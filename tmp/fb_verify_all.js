const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  // Patch gsap.fromTo
  await page.evaluate(() => {
    window.__saCallCount = 0;
    const orig = window.gsap.fromTo.bind(window.gsap);
    window.gsap.fromTo = function(t, f, to) {
      window.__saCallCount++;
      return orig(t, f, to);
    };
  });
  
  // Click ALL instances of the click component  
  const clickInsts = await page.$$('[data-fb-component-id="cmp-1775110982860-6wu086"]');
  console.log('Click component instances: ' + clickInsts.length);
  
  for (let i = 0; i < clickInsts.length; i++) {
    await page.evaluate(() => { window.__saCallCount = 0; });
    
    // Scroll to make it visible
    await clickInsts[i].scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    
    await clickInsts[i].click();
    await page.waitForTimeout(200);
    
    const result = await page.evaluate((idx) => {
      const insts = document.querySelectorAll('[data-fb-component-id="cmp-1775110982860-6wu086"]');
      const inst = insts[idx];
      const active = inst.querySelector('.fb-component-variant.is-active');
      return {
        index: idx,
        saCallCount: window.__saCallCount,
        activeVid: active ? active.getAttribute('data-fb-variant-id').slice(-6) : 'NONE',
      };
    }, i);
    console.log(`Instance ${i}: saCallCount=${result.saCallCount} activeVid=${result.activeVid}`);
  }
  
  // Also hover ALL instances of the mouse-enter component
  const hoverInsts = await page.$$('[data-fb-component-id="cmp-1775286421344-9cfdj9"]');
  console.log('\nHover component instances: ' + hoverInsts.length);
  
  for (let i = 0; i < hoverInsts.length; i++) {
    await page.evaluate(() => { window.__saCallCount = 0; });
    
    await hoverInsts[i].scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    
    await hoverInsts[i].hover();
    await page.waitForTimeout(200);
    
    const result = await page.evaluate((idx) => {
      const insts = document.querySelectorAll('[data-fb-component-id="cmp-1775286421344-9cfdj9"]');
      const inst = insts[idx];
      const active = inst.querySelector('.fb-component-variant.is-active');
      return {
        index: idx,
        saCallCount: window.__saCallCount,
        activeVid: active ? active.getAttribute('data-fb-variant-id').slice(-6) : 'NONE',
      };
    }, i);
    console.log(`Instance ${i}: saCallCount=${result.saCallCount} activeVid=${result.activeVid}`);
    
    // Move mouse away to reset
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
  }
  
  await browser.close();
})();
