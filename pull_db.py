"""Pull living.db from device via adb exec-out (binary-safe) and query HTML_CANVAS widgets."""
import sqlite3
import subprocess
import os
import sys
import json

ADB = r"F:\Android SDK\platform-tools\adb.exe"
PKG = "com.livingdashboard"
TMP_DIR = r"F:\allmylife\event\temp_db"
OUT_FILE = r"F:\allmylife\event\temp_html_analysis.txt"

os.makedirs(TMP_DIR, exist_ok=True)

def pull_file(remote, local):
    """Pull a file via adb exec-out run-as ... cat (binary-safe via subprocess pipes)."""
    cmd = [ADB, "exec-out", f"run-as {PKG} cat {remote}"]
    proc = subprocess.run(cmd, capture_output=True, check=False)
    if proc.returncode != 0:
        print(f"[WARN] {remote}: rc={proc.returncode} stderr={proc.stderr[:200]}")
        return False
    data = proc.stdout
    if len(data) < 16:
        print(f"[WARN] {remote}: too small ({len(data)} bytes): {data[:50]}")
        return False
    with open(local, "wb") as f:
        f.write(data)
    print(f"[OK] {remote} -> {local} ({len(data)} bytes)")
    return True

print("== Step 1: pull database files ==")
ok1 = pull_file("databases/living.db", os.path.join(TMP_DIR, "living.db"))
ok2 = pull_file("databases/living.db-wal", os.path.join(TMP_DIR, "living.db-wal"))
ok3 = pull_file("databases/living.db-shm", os.path.join(TMP_DIR, "living.db-shm"))

if not ok1:
    print("[FATAL] main db pull failed")
    sys.exit(1)

print("\n== Step 2: open sqlite and list tables ==")
conn = sqlite3.connect(os.path.join(TMP_DIR, "living.db"))
cur = conn.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
tables = [r[0] for r in cur.fetchall()]
print("Tables:", tables)

print("\n== Step 3: widgets schema ==")
cur.execute("PRAGMA table_info(widgets)")
for r in cur.fetchall():
    print(r)

print("\n== Step 4: list ALL widgets (id, type, title, w, h) ==")
cur.execute("SELECT id, panel_id, type, title, width, height, created_at FROM widgets ORDER BY created_at ASC")
all_rows = cur.fetchall()
for r in all_rows:
    print(r)

print("\n== Step 5: HTML_CANVAS widgets full state_json ==")
cur.execute("SELECT id, panel_id, type, title, state_json, width, height, created_at FROM widgets WHERE type='HTML_CANVAS' ORDER BY created_at ASC")
html_rows = cur.fetchall()
print(f"Found {len(html_rows)} HTML_CANVAS widgets")

# Also check FREE_HTML (since the task mentions AI-generated HTML components)
cur.execute("SELECT id, panel_id, type, title, state_json, width, height, created_at FROM widgets WHERE type='FREE_HTML' ORDER BY created_at ASC")
free_rows = cur.fetchall()
print(f"Found {len(free_rows)} FREE_HTML widgets")

# Also pull anything whose title mentions rain/clock/雨/钟/时 for safety
cur.execute("""SELECT id, panel_id, type, title, state_json, width, height, created_at
               FROM widgets
               WHERE title LIKE '%雨%' OR title LIKE '%rain%' OR title LIKE '%下雨%'
                  OR title LIKE '%钟%' OR title LIKE '%clock%' OR title LIKE '%时%'
                  OR title LIKE '%Rain%' OR title LIKE '%Clock%'
               ORDER BY created_at ASC""")
keyword_rows = cur.fetchall()
print(f"Found {len(keyword_rows)} widgets matching rain/clock keywords (by title)")

print("\n== Step 6: also scan state_json for rain/clock keywords ==")
cur.execute("""SELECT id, panel_id, type, title, state_json, width, height, created_at
               FROM widgets
               WHERE state_json LIKE '%rain%' OR state_json LIKE '%雨%'
                  OR state_json LIKE '%clock%' OR state_json LIKE '%钟%'
                  OR state_json LIKE '%requestAnimationFrame%'
                  OR state_json LIKE '%<canvas%'
               ORDER BY created_at ASC""")
content_rows = cur.fetchall()
print(f"Found {len(content_rows)} widgets matching rain/clock/canvas keywords (in state_json)")

conn.close()

# Combine all relevant rows, dedupe by id
all_relevant = {}
for r in html_rows + free_rows + keyword_rows + content_rows:
    all_relevant[r[0]] = r

print(f"\n== Total {len(all_relevant)} unique relevant widgets to dump ==")

# Write analysis file
with open(OUT_FILE, "w", encoding="utf-8") as f:
    f.write("=" * 80 + "\n")
    f.write("Android WebView HTML 组件诊断 - 数据库内容 dump\n")
    f.write("=" * 80 + "\n")
    f.write(f"ADB: {ADB}\n")
    f.write(f"Package: {PKG}\n")
    f.write(f"Database: living.db (Room v4)\n")
    f.write(f"Table: widgets\n")
    f.write(f"HTML 字段: state_json (JSON 字符串，含 html 字段)\n\n")

    # All widgets overview
    f.write("=" * 80 + "\n")
    f.write("[A] 所有 widgets 概览\n")
    f.write("=" * 80 + "\n")
    f.write(f"{'id':<40} {'type':<15} {'title':<30} {'w':<8} {'h':<8}\n")
    f.write("-" * 110 + "\n")
    for r in all_rows:
        wid, pid, wtype, title, w, h, ct = r
        f.write(f"{wid:<40} {wtype:<15} {(title or '')[:30]:<30} {w:<8} {h:<8}\n")
    f.write("\n")

    # All relevant widgets detailed
    f.write("=" * 80 + "\n")
    f.write("[B] 相关组件详细 state_json（HTML_CANVAS / FREE_HTML / 关键词匹配）\n")
    f.write("=" * 80 + "\n\n")
    for idx, (wid, pid, wtype, title, state_json, w, h, ct) in enumerate(all_relevant.values(), 1):
        f.write("-" * 80 + "\n")
        f.write(f"组件 #{idx}\n")
        f.write("-" * 80 + "\n")
        f.write(f"id:         {wid}\n")
        f.write(f"panel_id:   {pid}\n")
        f.write(f"type:       {wtype}\n")
        f.write(f"title:      {title}\n")
        f.write(f"width:      {w}\n")
        f.write(f"height:     {h}\n")
        f.write(f"created_at: {ct}\n")
        f.write(f"state_json length: {len(state_json) if state_json else 0}\n")
        f.write("\n--- state_json raw ---\n")
        f.write(state_json or "(empty)")
        f.write("\n\n--- state_json parsed (pretty) ---\n")
        try:
            parsed = json.loads(state_json) if state_json else {}
            f.write(json.dumps(parsed, indent=2, ensure_ascii=False))
        except Exception as e:
            f.write(f"(parse error: {e})")
        f.write("\n\n")
        # If html field exists, dump it raw
        try:
            parsed = json.loads(state_json) if state_json else {}
            if "html" in parsed:
                html = parsed["html"]
                f.write("--- html field (raw, unescaped) ---\n")
                f.write(html if isinstance(html, str) else str(html))
                f.write("\n\n")
        except Exception:
            pass

print(f"\n== Done. Wrote dump to {OUT_FILE} ==")
print("Analysis will follow in next step.")
