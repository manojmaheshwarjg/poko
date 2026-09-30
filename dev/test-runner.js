/* Runner behaviour that needs no page: re-locating when the page changes on its own
   (Phase K), and a learned step on the wrong screen offering the way there. The
   transport and the service are fakes that record what the runner asks for. */
global.window = {};
require('../core/runner.js');
const { createRunner } = global.window.CC.runner;

let failures = 0;
function check(label, condition, detail = '') {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
}

const plan = {
  tool: 'jira', goal: 'g', source: 'test',
  steps: [{ id: 's1', intent: 'Open settings', reasoning: 'r', target: { role: 'link', name: 'Project settings' }, action: { type: 'click' } }],
};

(async () => {
  const asked = [];
  const send = async (msg) => {
    asked.push(msg.type);
    if (msg.type === 'highlight') return { ok: true, node: { id: 0, role: 'link', name: 'Project settings' }, screen: {} };
    return { ok: true };
  };
  const runner = createRunner({ send, plan, onChange: () => {} });
  await runner.locate();
  check('a located step waits for approval', runner.state().status === 'awaiting-approval', runner.state().status);

  const before = asked.filter((t) => t === 'highlight').length;
  check('a lost target sends the runner to look again', runner.pageEvent({ type: 'targetLost', why: 'removed' }) === true);
  await new Promise((r) => setTimeout(r, 0));
  check('and it highlights the step afresh', asked.filter((t) => t === 'highlight').length === before + 1);
  check('a burst of losses is not a loop: the next one within 400ms is ignored', runner.pageEvent({ type: 'targetLost' }) === false);

  const quiet = createRunner({ send, plan: null, onChange: () => {} });
  check('with no plan there is nothing to look for', quiet.pageEvent({ type: 'targetLost' }) === false);
  check('other events are ignored', runner.pageEvent({ type: 'somethingElse' }) === false);

  const busy = createRunner({ send: () => new Promise(() => {}), plan, onChange: () => {} });
  busy.locate();
  check('never while it is already looking', busy.state().status === 'locating' && busy.pageEvent({ type: 'targetLost' }) === false);

  /* Captions: which step of how many, and when it was found again. */
  const captions = [];
  const two = { ...plan, steps: [plan.steps[0], { ...plan.steps[0], id: 's2', intent: 'Open permissions' }] };
  const capRunner = createRunner({
    send: async (msg) => {
      if (msg.type === 'highlight') {
        captions.push(msg.caption);
        return { ok: true, node: { id: 0, role: 'link', name: 'x' }, screen: {} };
      }
      return { ok: true };
    },
    plan: two,
    onChange: () => {},
  });
  await capRunner.locate();
  check('the spotlight says which step of how many', captions[0] === 'Step 1 of 2\nOpen settings', JSON.stringify(captions[0]));
  capRunner.pageEvent({ type: 'targetLost' });
  await new Promise((r) => setTimeout(r, 0));
  check('and says so when it found the step again', captions[1] === 'Step 1 of 2 \u00b7 found again\nOpen settings', JSON.stringify(captions[1]));

  /* A learned step on the wrong screen: the way there is offered, and nothing is
     recorded against the route for merely being elsewhere. */
  const expect = { screenId: 's_edit', screenName: 'Edit permissions', keys: ['H:edit'] };
  const routed = {
    ...plan,
    route: { id: 'r1', pathHash: 'h', label: 'Remove edit' },
    steps: [{ id: 'e1', intent: 'Untick Edit issues', reasoning: 'r', target: { role: 'checkbox', name: 'Edit issues' }, action: { type: 'setChecked', value: false }, expect }],
  };
  let onEdit = false;
  const sent = [];
  const decisions = [];
  const feedback = [];
  const way = { ok: true, screens: ['s_access', 's_settings', 's_perms', 's_edit'], steps: [
    { from: 's_access', to: 's_settings', target: { role: 'link', name: 'Project settings' }, action: { type: 'click' } },
    { from: 's_settings', to: 's_perms', target: { role: 'link', name: 'Permissions' }, action: { type: 'click' } },
    { from: 's_perms', to: 's_perms', target: { role: 'button', name: 'Actions' }, action: { type: 'click' } },
    { from: 's_perms', to: 's_edit', target: { role: 'menuitem', name: 'Edit permissions' }, action: { type: 'click' } },
  ] };
  const service = {
    productKey: async () => 'k',
    wayScreens: async () => [{ id: 's_access', name: 'Access', keys: ['H:access'] }, { id: 's_edit', name: 'Edit permissions', keys: ['H:edit'] }],
    wayfind: async (from, to) => (from === 's_access' && to === 's_edit' ? way : { ok: false, reason: 'no' }),
    feedback: (...a) => feedback.push(a),
  };
  const nav = createRunner({
    send: async (msg) => {
      sent.push(msg);
      if (msg.type === 'screenCheck') return { ok: onEdit };
      if (msg.type === 'whereAmI') return onEdit ? { screenId: 's_edit', name: 'Edit permissions' } : { screenId: 's_access', name: 'Access' };
      if (msg.type === 'act') {
        if (msg.target.name === 'Edit permissions') onEdit = true;
        return { ok: true };
      }
      if (msg.type === 'highlight') return { ok: true, node: { id: 0, role: 'checkbox', name: 'Edit issues' }, screen: {} };
      return { ok: true };
    },
    plan: routed,
    service,
    onChange: () => {},
    onDecision: (d) => decisions.push(d),
  });
  await nav.locate();
  await new Promise((r) => setTimeout(r, 0));
  const st = nav.state();
  check('a learned step on another screen is off the route, not "not found"', st.status === 'wrong-screen' && st.screenCheck.expected === 'Edit permissions', st.status);
  check('it knows where the page is and the way people go from there', st.where && st.where.name === 'Access' && st.way && st.way.ok && st.way.steps.length === 4);
  check('being elsewhere is not recorded against the route', decisions.length === 0 && feedback.length === 0);
  check('nothing was pointed at on the wrong screen', !sent.some((m) => m.type === 'highlight'));

  await nav.takeMeThere();
  const acts = sent.filter((m) => m.type === 'act');
  check('take me there clicks each step of the way, in order', acts.map((m) => m.target.name).join(' > ') === 'Project settings > Permissions > Actions > Edit permissions');
  check('every one of them only clicks', acts.every((m) => m.action.type === 'click'));
  check('then it looks for the step again, now on the right screen', nav.state().status === 'awaiting-approval', nav.state().status);
  check('still nothing recorded: navigating is not a decision', decisions.length === 0);
  check('the step itself still waits for its own approval', !acts.some((m) => m.action.type === 'setChecked'));

  /* A way that breaks half way stops, changes nothing, and says so. */
  onEdit = false;
  const broken = createRunner({
    send: async (msg) => {
      if (msg.type === 'screenCheck') return { ok: false };
      if (msg.type === 'whereAmI') return { screenId: 's_access', name: 'Access' };
      if (msg.type === 'act') return msg.target.name === 'Permissions' ? { ok: false, error: 'target not found at act time' } : { ok: true };
      return { ok: true };
    },
    plan: routed,
    service,
    onChange: () => {},
  });
  await broken.locate();
  await new Promise((r) => setTimeout(r, 0));
  await broken.takeMeThere();
  check('a way that breaks stops and says it changed nothing', broken.state().status === 'wrong-screen' && /nothing was changed/.test(broken.state().error || ''), broken.state().error);

  console.log(failures ? `\n${failures} failing` : '\nall passing');
  process.exit(failures ? 1 : 0);
})();
