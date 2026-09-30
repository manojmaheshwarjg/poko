/* Recorder: passive capture of what happens on the page.
 *
 * Every action becomes one transition: the screen before it, the action, and the
 * screen once the page has settled afterwards. That triple is the raw material for
 * everything the learning pipeline does. It never records what anyone typed.
 *
 * Three rules, each tied to a guarantee in DESIGN.md.
 *
 *   G6  Only humans teach. A trusted event is a person. The copilot's own clicks
 *       are marked `copilot` so they can serve as evidence but are never mined.
 *       Synthetic events a page dispatches to itself are ignored entirely.
 *   G10 Capture never affects the user. Every handler runs in the capture phase,
 *       never calls preventDefault, and swallows its own errors.
 *   --  Global state is left alone. observe() writes CC._elements, which the page
 *       agent relies on between locate and act, so snapshots restore it.
 */
(function () {
  const CC = (window.CC = window.CC || {});

  const SETTLE_QUIET_MS = 250;
  const SETTLE_MAX_MS = 3000;
  const IDLE_EPISODE_MS = 10 * 60 * 1000;
  const PENDING_KEY = 'cc-recorder-pending';

  const INTERACTIVE = new Set([
    'button', 'link', 'checkbox', 'radio', 'switch', 'menuitem', 'menuitemcheckbox',
    'tab', 'option', 'combobox', 'textbox',
  ]);
  const TOGGLES = new Set(['checkbox', 'radio', 'switch', 'menuitemcheckbox']);

  let enabled = false;
  let sink = null;
  let episode = null;
  let seq = 0;
  let lastActivity = 0;
  let chain = Promise.resolve();

  function newEpisode() {
    episode = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    seq = 0;
  }

  /* An observation plus the elements it was taken from, without disturbing the
     global element list anything else might be holding. */
  function snapshot() {
    const saved = CC._elements;
    try {
      const obs = CC.observer.observe();
      return { obs, elements: CC._elements };
    } catch {
      return null;
    } finally {
      CC._elements = saved;
    }
  }

  /* The control a person actually meant, not the icon span inside it. */
  function describe(start) {
    let el = start;
    for (let depth = 0; el && el !== document.documentElement && depth < 8; depth++, el = el.parentElement) {
      const role = CC.observer.roleOf(el);
      if (role && INTERACTIVE.has(role)) {
        return {
          el,
          role,
          name: CC.observer.accessibleName(el),
          within: CC.observer.sectionOf(el),
          region: CC.observer.regionOf(el),
        };
      }
    }
    return null;
  }

  function isToggle(target) {
    const el = target.el;
    return TOGGLES.has(target.role) || el.type === 'checkbox' || el.type === 'radio';
  }

  function checkedState(el) {
    if (typeof el.checked === 'boolean') return el.checked;
    const aria = el.getAttribute('aria-checked');
    return aria === null ? null : aria === 'true';
  }

  /* Waits for the page to stop changing. Mutations to the copilot's own overlay do
     not count, otherwise the highlight ring would hold every settle open. */
  function settle() {
    return new Promise((resolve) => {
      let quiet;
      const done = () => {
        observer.disconnect();
        clearTimeout(quiet);
        clearTimeout(ceiling);
        resolve();
      };
      const observer = new MutationObserver((records) => {
        const own = records.every((r) => {
          const n = r.target.nodeType === 1 ? r.target : r.target.parentElement;
          return n && n.closest && n.closest('#cc-highlight-layer');
        });
        if (own) return;
        clearTimeout(quiet);
        quiet = setTimeout(done, SETTLE_QUIET_MS);
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      quiet = setTimeout(done, SETTLE_QUIET_MS);
      const ceiling = setTimeout(done, SETTLE_MAX_MS);
    });
  }

  function emit(transition) {
    try {
      if (sink) sink(transition);
    } catch {
      /* a broken sink loses one transition, never the user's click */
    }
  }

  function capture(event, kind) {
    if (!enabled) return;
    const copilot = !!CC._copilotActing;
    /* G6 at the source. Not trusted and not ours means a page script talking to
       itself, which says nothing about what a person wanted. */
    if (!event.isTrusted && !copilot) return;

    const target = describe(event.target);
    if (!target) return;
    /* One interaction, one transition. A checkbox fires click then change, so its
       change is dropped: the click already recorded it. Text fields and native
       selects are the reverse: the click into them changes nothing worth keeping
       (a native select's dropdown is not even in the DOM), so only change counts. */
    const tag = target.el.tagName;
    if (kind === 'click' && (target.role === 'textbox' || tag === 'SELECT')) return;
    if (kind === 'change' && isToggle(target)) return;

    const before = snapshot();
    if (!before) return;

    let action;
    if (isToggle(target)) {
      const now = checkedState(target.el);
      /* On a checkbox the click has already flipped `checked` by the time any
         listener runs, so the snapshot shows the new state. Put the old one back,
         or every toggle would be recorded as a no-op. */
      const idx = before.elements ? before.elements.indexOf(target.el) : -1;
      if (idx >= 0 && now !== null) {
        const node = before.obs.nodes[idx];
        node.state = { ...(node.state || {}), checked: !now };
      }
      action = { type: 'setChecked', value: now };
    } else if (kind === 'change') {
      action = { type: 'setValue' };
    } else {
      action = { type: 'click' };
    }
    action.target = { role: target.role, name: target.name, within: target.within, region: target.region };

    const at = Date.now();
    if (!episode || at - lastActivity > IDLE_EPISODE_MS) newEpisode();
    lastActivity = at;
    const record = { at, episode, seq: seq++, source: copilot ? 'copilot' : 'user', before: before.obs, action };

    /* Survive a full page navigation: if the page unloads before settling, the
       half-finished transition is completed on the next load. */
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(record));
    } catch {
      /* private window or quota: the transition may be lost on navigation, fine */
    }

    chain = chain
      .then(settle)
      .then(() => {
        try {
          sessionStorage.removeItem(PENDING_KEY);
        } catch {}
        const after = snapshot();
        if (after) emit({ ...record, after: after.obs });
      })
      .catch(() => {});
  }

  function onClick(e) {
    try {
      capture(e, 'click');
    } catch {}
  }
  function onChange(e) {
    try {
      capture(e, 'change');
    } catch {}
  }

  function resumePending() {
    let raw = null;
    try {
      raw = sessionStorage.getItem(PENDING_KEY);
      sessionStorage.removeItem(PENDING_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const record = JSON.parse(raw);
      if (Date.now() - record.at > 15000) return;
      settle().then(() => {
        const after = snapshot();
        if (after) emit({ ...record, after: after.obs, crossedNavigation: true });
      });
    } catch {}
  }

  function start(nextSink) {
    sink = nextSink;
    if (enabled) return;
    enabled = true;
    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onChange, true);
    resumePending();
  }

  function stop() {
    enabled = false;
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('change', onChange, true);
  }

  CC.recorder = { start, stop, isEnabled: () => enabled };
})();
