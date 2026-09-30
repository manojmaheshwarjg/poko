/* Screen check (G8): before acting on a step that came from a learned route, confirm
 * the live page is the screen that step was learned on.
 *
 * The server identifies screens by hashed feature keys: "H:<heading hash>" and
 * "<role>:<name hash>@<section hash>". This computes the same keys for the live page
 * with the same per-product key, so the comparison is exact. It is shared, and
 * covered by a parity test, because if browser and server ever computed keys
 * differently every check would fail and the copilot would refuse to act.
 *
 * Expected keys are the screen's DISTINCTIVE keys only (no global chrome), so a nav
 * rail present everywhere can never confirm the wrong screen. An empty expectation
 * fails closed: with nothing to confirm, the answer is no.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.CC = root.CC || {};
    root.CC.screencheck = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MIN_RATIO = 0.5;

  /* obs: a live observation from core/observer.js (clear text, never stored). */
  async function liveKeys(obs, key, hashLabel) {
    const keys = new Set();
    const screen = obs.screen || {};
    if (screen.heading) keys.add('H:' + (await hashLabel(key, screen.heading)));
    for (const n of obs.nodes || []) {
      if (!n.name) continue;
      const nameHash = await hashLabel(key, n.name);
      const withinHash = n.within ? await hashLabel(key, n.within) : '';
      keys.add(`${n.role}:${nameHash}@${withinHash}`);
    }
    return keys;
  }

  function overlap(expected, live) {
    const exp = Array.isArray(expected) ? expected : [];
    if (!exp.length) return { ok: false, matched: 0, of: 0, ratio: 0, reason: 'no expectation to check against' };
    const matched = exp.filter((k) => live.has(k)).length;
    const ratio = matched / exp.length;
    const ok = matched >= 1 && ratio >= MIN_RATIO;
    return { ok, matched, of: exp.length, ratio, reason: ok ? null : `only ${matched} of ${exp.length} expected features present` };
  }

  async function check(obs, expected, key, hashLabel) {
    return overlap(expected, await liveKeys(obs, key, hashLabel));
  }

  return { liveKeys, overlap, check, MIN_RATIO };
});
