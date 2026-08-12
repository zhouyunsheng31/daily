/* 调试脚本 - 检查 Babel 转换后的代码和设置面板 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

  await page.goto('http://localhost:8772/', { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  // 获取所有 script 标签，找到 Babel 转换后的
  const scriptInfo = await page.evaluate(() => {
    const scripts = document.querySelectorAll('script');
    const info = [];
    scripts.forEach((s, i) => {
      const len = s.textContent.length;
      const head = s.textContent.substring(0, 200);
      info.push({ idx: i, type: s.type, len, head });
    });
    return info;
  });
  console.log('=== Scripts on page ===');
  scriptInfo.forEach(s => console.log(`[${s.idx}] type=${s.type} len=${s.len}\n  head: ${s.head}\n`));

  // 检查 useState 在转换后代码中出现的位置
  const useStateCheck = await page.evaluate(() => {
    const scripts = document.querySelectorAll('script');
    for (let i = scripts.length - 1; i >= 0; i--) {
      const code = scripts[i].textContent;
      if (code.includes('useState') && code.length > 1000) {
        // 找到所有 "useState" 出现的位置
        const positions = [];
        let idx = 0;
        while ((idx = code.indexOf('useState', idx)) !== -1) {
          positions.push({ pos: idx, ctx: code.substring(Math.max(0, idx - 30), idx + 40) });
          idx += 8;
        }
        // 找 "const { useState" 或 "var useState" 声明
        const decls = positions.filter(p => /const\s*\{\s*useState|var\s+useState|let\s+useState/.test(p.ctx));
        return { scriptIdx: i, totalOccurrences: positions.length, declarations: decls, firstDeclCtx: decls[0] };
      }
    }
    return null;
  });
  console.log('=== useState check ===');
  console.log(JSON.stringify(useStateCheck, null, 2));

  // 检查设置面板分区
  await page.locator('[data-settings-btn="bottom"]').click().catch(() => {});
  await page.waitForTimeout(500);
  const sections = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-section-id]');
    return Array.from(els).map(e => ({ id: e.getAttribute('data-section-id'), label: e.querySelector('span') ? e.querySelectorAll('span')[1] ? e.querySelectorAll('span')[1].textContent : '?' : '?' }));
  });
  console.log('=== Settings sections ===');
  console.log('count:', sections.length);
  sections.forEach(s => console.log(`  ${s.id}: ${s.label}`));

  console.log('\n=== PageErrors ===');
  errors.forEach(e => console.log('  ', e));

  await browser.close();
})();
