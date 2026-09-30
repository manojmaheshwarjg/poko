/* Sekva's panel. Renders runner state. Presentation only: no page access, no plan
   knowledge. Three tabs: Plan (the goal, where it goes, the steps), Activity (what is
   being learned, exploration, the decisions kept on this machine) and Settings (the
   host's, when it has any). */
(function () {
  const CC = (window.CC = window.CC || {});

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kbd = (k) => `<span class="cc-kbd">${esc(k)}</span>`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function stepState(i, state) {
    if (state.status === 'done' || i < state.index) return 'past';
    if (i === state.index) return 'current';
    return 'future';
  }

  /* The runtime defence. The observation carries the checkbox's current state,
     so the panel can show what the step will actually DO rather than what it is
     called. That makes a toggle-in-the-wrong-direction visible at the moment of
     approval, which is the only moment it can still be stopped, and it holds
     whether or not the planner obeyed the setChecked rule. */
  function effectLine(state) {
    const res = state.located;
    const step = state.plan?.steps[state.index];
    if (!res?.ok || !step || res.node.role !== 'checkbox') return '';

    const current = res.node.state ? res.node.state.checked : undefined;
    const action = step.action;

    if (action.type === 'setChecked') {
      if (current === undefined) return '';
      const want = !!action.value;
      return current === want
        ? `<div class="cc-effect" data-kind="noop">Already ${want ? 'on' : 'off'}. This step changes nothing.</div>`
        : `<div class="cc-effect"><span class="cc-was">${current ? 'on' : 'off'}</span><span class="cc-arrow">&rarr;</span><span class="cc-will">${want ? 'on' : 'off'}</span> Will turn it ${want ? 'on' : 'off'}.</div>`;
    }

    if (action.type === 'click') {
      if (current === undefined) {
        return `<div class="cc-effect" data-kind="risk">This clicks a checkbox, which toggles it. The current state could not be read, so the result is not certain.</div>`;
      }
      return `<div class="cc-effect" data-kind="risk">This clicks a checkbox, which toggles it. It is currently ${
        current ? 'on' : 'off'
      }, so this will turn it ${current ? 'off' : 'on'}.</div>`;
    }
    return '';
  }

  function matchLine(state) {
    if (state.status === 'wrong-screen' || state.status === 'navigating') {
      const c = state.screenCheck || {};
      return `<div class="cc-match">Waiting until you are on ${esc(c.expected || 'the screen this step was learned on')}.</div>`;
    }
    const res = state.located;
    if (state.status === 'locating') return `<div class="cc-match">Looking for it on the page&hellip;</div>`;
    if (state.status === 'repairing') return `<div class="cc-match">Asking the copilot what to use here&hellip;</div>`;
    if (!res) return '';
    if (!res.ok) {
      const why = res.error || 'no element on this screen matches that description';
      return `<div class="cc-match" data-ok="false">Not found: ${esc(why)}</div>`;
    }
    const n = res.node;
    const ambiguous = res.ambiguous ? `<span>${res.candidates.length} equally good matches, picked the first</span>` : '';
    return `<div class="cc-match" data-ambiguous="${!!res.ambiguous}">
      Found <span class="cc-chip">${esc(n.role)}</span>
      <span class="cc-chip">${esc(n.name)}</span> ${ambiguous}
    </div>`;
  }

  function actions(state, hasService) {
    const busy = state.status === 'acting' || state.status === 'locating' || state.status === 'repairing' || state.status === 'navigating';
    if (state.status === 'wrong-screen' || state.status === 'navigating') return '';
    if (state.status === 'not-found') {
      return `<div class="cc-actions">
        <button class="cc-btn" data-act="retry">Look again ${kbd('R')}</button>
        ${hasService ? `<button class="cc-btn" data-act="repair">Ask copilot</button>` : ''}
        <button class="cc-btn" data-act="skip">Skip ${kbd('S')}</button>
      </div>`;
    }
    return `<div class="cc-actions">
      <button class="cc-btn" data-variant="primary" data-act="approve" ${busy ? 'disabled' : ''}>
        ${state.status === 'acting' ? 'Doing it&hellip;' : `Approve ${kbd('A')}`}
      </button>
      <button class="cc-btn" data-act="skip" ${busy ? 'disabled' : ''}>Skip ${kbd('S')}</button>
    </div>`;
  }

  /* Suggestions: what verified routes in this product do. Picking one only fills in
     the goal; planning still waits for the Plan button. */
  let suggestions = null;
  function goalForm(state) {
    const busy = state.status === 'planning';
    const chips = (suggestions || [])
      .map((s) => `<button class="cc-suggest" data-suggest="${esc(s.label)}" title="Learned from how people do this here">${esc(s.title || s.label)}</button>`)
      .join('');
    return `
      <div class="cc-ask">
        <label class="cc-label" for="cc-goal-input">What do you want to do?</label>
        <textarea id="cc-goal-input" class="cc-input" rows="3"
          placeholder="Let contractors view but not edit issues in this project"
          ${busy ? 'disabled' : ''}>${esc(state.goal || '')}</textarea>
        <div class="cc-actions">
          <button class="cc-btn" data-variant="primary" data-act="plan" ${busy ? 'disabled' : ''}>
            ${busy ? 'Planning&hellip;' : `Plan it ${kbd('⌘↵')}`}
          </button>
          <span class="cc-note" style="margin:0">One paid call. Nothing happens until you approve a step.</span>
        </div>
        ${state.error ? `<div class="cc-alert" data-kind="bad">${esc(state.error)}</div>` : ''}
        ${chips ? `<div class="cc-label" style="margin-top:16px">Learned in this product</div><div class="cc-suggests">${chips}</div>` : ''}
      </div>`;
  }

  /* Two outcomes that produce no steps. They are answers, not failures, so
     neither is styled as an error: "cannot" is a dead end worth explaining, and
     "nothing to do" is a success the user should be able to read and trust. */
  function noStepsView(state) {
    const isNoOp = state.outcome === 'nothing_to_do';
    return `
      <div class="cc-ask">
        ${state.understood ? `<div class="cc-understood">${esc(state.understood)}</div>` : ''}
        <div class="cc-verdict" data-kind="${isNoOp ? 'settled' : 'blocked'}">
          <div class="cc-verdict-head">${isNoOp ? 'Nothing to do' : 'This cannot be done here'}</div>
          <div>${esc(state.limitation || '')}</div>
        </div>
        <div class="cc-actions"><button class="cc-btn" data-act="discard">Try another goal</button></div>
      </div>`;
  }

  /* The partial banner is the whole point of the outcome. It sits above the
     steps, before any Approve button, because the user has to see what the plan
     does NOT do while deciding whether to run it. */
  function partialBanner(state) {
    if (state.outcome !== 'partial' || !state.limitation) return '';
    return `
      <div class="cc-verdict" data-kind="partial">
        <div class="cc-verdict-head">This plan does not do everything you asked</div>
        <div>${esc(state.limitation)}</div>
      </div>`;
  }

  /* The plan's screens as a line of stops: where it has been, where it is, where it
     goes. Only a plan that follows a verified route knows its screens. */
  function stations(plan) {
    const out = [];
    plan.steps.forEach((s, i) => {
      if (!s.expect || !s.expect.screenName) return;
      const last = out[out.length - 1];
      if (last && last.id === s.expect.screenId) last.steps.push(i);
      else out.push({ id: s.expect.screenId, name: s.expect.screenName, steps: [i] });
    });
    return out;
  }

  function miniMap(state) {
    const stops = stations(state.plan);
    if (stops.length < 2) return '';
    const where = state.where;
    const on = where && stops.some((s) => s.id === where.screenId);
    const offRoute = (state.status === 'wrong-screen' || state.status === 'navigating') && where && !on;
    const items = stops
      .map((s) => {
        const done = state.status === 'done' || s.steps.every((i) => i < state.index);
        const current = !done && s.steps.includes(state.index);
        const you = where && where.screenId === s.id;
        return `<li data-state="${done ? 'done' : current ? 'current' : 'future'}"${you ? ' data-you="true"' : ''}>
          <span class="cc-stop"></span><span class="cc-stop-name">${esc(s.name)}</span>${you ? '<span class="cc-you">you</span>' : ''}</li>`;
      })
      .join('');
    return `<div class="cc-map" aria-label="Where this plan goes">
      <ol class="cc-line">${items}</ol>
      ${offRoute ? `<div class="cc-off"><span class="cc-off-dot"></span>You are on ${esc(where.name)}, off the route</div>` : ''}
    </div>`;
  }

  function offRoute(state) {
    if (state.status !== 'wrong-screen' && state.status !== 'navigating') return '';
    const expected = (state.screenCheck && state.screenCheck.expected) || 'the screen this step belongs on';
    const here = state.where ? `You are on <b>${esc(state.where.name)}</b>.` : 'This page is not one of the screens learned so far.';
    if (state.status === 'navigating') {
      return `<div class="cc-offroute"><div class="cc-offroute-head">Taking you to ${esc(expected)}&hellip;</div><div>Opening pages only. Nothing is changed.</div></div>`;
    }
    const way = state.way;
    const take = way && way.ok && way.steps.length
      ? `<button class="cc-btn" data-variant="primary" data-act="take">Take me there, ${plural(way.steps.length, 'step')} ${kbd('↵')}</button>`
      : '';
    return `<div class="cc-offroute">
      <div class="cc-offroute-head">Off the route</div>
      <div>This step is on <b>${esc(expected)}</b>. ${here}</div>
      ${!way ? `<p class="cc-note">Finding the way people go from here&hellip;</p>` : !way.ok ? `<p class="cc-note">No way to take you there: ${esc(way.reason)}.</p>` : ''}
      <div class="cc-actions">
        ${take}
        ${take ? '' : `<button class="cc-btn" data-act="retry">Check again ${kbd('R')}</button>`}
        <button class="cc-btn" data-act="skip">Skip this step ${kbd('S')}</button>
      </div>
      ${take ? `<p class="cc-note">Uses the way people go, with no model call. It only opens pages; nothing is changed until you approve a step.</p>` : ''}
      ${state.error ? `<div class="cc-alert" data-kind="warn">${esc(state.error)}</div>` : ''}
    </div>`;
  }

  /* What capture is doing, shown whenever it is on. Nobody should be recorded
     without being able to see that they are. */
  let learningText = '';
  function patchLearning(root) {
    root.querySelectorAll('[data-learning]').forEach((el) => {
      el.textContent = learningText || 'Learning is off for this product.';
      el.dataset.on = learningText ? 'true' : 'false';
    });
    const dot = root.querySelector('[data-learning-dot]');
    if (dot) dot.hidden = !learningText;
  }

  /* Exploration. The controls exist only when the host enables them, which it does
     only for a vendor install on a demo tenant. They live outside the runner's state
     and are patched in place, so a run in progress survives any re-render. */
  let explorer = null;
  let exploreView = { phase: 'idle' };

  const STOP_TEXT = {
    done: 'No more links to open',
    limit: 'Reached the page limit',
    stopped: 'Stopped',
    left: 'Stopped: a page moved to another site (signed out, or the product refuses to be framed)',
    'signed-out': 'Stopped: a sign-in page appeared, so the session had ended',
    error: 'Stopped by an error in the explorer',
  };
  const REFUSED = new Set(['unsafe', 'action-link', 'action-param', 'download', 'confirm']);

  /* Local display only; what is uploaded is normalised by the uploader. The query is
     shown because it is often the whole reason a link was refused (?op=watch). */
  function pathOf(href) {
    try {
      const u = new URL(href);
      const tail = u.search.length > 40 ? u.search.slice(0, 39) + '…' : u.search;
      return u.pathname + tail + (u.hash.startsWith('#/') ? u.hash : '');
    } catch {
      return href || '';
    }
  }
  function reasonText(s) {
    return CC.exploreRules ? CC.exploreRules.describe(s.reason, s.word) : `${s.reason}${s.word ? ` (${s.word})` : ''}`;
  }

  function exploreCard(v) {
    if (!explorer) return `<p class="cc-note">Exploration is for a vendor demo account with learning on. Set that up in Settings.</p>`;
    if (v.phase === 'idle') {
      return `<button class="cc-btn" data-explore="open">Explore this product</button>
        <p class="cc-note">Maps screens by opening links in a hidden frame. Never clicks, types or submits.</p>`;
    }
    if (v.phase === 'confirm') {
      return `
      <div class="cc-verdict cc-explore" data-kind="explore">
        <div class="cc-verdict-head">Map this product by opening its links</div>
        <div>Opens links from this page in a hidden frame and records each screen it finds. It never clicks, types or submits, and it will not open a link that looks like it could change something: signing out, deleting, exporting, paying, inviting.</div>
        <p class="cc-note">Opening a page can still do what viewing it does, like marking notifications read. Run it on a demo account.</p>
        <label class="cc-explore-max">Up to
          <select data-explore-max>${[10, 25, 50].map((n) => `<option value="${n}"${n === 25 ? ' selected' : ''}>${n}</option>`).join('')}</select>
          pages</label>
        <div class="cc-actions">
          <button class="cc-btn" data-variant="primary" data-explore="start">Start exploring</button>
          <button class="cc-btn" data-explore="cancel">Cancel</button>
        </div>
      </div>`;
    }
    if (v.phase === 'running') {
      return `
      <div class="cc-verdict cc-explore" data-kind="explore">
        <div class="cc-verdict-head">Exploring</div>
        <div>${plural(v.pages || 0, 'page')} mapped, ${plural(v.skipped || 0, 'link')} not opened</div>
        ${v.current ? `<p class="cc-note">Opening ${esc(pathOf(v.current))}</p>` : ''}
        <div class="cc-actions">
          <button class="cc-btn" data-explore="stop"${v.stopping ? ' disabled' : ''}>${v.stopping ? 'Stopping&hellip;' : 'Stop'}</button>
        </div>
      </div>`;
    }
    const skipped = v.skippedList || [];
    const refused = skipped.filter((s) => REFUSED.has(s.reason));
    const seen = skipped.filter((s) => s.reason === 'seen').length;
    const elsewhere = skipped.filter((s) => s.reason === 'offsite' || s.reason === 'scope' || s.reason === 'scheme').length;
    const over = skipped.filter((s) => s.reason === 'limit').length;
    const unreached = skipped.filter((s) => s.reason === 'unvisited').length;
    return `
      <div class="cc-verdict cc-explore" data-kind="${v.error ? 'blocked' : 'settled'}">
        <div class="cc-verdict-head">${v.error ? 'Exploration did not run' : `Mapped ${plural(v.pages || 0, 'page')}`}</div>
        ${v.error ? `<div>${esc(v.error)}</div>` : ''}
        ${v.stopped ? `<div>${esc(STOP_TEXT[v.stopped] || v.stopped)}.</div>` : ''}
        ${v.error ? '' : `<div>Not opened: ${refused.length} that could change something, ${seen} already mapped, ${elsewhere} elsewhere${over ? `, ${over} over the limit` : ''}${unreached ? `, ${unreached} not reached` : ''}.</div>`}
        ${refused.length ? `<details class="cc-explore-refused"><summary>Links it refused to open</summary><ul>${refused
          .slice(0, 30)
          .map((s) => `<li><code>${esc(pathOf(s.href))}</code> ${esc(reasonText(s))}</li>`)
          .join('')}</ul></details>` : ''}
        ${v.failures ? `<p class="cc-note">${plural(v.failures, 'page')} failed to load.</p>` : ''}
        ${v.uploadError
          ? `<div class="cc-alert" data-kind="bad">${esc(v.uploadError)}</div>`
          : v.error ? '' : `<p class="cc-note">${v.sent || 0} stored. They appear on the map in the console once learning runs.</p>`}
        <div class="cc-actions"><button class="cc-btn" data-explore="close">Close</button></div>
      </div>`;
  }

  function patchExplore(root) {
    const slot = root.querySelector('[data-explore-slot]');
    if (!slot) return;
    slot.innerHTML = exploreCard(exploreView);
    slot.querySelectorAll('[data-explore]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const what = btn.getAttribute('data-explore');
        if (what === 'open') CC.panel.setExplore({ phase: 'confirm' });
        if (what === 'start') explorer.start(Number(slot.querySelector('[data-explore-max]')?.value) || 25);
        if (what === 'stop') explorer.stop();
        if (what === 'cancel' || what === 'close') CC.panel.setExplore({ phase: 'idle' });
      });
    });
  }

  const DECISION_TEXT = { approved: 'approved', skipped: 'skipped', failed: 'failed', repaired: 'repaired', 'repair-failed': 'no repair', wrongScreen: 'wrong screen' };

  function mount({ root, runner, service }) {
    let tab = 'plan';
    let settingsMount = null;
    let settingsMounted = false;

    root.innerHTML = `
      <div class="cc-panel">
        <div class="cc-head">
          <svg class="cc-logo" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="6.5" fill="#4f46e5"/><path d="M7 16.2h4.3c1.6 0 2.4-.9 2.4-2.2v-4c0-1.3.8-2.2 2.4-2.2H17" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="7" cy="16.2" r="1.9" fill="#fff"/><circle cx="17" cy="7.8" r="1.9" fill="#fff"/></svg>
          <span class="cc-title">Sekva</span>
          <span class="cc-live" data-learning-dot hidden title="Learning from how this product is used"></span>
          <nav class="cc-tabs" role="tablist" aria-label="Panel">
            <button role="tab" data-tab="plan" aria-selected="true">Plan</button>
            <button role="tab" data-tab="activity" aria-selected="false">Activity</button>
            <button role="tab" data-tab="settings" aria-selected="false">Settings</button>
          </nav>
        </div>
        <div class="cc-pane" data-pane="plan"></div>
        <div class="cc-pane" data-pane="activity" hidden>
          <section class="cc-section"><div class="cc-label">Learning</div><div class="cc-learning" data-learning></div></section>
          <section class="cc-section"><div class="cc-label">Exploration</div><div data-explore-slot></div></section>
          <section class="cc-section">
            <div class="cc-label">Decisions kept on this machine <span data-journal-count></span></div>
            <div data-journal-list class="cc-journal"></div>
            <div class="cc-actions"><button class="cc-btn" data-act="export">Export</button></div>
          </section>
        </div>
        <div class="cc-pane" data-pane="settings" hidden><div data-settings-slot></div></div>
        <div class="cc-foot"><span data-foot></span><span class="cc-keys" data-keys></span></div>
      </div>`;

    const pane = (name) => root.querySelector(`[data-pane="${name}"]`);
    function show(name) {
      tab = name;
      root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
      root.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== name));
      if (name === 'activity') refreshJournal();
      if (name === 'settings') mountSettings();
      foot(runner.state());
    }
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
    root.querySelector('[data-act="export"]').addEventListener('click', () => CC.journal?.download());

    function mountSettings() {
      const slot = root.querySelector('[data-settings-slot]');
      if (settingsMount && !settingsMounted) {
        settingsMounted = true;
        settingsMount(slot);
      } else if (!settingsMount) {
        slot.innerHTML = `<p class="cc-note" style="padding:14px">Settings live in the Sekva extension. This page has none.</p>`;
      }
    }

    CC.panel.setSettings = (fn) => {
      settingsMount = fn;
      settingsMounted = false;
      if (tab === 'settings') mountSettings();
    };
    CC.panel.setLearning = (text) => {
      learningText = text || '';
      patchLearning(root);
    };
    CC.panel.enableExplore = (controller) => {
      explorer = controller || null;
      patchExplore(root);
    };
    CC.panel.setExplore = (view) => {
      exploreView = { ...(view || { phase: 'idle' }) };
      patchExplore(root);
      if (exploreView.phase !== 'idle' && tab !== 'activity') show('activity');
    };

    /* The journal is async and the render is not, so it is read after paint and
       patched in place. */
    let journalTotal = null;
    function refreshJournal() {
      if (!CC.journal) return;
      CC.journal
        .all()
        .then((entries) => {
          journalTotal = entries.length;
          const count = root.querySelector('[data-journal-count]');
          if (count) count.textContent = entries.length ? `(${entries.length})` : '';
          const list = root.querySelector('[data-journal-list]');
          if (list) {
            const recent = entries.slice(-6).reverse();
            list.innerHTML = recent.length
              ? recent
                  .map(
                    (e) => `<div class="cc-jrow"><span class="cc-pill" data-kind="${esc(e.decision)}">${esc(DECISION_TEXT[e.decision] || e.decision)}</span><span class="cc-jtext">${esc(e.intent || e.goal || '')}</span></div>`
                  )
                  .join('')
              : `<p class="cc-note" style="margin:0">None yet.</p>`;
          }
          foot(runner.state());
        })
        .catch(() => {});
    }

    function foot(state) {
      const f = root.querySelector('[data-foot]');
      if (f) f.textContent = `${state.log.filter((l) => l.decision && l.decision !== 'navigated').length} this plan${journalTotal ? ` · ${journalTotal} kept` : ''}`;
      const k = root.querySelector('[data-keys]');
      if (k && tab !== 'plan') k.innerHTML = '';
      else if (k) {
        k.innerHTML = state.plan
          ? state.status === 'wrong-screen' && state.way && state.way.ok
            ? `${kbd('↵')} take me there &middot; ${kbd('S')} skip`
            : `${kbd('A')} approve &middot; ${kbd('S')} skip`
          : `${kbd('⌘↵')} plan`;
      }
    }

    /* Suggestions are read once, and only while there is no plan. */
    if (service && service.suggestions && suggestions === null) {
      suggestions = [];
      service.suggestions().then((list) => {
        suggestions = list || [];
        if (!runner.state().plan) render(runner.state());
      });
    }

    function render(state) {
      const hasService = runner.hasService;
      let body;

      if (state.status === 'refused' || state.status === 'nothing-to-do') {
        body = noStepsView(state);
      } else if (!state.plan) {
        body = goalForm(state);
      } else {
        const outcomes = {};
        for (const entry of state.log) if (entry.decision) outcomes[entry.stepId] = entry.decision;
        const route = state.plan.route;
        const steps = state.plan.steps
          .map((s, i) => {
            const st = stepState(i, state);
            const isCurrent = st === 'current';
            return `
            <div class="cc-step" data-state="${st}" data-outcome="${outcomes[s.id] || ''}">
              <div class="cc-num">${outcomes[s.id] === 'approved' ? '&#10003;' : i + 1}</div>
              <div class="cc-body">
                <div class="cc-intent">${esc(s.intent)}</div>
                ${s.expect && s.expect.screenName && !isCurrent ? `<div class="cc-on">on ${esc(s.expect.screenName)}</div>` : ''}
                ${isCurrent ? `<div class="cc-why">${esc(s.reasoning)}</div>${matchLine(state)}${effectLine(state)}` : ''}
                ${isCurrent ? actions(state, hasService) : ''}
              </div>
            </div>`;
          })
          .join('');

        const done = state.status === 'done'
          ? `<div class="cc-done">Done. ${state.log.filter((l) => l.decision === 'approved').length} of ${state.plan.steps.length} steps approved.</div>`
          : '';

        body = `
          <div class="cc-goal">
            <div class="cc-goal-text">${esc(state.goal)}</div>
            <div class="cc-meta">${plural(state.plan.steps.length, 'step')} &middot; ${
              route ? `follows a verified route` : 'planned from the docs'
            }${state.outcome === 'partial' ? ' &middot; partial' : ''}</div>
            ${route ? `<div class="cc-route" title="Learned from how people actually do this. Each step checks it is on the right screen first.">&ldquo;${esc(route.label)}&rdquo;</div>` : ''}
          </div>
          ${miniMap(state)}
          ${partialBanner(state)}
          ${offRoute(state)}
          <div class="cc-steps">${steps}${done}</div>
          ${state.error && state.status !== 'wrong-screen' ? `<div class="cc-alert" data-kind="bad">${esc(state.error)}</div>` : ''}
          <div class="cc-actions cc-plan-actions">
            <button class="cc-btn cc-link" data-act="discard">New goal</button>
            <button class="cc-btn cc-link" data-act="reset">Start over</button>
          </div>`;
      }

      pane('plan').innerHTML = body;
      pane('plan').querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => act(btn.getAttribute('data-act')));
      });
      pane('plan').querySelectorAll('[data-suggest]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const input = root.querySelector('#cc-goal-input');
          if (input) {
            input.value = btn.getAttribute('data-suggest');
            input.focus();
          }
        });
      });
      const input = root.querySelector('#cc-goal-input');
      if (input && state.status !== 'planning') {
        /* Cmd/Ctrl+Enter submits, plain Enter stays a newline: planning costs
           money, so it should not be one stray keystroke away. */
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            const value = input.value.trim();
            if (value) runner.planFor(value);
          }
        });
      }
      foot(state);
      patchLearning(root);
      /* After the panel's own action, focus comes back to it, so the next shortcut
         works: acting on the page moves focus into the page. Only then, never while
         the person is working in the page on their own. */
      if (refocus && ['awaiting-approval', 'wrong-screen', 'not-found', 'failed', 'done'].includes(state.status)) {
        refocus = false;
        const target = pane('plan').querySelector('.cc-btn[data-variant="primary"]:not([disabled])') || pane('plan');
        if (target === pane('plan')) pane('plan').setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    }

    let refocus = false;
    function act(what) {
      if (['approve', 'skip', 'take', 'retry'].includes(what)) refocus = true;
      const state = runner.state();
      if (what === 'approve' && state.status === 'awaiting-approval') runner.approve();
      if (what === 'skip' && state.plan && state.status !== 'done' && state.status !== 'acting' && state.status !== 'navigating') runner.skip();
      if (what === 'take' && state.status === 'wrong-screen') runner.takeMeThere();
      if (what === 'reset') runner.reset();
      if (what === 'retry') runner.locate();
      if (what === 'repair') runner.repair();
      if (what === 'discard') runner.discard();
      if (what === 'plan') {
        const value = root.querySelector('#cc-goal-input')?.value.trim();
        if (value) runner.planFor(value);
      }
    }

    /* Keyboard: A approves, S skips, Enter takes you there, R looks again. Never
       while typing, and never for planning, which is Cmd+Enter in the goal box. */
    root.ownerDocument.addEventListener('keydown', (event) => {
      const t = event.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || tab !== 'plan') return;
      const k = event.key.toLowerCase();
      if (k === 'a') act('approve');
      else if (k === 's') act('skip');
      else if (k === 'r') act('retry');
      else if (k === 'enter' || k === 't') act('take');
      else return;
      event.preventDefault();
    });

    patchExplore(root);
    patchLearning(root);
    return render;
  }

  CC.panel = { mount, setLearning: () => {}, setExplore: () => {}, enableExplore: () => {}, setSettings: () => {} };
})();
