/**
 * Vitest 全局 setup（Phase 11.1）
 *
 * 作用：
 * 1. 注入 @testing-library/jest-dom 的自定义 matchers（toBeInTheDocument 等）
 * 2. 后续可在此扩展全局 mock（如 IntersectionObserver、matchMedia 等）
 */
import '@testing-library/jest-dom/vitest'
