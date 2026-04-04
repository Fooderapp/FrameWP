const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push({ type: 'pageerror', message: error.message });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push({ type: 'console', message: message.text() });
    }
  });
  await page.goto('http://canvaswp.local/homepage/', { waitUntil: 'networkidle' });

  const info = await page.evaluate(() => {
    const hasScrollTrigger = !!window.ScrollTrigger;
    const nodes = [...document.querySelectorAll('[data-fb-animations]')];
    const results = nodes.map((node) => {
      try {
        const parsed = JSON.parse(node.getAttribute('data-fb-animations'));
        const desktop = Array.isArray(parsed.desktop) ? parsed.desktop : [];
        const scroll = desktop.find((entry) => entry && entry.type === 'scroll');
        if (!scroll) return null;
        const style = getComputedStyle(node);
        return {
          id: node.getAttribute('data-fb-node-id'),
          tag: node.tagName,
          className: node.className,
          playback: scroll.playback,
          startOffsetPx: scroll.startOffsetPx,
          endOffsetPx: scroll.endOffsetPx,
          rectTop: node.getBoundingClientRect().top,
          rectHeight: node.getBoundingClientRect().height,
          position: style.position,
          display: style.display,
          leftStyle: style.left,
          topStyle: style.top,
          widthStyle: style.width,
          heightStyle: style.height,
        };
      } catch (error) {
        return null;
      }
    }).filter(Boolean);
    return { hasScrollTrigger, results };
  });

  console.log('ANIMATED_NODES');
  console.log(JSON.stringify(info, null, 2));

  const targetId = info.results[0] && info.results[0].id;
  if (!targetId) {
    console.log('NO_SCROLL_NODE');
    await browser.close();
    return;
  }

  const samples = [];
  for (const y of [0, 200, 400, 600, 800, 1000, 1200, 800, 400, 0]) {
    await page.evaluate((value) => window.scrollTo(0, value), y);
    await page.waitForTimeout(200);
    const sample = await page.evaluate((id) => {
      const nodes = [...document.querySelectorAll(`[data-fb-node-id="${id}"]`)];
      if (!nodes.length) return null;
      const visibleNode = nodes.find((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0) || nodes[0];
      const style = getComputedStyle(visibleNode);
      const parsedAnimations = JSON.parse(visibleNode.getAttribute('data-fb-animations'));
      const scrollAnimation = (Array.isArray(parsedAnimations.desktop) ? parsedAnimations.desktop : []).find((entry) => entry && entry.type === 'scroll');
      const board = visibleNode.closest('.fb-bp-inner') || visibleNode.parentElement;
      const boardTop = board.getBoundingClientRect().top + window.scrollY;
      const nodeTop = visibleNode.getBoundingClientRect().top + window.scrollY;
      const anchorTop = nodeTop - boardTop + (board.scrollTop || 0);
      const startMarker = boardTop + Math.max(0, Math.min(board.clientHeight || board.offsetHeight || 1, anchorTop + (scrollAnimation?.startOffsetPx ?? 0)));
      const endMarker = boardTop + Math.max(0, Math.min(board.clientHeight || board.offsetHeight || 1, anchorTop + (scrollAnimation?.endOffsetPx ?? 0)));
      const manualProgress = Math.max(0, Math.min(1, (window.scrollY - startMarker) / Math.max(0.0001, endMarker - startMarker)));
      const triggers = window.ScrollTrigger
        ? window.ScrollTrigger.getAll().map((entry) => ({
            start: entry.start,
            end: entry.end,
            progress: entry.progress,
            isActive: entry.isActive,
            triggerId: entry.trigger?.getAttribute('data-fb-node-id') || null,
          }))
        : [];
      return {
        scrollY: window.scrollY,
        instances: nodes.map((candidate, index) => ({
          index,
          top: candidate.getBoundingClientRect().top,
          left: candidate.getBoundingClientRect().left,
          width: candidate.getBoundingClientRect().width,
          height: candidate.getBoundingClientRect().height,
          transform: getComputedStyle(candidate).transform,
        })),
        top: visibleNode.getBoundingClientRect().top,
        left: visibleNode.getBoundingClientRect().left,
        width: visibleNode.getBoundingClientRect().width,
        height: visibleNode.getBoundingClientRect().height,
        opacity: style.opacity,
        position: style.position,
        styleLeft: style.left,
        styleTop: style.top,
        styleWidth: style.width,
        styleHeight: style.height,
        transform: style.transform,
        transition: scrollAnimation?.transition ?? null,
        startState: scrollAnimation?.startState ?? null,
        baseState: visibleNode.__fbAnimationBaseState
          ? {
              left: visibleNode.__fbAnimationBaseState.left,
              top: visibleNode.__fbAnimationBaseState.top,
              width: visibleNode.__fbAnimationBaseState.width,
              height: visibleNode.__fbAnimationBaseState.height,
              widthCss: visibleNode.__fbAnimationBaseState.widthCss,
              heightCss: visibleNode.__fbAnimationBaseState.heightCss,
              position: visibleNode.__fbAnimationBaseState.position,
              rotation: visibleNode.__fbAnimationBaseState.rotation,
            }
          : null,
        appliedProgress: visibleNode.dataset.fbDebugScrollProgress || null,
        manualProgress,
        startMarker,
        endMarker,
        triggers,
      };
    }, targetId);
    samples.push(sample);
  }

  console.log('SAMPLES');
  console.log(JSON.stringify({ targetId, samples }, null, 2));
  console.log('ERRORS');
  console.log(JSON.stringify(errors, null, 2));

  await browser.close();
})();
