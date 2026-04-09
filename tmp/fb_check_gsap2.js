const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  const result = await page.evaluate(() => ({
    hasGsap: !!window.gsap,
    version: window.gsap && window.gsap.version,
    hasFromTo: window.gsap && typeof window.gsap.fromTo,
    hasFlip: !!window.Flip,
    hasST: !!window.ScrollTrigger
  }));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
