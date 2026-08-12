// contextMenu 工具：封装 window.contextMenuApi.show，提供 showContextMenu(e, items) 签名
// window.contextMenuApi.show 仅接受 { label, enabled? } 数组并返回选中索引（Promise<number>）
// 此工具桥接 spec 中的 showContextMenu(e, items) 调用模式（items 含 onClick 回调）

interface ContextMenuItem {
  label: string
  onClick?: () => void | Promise<void>
  enabled?: boolean
}

/**
 * 显示右键菜单。
 * @param _e 触发菜单的鼠标事件（用于定位菜单，由主进程处理）
 * @param items 菜单项列表（含 label 和 onClick 回调）
 */
export async function showContextMenu(
  _e: React.MouseEvent | MouseEvent,
  items: ContextMenuItem[],
): Promise<void> {
  const api = window.contextMenuApi
  if (!api) {
    // 非 Electron 环境（如浏览器开发模式）：fallback 到 window.confirm 选择第一个项
    console.warn('[contextMenu] window.contextMenuApi not available, falling back')
    if (items.length > 0 && items[0].onClick) {
      await items[0].onClick()
    }
    return
  }

  const menuItems = items.map(i => ({ label: i.label, enabled: i.enabled }))
  const selectedIndex = await api.show(menuItems)
  if (selectedIndex >= 0 && selectedIndex < items.length) {
    const item = items[selectedIndex]
    if (item.onClick) {
      await item.onClick()
    }
  }
}
