package xyz.shadowshub.appruntime

/**
 * app-runtime：WebView 沙箱运行 HTML App。
 * - WebView 预热池（≤2，LRU）
 * - WebMessagePort 桥接（app-sdk JS shim 注入）
 * - URL 拦截白名单
 * M0-3 验证（全方案最大不确定性）时填充；M0-1 仅建模块。
 */
object AppRuntimeMarker