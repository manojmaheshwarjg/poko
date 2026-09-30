/* Phase M: vendor mode on a real product has to be earned with a one-time code. */
import { openDb } from '../service/lib/db.ts';
import { ingestBatch, productForOrigin, needsEnrollment } from '../service/lib/ingest.ts';
import { createEnrollment, enrollmentsFor } from '../service/lib/enroll.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
const register = (db: any, productId: string, install: Record<string, unknown>) =>
  ingestBatch(db, { productId, install, transitions: [] }) as any;

const db = openDb(':memory:');
const real = productForOrigin(db, 'https://app.acme.com');
const other = productForOrigin(db, 'https://other.example');
const local = productForOrigin(db, 'http://localhost:4500');

check('1. a real web origin needs enrollment; this machine does not', needsEnrollment('https://app.acme.com') && !needsEnrollment('http://localhost:4500') && !needsEnrollment('http://synthetic.localhost') && !needsEnrollment('http://127.0.0.1:8080'));
check('1. a claim of vendor mode without a code is refused', /enrollment code/.test(register(db, real.id, { id: 'install-noco-1', mode: 'vendor', attested: true }).error ?? ''));
check('1. and nothing about that install was stored', !(db.prepare('SELECT 1 FROM installs WHERE id = ?').get('install-noco-1')));
const { code } = createEnrollment(db, real.id);
check('2. a valid code registers the install in vendor mode', !register(db, real.id, { id: 'install-code-1', mode: 'vendor', attested: true, enrollment: code }).error
  && (db.prepare('SELECT mode, attested FROM installs WHERE id = ?').get('install-code-1') as any).mode === 'vendor');
check('2. a code works once', /already been used/.test(register(db, real.id, { id: 'install-code-2', mode: 'vendor', enrollment: code }).error ?? ''));
check('2. the install that spent it keeps working without it', !register(db, real.id, { id: 'install-code-1', mode: 'vendor', attested: true }).error);
const elsewhere = createEnrollment(db, other.id).code;
check('3. a code for another product does not work here', /no such code/.test(register(db, real.id, { id: 'install-code-3', mode: 'vendor', enrollment: elsewhere }).error ?? ''));
const stale = createEnrollment(db, real.id, { now: Date.now() - 10 * 86_400_000, ttlDays: 7 }).code;
check('3. an expired code does not work', /expired/.test(register(db, real.id, { id: 'install-code-4', mode: 'vendor', enrollment: stale }).error ?? ''));
check('3. a made-up code does not work', /no such code/.test(register(db, real.id, { id: 'install-code-5', mode: 'vendor', enrollment: 'enr_guess' }).error ?? ''));
check('4. customer mode never needs one', !register(db, real.id, { id: 'install-cust-9', mode: 'customer' }).error);
check('4. local development products are exempt', !register(db, local.id, { id: 'install-local-1', mode: 'vendor', attested: true }).error);
const stored = JSON.stringify(db.prepare('SELECT * FROM enrollments').all());
check('5. codes are stored as hashes only', !stored.includes(code) && !stored.includes(elsewhere));
check('5. the admin can see which codes were used, never the codes', enrollmentsFor(db, real.id).some((e) => e.used_by === 'install-code-1') && !JSON.stringify(enrollmentsFor(db, real.id)).includes('enr_'));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
