/* Client for the planner service. plan and repair spend money when called, so each
   is reached only from an explicit user action in the panel: typing a goal and
   pressing Plan, or pressing Ask copilot on a step that could not be located.
   Nothing calls those on load, on navigation, or on a timer. The rest (product key,
   feedback, learned screens, wayfinding, suggestions) is free. */
(function () {
  const CC = (window.CC = window.CC || {});

  const DEFAULT_BASE = 'http://localhost:4600';

  /* One install id per product in this browser, shared with the uploader (same storage
     key), so a person's feedback and their captured sessions on a product are
     recognisably the same person. Per product, because the server ties an install to
     one product and nothing should let it link one person's use of two. */
  function localInstallId(origin) {
    const key = `cc-install:${origin}`;
    try {
      const raw = localStorage.getItem(key);
      const inst = raw ? JSON.parse(raw) : null;
      if (inst && typeof inst.id === 'string') return inst.id;
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      const id = 'i_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(key, JSON.stringify({ id, created: Date.now() }));
      return id;
    } catch {
      return 'i_ephemeral_' + Math.random().toString(16).slice(2, 10);
    }
  }

  /* installId: where the id comes from. The extension's panel asks the background
     worker, which owns capture, so both use one id. Elsewhere it is the uploader's id
     when there is an uploader, and a local one when there is not. */
  function createService({ base = DEFAULT_BASE, tool, origin = null, installId = null }) {
    const getInstallId =
      installId ||
      (() => (CC.uploader && CC.uploader.installIdFor ? CC.uploader.installIdFor(origin) : Promise.resolve(localInstallId(origin))));
    let productPromise = null;
    async function post(path, body) {
      let response;
      try {
        response = await fetch(`${base}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tool, ...body }),
        });
      } catch {
        throw new Error(`Cannot reach the planner service at ${base}. Is it running?`);
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Service returned ${response.status}.`);
      return data;
    }

    /* The per-product hashing key, needed to check a screen against a learned route.
       Cached; a failure is not cached, so a later attempt can succeed. */
    function productKey() {
      if (!origin) return Promise.reject(new Error('no product origin configured'));
      productPromise ??= fetch(`${base}/api/product?origin=${encodeURIComponent(origin)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`product lookup failed (${r.status})`))))
        .then((d) => {
          if (!d.key) throw new Error('product lookup returned no key');
          return d.key;
        })
        .catch((err) => {
          productPromise = null;
          throw err;
        });
      return productPromise;
    }

    /* Fire and forget. Losing a feedback event costs a little evidence; letting it
       throw would cost the person their panel. */
    function feedback(route, kind, step) {
      if (!origin || !route) return;
      Promise.resolve()
        .then(() => getInstallId())
        .then((id) =>
          fetch(`${base}/api/feedback`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ origin, routeId: route.id, pathHash: route.pathHash, installId: id, kind, step }),
          })
        )
        .catch(() => {});
    }

    /* Free, and read only: the learned screens (hashed keys only) for "you are here",
       the way between two of them along links people use, and verified routes to
       suggest. None of these reaches a model. */
    let screensPromise = null;
    function wayScreens() {
      if (!origin) return Promise.reject(new Error('no product origin configured'));
      screensPromise ??= fetch(`${base}/api/wayfind?origin=${encodeURIComponent(origin)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`screens lookup failed (${r.status})`))))
        .then((d) => d.screens || [])
        .catch((err) => {
          screensPromise = null;
          throw err;
        });
      return screensPromise;
    }
    async function wayfind(from, to) {
      const response = await fetch(`${base}/api/wayfind`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ origin, from, to }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, reason: data.error || `no way found (${response.status})` };
      return data;
    }
    async function suggestions() {
      if (!origin) return [];
      try {
        const r = await fetch(`${base}/api/suggest?origin=${encodeURIComponent(origin)}`);
        return r.ok ? (await r.json()).suggestions || [] : [];
      } catch {
        return [];
      }
    }

    return {
      base,
      tool,
      origin,
      plan: (goal, observation) => post('/api/plan', { goal, observation, origin }),
      repair: (goal, intent, observation) => post('/api/repair', { goal, intent, observation }),
      productKey,
      feedback,
      wayScreens,
      wayfind,
      suggestions,
    };
  }

  CC.service = { createService };
})();
