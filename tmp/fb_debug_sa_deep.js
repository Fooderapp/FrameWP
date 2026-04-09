const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();  
  page.on('console', msg => {
    if (msg.text().startsWith('[SA]')) console.log(msg.text());
  });
  
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  // Inject debugging into the SA engine by patching animateVariantSwitch
  await page.evaluate(() => {
    // Find all component instances and check their active variant
    const instances = document.querySelectorAll('.fb-component-instance');
    console.log('[SA] Total instances: ' + instances.length);
    instances.forEach(inst => {
      const cid = inst.getAttribute('data-fb-component-id');
      const active = inst.getAttribute('data-fb-active-variant');
      const variants = inst.querySelectorAll('.fb-component-variant');
      console.log('[SA] Instance: ' + cid + ' active=' + active + ' variants=' + variants.length);
      
      // Check data-fb-node-id attributes on children
      variants.forEach(v => {
        const vid = v.getAttribute('data-fb-variant-id');
        const nodeIdEls = v.querySelectorAll('[data-fb-node-id]');
        const ids = [];
        nodeIdEls.forEach(el => ids.push(el.getAttribute('data-fb-node-id')));
        console.log('[SA]   variant=' + vid + ' nodeIds=[' + ids.join(', ') + '] active=' + v.classList.contains('is-active'));
      });
    });
  });
  
  // Click the component  
  const inst = await page.$('[data-fb-component-id="cmp-1775110982860-6wu086"]');
  if (!inst) { console.log('Not found'); await browser.close(); return; }
  
  // Before clicking, check the exact state
  const before = await page.evaluate(() => {
    const el = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    const variants = el.querySelectorAll('.fb-component-variant');
    const result = [];
    variants.forEach(v => {
      const vid = v.getAttribute('data-fb-variant-id');
      const els = v.querySelectorAll('[data-fb-node-id]');
      const childInfo = [];
      els.forEach(c => {
        const r = c.getBoundingClientRect();
        const cs = getComputedStyle(c);
        childInfo.push({
          nodeId: c.getAttribute('data-fb-node-id'),
          rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
          bg: cs.backgroundColor,
          opacity: cs.opacity,
          color: cs.color,
          borderRadius: cs.borderRadius,
        });
      });
      result.push({ vid, active: v.classList.contains('is-active'), children: childInfo });
    });
    return result;
  });
  console.log('[SA] BEFORE CLICK variant states:');
  before.forEach(v => {
    console.log('[SA]   ' + v.vid + ' (active=' + v.active + '):');
    v.children.forEach(c => {
      console.log('[SA]     ' + c.nodeId + ': ' + JSON.stringify(c.rect) + ' bg=' + c.bg + ' opacity=' + c.opacity);
    });
  });
  
  await browser.close();
})();
