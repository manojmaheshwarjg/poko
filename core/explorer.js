/* Read-only exploration (Phase G).
 *
 * Maps a product's screens before anyone has used it with the copilot. Starting from
 * the page the vendor is on, it opens same-origin links in a hidden frame, observes
 * each page, and reports what it saw. It never clicks, types, submits or opens a
 * menu. It only loads links a person could open, after they pass the rules in
 * core/explore-rules.js, and only one page per URL pattern.
 *
 * The frame is sandboxed without forms, popups, modals, downloads or top navigation,
 * so a page that tries on load to submit itself, open a window, block on a dialog,
 * start a download or break out of the frame cannot. Scripts do run: single page apps
 * render nothing without them.
 *
 * Opening a page can still have the effects that viewing it has (a notification
 * marked read, a "last viewed" time). That is why exploration is vendor mode only, on
 * a demo tenant, and started by a person who can stop it.
 *
 * Pages leave here raw, exactly as the recorder's transitions do, and are redacted
 * by the uploader before they are queued or sent (G3).
 */
(function () {
  const CC = (window.CC = window.CC || {});

  const DEFAULTS = {
    maxPages: 25,
    delayMs: 1500,
    pageTimeoutMs: 15000,
    quietMs: 500,
    settleCapMs: 5000,
    maxSkipped: 300,
    scope: null,
  };

  let current = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function newId() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return 'x_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /* Every link on a page, with what the rules need to judge it. */
  function linksOf(doc) {
    const out = [];
    for (const a of doc.querySelectorAll('a[href], area[href]')) {
      const name = CC.observer.accessibleName(a);
      out.push({
        href: a.href,
        name,
        /* The rules read the title too: a bare icon link is often only named there. */
        text: [name, a.getAttribute('title') || ''].join(' ').trim(),
        download: a.hasAttribute('download'),
        method: a.getAttribute('data-method') || a.getAttribute('data-turbo-method') || null,
        confirm: a.hasAttribute('data-confirm') || a.hasAttribute('data-turbo-confirm'),
        region: CC.observer.regionOf(a),
      });
    }
    return out;
  }

  function makeFrame() {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.setAttribute('data-copilot-explorer', '');
    frame.title = 'Copilot exploration';
    frame.inert = true;
    /* A real size, so layout and visibility are real, but off screen and unclickable. */
    frame.style.cssText =
      'position:fixed;left:-10000px;top:0;width:1280px;height:800px;border:0;opacity:0;pointer-events:none;';
    (document.body || document.documentElement).appendChild(frame);
    return frame;
  }

  /* Waits until the page stops changing, or a cap, whichever comes first. */
  function settle(doc, o) {
    return new Promise((resolve) => {
      const started = Date.now();
      let last = started;
      let mo = null;
      try {
        mo = new MutationObserver(() => {
          last = Date.now();
        });
        mo.observe(doc.documentElement || doc, { subtree: true, childList: true, attributes: true, characterData: true });
      } catch {}
      const tick = () => {
        const now = Date.now();
        if (now - last >= o.quietMs || now - started >= o.settleCapMs) {
          if (mo) mo.disconnect();
          resolve();
        } else {
          setTimeout(tick, 100);
        }
      };
      setTimeout(tick, 100);
    });
  }

  function load(frame, url, o) {
    return new Promise((resolve) => {
      let finished = false;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        frame.removeEventListener('load', onLoad);
        resolve(result);
      };
      const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), o.pageTimeoutMs);
      function onLoad() {
        let doc = null;
        try {
          doc = frame.contentDocument;
        } catch {}
        /* Unreadable means the frame ended up on another origin: a redirect to a sign-in
           provider, or a product that refuses to be framed. Either way, stop. */
        if (!doc || !doc.documentElement) return finish({ ok: false, reason: 'left', stop: true });
        let status;
        try {
          const nav = frame.contentWindow.performance.getEntriesByType('navigation')[0];
          status = nav && nav.responseStatus;
        } catch {}
        if (status >= 400) return finish({ ok: false, reason: 'http', status });
        settle(doc, o).then(() => finish({ ok: true, doc }));
      }
      frame.addEventListener('load', onLoad);
      frame.src = url;
    });
  }

  /* A visible password field means a sign-in page: the session has probably ended,
     and every page after this would be the same sign-in page. */
  function looksSignedOut(doc) {
    for (const input of doc.querySelectorAll('input[type="password"]')) {
      if (CC.observer.isVisible(input)) return true;
    }
    return false;
  }

  /* A page that focuses a field on load must not take the keyboard from the person
     working in the product. */
  function guardFocus(frame, before) {
    if (document.activeElement !== frame) return;
    try {
      frame.blur();
      if (before && before !== frame && before.isConnected && typeof before.focus === 'function') {
        before.focus({ preventScroll: true });
      }
    } catch {}
  }

  async function run(state, o, emit) {
    const R = CC.exploreRules;
    const send = (event) => {
      try {
        emit(event);
      } catch {}
    };
    const startUrl = location.href;
    const startedAt = Date.now();
    const base = { id: state.id, startUrl, startedAt };
    const visited = new Set([R.patternOf(startUrl)]);
    const skipped = [];
    const failures = [];
    const queue = [];
    /* A nav link repeated on every page is one link, not one per page: the report
       counts distinct kinds of link, each with the first reason it was skipped for. */
    const noted = new Set();
    const note = (items) => {
      for (const s of items) {
        const key = `${s.reason}|${R.patternOf(String(s.href))}`;
        if (noted.has(key)) continue;
        noted.add(key);
        if (skipped.length < o.maxSkipped) skipped.push(s);
      }
    };
    const pick = (doc, pageUrl) => {
      const room = Math.max(0, o.maxPages - state.pages - queue.length);
      const { allowed, skipped: s } = R.selectLinks(linksOf(doc), pageUrl, visited, room, { scope: o.scope });
      for (const a of allowed) queue.push({ url: a.url, from: pageUrl, via: { text: a.name || '', region: a.region || null } });
      note(s);
      send({ kind: 'progress', run: base, pages: state.pages, queued: queue.length, skipped: skipped.length });
    };

    let stopped = null;
    let frame = null;
    try {
      /* The page the person is on is page one. Observing it must not replace the
         live element list the runner acts through, so that is kept aside. */
      const saved = CC._elements;
      const first = CC.observer.observe(document);
      CC._elements = saved;
      state.pages = 1;
      send({ kind: 'page', run: base, page: { url: startUrl, from: null, via: null, observation: first, at: Date.now() } });
      pick(document, startUrl);

      frame = makeFrame();
      while (queue.length) {
        if (state.stopRequested) {
          stopped = 'stopped';
          break;
        }
        if (state.pages >= o.maxPages) {
          stopped = 'limit';
          break;
        }
        await sleep(o.delayMs);
        if (state.stopRequested) {
          stopped = 'stopped';
          break;
        }
        const next = queue.shift();
        send({ kind: 'loading', run: base, url: next.url });
        const focusBefore = document.activeElement;
        const res = await load(frame, next.url, o);
        guardFocus(frame, focusBefore);
        if (!res.ok) {
          failures.push({ href: next.url, reason: res.reason, status: res.status });
          if (res.stop) {
            stopped = 'left';
            break;
          }
          continue;
        }
        const doc = res.doc;
        if (looksSignedOut(doc)) {
          stopped = 'signed-out';
          break;
        }
        /* A redirect can land on a page already mapped under another URL. */
        const finalUrl = doc.URL;
        const finalPattern = R.patternOf(finalUrl);
        if (finalPattern !== R.patternOf(next.url)) {
          if (visited.has(finalPattern)) {
            note([{ href: next.url, reason: 'seen' }]);
            continue;
          }
          visited.add(finalPattern);
        }
        const observation = CC.observer.observe(doc);
        state.pages++;
        send({ kind: 'page', run: base, page: { url: finalUrl, from: next.from, via: next.via, observation, at: Date.now() } });
        pick(doc, finalUrl);
      }
      if (!stopped) stopped = 'done';
      for (const q of queue) note([{ href: q.url, reason: stopped === 'limit' ? 'limit' : 'unvisited' }]);
    } catch (err) {
      stopped = 'error';
      failures.push({ href: null, reason: 'error', message: String((err && err.message) || err) });
    } finally {
      if (frame) frame.remove();
      current = null;
    }
    send({
      kind: 'done',
      run: { ...base, finishedAt: Date.now(), stopped, pages: state.pages, skipped, failures },
    });
  }

  /* Starts a run and returns at once; pages and progress arrive through `emit`. */
  function start(options, emit) {
    const o = { ...DEFAULTS, ...(options || {}) };
    if (current) return { type: 'explore', ok: false, error: 'an exploration is already running' };
    /* The panel decides who may explore and the server refuses anyone else. This only
       stops a caller that forgot to ask. */
    if (o.mode !== 'vendor' || o.attested !== true) {
      return { type: 'explore', ok: false, error: 'exploration runs only for a vendor install on a demo tenant' };
    }
    if (!CC.exploreRules || !CC.redact || !CC.observer) return { type: 'explore', ok: false, error: 'explorer not loaded' };
    if (typeof emit !== 'function') return { type: 'explore', ok: false, error: 'no channel to send pages on' };
    o.maxPages = Math.max(1, Math.min(200, Math.floor(Number(o.maxPages) || DEFAULTS.maxPages)));
    o.delayMs = Math.max(250, Number(o.delayMs) || DEFAULTS.delayMs);
    const state = { id: newId(), stopRequested: false, pages: 0 };
    current = state;
    run(state, o, emit);
    return { type: 'explore', ok: true, id: state.id };
  }

  function stop() {
    if (!current) return { type: 'explore', ok: false, error: 'nothing is being explored' };
    current.stopRequested = true;
    return { type: 'explore', ok: true, stopping: current.id };
  }

  CC.explorer = { start, stop, running: () => !!current };
})();
