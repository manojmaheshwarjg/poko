/* What counts as a claim of scope ("in this project", "only for this team"), used on
   both sides of a learned route, so the two can never disagree:
     - a route's label may not promise a scope its steps do not establish (verify.ts);
     - a route is not offered to a request that asks for a scope its steps do not
       establish (known.ts).
   The first G9 runs are why: a route that edits a scheme shared by every project,
   offered to "only for this project", made the planner follow it or give up, whatever
   the route was called. A route that itself copies, duplicates or creates the narrower
   thing does establish the scope, and a route that only goes somewhere changes nothing,
   so neither is affected. */
import type { StoredAction } from './graph.ts';

const CONTAINERS = 'project|space|workspace|team|board|repo|repository|organization|organisation|org|site|account|tenant|environment';
const SCOPE = new RegExp(
  `\\b(?:in|for|within|inside|on) (?:this|the current|our|my|only this|just this) (?:${CONTAINERS})\\b|\\b(?:only|just) (?:in|for|within|on) (?:this|the current|our|my|one)\\b`,
  'i'
);
const CREATES_SCOPE = /\b(copy|copies|duplicate|clone|create|new)\b/i;

/* The scope phrase in a label or request, or null. */
export function claimedScope(text: string): string | null {
  const m = String(text ?? '').match(SCOPE);
  return m ? m[0] : null;
}

/* Whether a route's own steps create the narrower thing a scope claim needs. */
export function establishesScope(route: { kind: string; path_json: string }): boolean {
  if (route.kind === 'destination') return true;
  const steps = JSON.parse(route.path_json) as Array<{ action: StoredAction }>;
  return steps.some((s) => CREATES_SCOPE.test(s.action.target.name?.text ?? ''));
}
