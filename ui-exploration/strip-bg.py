#!/usr/bin/env python3
# ============================================================================
# UI 探索 · 图标背景去除（色度键 + 边缘羽化）
# 用法: python3 strip-bg.py <输入.png> <输出.png> [背景基准色RRGGBB] [阈值] [羽化]
# 默认背景基准色 #0F172A（当前图标深蓝底），阈值 70，羽化 40
# ============================================================================
import sys
import numpy as np
from PIL import Image

def main():
    if len(sys.argv) < 3:
        print('用法: strip-bg.py <in.png> <out.png> [RRGGBB] [thresh] [feather]', file=sys.stderr)
        sys.exit(1)
    src, dst = sys.argv[1], sys.argv[2]
    bg = tuple(int(sys.argv[3][i:i+2], 16) for i in (0, 2, 4)) if len(sys.argv) > 3 and len(sys.argv[3]) == 6 else (15, 23, 42)
    thresh = float(sys.argv[4]) if len(sys.argv) > 4 else 70.0
    feather = float(sys.argv[5]) if len(sys.argv) > 5 else 40.0

    img = Image.open(src).convert('RGBA')
    arr = np.array(img).astype(np.float32)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    dist = np.sqrt((r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2)
    # dist <= thresh → alpha 0（纯背景）；thresh~thresh+feather → 线性过渡；> → 255
    alpha = np.clip((dist - thresh) / feather * 255.0, 0, 255)
    arr[..., 3] = alpha
    # 半透明边缘去蓝边：alpha 越低，颜色越向背景色收敛，避免彩色描边残留
    t = (alpha / 255.0)[..., None]
    arr[..., :3] = arr[..., :3] * t + np.array(bg, dtype=np.float32) * (1 - t)

    Image.fromarray(arr.astype(np.uint8)).save(dst)
    print('✓ %s -> %s (bg=%s thresh=%s feather=%s)' % (src, dst, bg, thresh, feather))

if __name__ == '__main__':
    main()