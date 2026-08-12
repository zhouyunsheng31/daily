# Video Sprites — 视频转序列帧 / 抠图 / 精灵图（frameronin 技术复刻）

> 来源：https://frameronin.com/（独立游戏素材工具站）「视频转序列帧」+「抠图去背」+「Sprite Sheet」模块。
> 用途：把 AI 生成的视频变成**游戏可用的透明角色动画**（跑酷/横版/帧动画），或把任意视频变成帧序列素材。
> 本 skill 把 frameronin 的关键技术拆解为可执行流程；系统已内置 `edit_video to-sprite` 一键封装，
> 但遇到封装不满足的场景（特殊抠图/帧排序/合并）时按本 skill 自行复刻。

## 何时使用

- 用户要"把视频变成游戏角色/精灵图/序列帧/跑动动画"
- 生成视频后需要**去掉背景**（绿幕/纯色）做成透明素材
- 需要帧动画素材（走路/跑步/攻击循环）、Sprite Sheet 拼图
- 任何"视频 → 游戏素材"的需求

## 核心流程（视频 → 透明 Sprite Sheet）

### 1. 抽帧
- 目标帧数 N（跑动循环 8-12 帧足够；动作复杂可 12-16）
- 采样帧率 fps = N / 视频时长（如 4 秒视频取 8 帧 → fps=2）
- 缩放：角色高度建议 **96-160px**（太小细节丢、太大浪费）：
  `ffmpeg -i in.mp4 -vf "fps=2,scale=-1:128" frame-%02d.png`

### 2. 抠图（去背景）——frameronin 的三个关键参数
| 参数 | 含义 | 取值建议 |
|---|---|---|
| **容差 (fuzz)** | 与背景色距离多近算背景 | 绿幕/纯色背景 25-35%（ImageMagick `-fuzz 28%`）；背景不匀可到 40% |
| **羽化 (feather)** | 边缘过渡带宽度 | 2-6px（`-blur 0x0.5` 或 colorkey 的 similarity 第三参） |
| **抑色 (despill)** | 去掉角色边缘染上的背景色（绿幕边缘常见绿色描边） | `ffmpeg -vf "despill=green:0.5"`（蓝幕用 blue） |

实现（两段式，效果最好）：
```
# ① ImageMagick 容差透明（自动检测背景色：取首帧四角像素均值）
BG=$(convert frame-01.png -format "%[pixel:p{8,8}]" info:)
convert frame-01.png -fuzz 28% -transparent "$BG" -trim +repage \
  -background none -gravity center -extent 96x128 out-01.png
# ② ffmpeg despill 抑色（去掉角色边缘残留的背景色反射）
ffmpeg -i out-01.png -vf "despill=green:0.5:1" -c:v png clean-01.png
```
> 背景色检测技巧：取第一帧**四个角落**的像素色，两两最近的两个取平均 = 背景色
> （角落一般不被角色遮挡；四角都测避免某角正好是角色一部分）。

### 3. 裁剪到角色包围盒（帧间统一）
- 每帧 `-trim +repage` 裁掉透明边 → 得到角色实际包围盒
- 所有帧 **统一画布**（取最大包围盒或固定 3:4 比例），居中放置：
  `-background none -gravity center -extent 96x128`
- 不统一会导致帧动画抖动（角色左右漂移）

### 4. 拼 Sprite Sheet
- 一行拼图（帧动画从左到右循环）：`ffmpeg -i clean-%02d.png -filter_complex "tile=8x1" -frames:v 1 sprite.png`
- 必须 `-frames:v 1`（否则 image2 muxer 报"同名文件"错误）
- 记录每帧尺寸 = sprite.width / N（游戏代码里按此切帧）

### 5. 游戏内使用
- `<img>` / `new Image()` 加载 sprite（**务必加 `crossOrigin='anonymous'`**，
  否则 sandbox iframe 里 canvas 被污染，getImageData/toDataURL 报 SecurityError）
- 帧动画：`ctx.drawImage(sprite, frameIdx*frameW, 0, frameW, frameH, x, y, w, h)`
- 角色绘制尺寸建议：高度占画面 **12-20%**（太小看不清；示例游戏曾因 56px 太小被吐槽）

## 其他 frameronin 能力复刻

- **转 GIF**：两遍法（palettegen → paletteuse）质量最好：
  `ffmpeg -i in.mp4 -vf "fps=10,scale=480:-1:flags=lanczos,palettegen" pal.png`
  `ffmpeg -i in.mp4 -i pal.png -lavfi "fps=10,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse" out.gif`
- **帧排序/合并**：`-vf "select=..."` 选帧；`tile` 合并；GIF 可 `-vf "reverse"` 倒放
- **双背景去背**：背景有两种色时，先按主色抠一次，剩余杂点用 `-fuzz` 小范围再抠一次
- **瓦片地图/场景**：类似流程抽帧拼图，`-trim` 后按 grid 布局

## 系统内置封装（优先使用）

`edit_video` 工具（webOS 会话内）：
- **`to-sprite`**：一键完成 抽帧→检测背景→抠图→despill→裁剪→拼图（推荐直接用这个）
- `extract-frames`：只抽帧
- `sprite-sheet`：抽帧+拼图（不抠图）
- `remove-bg`：绿幕/纯色 → 透明 webm（视频级，可再喂给 to-sprite）
- 产物自动落在工作区 agent/media/ 并提供公开 URL

## 质量检查清单

- [ ] 背景像素 alpha=0（`identify -format "%[pixel:p{8,8}]"` 应为 rgba(...,0)）
- [ ] 角色边缘无背景色描边（despill 是否生效）
- [ ] 各帧角色位置一致（无抖动：统一 extent 后逐帧比较包围盒中心）
- [ ] sprite 尺寸 = frameW × N（N=帧数）
- [ ] 游戏里角色绘制尺寸足够大（高度 ≥ 画面 12%）
