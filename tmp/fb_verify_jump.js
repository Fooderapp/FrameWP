const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  // Patch gsap.fromTo to record timing
  await page.evaluate(() => {
    window.__opacityLog = [];
    const origFrom = window.gsap.fromTo.bind(window.gsap);
    window.gsap.fromTo = function(t, f, to) {
      const result = origFrom(t, f, to);
      return result;
    };
    // Monitor opacity changes on variant wrappers
    const comp = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    const variants = comp.querySelectorAll('.fb-component-variant');
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'style') {
          const vid = m.target.getAttribute('data-fb-variant-id')?.slice(-6);
          window.__opacityLog.push({
            vid, opacity: m.target.style.opacity, time: performance.now(),
            isActive: m.target.classList.contains('is-active'),
          });
        }
      }
    });
    variants.forEach(v => observer.observe(v, { attributes: true }));
  });
  
  // Click component
  const comp = await page.$('[data-fb-component-id="cmp-1775110982860-6wu086"]');
  await comp.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await comp.click();
  await page.waitForTimeout(100);
  
  // Check opacity state
  const log = await page.evaluate(() => window.__opacityLog);
  console.log('Opacity transitions:');
  const t0 = log.length ? log[0].time : 0;
  log.forEach(entry => {
    console.log(`  +${(entry.time - t0).toFixed(1)}ms ${entry.vid} opacity=${entry.opacity} isActive=${entry.isActive}`);
  });
  
  // Key check: did the "next" variant get opacity=1 AFTER fromTo tweens?
  // The next variant (ic0m3x) should only get opacity='1' after all fromTo calls
  const nextOpacity1 = log.find(e => e.vid === 'ic0m3x' && e.opacity === '1');
  const currentOpacity0 = log.find(e => e.vid === 'cqg30m' && e.opacity === '0');
  console.log('\nNext visible at: +' + ((nextOpacity1?.time ?? 0) - t0).toFixed(1) + 'ms');
  console.log('Current hidden at: +' + ((currentOpacity0?.time ?? 0) - t0).toFixed(1) + 'ms');
  
  await browser.close();
})();
