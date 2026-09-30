/* The with/without verdict (G9). Shared by eval/run.mjs, which prints it, and
   service/scripts/g9.mts, which acts on it, so what is printed is what is enforced.

   `results` is what run.mjs writes: one entry per scenario per mode, each with
   `useRoutes`, `problems` and the service's `result` (whose `knownOffered` lists the
   routes offered for that request). */
export function compareModes(results) {
  const withR = new Map(results.filter((r) => r.useRoutes).map((r) => [r.id, r]));
  const without = new Map(results.filter((r) => !r.useRoutes).map((r) => [r.id, r]));
  const pass = (r) => !!r && !r.problems.length;
  /* A request that never got an answer (rate limited past every retry, or the service
     down) says nothing about the plan. Counted as a failure it could fake a regression,
     so a scenario where either side went unanswered is left out of the verdict. */
  const unanswered = (r) => !r || !!(r.result && r.result.error);
  const ids = [...withR.keys()];
  const inconclusive = ids.filter((id) => unanswered(withR.get(id)) || unanswered(without.get(id)));
  const decided = ids.filter((id) => !inconclusive.includes(id));
  const regressed = decided.filter((id) => pass(without.get(id)) && !pass(withR.get(id)));
  const improved = decided.filter((id) => !pass(without.get(id)) && pass(withR.get(id)));
  const offered = (id) => (withR.get(id) && withR.get(id).result && withR.get(id).result.knownOffered) || [];
  return {
    /* Only a run with both modes for every scenario can decide anything. */
    complete: withR.size > 0 && withR.size === without.size && ids.every((id) => without.has(id)),
    docsOnly: { passed: [...without.values()].filter(pass).length, of: without.size },
    withRoutes: { passed: [...withR.values()].filter(pass).length, of: withR.size },
    followed: [...withR.values()].filter((r) => r.followedRoute).length,
    regressed,
    improved,
    inconclusive,
    /* Every route offered anywhere with routes on, and those offered where it got worse. */
    tested: [...new Set(ids.flatMap(offered))],
    implicated: [...new Set(regressed.flatMap(offered))],
  };
}
