// 命令栈：按面板独立，用于 undo/redo 操作（笔迹、连线）。
// 不放 Zustand store 内（避免序列化问题，跨面板独立）。

export interface CanvasCommand {
  execute: () => void | Promise<void>
  undo: () => void | Promise<void>
  redo: () => void | Promise<void>
  description: string
}

const MAX_UNDO_STACK = 50

export class CommandStack {
  private undoStack: CanvasCommand[] = []
  private redoStack: CanvasCommand[] = []
  private failCount = 0

  push(cmd: CanvasCommand): void {
    this.undoStack.push(cmd)
    if (this.undoStack.length > MAX_UNDO_STACK) {
      this.undoStack.shift()
    }
    // 新操作清空 redo 栈
    this.redoStack = []
  }

  async undo(): Promise<boolean> {
    if (this.undoStack.length === 0) return false
    const cmd = this.undoStack.pop()!
    try {
      await cmd.undo()
      this.redoStack.push(cmd)
      this.failCount = 0
      return true
    } catch (e) {
      console.error('[CommandStack] undo failed:', e)
      this.failCount++
      if (this.failCount > 5) this.clear()
      return false
    }
  }

  async redo(): Promise<boolean> {
    if (this.redoStack.length === 0) return false
    const cmd = this.redoStack.pop()!
    try {
      await cmd.redo()
      this.undoStack.push(cmd)
      this.failCount = 0
      return true
    } catch (e) {
      console.error('[CommandStack] redo failed:', e)
      this.failCount++
      if (this.failCount > 5) this.clear()
      return false
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.failCount = 0
  }

  size(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length }
  }
}

const stackMap = new Map<string, CommandStack>()

export function getCommandStack(panelId: string): CommandStack {
  let stack = stackMap.get(panelId)
  if (!stack) {
    stack = new CommandStack()
    stackMap.set(panelId, stack)
  }
  return stack
}

export function clearAllCommandStacks(): void {
  stackMap.clear()
}
