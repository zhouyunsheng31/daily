// 对抗审核脚本 v2：修复 tab 切换选择器
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  const results = [];
  const check = (name, cond, detail) => {
    results.push({ name, pass: !!cond, detail: detail || '' });
    console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' -> ' + detail : ''));
  };

  try {
    await page.goto('http://localhost:8765/canvas-core-v3.html', { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(3000);

    // 1. 切换到视图2（AI 对话形态）- 用文本定位
    await page.locator('button:has-text("AI 对话形态")').click();
    await page.waitForTimeout(800);
    const v2Content = await page.evaluate(() => document.body.textContent.includes('浮球形态'));
    check('视图2（AI 对话形态）可切换', v2Content);
    await page.screenshot({ path: path.join(__dirname, '.screenshots', 'v3-view2-ai.png') });

    // 2. 切换到视图3（背景层）
    await page.locator('button:has-text("背景层")').click();
    await page.waitForTimeout(800);
    const v3Content = await page.evaluate(() => document.body.textContent.includes('背景层始终存在'));
    check('视图3（背景层）可切换', v3Content);
    await page.screenshot({ path: path.join(__dirname, '.screenshots', 'v3-view3-bg.png') });

    // 3. 切换到视图4（弹出层）
    await page.locator('button:has-text("弹出层")').click();
    await page.waitForTimeout(800);
    const v4Content = await page.evaluate(() => document.body.textContent.includes('弹出层示例'));
    check('视图4（弹出层）可切换', v4Content);

    // 4. 测试弹出层点击
    await page.locator('text=登录窗口').first().click();
    await page.waitForTimeout(500);
    const hasOverlay = await page.evaluate(() => {
      const els = document.querySelectorAll('[style*="overlay"]');
      return els.length;
    });
    check('弹出层可点击弹出（登录窗口）', hasOverlay > 0, 'overlay=' + hasOverlay);
    await page.screenshot({ path: path.join(__dirname, '.screenshots', 'v3-view4-popup.png') });

    // 5. 关闭弹窗（点击遮罩）
    await page.mouse.click(960, 540);
    await page.waitForTimeout(500);
    const overlayGone = await page.evaluate(() => {
      const els = document.querySelectorAll('[style*="overlay"]');
      return els.length;
    });
    check('弹出层可关闭', overlayGone === 0, 'overlay=' + overlayGone);

    // 6. 切回视图1，验证缩放仍在
    await page.locator('button:has-text("画布主页")').click();
    await page.waitForTimeout(800);
    const backToV1 = await page.locator('[data-zoom-control="true"]').count();
    check('切回视图1后缩放控件仍在', backToV1 > 0);

    // 7. 控制台错误
    check('对抗审核：控制台无错误', consoleErrors.length === 0, JSON.stringify(consoleErrors));

  } catch (e) {
    check('对抗审核脚本执行无异常', false, e.message);
  } finally {
    await browser.close();
  }

  const passed = results.filter(c => c.pass).length;
  const failed = results.filter(c => !c.pass).length;
  console.log('\n=== 对抗审核 v2 汇总 ===');
  console.log('通过: ' + passed + ' / 失败: ' + failed);
  process.exit(failed > 0 ? 1 : 0);
})();
