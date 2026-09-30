/* Target matching. The shape accepted here is exactly what the Phase 1 planner
   will emit, so swapping the hardcoded plan for an LLM is a swap, not a rewrite.

   target = { role?, name?, within?, nameMatch?: 'contains'|'exact', nth?: number }

   `within` names the section the control sits in, for pages where the same name
   appears several times. It is scored, never filtered on: a guessed role that
   disqualified its own match is exactly how targeting failed before, and a
   guessed section would fail the same way. A wrong `within` should cost a match
   some rank, not eliminate it. */
(function () {
  const CC = (window.CC = window.CC || {});

  function norm(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  const INTERACTIVE = new Set([
    'button', 'link', 'checkbox', 'radio', 'combobox', 'menuitem',
    'menuitemcheckbox', 'tab', 'switch', 'option', 'textbox',
  ]);

  function score(node, target) {
    let s = 0;
    if (target.role) {
      if (node.role !== target.role) return -1;
      s += 2;
    } else if (INTERACTIVE.has(node.role)) {
      /* No role given, which means the planner had not seen the element. Prefer
         something clickable over the heading that happens to share its text. */
      s += 2;
    }
    if (target.name) {
      const a = norm(node.name);
      const b = norm(target.name);
      if (!a) return -1;
      if (a === b) s += 10;
      else if (target.nameMatch === 'exact') return -1;
      else if (a.includes(b)) s += 6 - Math.min(3, (a.length - b.length) / 40);
      else if (b.includes(a)) s += 3;
      else return -1;
    }
    if (target.within) {
      const inSection = norm(node.within);
      const wanted = norm(target.within);
      if (inSection && (inSection.includes(wanted) || wanted.includes(inSection))) {
        /* Big enough to separate identical names in different sections, which is
           the entire reason this field exists. */
        s += 5;
      } else {
        s -= 2;
      }
    }
    if (node.state && node.state.disabled) s -= 5;
    return s;
  }

  /* Returns { found, node, candidates, ambiguous }.
     Ambiguity is surfaced rather than silently resolved: in Phase 1 an ambiguous
     match is a signal the planner needs a better description, and we want to see
     it rather than paper over it. */
  function locate(observation, target) {
    const scored = observation.nodes
      .map((node) => ({ node, s: score(node, target) }))
      .filter((c) => c.s >= 0)
      .sort((a, b) => b.s - a.s);

    if (!scored.length) return { found: false, candidates: [] };

    if (typeof target.nth === 'number') {
      const pick = scored[target.nth];
      return pick
        ? { found: true, node: pick.node, candidates: scored.map((c) => c.node) }
        : { found: false, candidates: scored.map((c) => c.node) };
    }

    const top = scored[0];
    const ambiguous = scored.length > 1 && scored[1].s === top.s;
    return {
      found: true,
      node: top.node,
      ambiguous,
      candidates: scored.slice(0, 5).map((c) => c.node),
    };
  }

  CC.target = { locate, score };
})();
