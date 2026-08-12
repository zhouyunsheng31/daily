package xyz.shadowshub.overlayruntime

/**
 * overlay-runtime：悬浮窗/桌宠层。
 * - TYPE_APPLICATION_OVERLAY + 共享 overlay WebView 单 canvas（10 桌宠≠10 WebView）
 * - 点击穿透 hit-test
 * M0-4（悬浮窗验证）时填充；M0-1 仅建模块。
 */
object OverlayRuntimeMarker