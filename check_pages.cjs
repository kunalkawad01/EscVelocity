const { chromium } = require('playwright');

(async () => {
  const br = await chromium.launch();
  const page = await br.newPage();

  for (const path of ['/live-trading', '/intraday-race']) {
    const errs = [];
    const handler = m => { if (m.type() === 'error') errs.push(m.text()); };
    const pgErr = e => errs.push('PAGE ERROR: ' + e.message);
    page.on('console', handler);
    page.on('pageerror', pgErr);

    console.log('\n=== ' + path + ' ===');
    try {
      await page.goto('http://localhost:5173' + path, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(3000);
    } catch (e) {
      console.log('Navigation error:', e.message);
    }
    if (errs.length) errs.forEach(e => console.log('ERR:', e));
    else console.log('No console errors');

    page.off('console', handler);
    page.off('pageerror', pgErr);
  }

  await br.close();
})();
