const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  const errors = [];
  const consoleMessages = [];

  page.on('console', msg => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    errors.push(`[pageerror] ${err.message}`);
  });

  console.log('=== 验证 index.html 聚合页面 ===');
  await page.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 检查页面标题
  const title = await page.title();
  console.log('页面标题:', title);

  // 检查导航按钮
  const navBtns = await page.$$eval('.nav-btn', btns => btns.map(b => b.textContent));
  console.log('导航按钮:', navBtns);

  // 检查 iframe 数量
  const iframes = await page.$$eval('iframe', frames => frames.map(f => ({ src: f.src, title: f.title })));
  console.log('iframe 数量:', iframes.length);
  console.log('iframe 列表:', JSON.stringify(iframes, null, 2));

  // 检查活跃的 iframe
  const activeFrame = await page.$('.frame-wrapper.active iframe');
  if (activeFrame) {
    const src = await activeFrame.getAttribute('src');
    console.log('活跃 iframe src:', src);

    // 检查 iframe 内容是否加载
    const frame = await activeFrame.contentFrame();
    if (frame) {
      await frame.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      const frameTitle = await frame.title();
      const frameBody = await frame.$('body');
      const frameBodyText = frameBody ? await frameBody.textContent() : '';
      console.log('iframe 标题:', frameTitle);
      console.log('iframe body 文本长度:', frameBodyText.length);
      console.log('iframe body 前 200 字符:', frameBodyText.substring(0, 200));
    }
  } else {
    console.log('❌ 没有找到活跃的 iframe');
  }

  // 测试 Tab 切换
  console.log('\n=== 测试 Tab 切换 ===');
  const auxBtn = await page.$('[data-target="auxiliary"]');
  if (auxBtn) {
    await auxBtn.click();
    await page.waitForTimeout(1000);
    const activeAfterClick = await page.$('.frame-wrapper.active iframe');
    if (activeAfterClick) {
      const src = await activeAfterClick.getAttribute('src');
      console.log('切换后活跃 iframe src:', src);
    }
  }

  // 切回画布核心
  const canvasBtn = await page.$('[data-target="canvas"]');
  if (canvasBtn) {
    await canvasBtn.click();
    await page.waitForTimeout(1000);
  }

  // 截图
  await page.screenshot({ path: 'f:\\allmylife\\event\\docs\\ui-prototype\\verify-index.png', fullPage: false });
  console.log('\n截图已保存: verify-index.png');

  // 检查错误
  console.log('\n=== 错误检查 ===');
  console.log('pageerror 数量:', errors.length);
  if (errors.length > 0) {
    errors.forEach(e => console.log(e));
  }
  console.log('console 消息数量:', consoleMessages.length);
  const errorMessages = consoleMessages.filter(m => m.includes('[error]'));
  if (errorMessages.length > 0) {
    console.log('console.error 消息:');
    errorMessages.forEach(m => console.log(m));
  }

  await browser.close();
  console.log('\n=== 验证完成 ===');
})();
