---
name: media-package
description: 平台官方 AI 生图与多媒体能力包（system.media）开发使用指南。当用户要求制作生图 App、头像生成 App、壁纸画廊 App，或在对话中调用媒体服务时，遵循本指南。
---

# 平台官方 AI 生图与媒体服务包（system.media）

本包为 Daily webOS 官方预置能力包，将平台的 AI 图像生成算力封装为标准能力包。

## 1. 在对话中调用
系统已自动为你注册 `appapi_media_generate_image` 工具，直接调用该工具即可为用户生成图片。

## 2. 在 App 内部集成（重要铁律）
在编写 HTML App 时，**严禁在沙箱中写 `fetch('/webos/api/...')`**（沙箱跨域无 Cookie 必报 401 失败）。
必须通过系统 SDK 调用本包：

```javascript
// 方式一：标准 App API 管道调用（推荐）
const res = await DailyWebOs.useApi('media').generateImage({
  prompt: '赛博朋克风格猫咪头像，8k 高清',
  size: '1024x1024'
});
if (res.ok && res.result && res.result.url) {
  document.getElementById('avatar-img').src = res.result.url;
}

// 方式二：宿主媒体快捷方法
const img = await DailyWebOs.media.generateImage({
  prompt: '二次元美少女插画',
  size: '1024x1024'
});
if (img.ok) {
  document.getElementById('avatar-img').src = img.url;
}
```
