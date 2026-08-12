/**
 * useWebviewPool：webview 并发限制 hook（Phase 7 批次5 任务2）
 *
 * 简单计数器 + 队列，限制同时活跃的 webview 数量为 MAX_CONCURRENT_WEBVIEWS。
 * 超出的进入队列等待，其他 webview 释放后才会被唤醒。
 *
 * 设计要点：
 * - 模块级单例状态（activeCount + queue），所有调用方共享同一个池
 * - acquire() 返回 Promise，await 后才创建 webview
 * - release() 时若有等待者，直接移交位置（不增减 activeCount）
 * - 无等待者时 release() 才 activeCount--
 *
 * 计数逻辑：
 * - acquire 成功（未满）：activeCount++
 * - acquire 入队（已满）：不 activeCount++，等待 release 时移交位置
 * - release 有等待者：弹出并唤醒（位置移交，不增减 activeCount）
 * - release 无等待者：activeCount--
 */
import { useCallback } from 'react'

/** 最大并发 webview 数量（Phase 15 批次5：spec 7.1.1 要求最多 3 个并发） */
const MAX_CONCURRENT_WEBVIEWS = 3

/** 当前活跃 webview 数量（模块级单例） */
let activeCount = 0

/** 等待队列（FIFO，存 resolve 回调） */
const queue: Array<() => void> = []

export interface UseWebviewPoolReturn {
  /** 获取一个 webview 位置（若已满则排队等待） */
  acquire: () => Promise<void>
  /** 释放一个 webview 位置（若有等待者则直接移交） */
  release: () => void
  /** 当前活跃 webview 数量 */
  getActiveCount: () => number
  /** 当前等待队列长度 */
  getQueueLength: () => number
}

/**
 * webview 并发池 hook
 * 返回 acquire/release 方法，用于限制 webview 并发数量
 */
export function useWebviewPool(): UseWebviewPoolReturn {
  const acquire = useCallback((): Promise<void> => {
    // 未满：直接获取位置
    if (activeCount < MAX_CONCURRENT_WEBVIEWS) {
      activeCount++
      return Promise.resolve()
    }
    // 已满：入队等待（被唤醒时不 activeCount++，因为位置是 release 时移交的）
    return new Promise<void>(resolve => {
      queue.push(resolve)
    })
  }, [])

  const release = useCallback((): void => {
    if (queue.length > 0) {
      // 有等待者：直接移交位置（弹出队列头并唤醒，不增减 activeCount）
      const next = queue.shift()
      if (next) {
        next()
        return
      }
    }
    // 无等待者：释放位置
    activeCount = Math.max(0, activeCount - 1)
  }, [])

  return {
    acquire,
    release,
    getActiveCount: () => activeCount,
    getQueueLength: () => queue.length,
  }
}
