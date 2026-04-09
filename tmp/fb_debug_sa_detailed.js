const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Capture console logs
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  // Monkey-patch key SA functions
  await page.evaluate(() => {
    window.__saTrace = [];
    
    // Patch gsap.fromTo
    const origFromTo = window.gsap.fromTo.bind(window.gsap);
    window.gsap.fromTo = function(target, from, to) {
      window.__saTrace.push({ fn: 'gsap.fromTo', target: target.className || target.tagName, from: JSON.stringify(from).substring(0,200), to: JSON.stringify(to).substring(0,200) });
      return origFromTo(target, from, to);
    };
    
    // Patch gsap.timeline
    const origTimeline = window.gsap.timeline.bind(window.gsap);
    window.gsap.timeline = function(opts) {
      window.__saTrace.push({ fn: 'gsap.timeline', opts: JSON.stringify(opts || {}).substring(0,200) });
      return origTimeline(opts);
    };
  });
  
  // Find the "Property 1=Default" component  
  const allComps = await page.evaluate(() => {
    const result = [];
    document.querySelectorAll('.fb-component-instance').forEach(inst => {
      const variants = inst.querySelectorAll('.fb-component-variant');
      const variantInfos = [];
      variants.forEach(v => {
        variantInfos.push({
          vid: v.getAttribute('data-fb-variant-id'),
          mode: v.getAttribute('data-fb-variant-mode'),
          trigger: v.getAttribute('data-fb-trigger'),
          target: v.getAttribute('data-fb-target-variant-id'),
          duration: v.getAttribute('data-fb-transition-duration'),
          type: v.getAttribute('data-fb-transition-type'),
          isActive: v.classList.contains('is-active'),
        });
      });
      result.push({
        compId: inst.getAttribute('data-fb-component-id'),
        activeVariant: inst.getAttribute('data-fb-active-variant'),
        variants: variantInfos
      });
    });
    return result;
  });
  console.log('ALL COMPONENTS:', JSON.stringify(allComps, null, 2));
  
  // Click the first click-triggered component
  const clickComp = allComps.find(c => c.variants.some(v => v.trigger === 'click'));
  if (clickComp) {
    console.log('\nClicking component:', clickComp.compId);
    const inst = await page.$(`[data-fb-component-id="${clickComp.compId}"]`);
    await inst.click();
    
    // Check at 100ms, 300ms, 600ms
    for (const delay of [100, 300, 600]) {
      await page.waitForTimeout(delay === 100 ? 100 : (delay === 300 ? 200 : 300));
      const state = await page.evaluate((cid) => {
        const el = document.querySelector(`[data-fb-component-id="${cid}"]`);
        const active = el.getAttribute('data-fb-active-variant');
        const variants = el.querySelectorAll('.fb-component-variant');
        const vStates = [];
        variants.forEach(v => {
          const children = v.querySelectorAll('.fb-el');
          const childTransforms = [];
          children.forEach(c => {
            const cs = getComputedStyle(c);
            childTransforms.push({
              id: c.getAttribute('data-fb-node-id'),
              transform: cs.transform,
              width: cs.width,
              height: cs.height,
              opacity: cs.opacity,
            });
          });
          vStates.push({
            vid: v.getAttribute('data-fb-variant-id'),
            classes: v.className,
            children: childTransforms.slice(0, 3)
          });
        });
        return { active, variantStates: vStates, traceLen: window.__saTrace.length };
      }, clickComp.compId);
      console.log(`\nAt ${delay}ms:`, JSON.stringify(state, null, 2));
    }
    
    // Get traces
    const traces = await page.evaluate(() => window.__saTrace);
    console.log('\nGSAP TRACES:', JSON.stringify(traces, null, 2));
  }
  
  await browser.close();
})();
