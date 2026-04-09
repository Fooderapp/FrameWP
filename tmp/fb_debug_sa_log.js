const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const saLogs = [];
  page.on('console', msg => {
    const t = msg.text();
    if (t.startsWith('[SA-DBG]')) saLogs.push(t);
  });
  
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  // Click the component
  const inst = await page.$('[data-fb-component-id="cmp-1775110982860-6wu086"]');
  await inst.click();
  await page.waitForTimeout(2000);
  
  console.log('=== SA DEBUG LOGS ===');
  saLogs.forEach(l => console.log(l));
  console.log('=== END ===');
  
  await browser.close();
})();
