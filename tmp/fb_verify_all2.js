const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  // Check visibility of all instances
  const info = await page.evaluate(() => {
    const allClick = document.querySelectorAll('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    const allHover = document.querySelectorAll('[data-fb-component-id="cmp-1775286421344-9cfdj9"]');
    const check = (els, label) => {
      const results = [];
      els.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        results.push({
          index: i,
          visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
          display: cs.display,
          visibility: cs.visibility,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          activeVariant: el.getAttribute('data-fb-active-variant')?.slice(-6),
          parentClasses: el.parentElement?.className?.substring(0, 80),
        });
      });
      return results;
    };
    return {
      click: check(allClick, 'click'),
      hover: check(allHover, 'hover'),
    };
  });
  
  console.log('Click components:');
  info.click.forEach(c => console.log(`  [${c.index}] visible=${c.visible} display=${c.display} rect=${JSON.stringify(c.rect)} active=${c.activeVariant} parent=${c.parentClasses}`));
  
  console.log('\nHover components:');
  info.hover.forEach(c => console.log(`  [${c.index}] visible=${c.visible} display=${c.display} rect=${JSON.stringify(c.rect)} active=${c.activeVariant} parent=${c.parentClasses}`));
  
  await browser.close();
})();
