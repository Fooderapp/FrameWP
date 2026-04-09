const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  await page.evaluate(() => {
    window.__saCalls = [];
    const orig = window.gsap.fromTo.bind(window.gsap);
    window.gsap.fromTo = function(t, f, to) {
      const cls = (t.className || '').split(' ').find(c => c.startsWith('fb-el-')) || '';
      window.__saCalls.push({ cls, from: Object.keys(f), to: Object.keys(to).filter(k => k !== 'duration' && k !== 'ease') });
      return orig(t, f, to);
    };
  });
  
  const comp = await page.$('[data-fb-component-id="cmp-1775110982860-6wu086"]');
  await comp.scrollIntoViewIfNeeded();
  await page.waitForTimeout(50);
  await comp.click();
  await page.waitForTimeout(1500);
  
  const calls = await page.evaluate(() => window.__saCalls);
  console.log('SA calls:', calls.length);
  calls.forEach(c => console.log(`  ${c.cls}: from=[${c.from}] to=[${c.to}]`));
  
  // Check final positions
  const final = await page.evaluate(() => {
    const inst = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    const ir = inst.getBoundingClientRect();
    const active = inst.querySelector('.fb-component-variant.is-active');
    const r = [];
    active.querySelectorAll('[data-fb-node-id]').forEach(n => {
      const br = n.getBoundingClientRect();
      r.push({ nid: n.dataset.fbNodeId.slice(-5), x: +(br.left-ir.left).toFixed(1), w: +br.width.toFixed(1) });
    });
    return r;
  });
  console.log('\nFinal positions:');
  final.forEach(f => console.log(`  ${f.nid}: x=${f.x} w=${f.w}`));
  
  await browser.close();
})();
