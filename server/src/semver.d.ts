// server/src/semver.d.ts —— semver 最小类型声明（semver 无 bundled types）
declare module 'semver' {
  /** 版本是否满足 range（如 ^1.2.0 / >=1.0.0 <2.0.0） */
  export function satisfies(version: string, range: string): boolean
  export function valid(version: string): string | null
  export function clean(version: string): string | null
}