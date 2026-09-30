/* How long a rate-limited request says to wait, from the provider's message:
   "Please try again in 3.915s", "... in 7m12.5s", "... in 1h2m3s", "... in 450ms".
   Returns milliseconds, or null when the message gives no hint. */
export function parseWait(message) {
  const m = /try again in ((?:[\d.]+(?:ms|h|m|s))+)/.exec(String(message));
  if (!m) return null;
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  let total = 0;
  for (const [, n, u] of m[1].matchAll(/([\d.]+)(ms|h|m|s)/g)) total += parseFloat(n) * unit[u];
  return Math.round(total);
}

/* A per-minute limit clears in seconds and is worth waiting out. Anything longer is a
   daily limit, where every request after this one fails too: stop, do not hammer. */
export const LONG_WAIT_MS = 2 * 60_000;
