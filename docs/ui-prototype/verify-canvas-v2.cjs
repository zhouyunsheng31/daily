// canvas-core-v2 专属验证脚本（独立文件名，避免被覆盖）
const { chromium } = require('playwright');
const fs = require('fs');

const SCREENSHOTS_DIR = 'f:\\allmylife\\event\\docs\\ui-prototype\\.screenshots';
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  const errors = [];
  const consoleErrors = [];
  const warnings = [];

  page.on('pageerror', (err) => { errors.push(`[pageerror] ${err.message}`); });
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') consoleErrors.push(`[console.error] ${text}`);
    else if (type === 'warning') warnings.push(`[console.warn] ${text}`);
  });

  try {
    await page.goto('http://localhost:8765/canvas-core-v2.html', { waitUntil: 'commit', timeout: 30000 });
    await page.waitForTimeout(8000);

    console.log('=== V1 视图1：画布主页 ===');
    console.log(`  Tab 数: ${await page.locator('.tab-btn').count()} (期望 5)`);
    console.log(`  iframe widget 数: ${await page.locator('.iframe-widget').count()} (期望 3)`);
    console.log(`  自由 HTML 光球: ${await page.locator('.free-orb').count()} (期望 1)`);
    console.log(`  飘动光点: ${await page.locator('.free-particle').count()} (期望 5)`);
    console.log(`  下雨特效滴数: ${await page.locator('.rain-drop').count()} (期望 ≥30)`);
    console.log(`  AI 浮球: ${await page.locator('.ai-ball-glow').count()} (期望 1)`);
    console.log(`  登录弹窗: ${await page.locator('text=登录 Daily').count()} (期望 1)`);
    console.log(`  标注胶囊数: ${await page.locator('.label-chip').count()} (期望 ≥5)`);
    console.log(`  顶部工具栏: ${await page.locator('text=最大档').count() >= 1 ? '✓' : '✗'}`);

    await page.screenshot({ path: `${SCREENSHOTS_DIR}\\canvas-v2-view1.png` });

    // 先关闭登录弹窗
    await page.locator('div.pop-in button').first().click();
    await page.waitForTimeout(500);

    // 测试 iframe widget 拖拽
    const widgetBefore = await page.locator('.iframe-widget').first().boundingBox();
    await page.locator('.widget-titlebar').first().hover();
    await page.mouse.down();
    await page.mouse.move(widgetBefore.x + 80, widgetBefore.y + 60);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const widgetAfter = await page.locator('.iframe-widget').first().boundingBox();
    console.log(`  iframe widget 拖拽: ${Math.abs(widgetAfter.x - widgetBefore.x) > 30 ? '✓ 可拖拽' : '✗ 未移动'}`);

    // 测试 AI 浮球点击
    await page.locator('.ai-ball-glow').click();
    await page.waitForTimeout(400);
    console.log(`  AI 浮球展开: ${await page.locator('text=AI 助手').count() >= 1 ? '✓' : '✗'}`);
    await page.locator('.ai-ball-glow').click();
    await page.waitForTimeout(300);

    console.log('\n=== V2 视图2：相册缩放三档 ===');
    await page.locator('.tab-btn:has-text("相册缩放")').click();
    await page.waitForTimeout(500);
    console.log(`  [中档] 网格组件数: ${await page.locator('div.zoom-transition').count()}`);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}\\canvas-v2-view2-mid.png` });

    await page.locator('button:has-text("最小档")').click();
    await page.waitForTimeout(600);
    console.log(`  [最小档] Apple Watch 圆球数: ${await page.locator('.aw-bubble').count()} (期望 12)`);
    console.log(`  [最小档] 底部 AI 对话栏: ${await page.locator('text=问 AI 助手').count() >= 1 ? '✓' : '✗'}`);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}\\canvas-v2-view2-min.png` });

    await page.locator('button:has-text("最大档")').click();
    await page.waitForTimeout(600);
    console.log(`  [最大档] 标签: ${await page.locator('text=最大档 · 单个 HTML 占满全屏').count() >= 1 ? '✓' : '✗'}`);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}\\canvas-v2-view2-max.png` });

    console.log('\n=== V3 视图3：AI 对话两种形态 ===');
    await page.locator('.tab-btn:has-text("AI 对话形态")').click();
    await page.waitForTimeout(500);
    console.log(`  [浮球] 默认显示: ${await page.locator('text=浮球 · 始终置顶').count() >= 1 ? '✓' : '✗'}`);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}\\canvas-v2-view3-ball.png` });

    await page.locator('button:has-text("底部任务栏形态")').click();
    await page.waitForTimeout(500);
    console.log(`  [任务栏] 切换后显示: ${await page.locator('text=底部任务栏 · 椭圆发送框').count() >= 1 ? '✓' : '✗'}`);
    console.log(`  [任务栏] 对话气泡数: ${await page.locator('div.bubble-in').count()}`);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}\\canvas-v2-view3-taskbar.png` });

    console.log('\n=== V4 视图4：背景层示例 ===');
    await page.locator('.tab-btn:has-text("背景层")').click();
    await page.waitForTimeout(500);
    console.log(`  上半部分: ${await page.locator('text=图片背景 + 基础组件').count() >= 1 ? '✓' : '✗'}`);
    console.log(`  下半部分: ${await page.locator('text=特效背景 + 装饰元素').count() >= 1 ? '✓' : '✗'}`);
    console.log(`  天气组件: ${await page.locator('text=22°').count() >= 1 ? '✓ 显示天气' : '✗'}`);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}\\canvas-v2-view4.png` });

    console.log('\n=== V5 视图5：弹出层示例 ===');
    await page.locator('.tab-btn:has-text("弹出层")').click();
    await page.waitForTimeout(500);
    const cards = page.locator('div:has(> div > div:has-text("点击弹出"))');
    console.log(`  弹窗卡片数: ${await cards.count()}`);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}\\canvas-v2-view5-cards.png` });

    await cards.nth(0).click();
    await page.waitForTimeout(500);
    console.log(`  [登录] 弹出: ${await page.locator('text=登录后可同步画布').count() >= 1 ? '✓' : '✗'}`);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}\\canvas-v2-view5-login.png` });
    await page.locator('text=没有账号？').click().catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    // 点击遮罩关闭
    await page.evaluate(() => {
      const overlays = document.querySelectorAll('div[style*="backdrop-filter"]');
      if (overlays.length > 0) overlays[overlays.length-1].click();
    });
    await page.waitForTimeout(400);

    await cards.nth(1).click();
    await page.waitForTimeout(400);
    console.log(`  [引导] 弹出: ${await page.locator('text=Step 1/3').count() >= 1 ? '✓' : '✗'}`);
    await page.locator('button:has-text("下一步")').click();
    await page.waitForTimeout(300);
    console.log(`  [引导] 步骤2: ${await page.locator('text=Step 2/3').count() >= 1 ? '✓' : '✗'}`);
    await page.locator('button:has-text("跳过")').click();
    await page.waitForTimeout(300);

    await cards.nth(2).click();
    await page.waitForTimeout(400);
    console.log(`  [广告] 弹出: ${await page.locator('text=Daily Pro 上线').count() >= 1 ? '✓' : '✗'}`);
    await page.evaluate(() => {
      const overlays = document.querySelectorAll('div[style*="backdrop-filter"]');
      if (overlays.length > 0) overlays[overlays.length-1].click();
    });
    await page.waitForTimeout(400);

    await cards.nth(3).click();
    await page.waitForTimeout(400);
    console.log(`  [条件] 弹出: ${await page.locator('text=请先登录').count() >= 1 ? '✓' : '✗'}`);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}\\canvas-v2-view5-condition.png` });

    console.log('\n=== 控制台错误统计 ===');
    console.log(`pageerror 数: ${errors.length}`);
    errors.forEach(e => console.log('  ' + e));
    console.log(`console.error 数: ${consoleErrors.length}`);
    consoleErrors.slice(0, 10).forEach(e => console.log('  ' + e));
    console.log(`console.warn 数: ${warnings.length}`);
    warnings.slice(0, 5).forEach(e => console.log('  ' + e));

    const hasNoErrors = errors.length === 0 && consoleErrors.length === 0;
    console.log(`\n=== 最终结论: ${hasNoErrors ? '✓ 完全合格 - 无 JS 错误' : '✗ 不合格 - 有错误'} ===`);

  } catch (e) {
    console.error('执行异常:', e.message);
    console.log('\n=== 已捕获错误 ===');
    console.log(`pageerror: ${errors.length}, console.error: ${consoleErrors.length}`);
    errors.forEach(e => console.log('  ' + e));
    consoleErrors.slice(0, 10).forEach(e => console.log('  ' + e));
  } finally {
    await browser.close();
  }
})();
