/* The cursor itself: a spotlight ring on the element the copilot is proposing,
   plus a caption. Nothing is clicked by drawing this.

   The caption is placed so it does not cover anything else on screen. That is
   not cosmetic: the copilot's reasoning routinely refers to a nearby option it
   is telling you NOT to pick, and a caption parked on top of that option hides
   the evidence for its own argument. */
(function () {
  const CC = (window.CC = window.CC || {});
  const ID = 'cc-highlight-layer';
  const GAP = 8;
  const EDGE = 8;

  const INTERACTIVE = new Set([
    'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
    'menuitem', 'menuitemcheckbox', 'tab', 'switch', 'option',
  ]);

  function layer() {
    let el = document.getElementById(ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = ID;
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '2147483646',
    });
    el.innerHTML = `
      <div data-cc-ring style="
        position:absolute; border-radius:8px; opacity:0;
        box-shadow:0 0 0 2px #6366f1, 0 0 0 6px rgba(99,102,241,.22), 0 8px 24px rgba(15,23,42,.18);
        transition:all .18s cubic-bezier(.4,0,.2,1);
      "></div>
      <div data-cc-caption style="
        position:absolute; opacity:0; max-width:280px; width:max-content;
        padding:7px 10px; border-radius:8px;
        background:#fff; color:#111827; border:1px solid #c7d2fe;
        font:500 12px/1.4 -apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;
        box-shadow:0 8px 24px rgba(17,24,39,.14), 0 2px 6px rgba(17,24,39,.06);
        transition:opacity .18s ease;
      "></div>`;
    document.documentElement.appendChild(el);
    return el;
  }

  function overlapArea(a, b) {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  }

  /* Pure. Exported so it can be tested without a browser.
     obstacles: [{ rect:{left,top,right,bottom}, weight }] */
  function choosePlacement(target, cap, obstacles, viewport) {
    const candidates = [
      ['below-left', target.left, target.bottom + GAP],
      ['below-right', target.right - cap.w, target.bottom + GAP],
      ['above-left', target.left, target.top - cap.h - GAP],
      ['above-right', target.right - cap.w, target.top - cap.h - GAP],
      ['right', target.right + GAP, target.top],
      ['left', target.left - cap.w - GAP, target.top],
    ];

    let best = null;
    candidates.forEach(([name, left, top], i) => {
      const x = Math.max(EDGE, Math.min(left, viewport.w - cap.w - EDGE));
      const y = Math.max(EDGE, Math.min(top, viewport.h - cap.h - EDGE));
      const pushed = Math.abs(x - left) + Math.abs(y - top);
      const rect = { left: x, top: y, right: x + cap.w, bottom: y + cap.h };

      let covered = 0;
      for (const o of obstacles) covered += overlapArea(rect, o.rect) * o.weight;

      /* Covering something is the expensive failure. Being nudged back inside
         the viewport is cheap. The index term only breaks exact ties, so the
         preference order (below, above, beside) holds when nothing is covered. */
      const penalty = covered + pushed * 20 + i * 0.5;
      if (!best || penalty < best.penalty) best = { name, rect, penalty, covered, pushed };
    });
    return best;
  }

  function isFullyInView(r) {
    return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
  }

  /* The spotlight follows its element. A ring drawn once stays at those coordinates
     while the page moves under it: after a person navigates on their own it ends up
     circling whatever is there now, which invites a wrong click. So the element is
     tracked through scrolling, resizing and re-rendering, and when it is gone (removed,
     or hidden) the ring is taken down and `onLost` tells the runner to look again. */
  let tracked = null;

  function stopTracking() {
    if (!tracked) return;
    window.removeEventListener('scroll', tracked.schedule, true);
    window.removeEventListener('resize', tracked.schedule);
    tracked.observer.disconnect();
    if (tracked.frame) cancelAnimationFrame(tracked.frame);
    tracked = null;
  }

  function follow() {
    if (!tracked) return;
    tracked.frame = null;
    const { el } = tracked;
    const visible = el.isConnected && (!CC.observer || CC.observer.isVisible(el));
    if (!visible) {
      const onLost = tracked.onLost;
      stopTracking();
      hide();
      if (onLost) {
        try {
          onLost(el.isConnected ? 'hidden' : 'removed');
        } catch {}
      }
      return;
    }
    const r = el.getBoundingClientRect();
    const last = tracked.rect;
    if (last && r.left === last.left && r.top === last.top && r.width === last.width && r.height === last.height) return;
    tracked.rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    draw(el, tracked.caption, tracked.nodes);
  }

  function track(el, caption, nodes, onLost) {
    stopTracking();
    const schedule = () => {
      if (tracked && !tracked.frame) tracked.frame = requestAnimationFrame(follow);
    };
    const own = document.getElementById(ID);
    /* Changes to the ring itself are not changes to the page. */
    const observer = new MutationObserver((records) => {
      if (records.every((rec) => own && own.contains(rec.target))) return;
      schedule();
    });
    const r = el.getBoundingClientRect();
    tracked = { el, caption, nodes, onLost, schedule, observer, frame: null, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }

  /* nodes: the observation's nodes, index-aligned with CC._elements. Rects are
     re-measured live rather than read off the observation, because scrolling the
     target into view invalidates every rect captured before the scroll. */
  function show(el, caption, nodes, opts = {}) {
    if (!el) return false;
    if (!isFullyInView(el.getBoundingClientRect())) {
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
    const drawn = draw(el, caption, nodes);
    track(el, caption, nodes, opts.onLost || null);
    return drawn;
  }

  function draw(el, caption, nodes) {
    const root = layer();
    const ring = root.querySelector('[data-cc-ring]');
    const cap = root.querySelector('[data-cc-caption]');
    const r = el.getBoundingClientRect();

    Object.assign(ring.style, {
      left: `${r.left - 3}px`,
      top: `${r.top - 3}px`,
      width: `${r.width + 6}px`,
      height: `${r.height + 6}px`,
      opacity: '1',
    });

    if (!caption) {
      cap.style.opacity = '0';
      return true;
    }

    /* Measure the caption offscreen before deciding where it goes. A first line
       ("Step 4 of 4") is set apart from what the step does. */
    const [kicker, ...rest] = String(caption).split('\n');
    if (rest.length) {
      cap.innerHTML = '';
      const k = document.createElement('div');
      k.textContent = kicker;
      Object.assign(k.style, { color: '#4f46e5', fontSize: '11px', fontWeight: '600', marginBottom: '2px' });
      const t = document.createElement('div');
      t.textContent = rest.join(' ');
      cap.append(k, t);
    } else {
      cap.textContent = caption;
    }
    cap.style.opacity = '0';
    cap.style.left = '-9999px';
    cap.style.top = '0px';
    const capBox = cap.getBoundingClientRect();

    const obstacles = [];
    const elements = CC._elements || [];
    (nodes || []).forEach((node, i) => {
      const other = elements[i];
      if (!other || other === el) return;
      const box = other.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return;
      obstacles.push({
        rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
        weight: INTERACTIVE.has(node.role) ? 1 : 0.25,
      });
    });
    /* Never cover the element being pointed at. */
    obstacles.push({ rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, weight: 4 });

    const placement = choosePlacement(
      { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      { w: capBox.width, h: capBox.height },
      obstacles,
      { w: window.innerWidth, h: window.innerHeight }
    );

    Object.assign(cap.style, {
      left: `${placement.rect.left}px`,
      top: `${placement.rect.top}px`,
      opacity: '1',
    });
    return true;
  }

  function hide() {
    const root = document.getElementById(ID);
    if (!root) return;
    root.querySelector('[data-cc-ring]').style.opacity = '0';
    root.querySelector('[data-cc-caption]').style.opacity = '0';
  }

  function clear() {
    stopTracking();
    hide();
  }

  CC.highlighter = { show, clear, choosePlacement, overlapArea };
})();
