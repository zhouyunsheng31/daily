/**
 * LdLogo 组件（Phase 7 批次1 任务2.6：BrowserHome Logo 对齐原型）
 *
 * 渲染渐变 LD 字母圆形 Logo（用 SVG，不依赖图片文件）：
 * - 圆形背景，紫色到蓝色渐变
 * - 中间显示 "LD" 字母（白色）
 * - 尺寸可配置（默认 48px）
 *
 * 用 SVG 而非 <img>：避免打包路径问题，支持任意尺寸缩放不失真。
 */
interface LdLogoProps {
  /** Logo 尺寸（宽=高=size），默认 48px */
  size?: number
}

export default function LdLogo({ size = 48 }: LdLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Daily Logo"
    >
      <defs>
        <linearGradient id="ld-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#667eea" />
          <stop offset="100%" stopColor="#764ba2" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="24" fill="url(#ld-gradient)" />
      <text
        x="24"
        y="32"
        textAnchor="middle"
        fontSize="18"
        fontWeight="bold"
        fill="white"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
      >
        LD
      </text>
    </svg>
  )
}
