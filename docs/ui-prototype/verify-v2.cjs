const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();

  const errors = [];
  const consoleErrors = [];
  const consoleWarnings = [];

  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') consoleErrors.push(text);
    if (type === 'warning') consoleWarnings.push(text);
  });
  page.on('pageerror', err => {
    errors.push(err.message);
  });

  const url = 'http://localhost:8765/auxiliary-pages-v2.html';
  console.log('=== 验证 auxiliary-pages-v2.html ===');
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(5000);

  const rootHTML = await page.$eval('#root', el => el.innerHTML.length);
  console.log('root 内容长度:', rootHTML, rootHTML < 100 ? '(异常)' : '(正常)');

  const topTabs = await page.$$eval('.dl-toptab', btns => btns.map(b => b.textContent.trim()));
  console.log('顶部 Tab:', JSON.stringify(topTabs));

  const shotDir = path.join(path.dirname(__filename), '.screenshots');
  const mainDir = path.dirname(__filename);

  // ---- 1. 登录页（默认页面，弹窗默认显示）----
  console.log('\n--- 登录页 ---');
  let modal = await page.$('.dl-modal');
  console.log('  登录弹窗默认显示:', !!modal, '(期望 true)');
  if (modal) {
    const regTab = await page.$('.dl-modal .dl-settings-nav button:has-text("注册")');
    if (regTab) {
      await regTab.click();
      await page.waitForTimeout(300);
      const pwdInputs = await page.$$('.dl-modal input[type="password"]');
      console.log('  注册模式密码框数量:', pwdInputs.length, '(期望 2)');
      // 切回登录
      await page.$('.dl-modal .dl-settings-nav button:has-text("登录")').then(b => b && b.click());
      await page.waitForTimeout(300);
    }
  }
  await page.screenshot({ path: path.join(shotDir, 'aux-v2-1-login.png'), fullPage: true });
  console.log('  截图: aux-v2-1-login.png');
  // 关闭弹窗（按 ESC 或点击关闭按钮）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  // 如果 ESC 没关，用 JS 关闭
  const modalStillThere = await page.$('.dl-modal');
  if (modalStillThere) {
    // 点击关闭按钮（右上角 ×）
    await page.$eval('.dl-modal > button', b => b.click()).catch(() => {});
    await page.waitForTimeout(500);
  }

  // ---- 2. 设置页 ----
  console.log('\n--- 设置页 ---');
  await page.click('.dl-toptab:has-text("设置页")');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shotDir, 'aux-v2-2-settings.png'), fullPage: true });
  console.log('  截图: aux-v2-2-settings.png');
  const settingsTabs = await page.$$('.dl-settings-nav button');
  console.log('  设置页 tab 数量:', settingsTabs.length, '(期望 5)');
  for (let i = 0; i < settingsTabs.length; i++) {
    await settingsTabs[i].click();
    await page.waitForTimeout(300);
  }
  await settingsTabs[0].click();
  await page.waitForTimeout(300);
  const toggles = await page.$$('.dl-toggle');
  console.log('  AI 工具 toggle 数量:', toggles.length, '(期望 7)');
  if (toggles.length > 0) {
    await toggles[0].click();
    await page.waitForTimeout(300);
    const checked = await page.$eval('.dl-toggle input', el => el.checked);
    console.log('  第一个 toggle 点击后状态:', checked, '(期望 true)');
  }

  // ---- 3. 面板切换 ----
  console.log('\n--- 面板切换 ---');
  await page.click('.dl-toptab:has-text("面板切换")');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shotDir, 'aux-v2-3-panel.png'), fullPage: true });
  console.log('  截图: aux-v2-3-panel.png');
  const panelCards = await page.$$('.dl-card[style*="cursor: pointer"]');
  console.log('  面板卡片数量:', panelCards.length, '(期望 ≥5)');
  const createBtn = await page.$('button:has-text("创建社区面板")');
  if (createBtn) {
    await createBtn.click();
    await page.waitForTimeout(500);
    const panelModal = await page.$('.dl-modal');
    console.log('  创建社区弹窗出现:', !!panelModal, '(期望 true)');
    // 关闭弹窗
    await page.$eval('.dl-modal > button', b => b.click()).catch(() => {});
    await page.waitForTimeout(500);
  }

  // ---- 4. 社区发现 ----
  console.log('\n--- 社区发现 ---');
  await page.click('.dl-toptab:has-text("社区发现")');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(shotDir, 'aux-v2-4-community.png'), fullPage: true });
  console.log('  截图: aux-v2-4-community.png');
  const communityCards = await page.$$('.dl-card');
  console.log('  社区卡片数量:', communityCards.length, '(期望 8)');
  const joinBtns = await page.$$('button:has-text("加入")');
  console.log('  加入按钮数量:', joinBtns.length, '(期望 8)');
  if (joinBtns.length > 0) {
    await joinBtns[0].click();
    await page.waitForTimeout(300);
    const joinedText = await page.$('button:has-text("已加入")');
    console.log('  加入后变"已加入":', !!joinedText, '(期望 true)');
  }

  // ---- 5. 组件导入 ----
  console.log('\n--- 组件导入 ---');
  await page.click('.dl-toptab:has-text("组件导入")');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shotDir, 'aux-v2-5-import.png'), fullPage: true });
  console.log('  截图: aux-v2-5-import.png');
  const dragArea = await page.$('.dl-drag');
  console.log('  拖拽区存在:', !!dragArea, '(期望 true)');
  const textarea = await page.$('textarea');
  console.log('  textarea 存在:', !!textarea, '(期望 true)');
  const copyBtn = await page.$('button:has-text("复制")');
  if (copyBtn) {
    await copyBtn.click();
    await page.waitForTimeout(400);
    const copiedText = await page.$('button:has-text("已复制")');
    console.log('  复制按钮变"已复制":', !!copiedText, '(期望 true)');
  }

  // ---- 主截图（设置页，内容最丰富）----
  await page.click('.dl-toptab:has-text("设置页")');
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.join(mainDir, 'auxiliary-pages-v2-screenshot.png'),
    fullPage: true
  });
  console.log('\n主截图: auxiliary-pages-v2-screenshot.png');

  console.log('\n=== 错误汇总 ===');
  console.log('页面错误 (pageerror):', errors.length);
  errors.forEach(e => console.log('  -', e));
  console.log('控制台错误 (console.error):', consoleErrors.length);
  consoleErrors.forEach(e => console.log('  -', e));
  console.log('控制台警告 (console.warning):', consoleWarnings.length);
  consoleWarnings.forEach(e => console.log('  -', e));

  await browser.close();

  if (errors.length > 0 || consoleErrors.length > 0) {
    console.log('\n结果: 不合格（有错误）');
    process.exit(1);
  } else {
    console.log('\n结果: 合格（无错误）');
  }
})();
