declare module 'pdfjs-dist/build/pdf.mjs' {
  export const GlobalWorkerOptions: {
    workerSrc: string
  }
  export function getDocument(params: { data: ArrayBuffer }): {
    promise: Promise<{
      numPages: number
      getPage: (n: number) => Promise<{
        getViewport: (params: { scale: number }) => { height: number; width: number }
        render: (params: {
          canvasContext: CanvasRenderingContext2D
          viewport: { height: number; width: number }
        }) => { promise: Promise<void> }
      }>
    }>
  }
}

declare module 'pdfjs-dist/build/pdf.worker.mjs'
