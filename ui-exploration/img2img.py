#!/usr/bin/env python3
# ============================================================================
# UI 探索 · 图生图脚本（ChatST /v1/images/edits，基于参考图优化生成）
# 用法: python3 img2img.py "<prompt>" <参考图.png> <输出.png>
# - API key 从 ../server/.env 读取（CHATST_IMAGE_API_KEY），不硬编码、不落盘
# ============================================================================
import sys, os, json, base64, uuid, urllib.request

if len(sys.argv) < 4:
    print('用法: img2img.py "<prompt>" <ref.png> <out.png>', file=sys.stderr)
    sys.exit(1)

prompt, ref_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

# 读 key（不打印）
key = None
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server', '.env')
with open(env_path, 'r', encoding='utf-8') as f:
    for line in f:
        if line.startswith('CHATST_IMAGE_API_KEY='):
            key = line.split('=', 1)[1].strip()
            break
if not key:
    print('错误: 无法读取 CHATST_IMAGE_API_KEY', file=sys.stderr)
    sys.exit(1)

with open(ref_path, 'rb') as f:
    ref = f.read()
ref_type = 'image/jpeg' if ref[:3] == b'\xff\xd8\xff' else 'image/png'

boundary = '----daily-img2img-%s' % uuid.uuid4().hex[:8]
parts = []
def push(name, value):
    parts.append(('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n' % (boundary, name, value)).encode('utf-8'))

push('model', 'gpt-image-2-super')
push('prompt', prompt)
parts.append(('--%s\r\nContent-Disposition: form-data; name="image"; filename="ref.%s"\r\nContent-Type: %s\r\n\r\n' % (boundary, 'jpg' if ref_type == 'image/jpeg' else 'png', ref_type)).encode('utf-8'))
parts.append(ref)
parts.append(('\r\n--%s--\r\n' % boundary).encode('utf-8'))
body = b''.join(parts)

req = urllib.request.Request('https://api.chatst.org/v1/images/edits', data=body, method='POST')
req.add_header('Authorization', 'Bearer ' + key)
req.add_header('Content-Type', 'multipart/form-data; boundary=' + boundary)
print('▶ 图生图: %s…' % prompt[:60])
try:
    with urllib.request.urlopen(req, timeout=240) as resp:
        data = json.loads(resp.read().decode('utf-8'))
except Exception as e:
    print('ERROR: %s' % e, file=sys.stderr)
    sys.exit(1)

if 'error' in data:
    print('上游错误: %s' % json.dumps(data['error'], ensure_ascii=False)[:400], file=sys.stderr)
    sys.exit(1)

items = data.get('data') or []
if not items:
    print('ERROR: 无图片返回 %s' % json.dumps(data)[:300], file=sys.stderr)
    sys.exit(1)

item = items[0]
if item.get('b64_json'):
    with open(out_path, 'wb') as f:
        f.write(base64.b64decode(item['b64_json']))
elif item.get('url'):
    urllib.request.urlretrieve(item['url'], out_path)
print('✓ 已保存: %s' % out_path)
