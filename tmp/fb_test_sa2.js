const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  // Check component structure
  const structure = await page.evaluate(() => {
    const inst = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    if (!inst) return 'Component not found';
    const variants = inst.querySelectorAll('.fb-component-variant');
    const result = [];
    variants.forEach(v => {
      result.push({
        variantId: v.getAttribute('data-variant-id'),
        classes: v.className,
        childCount: v.querySelectorAll('.fb-el').length,
        attrs: Array.from(v.attributes).map(a => a.name + '=' + a.value.substring(0, 60))
      });
    });
    return { instanceAttrs: Array.from(inst.attributes).map(a => a.name + '=' + a.value.substring(0, 80)), variantCount: variants.length, variants: result };
  });
  console.log(JSON.stringify(structure, null, 2));
  
  await browser.close();
})();
