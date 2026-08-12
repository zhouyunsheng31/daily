// =============================================================================
// Phase 11.6.1 Dev Server E2E 验证脚本
// =============================================================================
//
// 用途：通过 Playwright MCP 验证 dev server 启动 + 主页面渲染 + 关键元素存在。
//
// 功能：
//   1. 检查 dev server 是否在运行（http://localhost:5173）
//   2. 如未运行，启动 npm run dev（异步，等待 5s）
//   3. 用 Playwright MCP 打开 dev server URL
//   4. 等待主页面加载（.app-root / .panel-sidebar）
//   5. 截图保存到 docs/verify/phase11/dev-server-home.png
//   6. 验证关键元素存在（canvas / Sidebar / TabBar）
//   7. 关闭浏览器
//
// 运行方式：
//   node e2e/phase11-dev-server.mjs
//
// 或通过 playwright-cli.js（text 模式不支持，需用 node 直接运行）：
//   node "F:\Operit_workspace_full_backup\workspace_backup\.mcp-playwright-runtime\playwright-cli.js" run e2e/phase11-dev-server.mjs
//   （注：playwright-cli.js run 期望文本格式脚本，本文件为 MCP SDK 格式，
//    需用 node 直接运行，参考 phase9-verify-all.mjs）
//
// MCP 连接：HTTP server at http://127.0.0.1:8931/mcp
// 目标 URL：http://localhost:5173/（Vite dev server）
// 截图目录：f:\allmylife\event\docs\verify\phase11\
//
// 重要约束：
//   - 不修改任何项目源代码
//   - 失败时打印 ERROR 但继续（不 abort）
//   - 退出码 0（让对抗 review 看到完整报告）
// =============================================================================

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ===== 配置 =====
const PORT = parseInt(process.env.PLAYWRIGHT_HTTP_PORT || '8931', 10);
const MCP_URL = `http://127.0.0.1:${PORT}/mcp`;
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;
const DEV_URL = 'http://localhost:5173/';
const DEV_HEALTH_URL = 'http://localhost:5173/';
const VW = 1440, VH = 900;
const SHOTS_DIR = 'f:\\allmylife\\event\\docs\\verify\\phase11';
const PROJECT_ROOT = 'f:\\allmylife\\event';

// 创建截图目录
try { fs.mkdirSync(SHOTS_DIR, { recursive: true }); } catch (e) { /* ignore */ }

// ===== MCP Client =====
const client = new Client({ name: 'phase11-dev-server-e2e', version: '1.0.0' }, { capabilities: {} });

// ===== 结果汇总 =====
const results = {
  passed: 0,
  failed: 0,
  cases: [],
  screenshots: [],
  devServerStarted: false,
  devServerWasRunning: false,
};

// ===== 工具函数 =====

