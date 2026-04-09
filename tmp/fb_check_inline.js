const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  // Check inline styles for fr-2-mr2 in BOTH variants of the first component instance
  const data = await page.evaluate(() => {
    const inst = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    const variants = inst.querySelectorAll('.fb-component-variant');
    const result = [];
    variants.forEach(v => {
      const vid = v.getAttribute('data-fb-variant-id');
      const children = v.querySelectorAll('[data-fb-node-id]');
      const childData = [];
      children.forEach(c => {
        childData.push({
          nodeId: c.getAttribute('data-fb-node-id'),
          inlineStyle: c.getAttribute('style'),
          rect: (() => { const r = c.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; })()
        });
      });
      result.push({ vid, active: v.classList.contains('is-active'), children: childData });
    });
    return result;
  });
  
  data.forEach(v => {
    console.log(`\nVariant ${v.vid} (active=${v.active}):`);
    v.children.forEach(c => {
      // Find width/height in inline style
      const wMatch = c.inlineStyle?.match(/width:([^;]+)/);
      const hMatch = c.inlineStyle?.match(/height:([^;]+)/);
      console.log(`  ${c.nodeId}: rect=${JSON.stringify(c.rect)} inline-w=${wMatch?.[1]?.trim()} inline-h=${hMatch?.[1]?.trim()}`);
    });
  });
  
  await browser.close();
})();
