/* V8 验证脚本 - 使用 Playwright */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
  });

  await page.goto('http://localhost:8772/', { waitUntil: 'load' });
  // 等待 Babel 转换 + React 渲染完成（CDN 加载 + 转换耗时较长）
  try {
    await page.waitForSelector('[data-view="v1-canvas"]', { timeout: 30000, state: 'attached' });
  } catch (e) {
    // 超时时打印调试信息
    console.log('DEBUG: waitForSelector failed');
    console.log('DEBUG: pageerrors=', JSON.stringify(errors));
    const bodyText = await page.evaluate(() => document.body ? document.body.innerHTML.substring(0, 500) : 'no body');
    console.log('DEBUG: body head=', bodyText.substring(0, 300));
    throw e;
  }
  await page.waitForTimeout(1500);

  const results = {};
  let passCount = 0, failCount = 0;
  const mark = (k, ok, detail) => {
    results[k] = ok ? 'PASS' : 'FAIL';
    if (detail) results[k + '_detail'] = detail;
    if (ok) passCount++; else failCount++;
  };

  // === 1. 0 pageerror ===
  mark('1_pageerror', errors.length === 0, `${errors.length} errors` + (errors.length ? ': ' + errors.join(' | ') : ''));

  // === 2. 顶部无缩放按钮 (zoomBtnCount=0) ===
  const zoomBtnCount = await page.locator('[data-zoom-btn]').count();
  mark('2_zoomBtnCount', zoomBtnCount === 0, `count=${zoomBtnCount}`);

  // === 3. 顶部无"个人面板"标签 ===
  const topToolbarCount = await page.locator('[data-top-toolbar]').count();
  const cornerLogoCount = await page.locator('[data-corner-logo]').count();
  // 检查 view-container (v1-canvas) 内是否有"个人面板"文字（设置面板默认关闭）
  const personalPanelInCanvas = await page.evaluate(() => {
    const vc = document.querySelector('[data-view="v1-canvas"]');
    if (!vc) return -1;
    const walker = document.createTreeWalker(vc, NodeFilter.SHOW_TEXT);
    let count = 0;
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.includes('个人面板')) count++;
    }
    return count;
  });
  mark('3_noPersonalPanelLabel', topToolbarCount === 0 && cornerLogoCount === 1 && personalPanelInCanvas === 0,
    `topToolbar=${topToolbarCount}, cornerLogo=${cornerLogoCount}, personalPanelTextInCanvas=${personalPanelInCanvas}`);

  // === 4. 滚轮缩放可用 ===
  // 先记录初始中心点（用于中心点 Δ 测试）
  const centerNormal = await page.evaluate(() => {
    const w = document.querySelector('[data-widget-id="w-pdf"]');
    if (!w) return null;
    const r = w.getBoundingClientRect();
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
  });

  const zoomBefore = await page.locator('[data-pan-container]').getAttribute('data-zoom-level');
  // 滚轮向下（缩小）：normal -> mini
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(600);
  const zoomAfterDown = await page.locator('[data-pan-container]').getAttribute('data-zoom-level');

  // === 5. 缩放前后组件中心点 Δ=0 ===
  const centerMini = await page.evaluate(() => {
    const w = document.querySelector('[data-widget-id="w-pdf"]');
    if (!w) return null;
    const r = w.getBoundingClientRect();
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
  });
  const dx = Math.abs(centerMini.x - centerNormal.x);
  const dy = Math.abs(centerMini.y - centerNormal.y);
  mark('5_centerDelta0', dx < 1 && dy < 1, `normal=(${centerNormal.x.toFixed(1)},${centerNormal.y.toFixed(1)}) mini=(${centerMini.x.toFixed(1)},${centerMini.y.toFixed(1)}) Δ=(${dx.toFixed(2)},${dy.toFixed(2)})`);

  // 滚轮向上（放大）：mini -> normal
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(600);
  const zoomAfterUp = await page.locator('[data-pan-container]').getAttribute('data-zoom-level');
  mark('4_wheelZoom', zoomAfterDown !== zoomBefore, `${zoomBefore} ->(wheelDown) ${zoomAfterDown} ->(wheelUp) ${zoomAfterUp}`);

  // === 6. 自由 HTML 不可拖动 (pointer-events: none) ===
  const freeHtmlCheck = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-free-html="true"]');
    if (!els.length) return { count: 0, allNone: false };
    let allNone = true;
    els.forEach(el => {
      const s = window.getComputedStyle(el);
      if (s.pointerEvents !== 'none') allNone = false;
    });
    return { count: els.length, allNone };
  });
  mark('6_freeHtmlNoDrag', freeHtmlCheck.count > 0 && freeHtmlCheck.allNone, `count=${freeHtmlCheck.count}, allPointerEventsNone=${freeHtmlCheck.allNone}`);

  // === 7. 画布可平移 ===
  const panBefore = await page.locator('[data-pan-container]').evaluate(el => ({
    x: el.getAttribute('data-pan-x'), y: el.getAttribute('data-pan-y')
  }));
  // 在空白区域拖动（右侧远离 widgets 的位置）
  await page.mouse.move(1100, 600);
  await page.mouse.down();
  await page.mouse.move(1150, 650);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const panAfter = await page.locator('[data-pan-container]').evaluate(el => ({
    x: el.getAttribute('data-pan-x'), y: el.getAttribute('data-pan-y')
  }));
  mark('7_canvasPan', panAfter.x !== panBefore.x || panAfter.y !== panBefore.y,
    `before=(${panBefore.x},${panBefore.y}) after=(${panAfter.x},${panAfter.y})`);

  // === 8. iframe widget 可拖动 ===
  const widgetPosBefore = await page.evaluate(() => {
    const w = document.querySelector('[data-widget-id="w-pdf"]');
    return { left: w.style.left, top: w.style.top };
  });
  const titlebarBox = await page.locator('[data-widget-id="w-pdf"] .widget-titlebar').boundingBox();
  if (titlebarBox) {
    await page.mouse.move(titlebarBox.x + 60, titlebarBox.y + 12);
    await page.mouse.down();
    await page.mouse.move(titlebarBox.x + 120, titlebarBox.y + 50);
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  const widgetPosAfter = await page.evaluate(() => {
    const w = document.querySelector('[data-widget-id="w-pdf"]');
    return { left: w.style.left, top: w.style.top };
  });
  mark('8_iframeDrag', widgetPosAfter.left !== widgetPosBefore.left || widgetPosAfter.top !== widgetPosBefore.top,
    `before=(${widgetPosBefore.left},${widgetPosBefore.top}) after=(${widgetPosAfter.left},${widgetPosAfter.top})`);

  // === 9. 设置面板 9 分区 ===
  await page.locator('[data-settings-btn="bottom"]').click();
  await page.waitForTimeout(500);
  const sectionCount = await page.locator('[data-section-id]').count();
  mark('9_settings9Sections', sectionCount === 9, `count=${sectionCount}`);

  // === 10. 设置面板"缩放档位触发值"保留 ===
  // display 分区默认展开，检查缩放触发值输入框
  const zoomMaxInputCount = await page.locator('[data-zoom-max-input]').count();
  const zoomMinInputCount = await page.locator('[data-zoom-min-input]').count();
  const zoomThresholdText = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-settings-section="display"]');
    if (!els.length) return false;
    return els[0].textContent.includes('缩放档位触发值');
  });
  mark('10_zoomThreshold', zoomMaxInputCount === 1 && zoomMinInputCount === 1 && zoomThresholdText,
    `zoomMaxInput=${zoomMaxInputCount}, zoomMinInput=${zoomMinInputCount}, textPresent=${zoomThresholdText}`);

  // === 11. AI 对话互斥 ===
  // 关闭设置面板
  await page.locator('[data-settings-close]').click();
  await page.waitForTimeout(400);
  const aiModeBefore = await page.locator('[data-view="v1-canvas"]').getAttribute('data-ai-mode');
  const bottomBarBefore = await page.locator('[data-bottom-bar]').count();
  const ballWrapperBefore = await page.locator('[data-ai-ball-wrapper]').count();
  // 切换到浮球模式
  await page.locator('[data-mode-switch="to-ball"]').click();
  await page.waitForTimeout(400);
  const aiModeAfter = await page.locator('[data-view="v1-canvas"]').getAttribute('data-ai-mode');
  const bottomBarAfter = await page.locator('[data-bottom-bar]').count();
  const ballWrapperAfter = await page.locator('[data-ai-ball-wrapper]').count();
  mark('11_aiMutex',
    aiModeBefore === 'dialog' && bottomBarBefore === 1 && ballWrapperBefore === 0 &&
    aiModeAfter === 'ball' && bottomBarAfter === 0 && ballWrapperAfter === 1,
    `before: mode=${aiModeBefore} bottomBar=${bottomBarBefore} ball=${ballWrapperBefore} | after: mode=${aiModeAfter} bottomBar=${bottomBarAfter} ball=${ballWrapperAfter}`);

  // 输出结果
  console.log('\n========== V8 验证结果 ==========');
  Object.keys(results).forEach(k => {
    if (k.endsWith('_detail')) return;
    console.log(`[${results[k]}] ${k}` + (results[k + '_detail'] ? '  ->  ' + results[k + '_detail'] : ''));
  });
  console.log(`\n总计: ${passCount} PASS, ${failCount} FAIL`);
  console.log('==================================\n');

  await browser.close();
  process.exit(failCount > 0 ? 1 : 0);
})();
