const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  // Find the click-trigger component
  const cmp = await page.$('[data-fb-component-id="cmp-1775110982860-6wu086"]');
  if (!cmp) { console.log('Component not found'); await browser.close(); return; }
  
  // Capture before state
  const before = await page.evaluate(() => {
    const inst = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    const active = inst.querySelector('.fb-component-variant.is-active');
    return {
      activeVariant: active ? active.getAttribute('data-variant-id') : null,
      gsapVersion: window.gsap && window.gsap.version,
    };
  });
  console.log('BEFORE click:', JSON.stringify(before));
  
  // Click
  await cmp.click();
  
  // Wait 200ms and capture mid-animation state
  await page.waitForTimeout(200);
  const during = await page.evaluate(() => {
    const inst = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    const variants = inst.querySelectorAll('.fb-component-variant');
    const result = {};
    variants.forEach(v => {
      const vid = v.getAttribute('data-variant-id');
      const firstChild = v.querySelector('.fb-el');
      result[vid] = {
        classes: v.className,
        transform: firstChild ? getComputedStyle(firstChild).transform : 'N/A',
        opacity: firstChild ? getComputedStyle(firstChild).opacity : 'N/A',
      };
    });
    return result;
  });
  console.log('DURING (200ms):', JSON.stringify(during, null, 2));
  
  // Wait for animation to complete
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const inst = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    const active = inst.querySelector('.fb-component-variant.is-active');
    return {
      activeVariant: active ? active.getAttribute('data-variant-id') : null,
    };
  });
  console.log('AFTER:', JSON.stringify(after));
  
  await browser.close();
})();
