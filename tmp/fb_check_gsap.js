const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  await p.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  const r = await p.evaluate(() => {
    return {
      hasGsap: !!window.gsap,
      version: window.gsap ? window.gsap.version : null,
      hasFromTo: window.gsap ? typeof window.gsap.fromTo : null,
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})();
