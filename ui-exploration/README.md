# ui-exploration · UI 探索工作区

> Daily Android 端 UI/图标探索专属目录（2026-08-16 建立）。**无上下文的 AI 接手时先读本文件。**
> 关联规范：`docs/android/10-ui-design.md`（§0 用户方向 v1 / §2.1 UI 包化边界 / §4 图标 brief）、`docs/android/03-package-system.md`（§5.1 UI 开放）。

## 1. 当前状态（2026-08-16）

- **App 图标已定稿 = E1**：`generated/icon-E1-selected.png`（= `icon-E1-glow-polish.png`）
- **全套 UI 基调已定 = 「清亮通透 + 平面化优化」**：4 页探索稿在 `generated/ui-full-*.png`（对话主页 / 沉浸桌面启动器 / 个人中心 / 设置页）
- 下一步（M1-1）：E1 转 Adaptive Icon（矢量重绘前景 + 背景 + monochrome）+ 选定 UI 落成 Compose 默认主题 tokens；双主题截图评审（M0-6 走查，用户主导）

## 2. 设计语言（已定，勿改）

- **图标**：深蓝底 `#0F172A` + 亮蓝光点 `#4F8CFF` + 白色高光点（左上）；原占位 XML 版备份在 `current-xml-icon/`（后续可能复用）
- **UI**：暖白底（`#f8f7f3` → 浅灰蓝渐变）+ 毛玻璃半透明卡片 + 扁平圆角图标 + 亮蓝 `#4F8CFF` 点缀 + 大留白 + 细暖阴影；手机 OS 清亮通透质感
- **包化**：本套 = 系统默认 UI 包（`com.daily.system.ui` 子包）v1（D20）；除安全 UI（权限弹窗/授权页）外全部可经包修改，默认包常驻可回退（10 §2.1）

## 3. 资产清单

| 路径 | 内容 |
|---|---|
| `generated/ref-current-icon.png` | 当前 Android 占位图标复刻（PIL，参考图） |
| `generated/icon-E1-selected.png` | **定稿图标**（图生图优化，含背景） |
| `generated/icon-E1-glow-polish-transparent.png` | E1 去背景透明版（前景层用） |
| `generated/icon-E2-*.png` / `icon-E3-*.png` | 落选候选（渐变立体 / 光点+网格） |
| `generated/ui-full-chat-v2.png` | 对话主页（定稿方向） |
| `generated/ui-full-desktop-launcher.png` | 沉浸桌面（启动器） |
| `generated/ui-full-profile.png` | 个人中心 |
| `generated/ui-full-settings.png` | 设置页 |
| `current-xml-icon/` | 现 XML 版图标备份（ic_launcher*.xml ×4） |
| `gen-image.sh` | 文生图（ChatST gpt-image-2-super，key 从 `../server/.env` 读，不落盘） |
| `img2img.py` | 图生图（`/v1/images/edits` multipart） |
| `strip-bg.py` | 色度键去背景（PIL + numpy，默认基准 #0F172A） |
| `make-ref-icon.py` | 复刻当前图标为参考图（PIL） |

## 4. 常用命令

```bash
# 文生图（1024×1024 默认）
./gen-image.sh "prompt" 输出名.png [size]
# 图生图（基于参考图）
python3 img2img.py "prompt" 参考图.png 输出.png
# 去背景（默认基准色 #0F172A）
python3 strip-bg.py 输入.png 输出.png [RRGGBB] [阈值] [羽化]
```

> ⚠️ 纪律：生图产物统一归档 `generated/`；API key 只从 `server/.env` 读，不写进脚本/对话/日志；密钥不落盘、不入 Git。
