from PIL import Image, ImageDraw

# 复刻当前 Android 图标 (ic_launcher_foreground + background)
# 背景 #0F172A，前景：蓝色光点 #4F8CFF(中心偏上) + 白色高光小圆(下方)
S = 1024
img = Image.new('RGB', (S, S), '#0F172A')
d = ImageDraw.Draw(img)

# 光点（按 vector 108 视口放大：圆 M54,34 r20 → 中心(512,322) r190）
cx, cy, r = S/2, S*0.31, S*0.19
d.ellipse([cx-r, cy-r, cx+r, cy+r], fill='#4F8CFF')

# 白色高光小点（vector M54,46 r8 → 中心(512,437) r76）
hx, hy, hr = S/2, S*0.44, S*0.074
d.ellipse([hx-hr, hy-hr, hx+hr, hy+hr], fill='#FFFFFF')

img.save('/data/user/0/com.ai.assistance.operit/files/workspace/daily/daily/ui-exploration/generated/ref-current-icon.png')
print('saved ref-current-icon.png', img.size)
