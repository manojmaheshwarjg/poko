/* Page side of the protocol. Same handlers whether the transport is the dev
   harness (postMessage across an iframe) or the extension (chrome messaging). */
(function () {
  const CC = (window.CC = window.CC || {});

  function handle(msg, ctx) {
    switch (msg.type) {
      case 'ping':
        return { type: 'pong' };

      case 'observe':
        return { type: 'observation', observation: CC.observer.observe() };

      case 'locate': {
        const observation = CC.observer.observe();
        const result = CC.target.locate(observation, msg.target);
        return { type: 'located', ...result, screen: observation.screen };
      }

      case 'highlight': {
        const observation = CC.observer.observe();
        const result = CC.target.locate(observation, msg.target);
        if (!result.found) {
          CC.highlighter.clear();
          /* The screen signature matters more on failure than on success: a
             not-found or a repair is only interpretable later if you know where
             it happened. */
          return { type: 'highlighted', ok: false, ...result, screen: observation.screen };
        }
        /* If the element goes away (the person navigated, or the app re-rendered), the
           ring comes down and the panel is told, so it can look for the step again. */
        const push = typeof ctx?.push === 'function' ? ctx.push : null;
        CC.highlighter.show(CC.elementFor(result.node.id), msg.caption, observation.nodes, {
          onLost: push ? (why) => push('targetLost', { why }) : null,
        });
        return { type: 'highlighted', ok: true, ...result, screen: observation.screen };
      }

      case 'clearHighlight':
        CC.highlighter.clear();
        return { type: 'highlightCleared' };

      /* Act re-locates immediately before acting rather than trusting a node id
         from an earlier observation. The page may have moved under us. */
      case 'act': {
        const observation = CC.observer.observe();
        const result = CC.target.locate(observation, msg.target);
        if (!result.found) return { type: 'acted', ok: false, error: 'target not found at act time' };
        const el = CC.elementFor(result.node.id);
        /* Marks the copilot's own action so the recorder files it as evidence rather
           than as something a person did (G6). The click dispatch is synchronous, so
           the flag is live for exactly the events this act produces. */
        let outcome;
        CC._copilotActing = true;
        try {
          outcome = CC.executor.act(el, msg.action);
        } finally {
          CC._copilotActing = false;
        }
        CC.highlighter.clear();
        return { type: 'acted', ...outcome, node: result.node };
      }

      /* G8: is the live page the screen this step was learned on? Async, because
         the check hashes the live page's labels with the product key. */
      case 'screenCheck': {
        if (!CC.screencheck || !CC.redact) return { type: 'screenChecked', ok: false, reason: 'screen check not loaded' };
        if (!msg.key) return { type: 'screenChecked', ok: false, reason: 'no product key to check with' };
        const saved = CC._elements;
        const observation = CC.observer.observe();
        CC._elements = saved;
        return CC.screencheck
          .check(observation, msg.expect && msg.expect.keys, msg.key, CC.redact.hashLabel)
          .then((r) => ({ type: 'screenChecked', ...r, heading: observation.screen && observation.screen.heading }));
      }

      /* Which learned screen is this page? The panel sends the product's screens with
         their hashed keys; the live page is hashed with the same key and the best match
         wins, if it matches well enough. Used for "you are here" and for the start of
         "Take me there". Reads only. */
      case 'whereAmI': {
        if (!CC.screencheck || !CC.redact) return { type: 'where', screenId: null, reason: 'screen check not loaded' };
        if (!msg.key) return { type: 'where', screenId: null, reason: 'no product key to check with' };
        const saved = CC._elements;
        const observation = CC.observer.observe();
        CC._elements = saved;
        return CC.screencheck.liveKeys(observation, msg.key, CC.redact.hashLabel).then((live) => {
          let best = null;
          for (const s of msg.screens || []) {
            const r = CC.screencheck.overlap(s.keys, live);
            if (r.matched && (!best || r.ratio > best.ratio)) best = { screenId: s.id, name: s.name, ratio: r.ratio };
          }
          return best && best.ratio >= CC.screencheck.MIN_RATIO ? { type: 'where', ...best } : { type: 'where', screenId: null, reason: 'this page matches no learned screen well enough' };
        });
      }

      case 'recorder': {
        if (!CC.recorder) return { type: 'recorder', ok: false, error: 'recorder not loaded' };
        if (msg.enabled) {
          const sink = typeof ctx?.emit === 'function' ? ctx.emit : null;
          if (!sink) return { type: 'recorder', ok: false, error: 'no channel to send transitions on' };
          CC.recorder.start(sink);
        } else {
          CC.recorder.stop();
        }
        return { type: 'recorder', ok: true, enabled: CC.recorder.isEnabled() };
      }

      /* Phase G. Starts a read-only exploration from this page and returns at once;
         pages and progress are pushed as 'explore' events. One run at a time. */
      case 'explore': {
        if (!CC.explorer) return { type: 'explore', ok: false, error: 'explorer not loaded' };
        const push = typeof ctx?.push === 'function' ? ctx.push : null;
        if (!push) return { type: 'explore', ok: false, error: 'no channel to send pages on' };
        return CC.explorer.start(msg.options, (event) => push('explore', event));
      }

      case 'exploreStop':
        return CC.explorer ? CC.explorer.stop() : { type: 'explore', ok: false, error: 'explorer not loaded' };

      default:
        return { type: 'error', error: `unknown message: ${msg.type}` };
    }
  }

  CC.pageAgent = { handle };

  /* Harness transport: the panel lives in the parent frame. */
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.channel !== 'copilot' || msg.direction !== 'toPage') return;
    /* Transitions are pushed, not requested, so the recorder needs a channel back to
       the panel that outlives this one message. */
    const source = event.source;
    const push = (name, payload) =>
      source.postMessage({ channel: 'copilot', direction: 'toPanel', event: name, payload }, '*');
    const emit = (transition) => push('transition', transition);
    const respond = (reply) =>
      event.source.postMessage({ channel: 'copilot', direction: 'toPanel', id: msg.id, payload: reply }, '*');
    const failure = (err) => ({ type: 'error', error: String(err && err.message ? err.message : err) });
    /* Some handlers are async (the screen check hashes), so every reply goes through
       a promise: sync and async results travel the same way. */
    try {
      Promise.resolve(handle(msg.payload, { emit, push })).then(respond, (err) => respond(failure(err)));
    } catch (err) {
      respond(failure(err));
    }
  });
})();
