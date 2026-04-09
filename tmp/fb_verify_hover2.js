const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  // Hover the mouse-enter component
  const inst = await page.$('[data-fb-component-id="cmp-1775286421344-9cfdj9"]');
  
  // Hover
  await inst.hover();
  
  // Check at multiple time points
  for (const delay of [100, 300, 500, 800, 1200]) {
    await page.waitForTimeout(delay === 100 ? 100 : (delay - [100, 300, 500, 800][[ 100, 300, 500, 800, 1200].indexOf(delay) - 1] || delay));
    const state = await page.evaluate(() => {
      const el = document.querySelector('[data-fb-component-id="cmp-1775286421344-9cfdj9"]');
      const active = el.getAttribute('data-fb-active-variant');
      const variants = el.querySelectorAll('.fb-component-variant');
      const vStates = [];
      variants.forEach(v => {
        vStates.push({
          vid: v.getAttribute('data-fb-variant-id').slice(-6),
          classes: v.className.replace('fb-component-variant ', ''),
          opacity: v.style.opacity || getComputedStyle(v).opacity,
        });
      });
      return { active: active.slice(-6), variants: vStates };
    });
    console.log(`At ${delay}ms:`, JSON.stringify(state));
  }
  
  if (errors.length) console.log('ERRORS:', errors);
  
  await browser.close();
})();
