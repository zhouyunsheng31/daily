#!/bin/bash
# ============================================================================
# UI 探索 · 生图脚本（调用服务器 ChatST 图像 API：gpt-image-2-super）
# ----------------------------------------------------------------------------
# 用法:
#   ./gen-image.sh "prompt 文字" 输出文件名.png [size]
#   ./gen-image.sh "prompt" 输出文件名.png 1024x1024
#
# - API key 从 ../server/.env 读取（CHATST_IMAGE_API_KEY），不硬编码、不落盘
# - 输出保存到 ./generated/ 目录
# - 错误时打印上游错误信息并退出非 0
# ============================================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../server/.env"
OUT_DIR="$SCRIPT_DIR/generated"

if [ $# -lt 2 ]; then
  echo "用法: $0 <prompt> <输出文件名.png> [size]" >&2
  exit 1
fi

PROMPT="$1"
OUT_NAME="$2"
SIZE="${3:-1024x1024}"
mkdir -p "$OUT_DIR"
OUT_PATH="$OUT_DIR/$OUT_NAME"

KEY="$(grep -E '^CHATST_IMAGE_API_KEY=' "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r\n')"
if [ -z "$KEY" ]; then
  echo "错误: 无法从 $ENV_FILE 读取 CHATST_IMAGE_API_KEY" >&2
  exit 1
fi

# 用 python3 做 JSON 转义（避免引号/换行问题）
PROMPT_JSON="$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$PROMPT")"

echo "▶ 生成中: ${PROMPT:0:60}… (size=$SIZE, 最长 180s)"
RESP="$(curl -sS --max-time 180 https://api.chatst.org/v1/images/generations \
  -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"gpt-image-2-super\",\"prompt\":$PROMPT_JSON,\"size\":\"$SIZE\",\"n\":1}")"

if [ $? -ne 0 ]; then
  echo "错误: 网络/超时失败" >&2
  exit 1
fi

# 解析响应：优先 b64_json，回退 url 下载
python3 - "$OUT_PATH" <<PYEOF
import sys, json, base64, urllib.request
out = sys.argv[1]
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except Exception as e:
    print(f"错误: 响应非 JSON: {e}", file=sys.stderr)
    print(raw[:400], file=sys.stderr)
    sys.exit(1)
if "error" in d:
    print(f"上游错误: {json.dumps(d['error'], ensure_ascii=False)[:400]}", file=sys.stderr)
    sys.exit(1)
items = d.get("data") or []
if not items:
    print("错误: 无图片返回", file=sys.stderr)
    sys.exit(1)
item = items[0]
if item.get("b64_json"):
    with open(out, "wb") as f:
        f.write(base64.b64decode(item["b64_json"]))
    print(f"✓ 已保存: {out}")
elif item.get("url"):
    urllib.request.urlretrieve(item["url"], out)
    print(f"✓ 已保存(URL): {out}")
else:
    print("错误: 数据格式未知", file=sys.stderr)
    sys.exit(1)
PYEOF