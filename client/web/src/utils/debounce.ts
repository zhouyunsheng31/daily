export function createDebouncedSave<T extends (...args: never[]) => void>(
  fn: T,
  delay: number
): { call: T; cancel: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null
  const call = ((...args: Parameters<T>) => {
    lastArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      fn(...args)
      timer = null
      lastArgs = null
    }, delay)
  }) as T
  const cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    lastArgs = null
  }
  const flush = () => {
    if (timer && lastArgs) {
      clearTimeout(timer)
      timer = null
      const args = lastArgs
      lastArgs = null
      fn(...args)
    }
  }
  return { call, cancel, flush }
}
