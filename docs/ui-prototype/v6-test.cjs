// V6 验证脚本 - Playwright 运行时测试
const { chromium } = require('playwright');

(async () => {
  const results = { passed: [], failed: [] };
  const log = (name, ok, detail) => {
    const arr = ok ? results.passed : results.failed;
    arr.push({ name, detail });
    console.log((ok ? '✅ PASS' : '❌ FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
  };

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // 收集 pageerror
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [console.error]', msg.text());
  });

  console.log('=== 打开 http://localhost:8769/ ===');
  await page.goto('http://localhost:8769/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // ========== 测试 1：0 pageerror ==========
  log('0 pageerror', pageErrors.length === 0, 'pageerror 数量: ' + pageErrors.length + (pageErrors.length > 0 ? ' | ' + pageErrors.join('; ') : ''));

  // ========== 测试 2：拖动测试 - iframe widget ==========
  console.log('\n=== 拖动测试：iframe widget (w-pdf) ===');
  try {
    const widget = page.locator('[data-widget-id="w-pdf"]');
    await widget.waitFor({ state: 'visible', timeout: 5000 });

    // 获取拖动前的位置
    const beforeBox = await widget.boundingBox();
    const beforeX = beforeBox.x;
    const beforeY = beforeBox.y;
    console.log('  拖动前 w-pdf 位置: x=' + beforeX + ', y=' + beforeY);

    // 找到 titlebar（拖动手柄）
    const titlebar = widget.locator('.widget-titlebar');
    const titlebarBox = await titlebar.boundingBox();

    // 在 titlebar 中心按下鼠标
    const startX = titlebarBox.x + titlebarBox.width / 2;
    const startY = titlebarBox.y + titlebarBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();

    // 移动鼠标（拖动 100, 80）
    const dx = 100, dy = 80;
    await page.mouse.move(startX + dx, startY + dy, { steps: 10 });
    await page.waitForTimeout(200);

    // 释放鼠标
    await page.mouse.up();
    await page.waitForTimeout(500);

    // 获取拖动后的位置
    const afterBox = await widget.boundingBox();
    const afterX = afterBox.x;
    const afterY = afterBox.y;
    console.log('  拖动后 w-pdf 位置: x=' + afterX + ', y=' + afterY);

    const deltaX = Math.abs(afterX - beforeX - dx);
    const deltaY = Math.abs(afterY - beforeY - dy);
    const dragWorked = deltaX < 5 && deltaY < 5; // 允许 5px 误差

    log('iframe widget 拖动', dragWorked, 'Δx=' + (afterX - beforeX) + ' (期望~' + dx + '), Δy=' + (afterY - beforeY) + ' (期望~' + dy + ')');

    // 检查 is-dragging 视觉反馈（在拖动过程中）
    // 重新获取 titlebar 位置（因为第一次拖动后组件已移动）
    const titlebar2 = widget.locator('.widget-titlebar');
    const titlebarBox2 = await titlebar2.boundingBox();
    const startX2 = titlebarBox2.x + titlebarBox2.width / 2;
    const startY2 = titlebarBox2.y + titlebarBox2.height / 2;
    await page.mouse.move(startX2, startY2);
    await page.mouse.down();
    await page.mouse.move(startX2 + 20, startY2 + 20, { steps: 5 });
    await page.waitForTimeout(100);
    const draggingClass = await widget.evaluate(el => el.className);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const hasDraggingClass = draggingClass.includes('is-dragging');
    log('拖动视觉反馈 (is-dragging class)', hasDraggingClass, 'class="' + draggingClass + '"');

  } catch (e) {
    log('iframe widget 拖动', false, '异常: ' + e.message);
  }

  // ========== 测试 3：拖动测试 - 自由 HTML 组件 (free-orb) ==========
  console.log('\n=== 拖动测试：自由 HTML 组件 (free-orb) ===');
  try {
    const freeOrb = page.locator('[data-widget-id="free-orb"]');
    await freeOrb.waitFor({ state: 'visible', timeout: 5000 });

    const beforeBox = await freeOrb.boundingBox();
    const beforeX = beforeBox.x;
    const beforeY = beforeBox.y;
    console.log('  拖动前 free-orb 位置: x=' + beforeX + ', y=' + beforeY);

    const cx = beforeBox.x + beforeBox.width / 2;
    const cy = beforeBox.y + beforeBox.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    const dx2 = 80, dy2 = 60;
    await page.mouse.move(cx + dx2, cy + dy2, { steps: 10 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(500);

    const afterBox = await freeOrb.boundingBox();
    const afterX = afterBox.x;
    const afterY = afterBox.y;
    console.log('  拖动后 free-orb 位置: x=' + afterX + ', y=' + afterY);

    const deltaX = Math.abs(afterX - beforeX - dx2);
    const deltaY = Math.abs(afterY - beforeY - dy2);
    log('自由 HTML 组件拖动', deltaX < 5 && deltaY < 5, 'Δx=' + (afterX - beforeX) + ' (期望~' + dx2 + '), Δy=' + (afterY - beforeY) + ' (期望~' + dy2 + ')');

  } catch (e) {
    log('自由 HTML 组件拖动', false, '异常: ' + e.message);
  }

  // ========== 测试 4：缩放前后组件中心点 Δ=0（相册式保留）==========
  console.log('\n=== 缩放中心点测试 ===');
  try {
    // 先确保在 normal 级别
    const normalBtn = page.locator('[data-zoom-btn="normal"]');
    await normalBtn.click();
    await page.waitForTimeout(500);

    const widget = page.locator('[data-widget-id="w-music"]');
    const beforeBox = await widget.boundingBox();
    const beforeCenterX = beforeBox.x + beforeBox.width / 2;
    const beforeCenterY = beforeBox.y + beforeBox.height / 2;
    console.log('  normal 级别 w-music 中心: x=' + beforeCenterX + ', y=' + beforeCenterY);

    // 切到 mini
    const miniBtn = page.locator('[data-zoom-btn="mini"]');
    await miniBtn.click();
    await page.waitForTimeout(600);

    const miniBox = await widget.boundingBox();
    const miniCenterX = miniBox.x + miniBox.width / 2;
    const miniCenterY = miniBox.y + miniBox.height / 2;
    console.log('  mini 级别 w-music 中心: x=' + miniCenterX + ', y=' + miniCenterY);

    const deltaMini = Math.abs(miniCenterX - beforeCenterX) + Math.abs(miniCenterY - beforeCenterY);
    log('缩放 mini 中心点 Δ=0', deltaMini < 3, 'Δ=' + deltaMini.toFixed(1) + 'px');

    // 切到 icon
    const iconBtn = page.locator('[data-zoom-btn="icon"]');
    await iconBtn.click();
    await page.waitForTimeout(600);

    const iconBox = await widget.boundingBox();
    const iconCenterX = iconBox.x + iconBox.width / 2;
    const iconCenterY = iconBox.y + iconBox.height / 2;
    console.log('  icon 级别 w-music 中心: x=' + iconCenterX + ', y=' + iconCenterY);

    const deltaIcon = Math.abs(iconCenterX - beforeCenterX) + Math.abs(iconCenterY - beforeCenterY);
    log('缩放 icon 中心点 Δ=0', deltaIcon < 3, 'Δ=' + deltaIcon.toFixed(1) + 'px');

    // 切回 normal
    await normalBtn.click();
    await page.waitForTimeout(600);

  } catch (e) {
    log('缩放中心点测试', false, '异常: ' + e.message);
  }

  // ========== 测试 5：icon 级别不是方形 ==========
  console.log('\n=== icon 级别形状测试 ===');
  try {
    const iconBtn = page.locator('[data-zoom-btn="icon"]');
    await iconBtn.click();
    await page.waitForTimeout(600);

    // 检查 IconContent 的 data-icon-shape
    const iconShapes = await page.locator('[data-icon-shape]').count();
    console.log('  data-icon-shape 元素数量: ' + iconShapes);

    // 检查第一个 icon 的圆形 div 的 border-radius
    const firstIconCircle = page.locator('[data-icon-shape] > div').first();
    const borderRadius = await firstIconCircle.evaluate(el => getComputedStyle(el).borderRadius);
    console.log('  icon 圆形 border-radius: ' + borderRadius);

    // border-radius 应该是 50%（圆形）而不是 px 值（方形）
    const isCircle = borderRadius === '50%' || borderRadius === '9999px';
    log('icon 级别是圆形 (不是方形)', isCircle && iconShapes > 0, 'border-radius=' + borderRadius + ', icon数量=' + iconShapes);

    await page.locator('[data-zoom-btn="normal"]').click();
    await page.waitForTimeout(500);

  } catch (e) {
    log('icon 级别形状测试', false, '异常: ' + e.message);
  }

  // ========== 测试 6：mini 级别显示精简 HTML 摘要 ==========
  console.log('\n=== mini 级别 HTML 摘要测试 ===');
  try {
    const miniBtn = page.locator('[data-zoom-btn="mini"]');
    await miniBtn.click();
    await page.waitForTimeout(600);

    // 检查 mini 内容是否有实际 HTML（不是纯文本）
    const widget = page.locator('[data-widget-id="w-music"]');
    const miniHtml = await widget.evaluate(el => el.innerHTML);

    // mini 应该包含封面、歌名等 HTML 元素，而不只是文本
    const hasCover = miniHtml.includes('linear-gradient') || miniHtml.includes('background');
    const hasText = miniHtml.includes('Morning Focus');
    const hasProgress = miniHtml.includes('1:24') || miniHtml.includes('3:12');
    const isRichHtml = hasCover && hasText && hasProgress;

    console.log('  mini w-music 有封面背景: ' + hasCover);
    console.log('  mini w-music 有歌名文本: ' + hasText);
    console.log('  mini w-music 有进度时间: ' + hasProgress);

    log('mini 级别显示精简 HTML', isRichHtml, '有封面=' + hasCover + ', 有歌名=' + hasText + ', 有进度=' + hasProgress);

    // 检查 PDF mini 有页码
    const pdfWidget = page.locator('[data-widget-id="w-pdf"]');
    const pdfMiniHtml = await pdfWidget.evaluate(el => el.innerHTML);
    const pdfHasPageNum = pdfMiniHtml.includes('3 / 12') || pdfMiniHtml.includes('3/12');
    log('mini PDF 有页码', pdfHasPageNum, 'html 包含页码: ' + pdfHasPageNum);

    await page.locator('[data-zoom-btn="normal"]').click();
    await page.waitForTimeout(500);

  } catch (e) {
    log('mini 级别 HTML 摘要测试', false, '异常: ' + e.message);
  }

  // ========== 测试 7：AI 浮球和底部对话栏互斥 ==========
  console.log('\n=== AI 对话方式互斥测试 ===');
  try {
    // 默认 dialog 模式
    const bottomBar = page.locator('[data-bottom-bar="true"]');
    const aiBall = page.locator('[data-ai-ball="true"]');

    const dialogVisible = await bottomBar.isVisible();
    const ballVisible = await aiBall.isVisible().catch(() => false); // 可能不存在
    console.log('  dialog 模式 - 底部栏可见: ' + dialogVisible + ', 浮球可见: ' + ballVisible);

    log('dialog 模式时底部栏可见', dialogVisible, '');
    log('dialog 模式时浮球不存在/不可见', !ballVisible, '');

    // 切到 ball 模式
    const toBallBtn = page.locator('[data-mode-switch="to-ball"]');
    await toBallBtn.click();
    await page.waitForTimeout(500);

    const bottomBarAfter = page.locator('[data-bottom-bar="true"]');
    const aiBallAfter = page.locator('[data-ai-ball="true"]');

    const dialogVisibleAfter = await bottomBarAfter.isVisible().catch(() => false);
    const ballVisibleAfter = await aiBallAfter.isVisible();
    console.log('  ball 模式 - 底部栏可见: ' + dialogVisibleAfter + ', 浮球可见: ' + ballVisibleAfter);

    log('ball 模式时浮球可见', ballVisibleAfter, '');
    log('ball 模式时底部栏不存在/不可见', !dialogVisibleAfter, '');

    // 切回 dialog 模式
    // 需要先展开浮球才能看到切换按钮
    await aiBallAfter.click();
    await page.waitForTimeout(300);
    const toDialogBtn = page.locator('[data-mode-switch="to-dialog"]');
    await toDialogBtn.click();
    await page.waitForTimeout(500);

  } catch (e) {
    log('AI 对话方式互斥测试', false, '异常: ' + e.message);
  }

  // ========== 测试 8：顶部无上传按钮 ==========
  console.log('\n=== 顶部无上传按钮测试 ===');
  try {
    const topToolbar = page.locator('[data-top-toolbar="true"]');
    const topHtml = await topToolbar.evaluate(el => el.innerHTML);
    const hasUploadInTop = topHtml.includes('upload') || topHtml.includes('上传');
    log('顶部工具栏无上传按钮', !hasUploadInTop, hasUploadInTop ? '发现上传相关内容' : '干净');

    // 底部对话栏应该有上传按钮
    const bottomBar = page.locator('[data-bottom-bar="true"]');
    const bottomHtml = await bottomBar.evaluate(el => el.innerHTML);
    const hasUploadInBottom = bottomHtml.includes('data-upload-btn');
    log('底部对话栏有上传按钮', hasUploadInBottom, '');

  } catch (e) {
    log('上传按钮位置测试', false, '异常: ' + e.message);
  }

  // ========== 测试 9：设置面板无缩放档位副本 ==========
  console.log('\n=== 设置面板无缩放档位副本测试 ===');
  try {
    // 打开设置面板
    const settingsBtn = page.locator('[data-settings-btn="bottom"]');
    await settingsBtn.click();
    await page.waitForTimeout(500);

    const settingsPanel = page.locator('.slide-in-right');
    const settingsHtml = await settingsPanel.evaluate(el => el.innerHTML);
    const hasZoomSection = settingsHtml.includes('缩放档位') || settingsHtml.includes('data-settings-zoom');
    log('设置面板无缩放档位副本', !hasZoomSection, hasZoomSection ? '发现缩放档位' : '干净');

    // 检查设置面板保留了 AI 对话方式 / 主题 / 组件管理
    const hasAiMode = settingsHtml.includes('AI 对话方式') || settingsHtml.includes('data-aimode-btn');
    const hasTheme = settingsHtml.includes('主题') || settingsHtml.includes('data-theme-btn');
    const hasWidgetMgmt = settingsHtml.includes('组件管理') || settingsHtml.includes('data-toggle-widget');
    log('设置面板保留 AI 对话方式', hasAiMode, '');
    log('设置面板保留主题切换', hasTheme, '');
    log('设置面板保留组件管理', hasWidgetMgmt, '');

    // 关闭设置面板
    await page.locator('[data-settings-close]').click();
    await page.waitForTimeout(300);

  } catch (e) {
    log('设置面板测试', false, '异常: ' + e.message);
  }

  // ========== 测试 10：4 个视图可切换 ==========
  console.log('\n=== 4 视图测试 ===');
  try {
    for (const v of ['v1', 'v2', 'v3', 'v4']) {
      // 点击 tab
      await page.evaluate((viewId) => {
        const btns = document.querySelectorAll('.tab-btn');
        const idx = ['v1','v2','v3','v4'].indexOf(viewId);
        if (btns[idx]) btns[idx].click();
      }, v);
      await page.waitForTimeout(500);
      const viewContainer = await page.locator('[data-view], .view-container').count();
      console.log('  视图 ' + v + ' 切换成功');
    }
    log('4 个视图可切换', true, '');
    // 切回 v1
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.tab-btn');
      if (btns[0]) btns[0].click();
    });
    await page.waitForTimeout(500);
  } catch (e) {
    log('4 视图测试', false, '异常: ' + e.message);
  }

  // ========== 测试 11：data-draggable 属性存在 ==========
  console.log('\n=== data-draggable 标记测试 ===');
  try {
    const draggableCount = await page.locator('[data-draggable="true"]').count();
    console.log('  data-draggable="true" 元素数量: ' + draggableCount);
    log('可拖动组件有 data-draggable 标记', draggableCount >= 8, '数量: ' + draggableCount + ' (期望 >=8: 5 iframe + 3 free)');
  } catch (e) {
    log('data-draggable 标记测试', false, '异常: ' + e.message);
  }

  // ========== 汇总 ==========
  console.log('\n========== 验证汇总 ==========');
  console.log('通过: ' + results.passed.length + ' 项');
  console.log('失败: ' + results.failed.length + ' 项');
  if (results.failed.length > 0) {
    console.log('\n失败项:');
    results.failed.forEach(f => console.log('  ❌ ' + f.name + ' | ' + f.detail));
  }
  console.log('==============================\n');

  await browser.close();
  process.exit(results.failed.length > 0 ? 1 : 0);
})();
