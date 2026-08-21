import { useState, useRef, useCallback, useEffect } from 'react'
import { ClipboardList, FileText, FolderOpen } from 'lucide-react'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist'

/** 可靠复制：优先 Async Clipboard API，失败/不可用时回退到临时 textarea + execCommand */
async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续走 fallback（权限拒绝 / 非安全上下文 / WebView 等）
  }
  let textarea: HTMLTextAreaElement | null = null
  try {
    textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea?.remove()
  }
}

interface Props {
  widgetId: string
  panelId: string
  state: Record<string, unknown>
  onUpdateState: (partial: Record<string, unknown>) => void
  onEditingChange?: (editing: boolean) => void
}

export default function PdfViewer({ state, onUpdateState, onEditingChange }: Props) {
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState((state.currentPage as number) || 1)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [hasPdfSelection, setHasPdfSelection] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const renderIdRef = useRef(0)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const activeTextLayerRef = useRef<TextLayer | null>(null)
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const loadIdRef = useRef(0)
  const pointerCleanupRef = useRef<(() => void) | null>(null)
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cleanupPointerListeners = useCallback(() => {
    pointerCleanupRef.current?.()
    pointerCleanupRef.current = null
    if (releaseTimerRef.current !== null) {
      clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
    }
  }, [])

  const invalidateCurrentRender = useCallback(() => {
    renderIdRef.current += 1
    renderTaskRef.current?.cancel()
    renderTaskRef.current = null
    activeTextLayerRef.current?.cancel()
    activeTextLayerRef.current = null
    if (textLayerRef.current) textLayerRef.current.innerHTML = ''
  }, [])

  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDocRef.current || !canvasRef.current) return

    const renderId = ++renderIdRef.current

    renderTaskRef.current?.cancel()
    renderTaskRef.current = null
    activeTextLayerRef.current?.cancel()
    activeTextLayerRef.current = null

    if (textLayerRef.current) {
      textLayerRef.current.innerHTML = ''
    }
    window.getSelection()?.removeAllRanges()
    setHasPdfSelection(false)

    const page = await pdfDocRef.current.getPage(pageNum)
    if (renderIdRef.current !== renderId) return

    const viewport = page.getViewport({ scale: 1.5 })
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = viewport.width
    canvas.height = viewport.height

    const task = page.render({ canvas, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport })
    renderTaskRef.current = task

    try {
      await task.promise
    } catch {
      return
    } finally {
      if (renderTaskRef.current === task) {
        renderTaskRef.current = null
      }
    }

    if (renderIdRef.current !== renderId) return

    try {
      if (textLayerRef.current) {
        textLayerRef.current.innerHTML = ''
        const textContent = await page.getTextContent()
        if (renderIdRef.current !== renderId) return

        const container = textLayerRef.current
        if (!container) return

        const layer = new TextLayer({
          textContentSource: textContent,
          container,
          viewport,
        })
        activeTextLayerRef.current = layer

        await layer.render()

        if (renderIdRef.current !== renderId) {
          container.innerHTML = ''
          return
        }
      }
    } catch {
      if (renderIdRef.current === renderId && textLayerRef.current) {
        textLayerRef.current.innerHTML = ''
      }
    }

    if (renderIdRef.current !== renderId) return

    setCurrentPage(pageNum)
    onUpdateState({ currentPage: pageNum })
  }, [onUpdateState])

  const handleTextLayerPointerDown = useCallback(() => {
    cleanupPointerListeners()
    onEditingChange?.(true)

    const release = () => {
      pointerCleanupRef.current?.()
      pointerCleanupRef.current = null
      releaseTimerRef.current = setTimeout(() => {
        onEditingChange?.(false)
        releaseTimerRef.current = null
      }, 200)
    }

    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
    window.addEventListener('blur', release, true)

    pointerCleanupRef.current = () => {
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', release, true)
      window.removeEventListener('blur', release, true)
    }
  }, [cleanupPointerListeners, onEditingChange])

  useEffect(() => {
    return () => {
      cleanupPointerListeners()
      onEditingChange?.(false)
    }
  }, [cleanupPointerListeners, onEditingChange])

  const isSelectionInsideTextLayer = useCallback(() => {
    const selection = window.getSelection()
    const root = textLayerRef.current
    if (!selection || selection.isCollapsed || !root) return false
    return root.contains(selection.anchorNode) && root.contains(selection.focusNode)
  }, [])

  useEffect(() => {
    const update = () => {
      const next = isSelectionInsideTextLayer()
      setHasPdfSelection(prev => prev === next ? prev : next)
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [isSelectionInsideTextLayer])

  const handleCopySelected = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    if (!textLayerRef.current?.contains(selection.anchorNode)) return
    if (!textLayerRef.current?.contains(selection.focusNode)) return

    const text = selection.toString().trim()
    if (!text) return

    void copyTextToClipboard(text).then((ok) => {
      setCopyStatus(ok ? 'copied' : 'failed')
      setTimeout(() => setCopyStatus('idle'), 1500)
    })
  }, [])

  useEffect(() => {
    if (!pdfFile) return

    const loadId = ++loadIdRef.current
    let loadingTask: PDFDocumentLoadingTask | null = null

    ;(async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs')
        if (loadIdRef.current !== loadId) return

        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href
        const arrayBuffer = await pdfFile.arrayBuffer()
        if (loadIdRef.current !== loadId) return

        const task = pdfjsLib.getDocument({ data: arrayBuffer })
        loadingTask = task as unknown as PDFDocumentLoadingTask
        const pdf = await task.promise as unknown as PDFDocumentProxy
        if (loadIdRef.current !== loadId) {
          pdf.destroy()
          return
        }

        pdfDocRef.current = pdf
        setNumPages(pdf.numPages)
        const startPage = (state.currentPage as number) || 1
        renderPage(Math.min(startPage, pdf.numPages))
      } catch {
        if (loadIdRef.current === loadId) {
          console.error('PDF 加载失败')
        }
      }
    })()

    return () => {
      loadIdRef.current += 1
      loadingTask?.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfFile])

  useEffect(() => {
    return () => { invalidateCurrentRender() }
  }, [invalidateCurrentRender])

  const handlePrev = () => currentPage > 1 && renderPage(currentPage - 1)
  const handleNext = () => currentPage < numPages && renderPage(currentPage + 1)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    invalidateCurrentRender()
    cleanupPointerListeners()
    window.getSelection()?.removeAllRanges()
    setHasPdfSelection(false)
    setCurrentPage(1)
    setPdfFile(file)
  }

  return (
    <div className="pdf-viewer-body">
      {!pdfFile ? (
        <div className="workspace-empty" style={{ flex: 1 }}>
          <div className="workspace-empty-icon"><FileText size={32} /></div>
          <p className="workspace-empty-text">选择一个 PDF 文件</p>
          <button className="toolbar-btn primary" style={{ marginTop: 12 }} onClick={() => fileInputRef.current?.click()}>
            打开文件
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={handleFileChange} />
        </div>
      ) : (
        <>
          <div className="pdf-toolbar">
            <span className="pdf-page-info">{pdfFile.name}</span>
            <div className="pdf-controls">
              <button className="pdf-btn" onClick={handlePrev} disabled={currentPage <= 1}>‹</button>
              <span className="pdf-page-info">{currentPage} / {numPages}</span>
              <button className="pdf-btn" onClick={handleNext} disabled={currentPage >= numPages}>›</button>
              <button
                className="pdf-btn"
                onClick={handleCopySelected}
                disabled={!hasPdfSelection}
                title={copyStatus === 'copied' ? '已复制' : copyStatus === 'failed' ? '失败' : '复制选中文本'}
                style={!hasPdfSelection ? { opacity: 0.4 } : undefined}
              >
                {copyStatus === 'copied' ? '已复制' : copyStatus === 'failed' ? '失败' : <ClipboardList size={14} />}
              </button>
              <button className="pdf-btn" onClick={() => fileInputRef.current?.click()} title="更换文件"><FolderOpen size={14} /></button>
              <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={handleFileChange} />
            </div>
          </div>
          <div className="pdf-canvas-wrap" style={{ position: 'relative' }}>
            <canvas ref={canvasRef} />
            <div
              ref={textLayerRef}
              className="pdf-text-layer"
              data-widget-interactive="true"
              onPointerDown={handleTextLayerPointerDown}
            />
          </div>
        </>
      )}
    </div>
  )
}
