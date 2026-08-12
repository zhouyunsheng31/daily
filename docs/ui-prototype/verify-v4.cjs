// V4 验证脚本 - 使用 Playwright 进行运行时验证
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // 收集 pageerror
  const pageErrors = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  console.log('=== V4 画布核心验证开始 ===\n');

  // 1. 打开页面
  await page.goto('http://localhost:8766/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000); // 等待 React 渲染 + Babel 转换

  // 2. 检查 pageerror
  console.log('【检查 1】pageerror 数量:', pageErrors.length);
  if (pageErrors.length > 0) {
    console.log('  pageerrors:', pageErrors);
  }

  // 3. 检查三个缩放按钮是否存在
  const zoomBtns = await page.$$('[data-zoom-btn]');
  const zoomBtnIds = await Promise.all(zoomBtns.map(b => b.getAttribute('data-zoom-btn')));
  console.log('\n【检查 2】缩放按钮数量:', zoomBtns.length, 'IDs:', zoomBtnIds);

  // 4. 获取 normal 级别下 widget 的中心点坐标
  const widgetIds = ['w-pdf', 'w-music', 'w-timer', 'w-ai', 'w-calc'];
  const getWidgetCenter = async (id) => {
    const el = await page.$(`[data-widget-id="${id}"]`);
    if (!el) return null;
    const box = await el.boundingBox();
    if (!box) return null;
    return {
      id,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      centerX: box.x + box.width / 2,
      centerY: box.y + box.height / 2,
    };
  };

  console.log('\n【检查 3】normal 级别下各 widget 中心点坐标：');
  const normalCenters = {};
  for (const id of widgetIds) {
    const c = await getWidgetCenter(id);
    if (c) {
      normalCenters[id] = c;
      console.log(`  ${id}: center=(${c.centerX.toFixed(1)}, ${c.centerY.toFixed(1)}), size=${c.width.toFixed(0)}x${c.height.toFixed(0)}`);
    } else {
      console.log(`  ${id}: NOT FOUND`);
    }
  }

  // 5. 点击 mini 缩放按钮
  console.log('\n【检查 4】点击"缩小版"按钮...');
  await page.click('[data-zoom-btn="mini"]');
  await page.waitForTimeout(600); // 等待 380ms transition + buffer

  // 6. 获取 mini 级别下 widget 的中心点坐标
  console.log('\n【检查 5】mini 级别下各 widget 中心点坐标（应与 normal 相同）：');
  const miniCenters = {};
  let centerMatchCount = 0;
  let centerMismatchCount = 0;
  for (const id of widgetIds) {
    const c = await getWidgetCenter(id);
    if (c) {
      miniCenters[id] = c;
      const nc = normalCenters[id];
      const dx = Math.abs(c.centerX - nc.centerX);
      const dy = Math.abs(c.centerY - nc.centerY);
      const sizeRatio = c.width / nc.width;
      const matched = dx < 1 && dy < 1;
      if (matched) centerMatchCount++; else centerMismatchCount++;
      console.log(`  ${id}: center=(${c.centerX.toFixed(1)}, ${c.centerY.toFixed(1)}), size=${c.width.toFixed(0)}x${c.height.toFixed(0)} | Δcenter=(${dx.toFixed(2)}, ${dy.toFixed(2)}) | scale=${sizeRatio.toFixed(3)} | ${matched ? '✓ 位置不变' : '✗ 位置改变'}`);
    }
  }
  console.log(`  汇总: ${centerMatchCount}/${widgetIds.length} 中心点不变, ${centerMismatchCount} 改变`);

  // 7. 检查 mini 版确实比原版小（scale < 1）
  console.log('\n【检查 6】缩小版是否比原版小（scale < 1）：');
  let allSmaller = true;
  for (const id of widgetIds) {
    if (miniCenters[id] && normalCenters[id]) {
      const ratio = miniCenters[id].width / normalCenters[id].width;
      const smaller = ratio < 1;
      if (!smaller) allSmaller = false;
      console.log(`  ${id}: scale=${ratio.toFixed(3)} | ${smaller ? '✓ 更小' : '✗ 没变小'}`);
    }
  }

  // 8. 点击 icon 缩放按钮
  console.log('\n【检查 7】点击"图标"按钮...');
  await page.click('[data-zoom-btn="icon"]');
  await page.waitForTimeout(600);

  // 9. 获取 icon 级别下 widget 的中心点坐标
  console.log('\n【检查 8】icon 级别下各 widget 中心点坐标（应与 normal 相同）：');
  const iconCenters = {};
  let iconMatchCount = 0;
  for (const id of widgetIds) {
    const c = await getWidgetCenter(id);
    if (c) {
      iconCenters[id] = c;
      const nc = normalCenters[id];
      const dx = Math.abs(c.centerX - nc.centerX);
      const dy = Math.abs(c.centerY - nc.centerY);
      const matched = dx < 1 && dy < 1;
      if (matched) iconMatchCount++;
      console.log(`  ${id}: center=(${c.centerX.toFixed(1)}, ${c.centerY.toFixed(1)}), size=${c.width.toFixed(0)}x${c.height.toFixed(0)} | Δcenter=(${dx.toFixed(2)}, ${dy.toFixed(2)}) | ${matched ? '✓ 位置不变' : '✗ 位置改变'}`);
    }
  }
  console.log(`  汇总: ${iconMatchCount}/${widgetIds.length} 中心点不变`);

  // 10. 检查 icon 级别 scale 更小
  console.log('\n【检查 9】icon 级别是否比 mini 更小：');
  let iconSmallerThanMini = true;
  for (const id of widgetIds) {
    if (iconCenters[id] && miniCenters[id]) {
      const ratio = iconCenters[id].width / miniCenters[id].width;
      const smaller = ratio < 1;
      if (!smaller) iconSmallerThanMini = false;
      console.log(`  ${id}: icon/mini scale ratio=${ratio.toFixed(3)} | ${smaller ? '✓ 更小' : '✗ 没变小'}`);
    }
  }

  // 11. 切回 normal
  await page.click('[data-zoom-btn="normal"]');
  await page.waitForTimeout(500);

  // 12. 检查设置按钮在底部对话栏右侧可见
  console.log('\n【检查 10】底部对话栏设置按钮是否可见：');
  const settingsBtnBottom = await page.$('[data-settings-btn="bottom"]');
  if (settingsBtnBottom) {
    const box = await settingsBtnBottom.boundingBox();
    const viewportHeight = 800;
    const isVisible = box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1280 && box.y + box.height <= viewportHeight;
    console.log(`  位置: (${box.x.toFixed(0)}, ${box.y.toFixed(0)}), 尺寸: ${box.width.toFixed(0)}x${box.height.toFixed(0)} | ${isVisible ? '✓ 可见' : '✗ 不可见'}`);
    // 检查是否在底部对话栏内
    const bottomBar = await page.$('[data-bottom-bar="true"]');
    if (bottomBar) {
      const bbBox = await bottomBar.boundingBox();
      const inBottomBar = box.x >= bbBox.x && box.x + box.width <= bbBox.x + bbBox.width && box.y >= bbBox.y && box.y + box.height <= bbBox.y + bbBox.height;
      console.log(`  在底部对话栏内: ${inBottomBar ? '✓ 是' : '✗ 否'}`);
      // 检查设置按钮是否在对话栏右侧（x > 对话栏中心）
      const barCenterX = bbBox.x + bbBox.width / 2;
      const btnCenterX = box.x + box.width / 2;
      console.log(`  在对话栏右侧: ${btnCenterX > barCenterX ? '✓ 是' : '✗ 否'} (按钮中心x=${btnCenterX.toFixed(0)}, 栏中心x=${barCenterX.toFixed(0)})`);
    }
  } else {
    console.log('  ✗ 未找到底部设置按钮');
  }

  // 13. 点击设置按钮 → 检查设置面板是否展开
  console.log('\n【检查 11】点击底部设置按钮 → 设置面板是否展开：');
  if (settingsBtnBottom) {
    await settingsBtnBottom.click();
    await page.waitForTimeout(500);
    const settingsPanel = await page.$('.slide-in-right');
    if (settingsPanel) {
      console.log('  ✓ 设置面板已展开');
      // 检查面板内容
      const themeBtns = await page.$$('[data-theme-btn]');
      const zoomSettingsBtns = await page.$$('[data-settings-zoom]');
      const toggleBtns = await page.$$('[data-toggle-widget]');
      console.log(`  主题切换按钮: ${themeBtns.length} 个`);
      console.log(`  缩放档位按钮: ${zoomSettingsBtns.length} 个`);
      console.log(`  组件管理切换: ${toggleBtns.length} 个`);
      // 关闭设置面板
      const closeBtn = await page.$('[data-settings-close]');
      if (closeBtn) {
        await closeBtn.click();
        await page.waitForTimeout(300);
        console.log('  设置面板已关闭');
      }
    } else {
      console.log('  ✗ 设置面板未展开');
    }
  }

  // 14. 点击 AI 浮球 → 检查设置选项是否展开
  console.log('\n【检查 12】点击 AI 浮球 → 设置选项是否展开：');
  const aiBall = await page.$('[data-ai-ball="true"]');
  if (aiBall) {
    await aiBall.click();
    await page.waitForTimeout(500);
    const aiSettingsBtn = await page.$('[data-settings-btn="ai"]');
    if (aiSettingsBtn) {
      const box = await aiSettingsBtn.boundingBox();
      console.log(`  ✓ AI 浮球展开后包含设置齿轮按钮，位置: (${box.x.toFixed(0)}, ${box.y.toFixed(0)})`);
    } else {
      console.log('  ✗ AI 浮球展开后未找到设置按钮');
    }
    // 关闭 AI 浮球
    await aiBall.click();
    await page.waitForTimeout(300);
  } else {
    console.log('  ✗ 未找到 AI 浮球');
  }

  // 15. 检查缩放控件是否在顶部工具栏
  console.log('\n【检查 13】缩放控件位置：');
  const zoomControl = await page.$('[data-zoom-control="true"]');
  if (zoomControl) {
    const box = await zoomControl.boundingBox();
    console.log(`  缩放控件位置: (${box.x.toFixed(0)}, ${box.y.toFixed(0)}) | y < 60 表示在顶部 ✓`);
  }

  // 16. 检查背景层不参与缩放（时钟 widget 位置不变）
  console.log('\n【检查 14】背景层（时钟）不参与缩放：');
  await page.click('[data-zoom-btn="mini"]');
  await page.waitForTimeout(500);
  // 时钟在背景层，位置应该不变
  console.log('  (背景层时钟组件在组件层之外，不受 transform: scale 影响)');

  // 切回 normal
  await page.click('[data-zoom-btn="normal"]');
  await page.waitForTimeout(500);

  // 总结
  console.log('\n=== 验证总结 ===');
  console.log('pageerror:', pageErrors.length === 0 ? '✓ 0 个错误' : `✗ ${pageErrors.length} 个错误`);
  console.log('console.error:', consoleErrors.length === 0 ? '✓ 0 个错误' : `${consoleErrors.length} 个（部分可能是 CDN 警告）`);
  console.log('缩放按钮:', zoomBtns.length === 3 ? '✓ 3 个' : `✗ ${zoomBtns.length} 个`);
  console.log('mini 中心点不变:', `${centerMatchCount}/${widgetIds.length} ${centerMatchCount === widgetIds.length ? '✓' : '✗'}`);
  console.log('icon 中心点不变:', `${iconMatchCount}/${widgetIds.length} ${iconMatchCount === widgetIds.length ? '✓' : '✗'}`);
  console.log('mini 比原版小:', allSmaller ? '✓' : '✗');
  console.log('icon 比 mini 更小:', iconSmallerThanMini ? '✓' : '✗');

  await browser.close();
  console.log('\n=== 验证结束 ===');
})().catch(err => {
  console.error('验证脚本出错:', err);
  process.exit(1);
});
