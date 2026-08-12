// S11 Web 端右键菜单：基于 DOM 的最小实现，注入 window.contextMenuApi
// desktop 端通过 Electron IPC 调用原生菜单；Web 端用 DOM 菜单替代
// contextMenu.ts 中 showContextMenu 调用 window.contextMenuApi.show(items) 并接收选中索引
import { useEffect, type ReactNode } from 'react'
import type { ContextMenuApi } from '../types/electron'

// 记录最近一次 contextmenu 事件的位置（show 调用时 event 已结束，无法直接获取坐标）
let lastContextMenuX = 0
let lastContextMenuY = 0

let activeMenu: HTMLDivElement | null = null

function showMenu(items: Array<{ label: string; enabled?: boolean }>): Promise<number> {
  return new Promise((resolve) => {
    // 若已有菜单打开，先关闭并 resolve(-1)
    if (activeMenu) {
      activeMenu.remove()
      activeMenu = null
    }

    const menu = document.createElement('div')
    menu.style.cssText = [
      'position:fixed',
      'z-index:99999',
      'background:#ffffff',
      'border:1px solid #e5e7eb',
      'border-radius:6px',
      'box-shadow:0 4px 12px rgba(0,0,0,0.15)',
      'padding:4px 0',
      'min-width:160px',
      'font-family:system-ui,sans-serif',
      'font-size:14px',
    ].join(';')

    let resolved = false
    const settle = (index: number) => {
      if (resolved) return
      resolved = true
      menu.remove()
      activeMenu = null
      document.removeEventListener('click', onOutsideClick, true)
      document.removeEventListener('contextmenu', onOutsideClick, true)
      resolve(index)
    }

    items.forEach((item, i) => {
      const menuItem = document.createElement('div')
      menuItem.textContent = item.label
      const disabled = item.enabled === false
      menuItem.style.cssText = [
        'padding:6px 16px',
        `cursor:${disabled ? 'not-allowed' : 'pointer'}`,
        `color:${disabled ? '#9ca3af' : '#1f2937'}`,
        'white-space:nowrap',
      ].join(';')
      if (!disabled) {
        menuItem.onmouseenter = () => { menuItem.style.background = '#f3f4f6' }
        menuItem.onmouseleave = () => { menuItem.style.background = 'transparent' }
        menuItem.onclick = (e) => {
          e.stopPropagation()
          settle(i)
        }
      }
      menu.appendChild(menuItem)
    })

    menu.style.left = `${lastContextMenuX}px`
    menu.style.top = `${lastContextMenuY}px`

    document.body.appendChild(menu)
    activeMenu = menu

    // 边界检测：防止菜单超出视口
    const rect = menu.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      menu.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`
    }

    const onOutsideClick = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        settle(-1)
      }
    }
    // 延迟添加监听，避免当前 contextmenu 事件冒泡触发立即关闭
    setTimeout(() => {
      document.addEventListener('click', onOutsideClick, true)
      document.addEventListener('contextmenu', onOutsideClick, true)
    }, 0)
  })
}

/**
 * WebContextMenu 组件：包裹应用，在 mount 时注入 window.contextMenuApi
 * S11 范围内 contextMenu 不被实际使用（S12 widget 右键菜单才需要）
 * 此组件提供最小 DOM 实现，让 contextMenu.ts 的 typeof 守卫在 Web 端也能走 api 分支
 */
export default function WebContextMenu({ children }: { children: ReactNode }) {
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      lastContextMenuX = e.clientX
      lastContextMenuY = e.clientY
    }
    document.addEventListener('contextmenu', onContextMenu)
    const api: ContextMenuApi = { show: showMenu }
    window.contextMenuApi = api
    return () => {
      document.removeEventListener('contextmenu', onContextMenu)
      if (activeMenu) {
        activeMenu.remove()
        activeMenu = null
      }
      window.contextMenuApi = undefined
    }
  }, [])
  return <>{children}</>
}
