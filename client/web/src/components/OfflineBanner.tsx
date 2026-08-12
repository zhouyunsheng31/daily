/**
 * OfflineBanner — Phase 9 批次 1 模块 8（离线降级 UI）
 *
 * 当 useRuntimeModeStore.isOfflineDowngraded === true 时，
 * 在顶部显示黄色 banner，提示用户当前处于离线降级模式。
 *
 * banner 提供"切换到云端"按钮，点击调用 setMode('cloud')：
 * - 用户显式选择云端后，effectiveMode 立即变为 'cloud'
 * - isOfflineDowngraded 变为 false（仅 auto 模式下离线才为 true）
 * - banner 消失（通过 CSS transition 平滑过渡）
 *
 * 设计要点：
 * - banner 出现/消失使用 CSS transition（max-height + opacity）
 * - 使用 lucide-react WifiOff 图标
 * - 不阻塞用户操作（仅顶部提示条）
 * - 与 App.tsx 的 app-topbar 同级（在 topbar 上方）
 */

import { useState, useEffect, memo, type ReactElement } from 'react'
import { WifiOff, X } from 'lucide-react'
import { useRuntimeModeStore } from '../stores/useRuntimeModeStore'

function OfflineBannerImpl(): ReactElement | null {
  const isOfflineDowngraded = useRuntimeModeStore(s => s.isOfflineDowngraded)
  const setMode = useRuntimeModeStore(s => s.setMode)

  // dismissed 用于"用户主动关闭 banner"的本地状态
  // （仅在当前 isOfflineDowngraded 期间关闭，下次再触发会重新显示）
  const [dismissed, setDismissed] = useState(false)

  // 当 isOfflineDowngraded 变化时重置 dismissed
  // （从 false → true 重新触发，或 true → false 后下次再触发）
  useEffect(() => {
    setDismissed(false)
  }, [isOfflineDowngraded])

  if (!isOfflineDowngraded || dismissed) return null

  const handleSwitchToCloud = (): void => {
    setMode('cloud')
  }

  const handleDismiss = (): void => {
    setDismissed(true)
  }

  return (
    <div
      className="offline-banner"
      role="alert"
      aria-live="polite"
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '8px 32px 8px 16px',
        background: 'linear-gradient(90deg, #fef3c7 0%, #fde68a 100%)',
        borderBottom: '1px solid #f59e0b',
        color: '#92400e',
        fontSize: '13px',
        fontWeight: 500,
        // 进入动画：高度 + 透明度过渡
        animation: 'offlineBannerSlideDown 240ms ease-out',
        // CSS transition 用于消失动画（通过 mounted 状态控制）
      }}
    >
      <WifiOff size={16} aria-hidden="true" />
      <span>
        已切换到本地 Agent（离线模式）。云端服务不可用，正在使用本地轻 Agent。
      </span>
      <button
        type="button"
        onClick={handleSwitchToCloud}
        aria-label="切换到云端模式"
        style={{
          marginLeft: '4px',
          padding: '3px 10px',
          background: '#92400e',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 500,
        }}
      >
        切换到云端
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="关闭提示"
        style={{
          position: 'absolute',
          right: '8px',
          top: '50%',
          transform: 'translateY(-50%)',
          padding: '2px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: '#92400e',
          opacity: 0.7,
          lineHeight: 0,
        }}
      >
        <X size={14} />
      </button>
      <style>{`
        @keyframes offlineBannerSlideDown {
          from {
            max-height: 0;
            opacity: 0;
            overflow: hidden;
          }
          to {
            max-height: 60px;
            opacity: 1;
          }
        }
      `}</style>
    </div>
  )
}

/**
 * memo 优化：仅在 isOfflineDowngraded / setMode 引用变化时重新渲染
 * （setMode 是 zustand action，引用稳定）
 */
export const OfflineBanner = memo(OfflineBannerImpl)
export default OfflineBanner