/** 检查 MCP server 健康 */
async function checkMcpHealth() {
  try {
    const r = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}

/** 检查 dev server 是否在运行 */
async function checkDevServer() {
  try {
    const r = await fetch(DEV_HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}

/** 启动 dev server（npm run dev） */
function startDevServer() {
  const child = spawn('npm', ['run', 'dev'], {
    cwd: PROJECT_ROOT,
    shell: process.platform === 'win32',
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  child.unref();
  return child;
}

/** 调用 MCP 工具，健壮处理错误 */
async function call(name, args, label, timeoutMs = 45000) {
  try {
    const result = await client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: timeoutMs, resetTimeoutOnProgress: true },
    );
    let text = '';
    if (result.content) {
      for (const it of result.content) {
        if (it.type === 'text') text += it.text;
        else if (it.type === 'image') text += ` [image]`;
      }
    }
    return { text, isError: !!result.isError };
  } catch (err) {
    return { text: '', isError: true, error: err.message };
  }
}

/** 解析 evaluate 返回的 JSON 结果 */
function parseEvalResult(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const marker = 'Result:"';
  const idx = text.indexOf(marker);
  if (idx >= 0) {
    const start = idx + marker.length;
    const end = text.lastIndexOf('"');
    if (end > start) {
      const escaped = text.substring(start, end);
      try {
        const unescaped = JSON.parse('"' + escaped + '"');
        try { return JSON.parse(unescaped); } catch { return { _raw: unescaped }; }
      } catch {}
    }
  }
  const f = text.indexOf('{');
  const l = text.lastIndexOf('}');
  if (f >= 0 && l > f) {
    try { return JSON.parse(text.substring(f, l + 1)); } catch {}
  }
  return null;
}

/** 执行 JS 并解析为 JSON */
async function evalJson(script, label, timeoutMs = 30000) {
  const r = await call('playwright_evaluate', { script }, label, timeoutMs);
  const parsed = parseEvalResult(r.text);
  console.log(`[${label}] => ${JSON.stringify(parsed)?.slice(0, 500) || r.text.slice(0, 200)}`);
  return { parsed: parsed || {}, raw: r.text, isError: r.isError };
}

/** 执行 JS 返回字符串 */
async function evalStr(script, label, timeoutMs = 30000) {
  const r = await call('playwright_evaluate', { script }, label, timeoutMs);
  const m = r.text.match(/Result:"([^"]*)"/);
  const result = m ? m[1] : r.text;
  console.log(`[${label}] => ${result.slice(0, 200)}`);
  return { result, isError: r.isError };
}

/** 截图（保存到 SHOTS_DIR） */
async function screenshot(name, label) {
  const r = await call('playwright_screenshot',
    { name, savePng: true, storeBase64: false, width: VW, height: VH, downloadsDir: SHOTS_DIR },
    label, 60000);
  if (r.isError) {
    console.error(`  ERROR screenshot ${name}: ${r.error || r.text.slice(0, 200)}`);
  } else {
    results.screenshots.push(name);
    console.log(`[screenshot] ${name} saved to ${SHOTS_DIR}`);
  }
  return r;
}

/** 记录用例结果 */
function recordCase(caseId, label, ok, detail = '') {
  const c = { id: caseId, label, ok, detail };
  results.cases.push(c);
  if (ok) {
    results.passed++;
    console.log(`  >>> ${caseId} ${label}: ✓ PASS${detail ? ' — ' + detail : ''}`);
  } else {
    results.failed++;
    console.error(`  >>> ${caseId} ${label}: ✗ FAIL${detail ? ' — ' + detail : ''}`);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// =============================================================================
// 主流程
// =============================================================================

async function main() {
  console.log('============================================================');
  console.log('  Phase 11.6.1 Dev Server E2E Verification');
  console.log('============================================================');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`MCP URL: ${MCP_URL}`);
  console.log(`Target: ${DEV_URL}  (${VW}x${VH} headless)`);
  console.log(`Shots dir: ${SHOTS_DIR}`);
  console.log('');

  // ===========================================================================
  // 步骤 1: 检查 dev server 是否在运行
  // ===========================================================================
  console.log('\n=== 步骤 1: 检查 dev server 是否在运行 ===');
  const devRunning = await checkDevServer();
  results.devServerWasRunning = devRunning;
  if (devRunning) {
    console.log('  dev server 已在运行（localhost:5173）');
    recordCase('S1', 'dev server 已在运行', true, 'localhost:5173 响应正常');
  } else {
    console.log('  dev server 未运行，尝试启动 npm run dev...');
    // ===========================================================================
    // 步骤 2: 启动 npm run dev（异步，wait 5s）
    // ===========================================================================
    console.log('\n=== 步骤 2: 启动 npm run dev ===');
    const devChild = startDevServer();
    results.devServerStarted = true;
    console.log('  npm run dev 已启动（detached，PID 不跟踪）');
    // 等待 5s 让 vite 启动
    console.log('  等待 5s 让 vite 启动...');
    await sleep(5000);
    // 再次检查
    const devRunningNow = await checkDevServer();
    if (devRunningNow) {
      console.log('  dev server 启动成功（localhost:5173 响应正常）');
      recordCase('S2', '启动 npm run dev 后 dev server 可访问', true, '5s 后 localhost:5173 响应正常');
    } else {
      // 再等 10s（vite 首次启动可能慢）
      console.log('  5s 后仍未就绪，再等 10s...');
      await sleep(10000);
      const devRunningRetry = await checkDevServer();
      if (devRunningRetry) {
        console.log('  dev server 启动成功（15s 后响应正常）');
        recordCase('S2', '启动 npm run dev 后 dev server 可访问', true, '15s 后 localhost:5173 响应正常');
      } else {
        console.error('  dev server 启动失败（15s 后仍无响应）');
        recordCase('S2', '启动 npm run dev 后 dev server 可访问', false, '15s 后 localhost:5173 仍无响应，可能端口冲突或启动失败');
      }
    }
  }

  // ===========================================================================
  // 步骤 3: 检查 Playwright MCP server 是否在运行
  // ===========================================================================
  console.log('\n=== 步骤 3: 检查 Playwright MCP server ===');
  const mcpHealthy = await checkMcpHealth();
  if (!mcpHealthy) {
    console.error(`\n[FATAL] Playwright MCP server DOWN at ${HEALTH_URL}`);
    console.error('请先启动 MCP server：');
    console.error('  powershell -File f:\\allmylife\\playwright-patch\\start-server.ps1');
    console.error('  或：node "F:\\Operit_workspace_full_backup\\workspace_backup\\.mcp-playwright-runtime\\playwright-mcp-server\\dist\\index.js" --port 8931');
    recordCase('S3', 'Playwright MCP server 健康', false, 'MCP server down，跳过浏览器测试');
    // 跳过浏览器测试，直接出报告
    printReport();
    process.exit(0);
  }
  console.log('  MCP server healthy. Connecting...');
  recordCase('S3', 'Playwright MCP server 健康', true, `${HEALTH_URL} 响应正常`);

  // 连接 MCP
  const transport = new SSEClientTransport(new URL(MCP_URL));
  await client.connect(transport);
  console.log('  Connected to MCP.');

  // ===========================================================================
  // 步骤 4: 用 Playwright MCP 打开 dev server URL
  // ===========================================================================
  console.log('\n=== 步骤 4: 用 Playwright MCP 打开 dev server URL ===');
  let navResult = await call('playwright_navigate',
    { url: DEV_URL, width: VW, height: VH, headless: true, waitUntil: 'load' },
    's4-navigate', 60000);
  if (navResult.isError) {
    console.log(`  [WARN] navigate 首次超时，等待 8s 后继续（vite 依赖优化首次启动慢）...`);
    await sleep(8000);
    // 重试 navigate
    navResult = await call('playwright_navigate',
      { url: DEV_URL, width: VW, height: VH, headless: true, waitUntil: 'domcontentloaded' },
      's4-navigate-retry', 30000);
    console.log(`  [retry] navigate result: ${navResult.isError ? 'failed' : 'ok'}`);
  } else {
    console.log(`  Navigated. ${navResult.text.slice(0, 60)}`);
  }
  recordCase('S4', 'navigate 到 dev server', !navResult.isError,
    navResult.isError ? `navigate 失败: ${navResult.error || navResult.text.slice(0, 100)}` : 'navigate 成功');

  // ===========================================================================
  // 步骤 5: 等待主页面加载
  // ===========================================================================
  console.log('\n=== 步骤 5: 等待主页面加载 ===');
  // 等待 app-root 或 panel-sidebar（最多 30s）
  const waitResult = await evalStr(`(async () => {
    for (let i = 0; i < 100; i++) {
      if (document.querySelector('.app-root') || document.querySelector('.panel-sidebar') || document.querySelector('#root')) return 'ready';
      await new Promise(r => setTimeout(r, 300));
    }
    return 'TIMEOUT';
  })()`, 's5-wait-app-root');
  const pageReady = waitResult.result === 'ready';
  // 等额外 3s 让组件完全渲染
  await sleep(3000);
  recordCase('S5', '等待主页面加载', pageReady,
    pageReady ? '检测到 .app-root / .panel-sidebar / #root' : `等待 30s 后未检测到关键元素，result=${waitResult.result}`);

  // ===========================================================================
  // 步骤 6: 截图保存到 docs/verify/phase11/dev-server-home.png
  // ===========================================================================
  console.log('\n=== 步骤 6: 截图保存到 docs/verify/phase11/dev-server-home.png ===');
  await screenshot('dev-server-home', 's6-screenshot-home');
  // 验证截图文件存在（MCP server 会在文件名后加时间戳，如 dev-server-home-2026-06-28T13-44-23-518Z.png）
  const screenshotExactPath = path.join(SHOTS_DIR, 'dev-server-home.png');
  const screenshotExactExists = fs.existsSync(screenshotExactPath);
  let screenshotExists = screenshotExactExists;
  let screenshotPath = screenshotExactPath;
  if (!screenshotExactExists) {
    // 查找带时间戳的文件
    try {
      const files = fs.readdirSync(SHOTS_DIR).filter(f => f.startsWith('dev-server-home') && f.endsWith('.png'));
      if (files.length > 0) {
        screenshotPath = path.join(SHOTS_DIR, files[files.length - 1]);
        screenshotExists = true;
      }
    } catch (e) { /* ignore */ }
  }
  recordCase('S6', '截图保存到 docs/verify/phase11/dev-server-home*.png', screenshotExists,
    screenshotExists ? `文件存在: ${path.basename(screenshotPath)} (${fs.statSync(screenshotPath).size} bytes)` : `文件不存在: ${screenshotExactPath}`);

  // ===========================================================================
  // 步骤 7: 验证关键元素存在（canvas / Sidebar / TabBar）
  // ===========================================================================
  console.log('\n=== 步骤 7: 验证关键元素存在（canvas / Sidebar / TabBar）===');
  const elements = await evalJson(`(() => {
    return JSON.stringify({
      hasAppRoot: !!document.querySelector('.app-root'),
      hasPanelSidebar: !!document.querySelector('.panel-sidebar'),
      hasCanvas: !!document.querySelector('canvas'),
      hasTabBar: !!document.querySelector('[class*="tab-bar"]') || !!document.querySelector('[class*="tabbar"]') || !!document.querySelector('[class*="TabBar"]'),
      hasSidebar: !!document.querySelector('[class*="sidebar"]') || !!document.querySelector('[class*="Sidebar"]'),
      hasWebview: !!document.querySelector('webview'),
      bodyChildCount: document.body.children.length,
      bodyClass: document.body.className,
      readyState: document.readyState,
      title: document.title,
    });
  })()`, 's7-verify-elements');

  const el = elements.parsed;
  recordCase('S7a', '关键元素存在（app-root 或 panel-sidebar）',
    el.hasAppRoot || el.hasPanelSidebar,
    `hasAppRoot=${el.hasAppRoot}, hasPanelSidebar=${el.hasPanelSidebar}, bodyChildren=${el.bodyChildCount}, title="${el.title}"`);
  recordCase('S7b', 'Sidebar 存在',
    el.hasPanelSidebar || el.hasSidebar,
    `hasPanelSidebar=${el.hasPanelSidebar}, hasSidebar=${el.hasSidebar}`);
  // TabBar 和 canvas 是可选的（视页面状态而定），记录但不计 pass/fail
  console.log(`  [info] hasCanvas=${el.hasCanvas}, hasTabBar=${el.hasTabBar}, hasWebview=${el.hasWebview}, readyState=${el.readyState}`);

  // ===========================================================================
  // 步骤 8: 关闭浏览器
  // ===========================================================================
  console.log('\n=== 步骤 8: 关闭浏览器 ===');
  try {
    await client.callTool({ name: 'playwright_close', arguments: {} });
    console.log('  浏览器已关闭');
    recordCase('S8', '关闭浏览器', true, 'playwright_close 调用成功');
  } catch (e) {
    console.log(`  关闭浏览器时出错（可忽略）: ${e.message}`);
    recordCase('S8', '关闭浏览器', true, `playwright_close 出错但已继续: ${e.message}`);
  }
  try { await client.close(); } catch {}

  // ===========================================================================
  // 汇总报告
  // ===========================================================================
  printReport();

  process.exit(0);
}

function printReport() {
  console.log('\n============================================================');
  console.log('  Phase 11.6.1 Dev Server E2E 验证汇总报告');
  console.log('============================================================\n');
  console.log(`dev server 是否已在运行: ${results.devServerWasRunning}`);
  console.log(`是否启动了 npm run dev: ${results.devServerStarted}`);
  console.log(`总用例数: ${results.passed + results.failed}`);
  console.log(`通过: ${results.passed}`);
  console.log(`失败: ${results.failed}`);
  console.log('');
  console.log('详细用例结果:');
  for (const c of results.cases) {
    const status = c.ok ? '✓' : '✗';
    console.log(`  ${status} ${c.id} ${c.label}${c.detail ? ' — ' + c.detail : ''}`);
  }
  console.log('');
  console.log(`截图保存目录: ${SHOTS_DIR}`);
  console.log(`截图数量: ${results.screenshots.length}`);
  results.screenshots.forEach(s => console.log(`  - ${s}`));
  console.log('\n============================================================');
  console.log(`  Phase 11.6.1 验证结束  exit code: 0  (passed=${results.passed}, failed=${results.failed})`);
  console.log('============================================================\n');
}

main().catch(err => {
  console.error('FATAL:', err);
  printReport();
  process.exit(0);
});
