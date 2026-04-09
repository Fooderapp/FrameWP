const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  // Monkey-patch gsap.fromTo to track calls
  await page.evaluate(() => {
    const origFromTo = window.gsap.fromTo.bind(window.gsap);
    window.__gsapCalls = [];
    window.gsap.fromTo = function(target, from, to) {
      window.__gsapCalls.push({
        target: target.className || target.tagName,
        from: JSON.stringify(from).substring(0, 200),
        to: JSON.stringify(to).substring(0, 200)
      });
      return origFromTo(target, from, to);
    };
  });
  
  const inst = await page.$('[data-fb-component-id="cmp-1775110982860-6wu086"]');
  
  // Before state
  const before = await page.evaluate(() => {
    const el = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    return el.getAttribute('data-fb-active-variant');
  });
  console.log('Active variant before:', before);
  
  // Click
  await inst.click();
  
  // Capture at 150ms
  await page.waitForTimeout(150);
  const mid = await page.evaluate(() => {
    const el = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    const variants = el.querySelectorAll('.fb-component-variant');
    const variantStates = [];
    variants.forEach(v => {
      const vid = v.getAttribute('data-fb-variant-id');
      const children = v.querySelectorAll('.fb-el');
      const childStates = [];
      children.forEach(c => {
        childStates.push({
          nodeId: c.getAttribute('data-fb-node-id'),
          transform: getComputedStyle(c).transform,
          opacity: getComputedStyle(c).opacity,
          inlineStyle: c.style.cssText.substring(0, 200)
        });
      });
      variantStates.push({
        vid,
        classes: v.className,
        children: childStates
      });
    });
    return {
      activeVariant: el.getAttribute('data-fb-active-variant'),
      gsapCalls: window.__gsapCalls.length,
      gsapCallSamples: window.__gsapCalls.slice(0, 3),
      variantStates
    };
  });
  console.log('MID (150ms):', JSON.stringify(mid, null, 2));
  
  // After animation (2s)
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => {
    const el = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    return {
      activeVariant: el.getAttribute('data-fb-active-variant'),
      gsapCalls: window.__gsapCalls.length
    };
  });
  console.log('AFTER:', JSON.stringify(after));
  
  await browser.close();
})();
