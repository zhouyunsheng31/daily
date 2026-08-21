#!/usr/bin/env bash
# ============================================================
# Daily Android 一键构建（服务器中转方案）
# 场景：唯一开发机 = Android 手机（上行慢），香港服务器 x86_64（2h4g）
# 流程：打包 client/android → scp 服务器 → 服务器构建 → APK 拉回手机
# 用法：bash deploy/android-build.sh [--install] [--no-upload]
#   --install   构建成功后自动安装到手机（需 Shizuku/Root shell）
#   --no-upload 跳过上传（服务器源码未变时复用）
# 依赖：手机侧 git/ssh/scp；服务器侧 JDK17/SDK/Gradle 已就绪（见首次部署）
# ============================================================
set -euo pipefail

SSH_KEY=/data/user/0/com.ai.assistance.operit/files/ssh-keys/daily_server_ed25519
SERVER=root@154.64.249.172
SRC_DIR=/data/user/0/com.ai.assistance.operit/files/workspace/daily/daily
REMOTE_DIR=/root/android-build
GRADLE=/opt/gradle-9.1.0/bin/gradle
ANDROID_HOME=/root/Android

INSTALL=0
SKIP_UPLOAD=0
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=1 ;;
    --no-upload) SKIP_UPLOAD=1 ;;
  esac
done

echo "==> [1/5] 打包 client/android（排除构建产物）"
cd "$SRC_DIR"
tar czf /tmp/android-src.tar.gz \
  --exclude='build' --exclude='.gradle' --exclude='.kotlin' \
  --exclude='local.properties' --exclude='*tools*' --exclude='*aapt2*' \
  client/android
ls -lh /tmp/android-src.tar.gz | awk '{print "    package:", $5}'

if [ "$SKIP_UPLOAD" = "0" ]; then
  echo "==> [2/5] 上传到服务器"
  scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
    /tmp/android-src.tar.gz "$SERVER":/root/android-src.tar.gz
fi

echo "==> [3/5] 服务器准备 + 构建"
ssh -i "$SSH_KEY" -p 22 -o StrictHostKeyChecking=no "$SERVER" "
set -e
rm -rf $REMOTE_DIR && mkdir -p $REMOTE_DIR
tar xzf /root/android-src.tar.gz -C $REMOTE_DIR --strip-components=1
mv $REMOTE_DIR/android/* $REMOTE_DIR/ 2>/dev/null || true
rm -rf $REMOTE_DIR/android
cd $REMOTE_DIR
# 服务器是 x86_64：移除手机 proot 专用 ARM64 aapt2 hack（否则 linux-aarch64 变体不存在会失败）
sed -i '/ARM64 proot/d' build.gradle.kts
sed -i '/subprojects {/,/^}/d' build.gradle.kts
sed -i '/aapt2FromMavenOverride/d' gradle.properties
# 2h4g 服务器：限制内存与并发，防止 Gradle daemon 被 OOM killer 杀
sed -i 's|org.gradle.jvmargs=.*|org.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=384m -Dfile.encoding=UTF-8|' gradle.properties
echo 'sdk.dir=$ANDROID_HOME' > local.properties
export ANDROID_HOME=$ANDROID_HOME
$GRADLE :app:assembleDebug --no-daemon --max-workers=1 --console=plain
"

echo "==> [4/5] 拉回 APK"
scp -i "$SSH_KEY" -P 22 -o StrictHostKeyChecking=no \
  "$SERVER":$REMOTE_DIR/app/build/outputs/apk/debug/app-debug.apk \
  /sdcard/Download/daily-debug.apk
sha256sum /sdcard/Download/daily-debug.apk
echo "    APK: /sdcard/Download/daily-debug.apk"

if [ "$INSTALL" = "1" ]; then
  echo "==> [5/5] 安装到手机（需 Shizuku/Root）"
  cp /sdcard/Download/daily-debug.apk /data/local/tmp/daily-debug.apk
  chmod 644 /data/local/tmp/daily-debug.apk
  pm install -r -t /data/local/tmp/daily-debug.apk
  am start -n xyz.shadowshub.daily/.MainActivity
  echo "    Done: xyz.shadowshub.daily 已启动"
else
  echo "==> [5/5] 跳过安装（加 --install 自动安装）"
fi

echo "✅ 构建完成"