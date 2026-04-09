const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });
  
  // Record element positions at every animation frame
  await page.evaluate(() => {
    window.__posLog = [];
    const comp = document.querySelector('[data-fb-component-id="cmp-1775110982860-6wu086"]');
    const record = () => {
      const active = comp.querySelector('.fb-component-variant.is-active');
      const present = comp.querySelectorAll('.fb-component-variant.is-present');
      const cr = comp.getBoundingClientRect();
      const entry = {
        time: performance.now(),
        compX: Math.round(cr.left),
        compY: Math.round(cr.top),
        compW: Math.round(cr.width),
        compH: Math.round(cr.height),
        activeVid: active?.getAttribute('data-fb-variant-id')?.slice(-6),
        presentCount: present.length,
      };
      // Get children positions of the active variant
      if (active) {
        const els = active.querySelectorAll('[data-fb-node-id]');
        els.forEach(el => {
          const er = el.getBoundingClientRect();
          const nid = el.dataset.fbNodeId.slice(-5);
          entry['el_' + nid + '_x'] = Math.round(er.left - cr.left);
          entry['el_' + nid + '_w'] = Math.round(er.width);
          entry['el_' + nid + '_transform'] = el.style.transform || el.style.cssText.match(/transform[^;]*/)?.[0] || '';
        });
      }
      window.__posLog.push(entry);
    };
    
    let running = true;
    const loop = () => {
      if (!running) return;
      record();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.__stopRecording = () => { running = false; };
  });
  
  await page.waitForTimeout(100);
  
  // Click
  const comp = await page.$('[data-fb-component-id="cmp-1775110982860-6wu086"]');
  await comp.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await comp.click();
  await page.waitForTimeout(2000);
  
  await page.evaluate(() => window.__stopRecording());
  
  const log = await page.evaluate(() => {
    // Only return frames around the click (where changes happen)
    const all = window.__posLog;
    // Find first frame where activeVid changes
    let changeIdx = all.findIndex((e, i) => i > 0 && e.activeVid !== all[0].activeVid);
    if (changeIdx < 0) changeIdx = 0;
    return all.slice(Math.max(0, changeIdx - 3), changeIdx + 15);
  });
  
  console.log('Position log around variant switch:');
  const t0 = log[0]?.time ?? 0;
  log.forEach((e, i) => {
    const t = ((e.time - t0)).toFixed(1);
    const els = Object.keys(e).filter(k => k.startsWith('el_')).map(k => `${k}=${e[k]}`).join(' ');
    console.log(`[${t}ms] active=${e.activeVid} present=${e.presentCount} comp={x:${e.compX},y:${e.compY},w:${e.compW},h:${e.compH}} ${els}`);
  });
  
  await browser.close();
})();
