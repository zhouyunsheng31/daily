// canvas-core-v3 验证脚本
// 检查三级缩放交互、控制台错误、截图
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => pageErrors.push(err.message));

  const results = { checks: [], screenshots: [], errors: { console: consoleErrors, page: pageErrors } };

  const check = (name, cond, detail) => {
    results.checks.push({ name, pass: !!cond, detail: detail || '' });
    console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' -> ' + detail : ''));
  };

  try {
    // 1. 导航到页面
    await page.goto('http://localhost:8765/canvas-core-v3.html', { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(3000); // 等 Babel 转换 + React 渲染

    // 2. 检查 root 有子元素（页面渲染成功）
    const rootChildren = await page.evaluate(() => document.getElementById('root').children.length);
    check('root 有子元素（页面渲染成功）', rootChildren > 0, 'children=' + rootChildren);

    // 3. 检查三个缩放按钮存在
    const normalBtn = await page.locator('[data-zoom-btn="normal"]').count();
    const miniBtn = await page.locator('[data-zoom-btn="mini"]').count();
    const iconBtn = await page.locator('[data-zoom-btn="icon"]').count();
    check('缩放按钮"正常"存在', normalBtn > 0, 'count=' + normalBtn);
    check('缩放按钮"缩小版"存在', miniBtn > 0, 'count=' + miniBtn);
    check('缩放按钮"图标"存在', iconBtn > 0, 'count=' + iconBtn);

    // 4. 默认是第一级（normal），检查 data-zoom-level="normal" 存在
    const normalLevel = await page.locator('[data-zoom-level="normal"]').count();
    check('第一级（正常）画布默认显示', normalLevel > 0, 'count=' + normalLevel);

    // 截图第一级
    await page.screenshot({ path: path.join(__dirname, '.screenshots', 'v3-level1-normal.png') });
    results.screenshots.push('v3-level1-normal.png');

    // 5. 点击"缩小版"按钮，检查布局变化
    await page.click('[data-zoom-btn="mini"]');
    await page.waitForTimeout(600); // 等过渡动画
    const miniLevel = await page.locator('[data-zoom-level="mini"]').count();
    const normalGone = await page.locator('[data-zoom-level="normal"]').count();
    check('点击"缩小版"后切换到第二级', miniLevel > 0 && normalGone === 0, 'mini=' + miniLevel + ' normal=' + normalGone);

    // 检查第二级是否有网格布局（widget-card 类）
    const miniCards = await page.locator('.widget-card').count();
    check('第二级显示缩小版卡片网格', miniCards >= 5, 'cards=' + miniCards);

    // 截图第二级
    await page.screenshot({ path: path.join(__dirname, '.screenshots', 'v3-level2-mini.png') });
    results.screenshots.push('v3-level2-mini.png');

    // 6. 点击"图标"按钮，检查图标模式
    await page.click('[data-zoom-btn="icon"]');
    await page.waitForTimeout(600);
    const iconLevel = await page.locator('[data-zoom-level="icon"]').count();
    const miniGone = await page.locator('[data-zoom-level="mini"]').count();
    check('点击"图标"后切换到第三级', iconLevel > 0 && miniGone === 0, 'icon=' + iconLevel + ' mini=' + miniGone);

    // 检查第三级是否有图标（icon-bubble 类）
    const iconBubbles = await page.locator('.icon-bubble').count();
    check('第三级显示图标网格', iconBubbles >= 5, 'bubbles=' + iconBubbles);

    // 截图第三级
    await page.screenshot({ path: path.join(__dirname, '.screenshots', 'v3-level3-icon.png') });
    results.screenshots.push('v3-level3-icon.png');

    // 7. 切换回第一级，验证可逆
    await page.click('[data-zoom-btn="normal"]');
    await page.waitForTimeout(600);
    const backToNormal = await page.locator('[data-zoom-level="normal"]').count();
    check('切换回第一级（可逆）', backToNormal > 0, 'count=' + backToNormal);

    // 8. 检查 AI 浮球存在
    const aiBall = await page.locator('.ai-ball-glow').count();
    check('AI 浮球存在', aiBall > 0, 'count=' + aiBall);

    // 9. 检查背景层存在（下雨特效 + 时钟）
    const rainDrops = await page.locator('.rain-drop').count();
    const clockVisible = await page.locator('.font-mono').count();
    check('背景层下雨特效存在', rainDrops > 10, 'drops=' + rainDrops);
    check('背景层时钟存在', clockVisible > 0, 'count=' + clockVisible);

    // 10. 切换到其他视图（Tab 切换）
    const tabBtns = await page.locator('.tab-btn').count();
    check('顶部 Tab 按钮存在（4个）', tabBtns >= 4, 'count=' + tabBtns);

    // 11. 控制台错误检查
    check('控制台无错误', consoleErrors.length === 0, 'errors=' + JSON.stringify(consoleErrors));
    check('页面无异常', pageErrors.length === 0, 'errors=' + JSON.stringify(pageErrors));

  } catch (e) {
    check('脚本执行无异常', false, e.message);
  } finally {
    await browser.close();
  }

  // 汇总
  const passed = results.checks.filter(c => c.pass).length;
  const failed = results.checks.filter(c => !c.pass).length;
  console.log('\n=== 验证汇总 ===');
  console.log('通过: ' + passed + ' / 失败: ' + failed);
  console.log('截图: ' + results.screenshots.join(', '));
  console.log('控制台错误: ' + consoleErrors.length);
  console.log('页面异常: ' + pageErrors.length);

  process.exit(failed > 0 ? 1 : 0);
})();
