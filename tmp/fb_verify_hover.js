const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const saLogs = [];
  page.on('console', msg => saLogs.push(msg.text()));
  
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  // Patch gsap.fromTo
  await page.evaluate(() => {
    window.__saFromTo = [];
    const orig = window.gsap.fromTo.bind(window.gsap);
    window.gsap.fromTo = function(t, f, to) {
      window.__saFromTo.push({ cls: (t.className || '').substring(0, 50), from: Object.keys(f).filter(k => k !== 'immediateRender'), to: Object.keys(to).filter(k => !['duration','ease'].includes(k)) });
      return orig(t, f, to);
    };
  });
  
  // Hover over the mouse-enter component
  const inst = await page.$('[data-fb-component-id="cmp-1775286421344-9cfdj9"]');
  if (!inst) { console.log('Mouse-enter component not found'); await browser.close(); return; }
  
  const before = await page.evaluate(() => {
    const el = document.querySelector('[data-fb-component-id="cmp-1775286421344-9cfdj9"]');
    return { active: el.getAttribute('data-fb-active-variant') };
  });
  console.log('Before hover:', before);
  
  await inst.hover();
  await page.waitForTimeout(200);
  
  const during = await page.evaluate(() => {
    const el = document.querySelector('[data-fb-component-id="cmp-1775286421344-9cfdj9"]');
    const variants = el.querySelectorAll('.fb-component-variant');
    const vInfo = [];
    variants.forEach(v => vInfo.push({ vid: v.getAttribute('data-fb-variant-id').substring(v.getAttribute('data-fb-variant-id').length - 6), classes: v.className }));
    return {
      active: el.getAttribute('data-fb-active-variant'),
      variants: vInfo,
      fromToCalls: window.__saFromTo.length,
    };
  });
  console.log('During hover (200ms):', JSON.stringify(during, null, 2));
  
  // Move mouse away
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  
  const after = await page.evaluate(() => {
    const el = document.querySelector('[data-fb-component-id="cmp-1775286421344-9cfdj9"]');
    return {
      active: el.getAttribute('data-fb-active-variant'),
      fromToCalls: window.__saFromTo.length,
    };
  });
  console.log('After mouse leave:', JSON.stringify(after));
  
  // Check fromTo details
  const calls = await page.evaluate(() => window.__saFromTo.slice(0, 5));
  console.log('fromTo call samples:', JSON.stringify(calls, null, 2));
  
  await browser.close();
})();
