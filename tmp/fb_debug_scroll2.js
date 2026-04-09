const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  // Get all elements with scroll animations
  const scrollData = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('[data-fb-animations]').forEach(el => {
      const anims = JSON.parse(el.dataset.fbAnimations || '{}');
      const desktop = anims.desktop || [];
      const scrollAnims = desktop.filter(a => a && a.type === 'scroll');
      if (scrollAnims.length > 0) {
        results.push({
          nodeId: el.dataset.fbNodeId,
          tagName: el.tagName,
          className: el.className.substring(0, 60),
          scrollAnims: scrollAnims.map(a => ({
            type: a.type,
            startState: a.startState ? Object.keys(a.startState) : [],
            startStateLayout: a.startState ? a.startState.layout : null,
            startStateStyle: a.startState ? a.startState.style : null,
          }))
        });
      }
    });
    return results;
  });
  console.log('Elements with scroll animations:', JSON.stringify(scrollData, null, 2));
  
  await browser.close();
})();
