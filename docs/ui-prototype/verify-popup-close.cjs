// 快速验证弹出层关闭按钮
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await p.goto('http://localhost:8765/canvas-core-v3.html', { waitUntil: 'load', timeout: 90000 });
  await p.waitForTimeout(3000);

  // 切换到视图4
  await p.locator('button:has-text("弹出层")').click();
  await p.waitForTimeout(500);

  // 点击登录窗口卡片
  await p.locator('text=登录窗口').first().click();
  await p.waitForTimeout(500);

  const before = await p.evaluate(() => document.querySelectorAll('[style*="overlay"]').length);
  console.log('弹窗打开后 overlay 数量:', before);

  // 点击关闭按钮（X 图标在 popup 右上角）
  // 用 evaluate 找到并点击包含 close SVG 的按钮
  const closed = await p.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      // 找到 popup 内的关闭按钮（包含 "line x1=6" 的 SVG）
      if (btn.innerHTML.includes('line x1="6"') && btn.closest('[class*="pop-in"]')) {
        btn.click();
        return true;
      }
    }
    return false;
  });
  console.log('找到并点击关闭按钮:', closed);
  await p.waitForTimeout(500);

  const after = await p.evaluate(() => document.querySelectorAll('[style*="overlay"]').length);
  console.log('关闭后 overlay 数量:', after);
  console.log('弹出层关闭' + (after === 0 ? '成功' : '失败'));

  await b.close();
  process.exit(after === 0 ? 0 : 1);
})();
