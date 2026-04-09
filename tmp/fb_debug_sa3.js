const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.scrollTo(0, 3800));
  await page.waitForTimeout(500);

  // Monkey-patch window.gsap to capture debug info
  await page.evaluate(() => {
    const g = window.gsap;
    if (!g) return;
    const debug = window.__saDebug = { fromToCalls: [], timelineCreated: false, timelineDuration: null, tweenCount: 0 };
    
    const origFromTo = g.fromTo.bind(g);
    g.fromTo = function(target, from, to) {
      const nodeId = target?.dataset?.fbNodeId || target?.className?.substring(0,80) || 'unknown';
      const isVariantChild = target?.closest?.('.fb-component-variant') != null;
      debug.fromToCalls.push({
        nodeId,
        isVariantChild,
        fromKeys: Object.keys(from || {}),
        toKeys: Object.keys(to || {}),
        fromX: from?.x, fromY: from?.y, fromW: from?.width, fromH: from?.height, fromRot: from?.rotation,
        toX: to?.x, toY: to?.y, toW: to?.width, toH: to?.height, toRot: to?.rotation,
        duration: to?.duration,
        easeType: typeof to?.ease,
        time: performance.now()
      });
      debug.tweenCount++;
      return origFromTo(target, from, to);
    };
    
    const origTimeline = g.timeline.bind(g);
    g.timeline = function(opts) {
      debug.timelineCreated = true;
      const tl = origTimeline(opts);
      setTimeout(() => { debug.timelineDuration = tl.duration(); }, 100);
      return tl;
    };
  });

  // Click
  const inst = await page.$('[data-fb-component-id="cmp-1775110982860-6wu086"]');
  await inst.click();
  
  // Wait then capture
  await page.waitForTimeout(50);
  const snap50 = await page.evaluate(() => {
    const inst = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    const v2 = inst?.querySelector('[data-fb-variant-id="cmp-var-1775110984929-ic0m3x"]');
    const child = v2?.querySelector('[data-fb-node-id="fr-1775110937637-8r120"]');
    const cs = child ? getComputedStyle(child) : null;
    return {
      v2Active: v2?.classList.contains('is-active'),
      v2Present: v2?.classList.contains('is-present'),
      v2InlineOpacity: v2?.style.opacity,
      childTransform: cs?.transform,
      childW: child ? child.getBoundingClientRect().width : null,
      childInlineStyle: child?.getAttribute('style')?.substring(0,200) || null
    };
  });
  
  await page.waitForTimeout(200);
  const snap250 = await page.evaluate(() => {
    const inst = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    const v2 = inst?.querySelector('[data-fb-variant-id="cmp-var-1775110984929-ic0m3x"]');
    const child = v2?.querySelector('[data-fb-node-id="fr-1775110937637-8r120"]');
    const cs = child ? getComputedStyle(child) : null;
    return {
      v2Active: v2?.classList.contains('is-active'),
      v2Present: v2?.classList.contains('is-present'),
      v2InlineOpacity: v2?.style.opacity,
      childTransform: cs?.transform,
      childW: child ? child.getBoundingClientRect().width : null,
    };
  });
  
  await page.waitForTimeout(1200);
  const debugData = await page.evaluate(() => window.__saDebug);
  
  console.log('=== gsap.fromTo CALLS ===');
  console.log(JSON.stringify(debugData, null, 2));
  console.log('=== SNAP @50ms ===');
  console.log(JSON.stringify(snap50, null, 2));
  console.log('=== SNAP @250ms ===');
  console.log(JSON.stringify(snap250, null, 2));
  console.log('=== ERRORS ===');
  console.log(JSON.stringify(errors, null, 2));
  await browser.close();
})();
