declare module '*.css'

// 根 node_modules 的 lucide-react 为精简安装（无 dist/*.d.ts），提供最小类型
declare module 'lucide-react' {
  import type { ComponentType, SVGProps } from 'react'
  type IconProps = SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }
  type Icon = ComponentType<IconProps>
  export const Activity: Icon
  export const Ban: Icon
  export const BarChart3: Icon
  export const Check: Icon
  export const CircleDollarSign: Icon
  export const Eye: Icon
  export const KeyRound: Icon
  export const LoaderCircle: Icon
  export const LogOut: Icon
  export const Search: Icon
  export const ShieldCheck: Icon
  export const Sparkles: Icon
  export const Ticket: Icon
  export const UserRound: Icon
  export const Users: Icon
  export const X: Icon
}