/* Panel side: plan state machine + transport-agnostic RPC.
   Knows nothing about where a plan came from, which is why swapping the
   hardcoded phase 0 plan for a generated one changed nothing below setPlan. */
(function () {
  const CC = (window.CC = window.CC || {});

  function createTransport(target) {
    let seq = 0;
    const pending = new Map();

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || msg.channel !== 'copilot' || msg.direction !== 'toPanel') return;
      const resolve = pending.get(msg.id);
      if (resolve) {
        pending.delete(msg.id);
        resolve(msg.payload);
      }
    });

    return function send(payload) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, resolve);
        target().postMessage({ channel: 'copilot', direction: 'toPage', id, payload }, '*');
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error('page did not respond'));
          }
        }, 4000);
      });
    };
  }

  const newRunId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  function createRunner({ send, plan, service, onChange, onDecision }) {
    const state = {
      plan: plan || null,
      goal: plan ? plan.goal : '',
      understood: plan ? plan.understood ?? null : null,
      outcome: plan ? plan.outcome ?? 'plan' : null,
      limitation: plan ? plan.limitation ?? null : null,
      error: null,
      index: 0,
      status: plan ? 'idle' : 'no-plan',
      located: null,
      lastResult: null,
      runId: plan ? newRunId() : null,
      screenCheck: null,
      /* Where the page is on the learned map, and the way back to a learned step's
         screen when it is somewhere else. Filled only for steps from a verified route. */
      where: null,
      way: null,
      navigating: false,
      relocated: false,
      log: [],
    };

    const emit = () => onChange({ ...state });
    const step = () => (state.plan ? state.plan.steps[state.index] : null) || null;

    /* Two destinations on purpose. state.log is UI state for the current plan and
       is cleared on reset. The journal is durable and never cleared here, because
       a rejection is only a useful signal if it outlives the session. */
    function record(entry) {
      state.log.push({ at: Date.now(), ...entry });
      const step = state.plan?.steps.find((s) => s.id === entry.stepId);
      const decision = {
        at: Date.now(),
        runId: state.runId,
        route: state.plan?.route?.id ?? null,
        tool: state.plan?.tool ?? null,
        goal: state.goal,
        source: state.plan?.source ?? null,
        planOutcome: state.outcome ?? null,
        stepId: entry.stepId,
        intent: step?.intent ?? null,
        reasoning: step?.reasoning ?? null,
        plannedTarget: step?.target ?? null,
        action: step?.action ?? null,
        /* What was actually on screen, which is the half the planner did not
           know and the half that makes a rejection interpretable later. */
        locatedAs: state.located?.node
          ? { role: state.located.node.role, name: state.located.node.name, state: state.located.node.state }
          : null,
        ambiguous: state.located?.ambiguous ?? false,
        screen: state.located?.screen ?? null,
        decision: entry.decision,
        ok: entry.ok,
        error: entry.error,
        from: entry.from,
        to: entry.to,
        note: entry.note,
      };
      if (CC.journal) CC.journal.append(decision);
      /* Phase L: the host may also learn from it (only with capture on, and redacted
         by the uploader first). A failure there must never reach the person. */
      if (typeof onDecision === 'function') {
        try {
          onDecision(decision);
        } catch {}
      }
    }

    /* Every decision is logged, approvals and rejections alike. This log is the
       training signal in phase 2 and the accept-rate metric in phase 3, so it
       exists from the first commit rather than being bolted on later. */

    async function observe() {
      const res = await send({ type: 'observe' });
      return res.observation;
    }

    /* The only path that spends money, and it is reached only from the panel's
       Plan button. */
    async function planFor(goal) {
      if (!service) return;
      state.goal = goal;
      state.status = 'planning';
      state.error = null;
      state.outcome = null;
      state.limitation = null;
      state.understood = null;
      emit();
      try {
        const observation = await observe();
        applyResult(await service.plan(goal, observation));
      } catch (err) {
        state.error = err.message;
        state.status = 'error';
        emit();
      }
    }

    /* Applies a service response. Split out from planFor so a stored response
       can be replayed into the panel without calling the API, which is how the
       outcome renderings get verified for free. */
    function applyResult(result) {
      /* planFor sets the goal before calling, so the fallback only matters when
         a stored response is replayed. */
      state.goal = result.goal || state.goal;
      state.outcome = result.outcome || null;
      state.limitation = result.limitation || null;
      state.understood = result.understood || null;
      /* cannot and nothing_to_do come back with no plan. Both are answers, so
         neither is an error, but neither has anything to run. */
      if (!result.plan) {
        state.status = result.outcome === 'nothing_to_do' ? 'nothing-to-do' : 'refused';
        emit();
        return;
      }
      setPlan(result.plan);
    }

    function setPlan(next) {
      state.plan = next;
      state.runId = newRunId();
      state.understood = next.understood || state.understood || null;
      state.outcome = next.outcome || state.outcome || 'plan';
      state.limitation = next.limitation ?? state.limitation ?? null;
      state.goal = next.goal || state.goal;
      state.index = 0;
      state.located = null;
      state.lastResult = null;
      state.log = [];
      state.status = 'idle';
      emit();
      locate();
    }

    async function locate() {
      const current = step();
      if (!current) return;
      state.status = 'locating';
      emit();
      /* A learned step says which screen it belongs on. When the page is another one
         there is nothing right to point at, so the way there is offered instead. This
         only looks: refusing to act is recorded when Approve is pressed, not here. */
      if (current.expect && state.plan?.route) {
        const check = await screenIsRight(current);
        if (!check.ok) {
          state.screenCheck = { expected: current.expect.screenName ?? 'the learned screen', ...check.detail };
          state.status = 'wrong-screen';
          state.located = null;
          await send({ type: 'clearHighlight' }).catch(() => {});
          emit();
          findWay(current);
          return;
        }
      }
      state.way = null;
      state.screenCheck = null;
      const caption = `Step ${state.index + 1} of ${state.plan.steps.length}${state.relocated ? ' \u00b7 found again' : ''}\n${current.intent}`;
      state.relocated = false;
      try {
        const res = await send({
          type: 'highlight',
          target: current.target,
          caption,
        });
        state.located = res;
        state.status = res.ok ? 'awaiting-approval' : 'not-found';
      } catch (err) {
        state.located = { ok: false, error: err.message };
        state.status = 'not-found';
      }
      emit();
    }

    /* Repair, not replan. A plan is written against screens the planner mostly
       could not see, so a missing target is expected. Re-targeting one step is
       cheaper and less destructive than throwing the plan away. */
    async function repair() {
      const current = step();
      if (!current || !service) return;
      state.status = 'repairing';
      emit();
      try {
        const observation = await observe();
        const result = await service.repair(state.goal, current.intent, observation);
        if (!result.found || !result.target) {
          state.located = { ok: false, error: result.note || 'nothing on this screen fits that step' };
          state.status = 'not-found';
          record({ stepId: current.id, decision: 'repair-failed', note: result.note });
          emit();
          return;
        }
        record({ stepId: current.id, decision: 'repaired', from: current.target, to: result.target });
        /* A learned step that had to be repaired no longer matches the product (G7). */
        service?.feedback(state.plan?.route, 'repaired', state.index);
        current.target = result.target;
        await locate();
      } catch (err) {
        state.error = err.message;
        state.status = 'error';
        emit();
      }
    }

    /* G8. A step that came from a verified route carries the screen it was learned
       on. Before acting, confirm the live page is that screen. Fail closed: if the
       check cannot run, do not act. */
    async function screenIsRight(current) {
      if (!current.expect || !state.plan?.route) return { ok: true };
      try {
        const key = await service.productKey();
        const res = await send({ type: 'screenCheck', expect: current.expect, key });
        return res && res.ok ? { ok: true } : { ok: false, detail: res };
      } catch (err) {
        return { ok: false, detail: { reason: `could not check the screen: ${err.message}` } };
      }
    }

    /* Where is the page, and how do people get from there to this step's screen?
       Free: learned screens and links only, no model. */
    async function findWay(current) {
      if (!service || !service.wayScreens || !current.expect?.screenId) return;
      try {
        const [screens, key] = await Promise.all([service.wayScreens(), service.productKey()]);
        const where = await send({ type: 'whereAmI', screens, key });
        state.where = where && where.screenId ? { screenId: where.screenId, name: where.name } : null;
        state.way = state.where
          ? await service.wayfind(state.where.screenId, current.expect.screenId)
          : { ok: false, reason: 'this page is not one of the screens learned so far' };
      } catch (err) {
        state.way = { ok: false, reason: err.message };
      }
      if (step() === current) emit();
    }

    /* "Take me there": every step of the way only navigates, so the one press that
       started it covers all of them. Each click is still found on the page first, and
       the page must move before the next one; if anything does not match, it stops. */
    async function takeMeThere() {
      const current = step();
      const way = state.way;
      if (!current || !way || !way.ok || !way.steps.length || state.navigating) return;
      state.navigating = true;
      state.status = 'navigating';
      state.error = null;
      emit();
      const pause = (ms) => new Promise((r) => setTimeout(r, ms));
      try {
        for (let i = 0; i < way.steps.length; i++) {
          const nav = way.steps[i];
          state.log.push({ at: Date.now(), stepId: `nav-${i}`, decision: 'navigated', to: nav.to });
          let res = null;
          /* The page may still be settling from the last click. */
          for (let attempt = 0; attempt < 6; attempt++) {
            res = await send({ type: 'act', target: { role: nav.target.role, name: nav.target.name }, action: nav.action });
            if (res && res.ok) break;
            await pause(300);
          }
          if (!res || !res.ok) throw new Error(`could not find "${nav.target.name}" on the way`);
          await pause(450);
        }
        state.navigating = false;
        state.way = null;
        await locate();
      } catch (err) {
        state.navigating = false;
        state.status = 'wrong-screen';
        state.error = `Stopped on the way: ${err.message}. It only opened pages, so nothing was changed.`;
        emit();
      }
    }

    async function approve() {
      const current = step();
      if (!current) return;
      state.status = 'acting';
      emit();
      const check = await screenIsRight(current);
      if (!check.ok) {
        state.screenCheck = { expected: current.expect?.screenName ?? 'the learned screen', ...check.detail };
        state.status = 'wrong-screen';
        record({ stepId: current.id, decision: 'wrongScreen', note: check.detail?.reason ?? null });
        service?.feedback(state.plan.route, 'wrongScreen', state.index);
        emit();
        findWay(current);
        return;
      }
      const res = await send({ type: 'act', target: current.target, action: current.action });
      state.lastResult = res;
      record({ stepId: current.id, decision: 'approved', ok: res.ok, error: res.error });

      if (!res.ok) {
        state.status = 'failed';
        emit();
        return;
      }
      await advance();
    }

    async function skip() {
      const current = step();
      if (!current) return;
      record({ stepId: current.id, decision: 'skipped' });
      service?.feedback(state.plan?.route, 'skipped', state.index);
      await send({ type: 'clearHighlight' });
      await advance();
    }

    async function advance() {
      state.index += 1;
      state.located = null;
      if (state.index >= state.plan.steps.length) {
        state.status = 'done';
        /* Positive evidence only when every step was approved, none skipped. */
        const skipped = state.log.some((l) => l.decision === 'skipped');
        if (!skipped) service?.feedback(state.plan.route, 'completed', null);
        await send({ type: 'clearHighlight' });
        emit();
        return;
      }
      /* Small settle delay: the page usually re-renders after an action. */
      setTimeout(locate, 350);
      emit();
    }

    async function reset() {
      state.index = 0;
      state.status = state.plan ? 'idle' : 'no-plan';
      state.located = null;
      state.lastResult = null;
      state.error = null;
      state.screenCheck = null;
      state.where = null;
      state.way = null;
      state.navigating = false;
      state.log = [];
      await send({ type: 'clearHighlight' });
      emit();
      /* Re-locate, otherwise the panel shows step 1 as current while nothing is
         highlighted and no match is reported: the copilot points at nothing. */
      if (state.plan) await locate();
    }

    async function discard() {
      state.plan = null;
      state.understood = null;
      state.outcome = null;
      state.limitation = null;
      await reset();
    }

    /* The page changed on its own and the highlighted element is gone: a person
       navigated, or the app re-rendered. Look for the step's target again rather than
       leave the step pointing at nothing, or at something else. Never while the copilot
       itself is acting or asking, and never more than about twice a second, so a page
       that keeps re-rendering cannot turn this into a loop. */
    let lastRelocate = 0;
    function pageEvent(event) {
      if (!event || event.type !== 'targetLost') return false;
      if (!state.plan || !step()) return false;
      if (!['idle', 'awaiting-approval', 'not-found', 'failed', 'wrong-screen'].includes(state.status)) return false;
      const now = Date.now();
      if (now - lastRelocate < 400) return false;
      lastRelocate = now;
      state.relocated = state.status === 'awaiting-approval';
      locate();
      return true;
    }

    return {
      state: () => ({ ...state }),
      pageEvent,
      step,
      locate,
      approve,
      skip,
      takeMeThere,
      reset,
      repair,
      applyResult,
      discard,
      planFor,
      setPlan,
      emit,
      hasService: Boolean(service),
    };
  }

  CC.runner = { createRunner, createTransport };
})();
