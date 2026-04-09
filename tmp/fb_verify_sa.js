const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  // Patch gsap.fromTo to record calls
  await page.evaluate(() => {
    window.__saFromTo = [];
    const orig = window.gsap.fromTo.bind(window.gsap);
    window.gsap.fromTo = function(t, f, to) {
      window.__saFromTo.push({ cls: t.className, from: JSON.parse(JSON.stringify(f)), to: JSON.parse(JSON.stringify(to)) });
      return orig(t, f, to);
    };
  });
  
  const inst = await page.$('[data-fb-component-id="cmp-1775110982860-6wu086"]');
  await inst.click();
  await page.waitForTimeout(100);
  
  // Check element state mid-animation
  const mid = await page.evaluate(() => {
    const el = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    const nextV = el.querySelector('.fb-component-variant.is-active');
    const children = nextV ? nextV.querySelectorAll('[data-fb-node-id]') : [];
    const childStates = [];
    children.forEach(c => {
      const cs = getComputedStyle(c);
      childStates.push({
        nodeId: c.getAttribute('data-fb-node-id'),
        transform: cs.transform,
        width: cs.width,
        height: cs.height,
      });
    });
    return { fromToCalls: window.__saFromTo, childStates };
  });
  
  console.log('gsap.fromTo calls:');
  mid.fromToCalls.forEach(c => {
    const from = Object.keys(c.from).filter(k => k !== 'immediateRender').map(k => k + '=' + (typeof c.from[k] === 'number' ? c.from[k].toFixed(1) : c.from[k])).join(', ');
    const to = Object.keys(c.to).filter(k => !['duration','ease'].includes(k)).map(k => k + '=' + (typeof c.to[k] === 'number' ? c.to[k].toFixed(1) : c.to[k])).join(', ');
    console.log('  ' + c.cls.substring(0, 40) + ': from={' + from + '} to={' + to + '}');
  });
  
  console.log('\nChild transforms at 100ms:');
  mid.childStates.forEach(c => {
    if (c.transform !== 'none') console.log('  ' + c.nodeId + ': transform=' + c.transform + ' w=' + c.width + ' h=' + c.height);
  });
  
  await browser.close();
})();
