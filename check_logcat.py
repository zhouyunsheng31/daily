"""Capture logcat for app PID, filter for WebView/JS errors."""
import subprocess
import sys

ADB = r"F:\Android SDK\platform-tools\adb.exe"
PKG = "com.livingdashboard"

# Get PID
r = subprocess.run([ADB, "shell", "pidof", PKG], capture_output=True, text=True)
pid = r.stdout.strip()
print(f"App PID: {pid}")

if not pid:
    print("[FATAL] App not running")
    sys.exit(1)

# Dump last 3000 lines for this PID
r = subprocess.run([ADB, "logcat", "-d", "-t", "3000", f"--pid={pid}"],
                   capture_output=True, text=True, encoding="utf-8", errors="replace")
lines = r.stdout.splitlines()
print(f"Total log lines: {len(lines)}")

# Filter relevant keywords
keywords = ["HtmlCanvas", "ConsoleMessage", "chromium", "Uncaught", "TypeError",
           "ReferenceError", "console:", "WebSettings", "factory:", "render:",
           "update:", "WebView", "background", "canvas", "rain", "clock",
           "error", "Error", "WARNING", "WARN", "Exception", "JS:",
           "glthread", "WebViewFactory", "resource"]

filtered = []
for line in lines:
    if any(kw in line for kw in keywords):
        filtered.append(line)

print(f"\nFiltered lines ({len(filtered)}):")
print("=" * 80)
for line in filtered[-100:]:
    print(line)
