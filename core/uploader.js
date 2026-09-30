/* Uploader: redacts transitions and delivers them to the service.
 *
 * Runs where the network is (the panel in the dev harness, the background worker in
 * the extension), never in the page being watched.
 *
 *   Redact first, always. A transition is redacted the moment it arrives and only
 *   the redacted form is ever queued or written to storage. If redaction is not
 *   possible (no product key yet, service unreachable), the transition is DROPPED,
 *   never queued raw. Losing a data point is acceptable; leaking one is not.
 *
 *   At-least-once delivery. The queue survives reloads and failed requests retry
 *   with backoff. The server's unique key on (install, episode, seq) makes a retry
 *   harmless, so at-least-once here becomes exactly-once in storage.
 *
 *   Bounded and silent (G10). The queue is capped, a full queue drops its oldest
 *   entries, and no failure here ever reaches the page or the person using it.
 *
 * Storage is asynchronous so the same code runs in a page (localStorage) and in the
 * extension's background worker (chrome.storage.local), which has no localStorage.
 */
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const CC = (G.CC = G.CC || {});

  /* Both are kept per product origin. The server ties an install to one product, so a
     browser used on two products is two installs, and nothing lets the server link one
     person's use of two products. A queue per product means a transition captured on
     one can never be flushed under another's id. */
  const QUEUE_KEY = 'cc-upload-queue';
  const INSTALL_KEY = 'cc-install';
  const MAX_QUEUE = 100;
  const BATCH = 20;
  const FLUSH_MS = 3000;
  const MAX_BACKOFF_MS = 60000;

  /* The default store, for pages. Every operation swallows its own failure. */
  const localStore = {
    async get(key, fallback) {
      try {
        const raw = G.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    async set(key, value) {
      try {
        G.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
  };

  /* One id per product per store, created on first use. Remembered per store so two
     callers asking at once cannot mint two ids. */
  const minted = new Map();
  function installIdFor(origin, store = localStore) {
    const key = `${INSTALL_KEY}:${origin}`;
    const memo = `${store === localStore ? 'local' : 'custom'}|${key}`;
    if (!minted.has(memo)) {
      minted.set(
        memo,
        (async () => {
          let inst = await store.get(key, null);
          if (!inst || typeof inst.id !== 'string') {
            const bytes = crypto.getRandomValues(new Uint8Array(12));
            inst = { id: 'i_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''), created: Date.now() };
            await store.set(key, inst);
          }
          return inst.id;
        })()
      );
    }
    return minted.get(memo);
  }

  /* devTruth: dev fixture only. Reads the fixture's data-screen marker before
     redaction removes it and sends it alongside, so clustering can be scored
     against ground truth. The server independently refuses it for any product that
     is not on localhost.
     enrollment: a vendor enrollment code (Phase M), sent only until the install has
     registered, since it is spent by that first registration anyway. */
  function createUploader({ base, origin, mode, attested, enrollment, onStatus, devTruth = false, store = localStore }) {
    const QUEUE = `${QUEUE_KEY}:${origin}`;
    const installId = () => installIdFor(origin, store);
    const status = {
      enabled: false, mode, attested: !!attested,
      captured: 0, queued: 0, sent: 0, duplicate: 0, dropped: 0, lastError: null,
    };
    let product = null;
    let timer = null;
    let flushing = false;
    let backoff = FLUSH_MS;
    let registered = false;

    /* Every read-modify-write of the queue goes through this chain, so an add and a
       flush can never interleave and lose an item. */
    let lock = Promise.resolve();
    function serial(fn) {
      const run = lock.then(fn, fn);
      lock = run.catch(() => {});
      return run;
    }
    const readQueue = () => store.get(QUEUE, []);

    const publish = () => {
      try {
        onStatus && onStatus({ ...status });
      } catch {}
    };

    async function claim() {
      const id = await installId();
      return { id, mode, attested: !!attested, ...(enrollment && !registered ? { enrollment } : {}) };
    }

    async function loadProduct() {
      const res = await fetch(`${base}/api/product?origin=${encodeURIComponent(origin)}`);
      if (!res.ok) throw new Error(`product lookup failed (${res.status})`);
      const data = await res.json();
      if (!data.key || !data.productId) throw new Error('product lookup returned no key');
      product = { id: data.productId, key: data.key, promoted: new Set(data.promoted || []) };
    }

    function schedule(ms = FLUSH_MS) {
      clearTimeout(timer);
      timer = setTimeout(flush, ms);
    }

    async function add(raw) {
      if (!status.enabled) return;
      status.captured++;
      try {
        if (!product) await loadProduct();
      } catch (err) {
        status.dropped++;
        status.lastError = `dropped, not stored raw: ${err.message}`;
        publish();
        return;
      }
      let redacted;
      try {
        redacted = await CC.redact.redactTransition(raw, {
          key: product.key, mode, attested: !!attested, promoted: product.promoted,
        });
      } catch (err) {
        status.dropped++;
        status.lastError = `redaction failed, dropped: ${err.message}`;
        publish();
        return;
      }
      const truth = devTruth
        ? { before: raw.before?.screen?.screen ?? null, after: raw.after?.screen?.screen ?? null }
        : null;
      /* From here on only the redacted form exists outside this function. */
      await serial(async () => {
        const queue = await readQueue();
        queue.push({ qid: `${raw.episode}:${raw.seq}`, t: redacted, truth });
        while (queue.length > MAX_QUEUE) {
          queue.shift();
          status.dropped++;
        }
        if (!(await store.set(QUEUE, queue))) {
          status.dropped++;
          status.lastError = 'storage full, dropped';
        }
        status.queued = queue.length;
      });
      publish();
      schedule();
    }

    async function flush() {
      if (flushing || !status.enabled) return;
      const queue = await readQueue();
      if (!queue.length) return;
      flushing = true;
      const batch = queue.slice(0, BATCH);
      try {
        if (!product) await loadProduct();
        const res = await fetch(`${base}/api/ingest`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            productId: product.id,
            install: await claim(),
            transitions: batch.map((item) => (item.truth ? { ...item.t, truth: item.truth } : item.t)),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `ingest failed (${res.status})`);
        registered = true;

        /* Remove exactly what was sent, by id. The queue may have grown, or been
           trimmed from the front, while the request was in flight. */
        const sent = new Set(batch.map((item) => item.qid));
        await serial(async () => {
          const left = (await readQueue()).filter((item) => !sent.has(item.qid));
          await store.set(QUEUE, left);
        });

        status.sent += data.accepted || 0;
        status.duplicate += data.duplicate || 0;
        status.dropped += (data.rejected || []).length;
        if (Array.isArray(data.promoted)) product.promoted = new Set(data.promoted);
        status.lastError = (data.rejected || []).length ? `server rejected ${data.rejected.length}` : null;
        backoff = FLUSH_MS;
      } catch (err) {
        status.lastError = err.message;
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      } finally {
        flushing = false;
        status.queued = (await readQueue()).length;
        publish();
        if (status.queued) schedule(status.lastError ? backoff : 0);
      }
    }

    function enable() {
      status.enabled = true;
      publish();
      /* Whatever an earlier page or worker left queued goes first. */
      readQueue().then((q) => {
        status.queued = q.length;
        publish();
        if (status.enabled && q.length) schedule(0);
      });
    }
    function disable() {
      status.enabled = false;
      clearTimeout(timer);
      publish();
    }

    /* Exploration (Phase G). Pages are redacted here exactly like transitions, then
       sent at once rather than queued: a run is attended, so a failure is shown to the
       person and stops the run instead of waiting in a queue. Sends are chained so the
       server sees a run's pages before its summary. */
    let exploreChain = Promise.resolve();
    function explore(event) {
      const job = exploreChain.then(() => sendExplore(event));
      exploreChain = job.catch(() => {});
      return job;
    }

    /* A skipped link leaves as its normalised pattern, or only its origin if it points
       at another site, and never at all if it is not a web link. */
    function cleanSkip(s, startUrl) {
      let url = null;
      try {
        const u = new URL(s.href, startUrl);
        if (u.protocol === 'http:' || u.protocol === 'https:') {
          url = u.origin === new URL(startUrl).origin ? CC.redact.normalizeUrl(u.toString()) : u.origin;
        }
      } catch {}
      return { url, reason: s.reason, word: s.word || null };
    }

    async function sendExplore(event) {
      if (!event || (event.kind !== 'page' && event.kind !== 'done')) return null;
      if (mode !== 'vendor' || !attested) throw new Error('exploration is only for a vendor install on a demo tenant');
      if (!product) await loadProduct();
      const opts = { key: product.key, mode, attested: !!attested, promoted: product.promoted };
      const r = event.run;
      const run = { id: r.id, startUrl: CC.redact.normalizeUrl(r.startUrl), startedAt: r.startedAt };
      const pages = [];
      if (event.kind === 'page') {
        const p = event.page;
        const page = {
          url: CC.redact.normalizeUrl(p.url),
          from: p.from ? CC.redact.normalizeUrl(p.from) : null,
          via: p.via && p.via.text
            ? await CC.redact.labelFor(p.via.text, { ...opts, role: 'link', region: p.via.region || undefined })
            : null,
          viaRegion: (p.via && p.via.region) || null,
          at: p.at,
          observation: await CC.redact.redactObservation(p.observation, opts),
        };
        /* Read before redaction removed it, as for transitions. The server refuses it
           for anything that is not a local product. */
        if (devTruth) page.truth = (p.observation && p.observation.screen && p.observation.screen.screen) || null;
        pages.push(page);
      } else {
        run.finishedAt = r.finishedAt;
        run.stopped = r.stopped;
        run.skipped = (r.skipped || []).map((s) => cleanSkip(s, r.startUrl));
        run.failures = (r.failures || []).map((f) => ({
          url: f.href ? CC.redact.normalizeUrl(f.href) : null,
          reason: f.reason,
          ...(typeof f.status === 'number' ? { status: f.status } : {}),
        }));
      }
      const res = await fetch(`${base}/api/explore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId: product.id, install: await claim(), run, pages }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || `exploration upload failed (${res.status})`);
        err.status = res.status;
        throw err;
      }
      registered = true;
      return data;
    }

    /* Phase L: a copilot decision, redacted here like everything else, then sent at
       once. Best effort: decisions are extra evidence, the journal keeps every one
       locally, and a failure here must never reach the person using the product. */
    async function decision(entry) {
      if (!status.enabled) return;
      try {
        if (!product) await loadProduct();
        const d = await CC.redact.redactDecision(entry, { key: product.key, mode, attested: !!attested, promoted: product.promoted });
        if (!d) return;
        const res = await fetch(`${base}/api/decisions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ productId: product.id, install: await claim(), decisions: [d] }),
        });
        if (!res.ok) throw new Error(`decision not stored (${res.status})`);
        registered = true;
        status.decisions = (status.decisions || 0) + 1;
      } catch (err) {
        status.lastError = `decision not sent: ${err.message}`;
      }
      publish();
    }

    return { add, flush, enable, disable, explore, decision, status: () => ({ ...status }), installId };
  }

  CC.uploader = { createUploader, installIdFor, localStore };
})();
