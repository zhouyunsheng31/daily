// Direct electron-builder API call with error handling and timeout
// to diagnose why packaging hangs
import { build, Platform, Arch } from 'electron-builder';

const timeoutMs = 10 * 60 * 1000; // 10 min hard timeout
const timer = setTimeout(() => {
  console.error(`[TIMEOUT] Build did not complete within ${timeoutMs / 1000}s`);
  process.exit(2);
}, timeoutMs);

// Progress ping every 15s to prove process is alive
let pingCount = 0;
const ping = setInterval(() => {
  pingCount++;
  const mem = process.memoryUsage();
  console.log(`[ping ${pingCount}] alive, rss=${Math.round(mem.rss / 1024 / 1024)}MB heapUsed=${Math.round(mem.heapUsed / 1024 / 1024)}MB`);
}, 15000);

try {
  console.log('[1] Starting build via JavaScript API...');
  console.log('[1] Platform: WINDOWS, Target: nsis, Arch: x64');
  console.log('[1] asar: false (to isolate asar issue)');

  const result = await build({
    targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
    config: {
      asar: false,
      npmRebuild: false,
    },
  });

  clearInterval(ping);
  clearTimeout(timer);
  console.log('[SUCCESS] Build completed!');
  console.log('[SUCCESS] Artifacts:', result);
  process.exit(0);
} catch (err) {
  clearInterval(ping);
  clearTimeout(timer);
  console.error('[ERROR] Build failed:');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
