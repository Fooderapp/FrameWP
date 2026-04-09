const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.scrollTo(0, 3800));
  await page.waitForTimeout(500);

  // Monkey-patch animateVariantSwitch to capture debug info
  const hooked = await page.evaluate(() => {
    // Find the saTimeline reference and animateVariantSwitch
    // We need to intercept gsap.timeline and gsap.fromTo to see what's happening
    const debug = window.__saDebug = { calls: [], tweens: [], timelines: [] };
    
    // Wrap gsap.timeline
    const origTimeline = gsap.timeline.bind(gsap);
    const origFromTo = gsap.fromTo.bind(gsap);
    
    gsap.timeline = function(opts) {
      const tl = origTimeline(opts);
      debug.timelines.push({
        created: performance.now(),
        hasOnComplete: !!opts?.onComplete,
        duration: null
      });
      const origAdd = tl.add.bind(tl);
      tl.add = function(child, pos) {
        debug.tweens.push({
          position: pos,
          childDuration: child?.duration?.() ?? null,
          time: performance.now()
        });
        return origAdd(child, pos);
      };
      // Capture duration after tweens are added
      setTimeout(() => {
        const last = debug.timelines[debug.timelines.length - 1];
        if (last) last.duration = tl.duration();
      }, 50);
      return tl;
    };
    
    gsap.fromTo = function(target, from, to) {
      debug.calls.push({
        target: target?.dataset?.fbNodeId || target?.className?.substring(0,60) || 'unknown',
        fromKeys: Object.keys(from || {}),
        toKeys: Object.keys(to || {}),
        duration: to?.duration,
        easeType: typeof to?.ease,
        time: performance.now()
      });
      return origFromTo(target, from, to);
    };
    
    return true;
  });

  // Click
  const inst = await page.$('[data-fb-component-id="cmp-1775110982860-6wu086"]');
  await inst.click();
  
  // Sample at multiple intervals
  const samples = [];
  for (const delay of [16, 50, 100, 200, 500, 1000]) {
    await page.waitForTimeout(delay - (samples.length > 0 ? [16,50,100,200,500,1000][samples.length-1] : 0));
    const s = await page.evaluate(() => {
      const inst = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
      const v2 = inst?.querySelector('[data-fb-variant-id="cmp-var-1775110984929-ic0m3x"]');
      const child = v2?.querySelector('[data-fb-node-id="fr-1775110937637-8r120"]');
      return {
        t: performance.now(),
        v2Active: v2?.classList.contains('is-active'),
        v2Present: v2?.classList.contains('is-present'),
        v2Opacity: v2?.style.opacity,
        v2Vis: v2?.style.visibility,
        childTransform: child ? getComputedStyle(child).transform : null,
        childW: child ? Math.round(child.getBoundingClientRect().width) : null,
        childInlineW: child?.style.width || null
      };
    });
    samples.push({ delay, ...s });
  }

  const debugData = await page.evaluate(() => window.__saDebug);
  
  console.log('=== SA DEBUG DATA ===');
  console.log(JSON.stringify(debugData, null, 2));
  console.log('=== SAMPLES ===');
  console.log(JSON.stringify(samples, null, 2));
  console.log('=== ERRORS ===');
  console.log(JSON.stringify(errors, null, 2));
  await browser.close();
})();
