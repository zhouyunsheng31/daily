package com.livingdashboard.ui.components

/**
 * 底部栏模式枚举（Spec 7.4 节，v4 #5）。
 *
 * - [BROWSER]：浏览器模式（M1 原有，5 按钮 `[后退][前进][Home][标签][⋮]`）
 * - [CANVAS]：画布模式（M2 新增，5 按钮 `[缩小][放大][Home][标签][⋮]`，与浏览器模式对称）
 *
 * 设计目的：`BottomBar` 新增 `mode: BottomBarMode = BottomBarMode.BROWSER` 参数，
 * 默认 BROWSER 保持 M1 调用兼容（不传 mode 时仍按 M1 浏览器模式渲染）。
 */
enum class BottomBarMode {
    BROWSER,
    CANVAS
}
