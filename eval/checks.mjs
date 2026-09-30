/* Structural checks, shared by run.mjs (live) and recheck.mjs (stored results).
   Each returns null when fine, or a string describing what is wrong.

   The most valuable check here is target reachability. screens.json already
   knows every element the fixture can show, so a target naming something that
   exists nowhere is an invented control, and a target naming something real
   with the wrong role will fail to locate at runtime. The first version of this
   file checked roles against an allowed set instead, and passed a plan
   containing both faults. */

function knownElements(screens) {
  const byName = new Map();
  for (const [screenName, screen] of Object.entries(screens)) {
    for (const node of screen.nodes) {
      const key = node.name.toLowerCase();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push({ role: node.role, screen: screenName, name: node.name });
    }
  }
  return byName;
}

/* A target is reachable if some known element's name contains the target name
   (the matcher is a case-insensitive substring match) and the roles agree. */
function reachability(target, byName) {
  const wanted = target.name.toLowerCase();
  const matches = [];
  for (const [name, entries] of byName) {
    if (name.includes(wanted) || wanted.includes(name)) matches.push(...entries);
  }
  if (!matches.length) return { ok: false, reason: 'no element with that name exists on any known screen' };
  /* A null role is the planner correctly declining to guess about a screen it
     could not see. Only the name is checkable then, and that is the point. */
  if (target.role == null) return { ok: true };
  const roleMatches = matches.filter((m) => m.role === target.role);
  if (!roleMatches.length) {
    const roles = [...new Set(matches.map((m) => m.role))].join(', ');
    return { ok: false, reason: `exists as ${roles}, not ${target.role}` };
  }
  return { ok: true };
}

export function check(scenario, result, screens) {
  const problems = [];
  const expect = scenario.expect ?? {};
  const plan = result.plan;

  /* Outcome first. Getting the outcome wrong is the failure that matters most,
     because a plan labelled "plan" when it is really "partial" looks like
     success while quietly doing less than was asked. */
  const wanted = expect.outcome ?? 'plan';
  const got = result.outcome ?? (result.plan ? 'plan' : 'cannot');
  if (got !== wanted) {
    problems.push(`outcome "${got}", expected "${wanted}"${result.limitation ? `: ${result.limitation}` : ''}`);
    return problems;
  }
  if (got === 'cannot' || got === 'nothing_to_do') {
    if (!result.limitation) problems.push(`outcome "${got}" with no explanation of why`);
    return problems;
  }
  if (got === 'partial' && !result.limitation) {
    problems.push('outcome "partial" but nothing said about what is not covered');
  }
  /* An empty plan is the right answer when the goal is already satisfied, so it
     is only a problem where a change or a route was actually expected. */
  if (!plan || !plan.steps?.length) {
    if (expect.mutates === false) return problems;
    problems.push('no steps returned');
    return problems;
  }

  /* Reachability first: a plan full of targets that cannot be found is broken
     regardless of whether its shape is right. */
  if (screens) {
    const byName = knownElements(screens);
    plan.steps.forEach((step, i) => {
      const verdict = reachability(step.target, byName);
      if (!verdict.ok) {
        const role = step.target.role ?? 'no role';
        problems.push(`step ${i + 1} target "${step.target.name}" (${role}): ${verdict.reason}`);
      }
    });
  }

  /* Clicking a checkbox mutates too. Counting only setValue/setChecked as
     mutating mislabelled a plan that unchecked a box by clicking it. */
  const checkboxNames = new Set();
  if (screens) {
    for (const screen of Object.values(screens)) {
      for (const node of screen.nodes) {
        if (node.role === 'checkbox') checkboxNames.add(node.name.toLowerCase());
      }
    }
  }
  const hitsCheckbox = (step) => {
    const name = step.target.name.toLowerCase();
    return [...checkboxNames].some((c) => c.includes(name) || name.includes(c));
  };
  const mutating = plan.steps.filter((s) => s.action.type !== 'click' || hitsCheckbox(s));

  /* setChecked sets, click toggles. On a checkbox the difference matters,
     because a toggle silently does the opposite when the state is not what the
     planner assumed. The plan still works if the assumption held, so this is
     reported but is not by itself a structural failure. */
  plan.steps.forEach((step, i) => {
    if (step.action.type === 'click' && hitsCheckbox(step)) {
      problems.push(
        `step ${i + 1} clicks the checkbox "${step.target.name}" instead of using setChecked, which toggles rather than sets`
      );
    }
  });
  if (expect.mutates === false && mutating.length) {
    problems.push(`expected no changes, but the plan changes ${mutating.length} thing(s)`);
  }
  if (expect.mutates === true && !mutating.length && !expect.routeShouldReach) {
    problems.push('expected a change but the plan only navigates');
  }
  if (expect.maxSteps && plan.steps.length > expect.maxSteps) {
    problems.push(`${plan.steps.length} steps, expected at most ${expect.maxSteps}`);
  }
  /* "Must not touch" means must not CHANGE. A setChecked that matches the current
     state asserts it rather than altering it, and flagging that conflates a
     redundant step with a destructive one. Current state comes from screens.json,
     so the difference is knowable. */
  const currentChecked = new Map();
  if (screens) {
    for (const screen of Object.values(screens)) {
      for (const node of screen.nodes) {
        if (node.role === 'checkbox' && node.state && 'checked' in node.state) {
          currentChecked.set(node.name.toLowerCase(), node.state.checked);
        }
      }
    }
  }
  for (const name of expect.mustNotTouch ?? []) {
    const key = name.toLowerCase();
    const offending = plan.steps.filter((s) => {
      if (!s.target.name.toLowerCase().includes(key)) return false;
      if (s.action.type === 'setChecked' && currentChecked.get(key) === s.action.value) return false;
      return true;
    });
    if (offending.length) {
      problems.push(`changes "${name}", which the goal did not ask to change`);
    }
  }
  if (expect.routeShouldReach) {
    const reached = plan.steps.some((s) =>
      s.target.name.toLowerCase().includes(expect.routeShouldReach.toLowerCase())
    );
    if (!reached) problems.push(`never reaches "${expect.routeShouldReach}"`);
  }
  for (const word of expect.reasoningMustMention ?? []) {
    const said = plan.steps.some((s) => s.reasoning.toLowerCase().includes(word.toLowerCase()));
    if (!said) problems.push(`reasoning never mentions "${word}"`);
  }
  if (expect.finalCheckedState !== undefined) {
    const setters = plan.steps.filter((s) => s.action.type === 'setChecked');
    if (!setters.length) problems.push('no checkbox change at all');
    else if (setters.at(-1).action.value !== expect.finalCheckedState) {
      problems.push(`ends with checked=${setters.at(-1).action.value}, expected ${expect.finalCheckedState}`);
    }
  }
  return problems;
}
