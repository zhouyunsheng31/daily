// 对抗审核脚本：验证更多边界情况
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

    // 1. 验证缩放控件在画布主页顶部工具栏内（不是单独页面）
    const zoomControl = await page.locator('[data-zoom-control="true"]').count();
    check('缩放控件集成在画布主页工具栏内（非单独概念页）', zoomControl > 0);

    // 2. 验证第一级有 iframe widget（可拖拽的矩形组件）
    const iframeWidgets = await page.locator('.iframe-widget').count();
    check('第一级有 iframe widget 矩形组件', iframeWidgets >= 5, 'count=' + iframeWidgets);

    // 3. 验证第一级有自由 HTML 组件（旋转光球）
    const freeOrbs = await page.locator('.free-orb').count();
    check('第一级有自由 HTML 组件（光球）', freeOrbs >= 1, 'count=' + freeOrbs);

    // 4. 验证第一级有自由 HTML 组件（飘动光点）
    const freeParticles = await page.locator('.free-particle').count();
    check('第一级有自由 HTML 组件（光点）', freeParticles >= 3, 'count=' + freeParticles);

    // 5. 切换到第二级，验证布局变化（从绝对定位变成网格）
    await page.click('[data-zoom-btn="mini"]');
    await page.waitForTimeout(600);
    // 第二级不应该有 iframe-widget（散落布局），应该有 widget-card（网格布局）
    const iframeInMini = await page.locator('.iframe-widget').count();
    const cardsInMini = await page.locator('.widget-card').count();
    check('第二级布局变化：从散落变成网格', iframeInMini === 0 && cardsInMini >= 5, 'iframe=' + iframeInMini + ' cards=' + cardsInMini);

    // 6. 验证第二级每个卡片显示缩小版内容（不是完整内容）
    const miniCardContent = await page.evaluate(() => {
      const cards = document.querySelectorAll('.widget-card');
      return Array.from(cards).map(c => c.textContent).join('|');
    });
    check('第二级卡片显示缩小版摘要内容', miniCardContent.includes('缩小版'), 'content has 缩小版 label');

    // 7. 验证背景层在第二级仍然存在
    const rainInMini = await page.locator('.rain-drop').count();
    check('第二级背景层（下雨）仍存在', rainInMini > 10, 'drops=' + rainInMini);

    // 8. 验证时钟在第二级有"AI 设定不受缩放影响"标注
    const immuneLabel = await page.evaluate(() => {
      return document.body.textContent.includes('AI 设定不受缩放影响');
    });
    check('时钟标注"AI 设定不受缩放影响"', immuneLabel);

    // 9. 切换到第三级，验证图标模式
    await page.click('[data-zoom-btn="icon"]');
    await page.waitForTimeout(600);
    const iconBubbles = await page.locator('.icon-bubble').count();
    const cardsGone = await page.locator('.widget-card').count();
    check('第三级只剩图标（卡片消失）', iconBubbles >= 5 && cardsGone === 0, 'bubbles=' + iconBubbles + ' cards=' + cardsGone);

    // 10. 验证第三级背景层仍存在
    const rainInIcon = await page.locator('.rain-drop').count();
    check('第三级背景层（下雨）仍存在', rainInIcon > 10, 'drops=' + rainInIcon);

    // 11. 验证 AI 浮球在所有级别都存在
    const aiBallInIcon = await page.locator('.ai-ball-glow').count();
    check('第三级 AI 浮球仍存在（不受缩放影响）', aiBallInIcon > 0);

    // 12. 切换到视图2（AI 对话形态）
    await page.click('.tab-btn:nth-child(1)'); // 第一个 tab 按钮是 v1，实际要点 v2
    // 实际 tab 按钮顺序：v1, v2, v3, v4
    const tabBtns = await page.locator('.tab-btn').all();
    if (tabBtns.length >= 2) {
      await tabBtns[1].click(); // 点击第二个 tab (v2)
      await page.waitForTimeout(500);
      const v2Content = await page.evaluate(() => document.body.textContent.includes('浮球形态'));
      check('视图2（AI 对话形态）可切换', v2Content);
    }

    // 13. 切换到视图3（背景层）
    const tabBtns2 = await page.locator('.tab-btn').all();
    if (tabBtns2.length >= 3) {
      await tabBtns2[2].click();
      await page.waitForTimeout(500);
      const v3Content = await page.evaluate(() => document.body.textContent.includes('背景层始终存在'));
      check('视图3（背景层）可切换', v3Content);
    }

    // 14. 切换到视图4（弹出层）
    const tabBtns3 = await page.locator('.tab-btn').all();
    if (tabBtns3.length >= 4) {
      await tabBtns3[3].click();
      await page.waitForTimeout(500);
      const v4Content = await page.evaluate(() => document.body.textContent.includes('弹出层示例'));
      check('视图4（弹出层）可切换', v4Content);

      // 测试弹出层点击
      const beforePopup = await page.evaluate(() => document.querySelectorAll('[style*="overlay-bg"]').length);
      // 点击第一张卡片
      const cards = await page.locator('.view-container > div > div > div > div').all();
      // 更简单：直接点包含"登录窗口"的卡片
      await page.locator('text=登录窗口').first().click();
      await page.waitForTimeout(500);
      const afterPopup = await page.evaluate(() => {
        const all = document.querySelectorAll('[style*="overlay-bg"]');
        return all.length;
      });
      check('弹出层可点击弹出', afterPopup > 0, 'overlay count=' + afterPopup);
    }

    // 15. 控制台错误
    check('对抗审核：控制台无错误', consoleErrors.length === 0, JSON.stringify(consoleErrors));

  } catch (e) {
    check('对抗审核脚本执行无异常', false, e.message);
  } finally {
    await browser.close();
  }

  const passed = results.filter(c => c.pass).length;
  const failed = results.filter(c => !c.pass).length;
  console.log('\n=== 对抗审核汇总 ===');
  console.log('通过: ' + passed + ' / 失败: ' + failed);
  process.exit(failed > 0 ? 1 : 0);
})();
