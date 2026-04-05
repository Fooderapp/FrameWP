/**
 * FrameBuilder Loop Runtime
 * Handles slideshow, ticker, and carousel modes on the frontend.
 * No build step — this file is copied as-is to assets/.
 */
(function () {
  'use strict';

  function initLoopTracks() {
    document.querySelectorAll('.fb-loop-track[data-fb-loop-mode]').forEach(initTrack);
  }

  function initTrack(track) {
    if (track._fbLoopInit) return;
    track._fbLoopInit = true;

    var mode = track.getAttribute('data-fb-loop-mode');
    var config = {};
    try { config = JSON.parse(track.getAttribute('data-fb-loop-config') || '{}'); } catch (e) { /* noop */ }
    var container = track.closest('.fb-loop-interactive') || track.parentElement;

    bindItemNavigation(track);

    if (mode === 'slideshow') initSlideshow(track, container, config);
    else if (mode === 'ticker') initTicker(track, container, config);
    else if (mode === 'carousel') initCarousel(track, container, config);
  }

  /* ── Auto-navigate for query-sourced items ──────────────────── */
  function bindItemNavigation(track) {
    track.querySelectorAll('.fb-loop-runtime-item[data-fb-loop-item-url]').forEach(function (item) {
      if (item._fbNavBound) return;
      item._fbNavBound = true;
      item.addEventListener('click', function (e) {
        if (e.target.closest('[data-fb-link-url], a[href], button')) return;
        var url = item.getAttribute('data-fb-loop-item-url');
        if (!url) return;
        if (e.metaKey || e.ctrlKey) {
          window.open(url, '_blank', 'noopener');
        } else {
          window.location.href = url;
        }
      });
    });
  }

  function cloneLoopItems(items) {
    return items.map(function (item) {
      return item.cloneNode(true);
    });
  }

  function onTrackTransitionComplete(track, duration, callback) {
    var done = false;

    function finish() {
      if (done) return;
      done = true;
      track.removeEventListener('transitionend', onEnd);
      callback();
    }

    function onEnd(event) {
      if (event.target !== track) return;
      if (event.propertyName && event.propertyName !== 'transform') return;
      finish();
    }

    track.addEventListener('transitionend', onEnd);
    window.setTimeout(finish, Math.max(0, duration) + 60);
  }

  /* ── Drag / swipe helper ────────────────────────────────────── */
  function bindDrag(track, opts) {
    var startX = 0;
    var startY = 0;
    var dragging = false;
    var moved = false;
    var threshold = 8;

    track.style.touchAction = opts.vertical ? 'pan-x' : 'pan-y';
    track.style.userSelect = 'none';

    track.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      dragging = true;
      moved = false;
      if (opts.onStart) opts.onStart();
      track.setPointerCapture(e.pointerId);
    });

    track.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      var delta = opts.vertical ? dy : dx;
      if (!moved && Math.abs(delta) < threshold) return;
      moved = true;
      if (opts.onMove) opts.onMove(delta);
    });

    track.addEventListener('pointerup', function (e) {
      if (!dragging) return;
      dragging = false;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      var delta = opts.vertical ? dy : dx;
      if (moved && opts.onEnd) opts.onEnd(delta);
      moved = false;
    });

    track.addEventListener('pointercancel', function () {
      if (!dragging) return;
      dragging = false;
      if (moved && opts.onEnd) opts.onEnd(0);
      moved = false;
    });

    // Prevent click on children after drag
    track.addEventListener('click', function (e) {
      if (moved) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  /* ── Slideshow ──────────────────────────────────────────────── */
  function initSlideshow(track, container, cfg) {
    var items = Array.from(track.querySelectorAll(':scope > .fb-loop-runtime-item'));
    if (items.length < 2) return;
    var current = 0;
    var duration = cfg.transitionDuration || 500;
    var transition = cfg.transition || 'slide';
    var loopEnabled = cfg.loop !== false;
    var autoplay = cfg.autoplay !== false;
    var interval = cfg.interval || 4000;
    var paused = false;
    var timer = null;
    var visualIndex = 0;
    var isAnimating = false;
    var slideItems = items;
    var hasLoopClones = transition === 'slide' && loopEnabled && items.length > 1;

    track.style.display = 'flex';
    track.style.flexWrap = 'nowrap';
    track.style.gap = '0px';
    track.style.willChange = 'transform';

    if (hasLoopClones) {
      track.insertBefore(items[items.length - 1].cloneNode(true), track.firstChild);
      track.appendChild(items[0].cloneNode(true));
      slideItems = Array.from(track.querySelectorAll(':scope > .fb-loop-runtime-item'));
      bindItemNavigation(track);
      visualIndex = 1;
    }

    if (transition === 'slide') {
      track.style.transition = 'transform ' + duration + 'ms ease';
    }

    function getSlideWidth() {
      return container.clientWidth || container.offsetWidth || 0;
    }

    slideItems.forEach(function (item, i) {
      item.style.flex = '0 0 100%';
      item.style.flexShrink = '0';
      item.style.minWidth = '100%';
      item.style.width = '100%';
      item.style.boxSizing = 'border-box';
      item.style.display = 'block';
      if (transition === 'fade') {
        item.style.position = i === 0 ? 'relative' : 'absolute';
        item.style.top = '0';
        item.style.left = '0';
        item.style.width = '100%';
        item.style.opacity = i === 0 ? '1' : '0';
        item.style.transition = 'opacity ' + duration + 'ms ease';
        item.style.zIndex = i === 0 ? '1' : '0';
      }
    });

    if (transition === 'fade') {
      track.style.position = 'relative';
    }

    function setSlidePosition(index, animated) {
      if (transition !== 'slide') return;
      track.style.transition = animated ? ('transform ' + duration + 'ms ease') : 'none';
      track.style.transform = 'translateX(-' + (index * getSlideWidth()) + 'px)';
    }

    function goTo(index) {
      if (transition === 'slide' && isAnimating) return;
      if (index === current && (!hasLoopClones || visualIndex === current + 1)) return;
      var prev = current;

      if (transition === 'fade') {
        current = index;
        items[prev].style.opacity = '0';
        items[prev].style.zIndex = '0';
        items[prev].style.position = 'absolute';
        items[current].style.opacity = '1';
        items[current].style.zIndex = '1';
        items[current].style.position = 'relative';
        updateDots(container, current);
      } else if (transition === 'slide') {
        if (hasLoopClones) {
          if (index >= items.length) {
            isAnimating = true;
            current = 0;
            visualIndex = items.length + 1;
            updateDots(container, current);
            setSlidePosition(visualIndex, true);
            onTrackTransitionComplete(track, duration, function () {
              isAnimating = false;
              visualIndex = 1;
              setSlidePosition(visualIndex, false);
            });
            return;
          }
          if (index < 0) {
            isAnimating = true;
            current = items.length - 1;
            visualIndex = 0;
            updateDots(container, current);
            setSlidePosition(visualIndex, true);
            onTrackTransitionComplete(track, duration, function () {
              isAnimating = false;
              visualIndex = items.length;
              setSlidePosition(visualIndex, false);
            });
            return;
          }
          current = index;
          visualIndex = current + 1;
          updateDots(container, current);
          setSlidePosition(visualIndex, true);
          return;
        }

        current = Math.max(0, Math.min(index, items.length - 1));
        setSlidePosition(current, true);
        updateDots(container, current);
      } else {
        current = index;
        items.forEach(function (it, idx) {
          it.style.display = idx === current ? 'flex' : 'none';
        });
        updateDots(container, current);
      }
    }

    function next() {
      var n = current + 1;
      if (n >= items.length) n = loopEnabled ? 0 : items.length - 1;
      goTo(n);
    }

    function prev() {
      var n = current - 1;
      if (n < 0) n = loopEnabled ? items.length - 1 : 0;
      goTo(n);
    }

    function startAutoplay() {
      stopAutoplay();
      if (autoplay && !paused) {
        timer = setInterval(next, interval);
      }
    }

    function stopAutoplay() {
      if (timer) { clearInterval(timer); timer = null; }
    }

    bindArrows(container, prev, next);
    bindDots(container, goTo);

    // Drag / swipe for slide transition
    if (transition === 'slide') {
      bindDrag(track, {
        onStart: function () {
          if (isAnimating) return;
          stopAutoplay();
          track.style.transition = 'none';
        },
        onMove: function (dx) {
          if (isAnimating) return;
          var base = (hasLoopClones ? visualIndex : current) * getSlideWidth();
          track.style.transform = 'translateX(' + (-base + dx) + 'px)';
        },
        onEnd: function (dx) {
          if (isAnimating) return;
          track.style.transition = 'transform ' + duration + 'ms ease';
          if (dx < -40) next();
          else if (dx > 40) prev();
          else setSlidePosition(hasLoopClones ? visualIndex : current, true);
          startAutoplay();
        },
      });
    }

    if (transition === 'slide' && hasLoopClones) {
      setSlidePosition(visualIndex, false);
    }

    window.addEventListener('resize', function () {
      if (transition !== 'slide') return;
      setSlidePosition(hasLoopClones ? visualIndex : current, false);
    });

    if (cfg.pauseOnHover !== false) {
      container.addEventListener('mouseenter', function () { paused = true; stopAutoplay(); });
      container.addEventListener('mouseleave', function () { paused = false; startAutoplay(); });
    }

    startAutoplay();
  }

  /* ── Ticker ─────────────────────────────────────────────────── */
  function initTicker(track, container, cfg) {
    var items = Array.from(track.querySelectorAll(':scope > .fb-loop-runtime-item'));
    if (items.length === 0) return;
    var speed = cfg.speed || 40;
    var direction = cfg.direction || 'left';
    var gap = typeof cfg.gap === 'number' ? cfg.gap : 24;
    var paused = false;
    var isVertical = direction === 'up' || direction === 'down';

    track.style.display = 'flex';
    track.style.flexDirection = isVertical ? 'column' : 'row';
    track.style.flexWrap = 'nowrap';
    track.style.gap = gap + 'px';
    track.style.willChange = 'transform';

    items.forEach(function (item) {
      item.style.flexShrink = '0';
    });

    var originalHTML = track.innerHTML;

    requestAnimationFrame(function () {
      var singleSetSize = 0;
      for (var i = 0; i < items.length; i++) {
        singleSetSize += isVertical
          ? items[i].offsetHeight + gap
          : items[i].offsetWidth + gap;
      }
      if (singleSetSize <= 0) return;

      var containerEl = track.closest('.fb-loop-interactive') || track.parentElement;
      var visibleSize = isVertical ? containerEl.clientHeight : containerEl.clientWidth;
      var clonesNeeded = Math.max(1, Math.ceil((visibleSize * 2) / singleSetSize));
      for (var c = 0; c < clonesNeeded; c++) {
        track.insertAdjacentHTML('beforeend', originalHTML);
      }
      bindItemNavigation(track);

      var totalSize = singleSetSize;
      var offset = 0;
      var lastTime = performance.now();
      var reverse = direction === 'right' || direction === 'down';

      function tick(now) {
        if (!paused) {
          var dt = (now - lastTime) / 1000;
          offset += speed * dt;
          if (offset >= totalSize) offset -= totalSize;
          var val = reverse ? offset : -offset;
          track.style.transform = isVertical
            ? 'translateY(' + val + 'px)'
            : 'translateX(' + val + 'px)';
        }
        lastTime = now;
        requestAnimationFrame(tick);
      }

      requestAnimationFrame(tick);
    });

    if (cfg.pauseOnHover !== false) {
      container.addEventListener('mouseenter', function () { paused = true; });
      container.addEventListener('mouseleave', function () { paused = false; });
    }
  }

  /* ── Carousel ───────────────────────────────────────────────── */
  function initCarousel(track, container, cfg) {
    var items = Array.from(track.querySelectorAll(':scope > .fb-loop-runtime-item'));
    if (items.length === 0) return;
    var visible = Math.min(cfg.visibleItems || 3, items.length);
    var scrollN = cfg.scrollItems || 1;
    var duration = cfg.transitionDuration || 500;
    var loopEnabled = cfg.loop !== false;
    var autoplay = cfg.autoplay === true;
    var interval = cfg.interval || 4000;
    var paused = false;
    var timer = null;
    var current = 0;
    var gap = typeof cfg.gap === 'number' ? cfg.gap : 0;
    var carouselItems = items;
    var visualIndex = 0;
    var isAnimating = false;
    var hasLoopClones = loopEnabled && items.length > 1;

    track.style.display = 'flex';
    track.style.flexWrap = 'nowrap';
    track.style.gap = gap + 'px';

    if (hasLoopClones) {
      cloneLoopItems(items).reverse().forEach(function (clone) {
        track.insertBefore(clone, track.firstChild);
      });
      cloneLoopItems(items).forEach(function (clone) {
        track.appendChild(clone);
      });
      carouselItems = Array.from(track.querySelectorAll(':scope > .fb-loop-runtime-item'));
      bindItemNavigation(track);
      visualIndex = items.length;
    }

    function getContainerWidth() {
      return container.clientWidth || container.offsetWidth || 0;
    }

    function getItemWidth() {
      var w = getContainerWidth();
      if (w <= 0) return 0;
      return (w - gap * (visible - 1)) / visible;
    }

    function applyItemWidths() {
      var w = getItemWidth();
      if (w <= 0) return;
      carouselItems.forEach(function (item) {
        item.style.flex = '0 0 ' + w + 'px';
        item.style.minWidth = w + 'px';
        item.style.width = w + 'px';
        item.style.boxSizing = 'border-box';
        item.style.display = 'block';
        item.style.overflow = 'hidden';
      });
    }

    function getOffset(index) {
      var w = getItemWidth();
      return index * (w + gap);
    }

    function applyPosition(index, animated) {
      track.style.transition = animated ? ('transform ' + duration + 'ms ease') : 'none';
      track.style.transform = 'translateX(-' + getOffset(index) + 'px)';
    }

    function goTo(index, animated) {
      var maxIndex = Math.max(0, items.length - visible);
      if (!hasLoopClones) {
        index = Math.max(0, Math.min(index, maxIndex));
        current = index;
        applyPosition(current, animated !== false);
        updateDots(container, current);
        return;
      }

      if (isAnimating) return;

      if (index >= items.length) {
        isAnimating = true;
        current = index % items.length;
        visualIndex = items.length + index;
        updateDots(container, current);
        applyPosition(visualIndex, animated !== false);
        onTrackTransitionComplete(track, duration, function () {
          isAnimating = false;
          visualIndex = items.length + current;
          applyPosition(visualIndex, false);
        });
        return;
      }

      if (index < 0) {
        isAnimating = true;
        current = (index % items.length + items.length) % items.length;
        visualIndex = items.length + index;
        updateDots(container, current);
        applyPosition(visualIndex, animated !== false);
        onTrackTransitionComplete(track, duration, function () {
          isAnimating = false;
          visualIndex = items.length + current;
          applyPosition(visualIndex, false);
        });
        return;
      }

      current = index;
      visualIndex = items.length + current;
      updateDots(container, current);
      applyPosition(visualIndex, animated !== false);
    }

    function next() { goTo(current + scrollN); }
    function prev() { goTo(current - scrollN); }

    function startAutoplay() {
      stopAutoplay();
      if (autoplay && !paused) {
        timer = setInterval(next, interval);
      }
    }

    function stopAutoplay() {
      if (timer) { clearInterval(timer); timer = null; }
    }

    // Defer initial layout to ensure container has computed width
    requestAnimationFrame(function () {
      applyItemWidths();
      applyPosition(hasLoopClones ? visualIndex : current, false);

      window.addEventListener('resize', function () {
        applyItemWidths();
        applyPosition(hasLoopClones ? (items.length + current) : current, false);
      });

      bindArrows(container, prev, next);
      bindDots(container, goTo);

      // Drag / swipe
      bindDrag(track, {
        onStart: function () {
          if (isAnimating) return;
          stopAutoplay();
          track.style.transition = 'none';
        },
        onMove: function (dx) {
          if (isAnimating) return;
          var base = getOffset(hasLoopClones ? visualIndex : current);
          track.style.transform = 'translateX(' + (-base + dx) + 'px)';
        },
        onEnd: function (dx) {
          if (isAnimating) return;
          var w = getItemWidth();
          var threshold = w * 0.2;
          track.style.transition = 'transform ' + duration + 'ms ease';
          if (dx < -threshold) next();
          else if (dx > threshold) prev();
          else applyPosition(hasLoopClones ? visualIndex : current, true);
          startAutoplay();
        },
      });

      if (cfg.pauseOnHover !== false) {
        container.addEventListener('mouseenter', function () { paused = true; stopAutoplay(); });
        container.addEventListener('mouseleave', function () { paused = false; startAutoplay(); });
      }

      startAutoplay();
    });
  }

  /* ── Helpers ────────────────────────────────────────────────── */
  function bindArrows(container, prevFn, nextFn) {
    var prevBtn = container.querySelector('.fb-loop-arrow--prev');
    var nextBtn = container.querySelector('.fb-loop-arrow--next');
    if (prevBtn) prevBtn.addEventListener('click', function (e) { e.stopPropagation(); prevFn(); });
    if (nextBtn) nextBtn.addEventListener('click', function (e) { e.stopPropagation(); nextFn(); });
  }

  function bindDots(container, goToFn) {
    var dotsContainer = container.querySelector('.fb-loop-dots');
    if (!dotsContainer) return;
    dotsContainer.querySelectorAll('.fb-loop-dot').forEach(function (dot) {
      dot.addEventListener('click', function (e) {
        e.stopPropagation();
        var index = parseInt(dot.getAttribute('data-fb-dot-index'), 10);
        if (!isNaN(index)) goToFn(index);
      });
    });
  }

  function updateDots(container, activeIndex) {
    var dotsContainer = container.querySelector('.fb-loop-dots');
    if (!dotsContainer) return;
    dotsContainer.querySelectorAll('.fb-loop-dot').forEach(function (dot, i) {
      dot.classList.toggle('fb-loop-dot--active', i === activeIndex);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLoopTracks);
  } else {
    initLoopTracks();
  }
})();
