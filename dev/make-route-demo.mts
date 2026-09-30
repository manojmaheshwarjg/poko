/* Builds dev/responses/route-check.json from the real fixture product: a plan whose
   one step was "learned on Board", carrying Board's real distinctive keys. Replayed
   in the harness on different stages to see the screen check pass and refuse. */
import { writeFileSync } from 'node:fs';
import { openDb } from '../service/lib/db.ts';

const db = openDb('service/data/copilot.db');
const p = db.prepare("SELECT id FROM products WHERE origin = 'http://localhost:4500'").get() as { id: string };
const board = db.prepare("SELECT id, display_name, distinctive_keys_json FROM screens WHERE product_id = ? AND display_name = 'Board'").get(p.id) as any;
if (!board) throw new Error('no Board screen learned yet');
const keys = JSON.parse(board.distinctive_keys_json) as string[];
const plan = {
  outcome: 'plan',
  goal: 'Open this project’s settings',
  understood: 'Open this project’s settings',
  limitation: null,
  plan: {
    id: 'demo-route-check', tool: 'jira', goal: 'Open this project’s settings', outcome: 'plan', limitation: null,
    route: { id: 'r_demo_route_check', pathHash: 'p_demo', label: 'Open the project settings' },
    steps: [{
      id: 's1',
      intent: 'Open Project settings',
      reasoning: 'Learned from people starting on the Board. The link exists on every screen, so only the screen check can tell whether this is the context it was learned in.',
      target: { role: 'link', name: 'Project settings' },
      action: { type: 'click' },
      expect: { screenId: board.id, screenName: board.display_name, keys },
    }],
  },
};
writeFileSync('dev/responses/route-check.json', JSON.stringify(plan, null, 2) + '\n');
console.log(`route-check.json written: expects ${board.display_name} (${keys.length} distinctive keys)`);
