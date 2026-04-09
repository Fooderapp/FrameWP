const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });

  // Scroll to where components are (around y=4000 based on data-fb-base-y)
  await page.evaluate(() => window.scrollTo(0, 3800));
  await page.waitForTimeout(500);

  // Before click: capture state of the click component
  const before = await page.evaluate(() => {
    const inst = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    if (!inst) return { error: 'instance not found' };
    const variants = inst.querySelectorAll('.fb-component-variant');
    const active = inst.querySelector('.fb-component-variant.is-active');
    const result = {
      instanceSize: { w: inst.offsetWidth, h: inst.offsetHeight },
      variantCount: variants.length,
      activeVariantId: active ? active.dataset.fbVariantId : null,
      variants: []
    };
    variants.forEach(v => {
      const children = v.querySelectorAll('[data-fb-node-id]');
      const childRects = [];
      children.forEach(c => {
        const r = c.getBoundingClientRect();
        childRects.push({
          id: c.dataset.fbNodeId,
          w: Math.round(r.width),
          h: Math.round(r.height),
          top: Math.round(r.top),
          left: Math.round(r.left)
        });
      });
      result.variants.push({
        id: v.dataset.fbVariantId,
        isActive: v.classList.contains('is-active'),
        isPresent: v.classList.contains('is-present'),
        visibility: getComputedStyle(v).visibility,
        opacity: getComputedStyle(v).opacity,
        childCount: children.length,
        childRects: childRects.slice(0, 8)  // first 8
      });
    });
    return result;
  });

  console.log('=== BEFORE CLICK ===');
  console.log(JSON.stringify(before, null, 2));

  // Click the component
  const inst = await page.$('[data-fb-component-id="cmp-1775110982860-6wu086"]');
  if (inst) {
    await inst.click();
    // Wait a tiny bit then capture mid-animation state
    await page.waitForTimeout(150);
    const during = await page.evaluate(() => {
      const inst = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
      if (!inst) return { error: 'gone' };
      const variants = inst.querySelectorAll('.fb-component-variant');
      const result = { variants: [] };
      variants.forEach(v => {
        const cs = getComputedStyle(v);
        const children = v.querySelectorAll('[data-fb-node-id]');
        const childTransforms = [];
        children.forEach(c => {
          const s = getComputedStyle(c);
          childTransforms.push({
            id: c.dataset.fbNodeId,
            transform: s.transform,
            opacity: s.opacity,
            w: Math.round(c.getBoundingClientRect().width),
            h: Math.round(c.getBoundingClientRect().height),
            inlineStyle: c.getAttribute('style') ? c.getAttribute('style').substring(0, 120) : ''
          });
        });
        result.variants.push({
          id: v.dataset.fbVariantId,
          isActive: v.classList.contains('is-active'),
          isPresent: v.classList.contains('is-present'),
          visibility: cs.visibility,
          opacity: cs.opacity,
          inlineOpacity: v.style.opacity,
          inlineVisibility: v.style.visibility,
          childTransforms: childTransforms.slice(0, 8)
        });
      });
      return result;
    });
    console.log('=== DURING ANIMATION (150ms after click) ===');
    console.log(JSON.stringify(during, null, 2));

    // Wait for animation to finish
    await page.waitForTimeout(2000);
    const after = await page.evaluate(() => {
      const inst = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
      if (!inst) return { error: 'gone' };
      const active = inst.querySelector('.fb-component-variant.is-active');
      return {
        activeVariantId: active ? active.dataset.fbVariantId : null
      };
    });
    console.log('=== AFTER ANIMATION ===');
    console.log(JSON.stringify(after, null, 2));
  }

  console.log('=== ERRORS ===');
  console.log(JSON.stringify(errors, null, 2));
  await browser.close();
})();
