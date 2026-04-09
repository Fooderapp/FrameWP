const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  // Check positions before click in both variants
  const before = await page.evaluate(() => {
    const inst = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    const ir = inst.getBoundingClientRect();
    const variants = inst.querySelectorAll('.fb-component-variant');
    const result = [];
    variants.forEach(v => {
      const vid = v.getAttribute('data-fb-variant-id');
      const els = v.querySelectorAll('[data-fb-node-id]');
      const childData = [];
      els.forEach(c => {
        const r = c.getBoundingClientRect();
        childData.push({
          nodeId: c.getAttribute('data-fb-node-id'),
          x: +(r.left - ir.left).toFixed(2),
          y: +(r.top - ir.top).toFixed(2),
          w: +r.width.toFixed(2),
          h: +r.height.toFixed(2),
        });
      });
      result.push({ vid: vid.substring(vid.length - 6), active: v.classList.contains('is-active'), children: childData });
    });
    return result;
  });
  before.forEach(v => {
    console.log(`Variant ...${v.vid} (active=${v.active}):`);
    v.children.forEach(c => console.log(`  ${c.nodeId}: x=${c.x} y=${c.y} w=${c.w} h=${c.h}`));
  });
  
  // Click and capture at 500ms
  const inst = await page.$('[data-fb-component-id="cmp-1775110982860-6wu086"]');
  await inst.click();
  await page.waitForTimeout(500);
  
  const mid = await page.evaluate(() => {
    const inst = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    const ir = inst.getBoundingClientRect();
    const active = inst.querySelector('.fb-component-variant.is-active');
    const els = active.querySelectorAll('[data-fb-node-id]');
    const result = [];
    els.forEach(c => {
      const r = c.getBoundingClientRect();
      const cs = getComputedStyle(c);
      result.push({
        nodeId: c.getAttribute('data-fb-node-id'),
        x: +(r.left - ir.left).toFixed(2),
        w: +r.width.toFixed(2),
        h: +r.height.toFixed(2),
        transform: cs.transform,
      });
    });
    return result;
  });
  console.log('\nAt 500ms (active variant):');
  mid.forEach(c => {
    if (c.transform !== 'none') console.log(`  ${c.nodeId}: x=${c.x} w=${c.w} h=${c.h} transform=${c.transform}`);
    else console.log(`  ${c.nodeId}: x=${c.x} w=${c.w} h=${c.h}`);
  });
  
  // Wait for completion
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const inst = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    const ir = inst.getBoundingClientRect();
    const active = inst.querySelector('.fb-component-variant.is-active');
    const els = active.querySelectorAll('[data-fb-node-id]');
    const result = [];
    els.forEach(c => {
      const r = c.getBoundingClientRect();
      result.push({
        nodeId: c.getAttribute('data-fb-node-id'),
        x: +(r.left - ir.left).toFixed(2),
        w: +r.width.toFixed(2),
        h: +r.height.toFixed(2),
        inlineStyle: (c.getAttribute('style') || '').substring(0, 100),
      });
    });
    return result;
  });
  console.log('\nAfter completion:');
  after.forEach(c => console.log(`  ${c.nodeId}: x=${c.x} w=${c.w} h=${c.h}`));
  
  await browser.close();
})();
