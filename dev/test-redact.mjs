/* Redaction tests. The asymmetry drives the suite: a label wrongly hashed costs a
   little learning quality, a label wrongly sent in clear is a leak. So most cases
   here try to sneak personal data past the rules, and a smaller set checks that
   ordinary UI labels still get through in vendor mode. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../core/redact.js');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

const KEY = 'product-key-jira-mock';

/* 1. Personal-data patterns must fire */
for (const text of [
  'priya.sharma@acme.com',
  'Call +1 (415) 555-0132',
  'Account 88213749',
  'Refund $1,200',
  'Order €49',
  'Build 3f9a2c7d1e',
  'id 550e8400-e29b-41d4-a716-446655440000',
  'PAY-14: Fix login bug',
  'Due 2026-09-23',
  'Due 9/23/2026',
  'Card 4111 1111 1111 1111',
]) {
  check(`personal: ${JSON.stringify(text)}`, R.looksPersonal(text));
}

/* 2. Ordinary UI labels must not be mistaken for data */
for (const text of [
  'Project settings', 'Edit issues for Contractors', 'GPT OSS 120B', 'Qwen 3.8 27B',
  'Step 2 of 5', 'Remove Contractors', 'Actions', 'Settings', 'Accepted', 'Add people',
  'Function Calling / Tool Use', 'Use a different scheme',
]) {
  check(`not personal: ${JSON.stringify(text)}`, !R.looksPersonal(text));
}

/* 3. Structural rules */
check('button in chrome is safe', R.isSafeLabel({ text: 'Actions', role: 'button', region: 'chrome' }));
check('checkbox inside a table cell is not', !R.isSafeLabel({ text: 'Approve', role: 'checkbox', region: 'content' }));
check('row role is not eligible', !R.isSafeLabel({ text: 'Contractors 3 people', role: 'row', region: 'chrome' }));
check('over-long label is not', !R.isSafeLabel({ text: 'x'.repeat(61), role: 'button', region: 'chrome' }));
check('record-key heading is not', !R.isSafeLabel({ text: 'PAY-14: Fix login', role: 'heading', region: 'chrome' }));
check('textbox label is eligible', R.isSafeLabel({ text: 'Search', role: 'textbox', region: 'chrome' }));

/* 4. Modes */
{
  const base = { key: KEY, role: 'button', region: 'chrome' };
  const vendorSafe = await R.labelFor('Actions', { ...base, mode: 'vendor' });
  check('vendor: safe label goes in clear', vendorSafe.text === 'Actions' && !!vendorSafe.hash);

  const vendorUnsafe = await R.labelFor('priya@acme.com', { ...base, mode: 'vendor' });
  check('vendor: personal label is hashed', !('text' in vendorUnsafe) && !!vendorUnsafe.hash);

  const custUnpromoted = await R.labelFor('Actions', { ...base, mode: 'customer', promoted: new Set() });
  check('customer: safe but unpromoted is hashed', !('text' in custUnpromoted));

  const h = await R.hashLabel(KEY, 'Actions');
  const custPromoted = await R.labelFor('Actions', { ...base, mode: 'customer', promoted: new Set([h]) });
  check('customer: safe and promoted goes in clear', custPromoted.text === 'Actions');

  const ph = await R.hashLabel(KEY, 'priya@acme.com');
  const custPersonalPromoted = await R.labelFor('priya@acme.com', {
    ...base,
    mode: 'customer',
    promoted: new Set([ph]),
  });
  check('customer: promotion can never override personal data', !('text' in custPersonalPromoted));

  /* k-anonymity is evidence that a content-region label is structure, so it may
     lift the region heuristic. It may never lift the personal-data patterns. */
  const contentPromoted = await R.labelFor('Edit issues for Contractors', {
    key: KEY, role: 'checkbox', region: 'content', mode: 'customer',
    promoted: new Set([await R.hashLabel(KEY, 'Edit issues for Contractors')]),
  });
  check('customer: promotion may clear a content-region label', contentPromoted.text === 'Edit issues for Contractors');
  const contentUnpromoted = await R.labelFor('Edit issues for Contractors', {
    key: KEY, role: 'checkbox', region: 'content', mode: 'customer', promoted: new Set(),
  });
  check('customer: content-region label stays hashed until promoted', !('text' in contentUnpromoted));
  const contentPersonalPromoted = await R.labelFor('Approve PAY-14', {
    key: KEY, role: 'checkbox', region: 'content', mode: 'customer',
    promoted: new Set([await R.hashLabel(KEY, 'Approve PAY-14')]),
  });
  check('customer: promotion never clears personal data in a content region', !('text' in contentPersonalPromoted));

  const vendorContent = await R.labelFor('Edit issues for Contractors', {
    key: KEY, role: 'checkbox', region: 'content', mode: 'vendor',
  });
  check('vendor: content region hashed without attestation', !('text' in vendorContent));
  const vendorAttested = await R.labelFor('Edit issues for Contractors', {
    key: KEY, role: 'checkbox', region: 'content', mode: 'vendor', attested: true,
  });
  check('vendor: content region clear with attestation', vendorAttested.text === 'Edit issues for Contractors');
  const vendorAttestedPersonal = await R.labelFor('priya@acme.com', {
    key: KEY, role: 'checkbox', region: 'content', mode: 'vendor', attested: true,
  });
  check('vendor: attestation never clears personal data', !('text' in vendorAttestedPersonal));

  const unknownMode = await R.labelFor('Actions', { ...base, mode: 'anything-else', promoted: new Set() });
  check('unknown mode behaves like customer, not vendor', !('text' in unknownMode));
}

/* 5. Hashing */
{
  const a = await R.hashLabel(KEY, 'Edit issues for Contractors');
  const b = await R.hashLabel(KEY, '  edit   ISSUES for contractors ');
  const c = await R.hashLabel('another-product', 'Edit issues for Contractors');
  const d = await R.hashLabel(KEY, 'Edit issues for Developers');
  check('hash is stable across case and whitespace', a === b);
  check('hash differs across products', a !== c);
  check('hash differs across labels', a !== d);
  check('hash is 16 hex chars', /^[0-9a-f]{16}$/.test(a), a);
}

/* 6. URLs */
const url = [
  ['https://app.acme.com/projects/123/settings?tab=perms&q=priya', 'https://app.acme.com/projects/:id/settings'],
  ['https://app.acme.com/p/550e8400-e29b-41d4-a716-446655440000', 'https://app.acme.com/p/:id'],
  ['https://jira.acme.com/browse/PAY-14', 'https://jira.acme.com/browse/:key'],
  ['https://app.acme.com/users/priya%40acme.com/edit', 'https://app.acme.com/users/:email/edit'],
  ['https://app.acme.com/invite/a8Kf29xLq01Zp7Rt4', 'https://app.acme.com/invite/:id'],
  ['https://app.acme.com/#/projects/42/board?filter=mine', 'https://app.acme.com/#/projects/:id/board'],
  ['https://console.groq.com/home', 'https://console.groq.com/home'],
  ['http://localhost:4500/fixture/jira-mock.html?screen=access', 'http://localhost:4500/fixture/jira-mock.html'],
];
for (const [input, want] of url) {
  const got = R.normalizeUrl(input);
  check(`url ${input.slice(0, 48)}`, got === want, got === want ? '' : `got ${got}`);
}
check('invalid url returns null rather than throwing', R.normalizeUrl('not a url') === null);

/* 7. Whole observation */
{
  const obs = {
    screen: { url: 'https://app.acme.com/projects/9/settings?x=1', title: 'Settings', heading: 'PAY-14 details' },
    nodes: [
      { role: 'textbox', name: 'Search', value: 'priya salary', region: 'chrome', rect: { x: 1 } },
      { role: 'checkbox', name: 'Approve for Acme Corp', region: 'content', state: { checked: true } },
      { role: 'button', name: 'Save', region: 'chrome', within: 'Billing' },
    ],
  };
  const out = await R.redactObservation(obs, { key: KEY, mode: 'vendor', promoted: new Set() });
  const json = JSON.stringify(out);
  check('typed value is dropped', !json.includes('priya salary') && !('value' in out.nodes[0]));
  check('rects are dropped', !json.includes('"rect"'));
  check('state is kept', out.nodes[1].state?.checked === true);
  check('content-region label hashed even in vendor mode', !('text' in out.nodes[1].name));
  check('personal heading hashed', !('text' in out.heading));
  check('safe chrome label kept in vendor mode', out.nodes[2].name.text === 'Save');
  check('section is redacted too', out.nodes[2].within?.text === 'Billing' && !!out.nodes[2].within.hash);
  check('url normalised in the browser', out.url === 'https://app.acme.com/projects/:id/settings');
}

/* 8. Actions */
{
  const typed = await R.redactAction(
    { type: 'setValue', value: 'my password', target: { role: 'textbox', name: 'Password', region: 'chrome' } },
    { key: KEY, mode: 'vendor' }
  );
  check('setValue never carries what was typed', !JSON.stringify(typed).includes('my password') && !('value' in typed));
  const box = await R.redactAction(
    { type: 'setChecked', value: false, target: { role: 'checkbox', name: 'Edit issues', region: 'chrome' } },
    { key: KEY, mode: 'vendor' }
  );
  check('setChecked keeps its boolean', box.value === false);
}

/* 9. Server re-check: defence against a buggy or hostile client */
{
  const leaked = R.recheckLabel({ hash: 'abc', text: 'priya@acme.com' }, { role: 'button', region: 'chrome', mode: 'vendor' });
  check('server strips personal text a client sent anyway', !('text' in leaked) && leaked.hash === 'abc');
  const attestedServer = R.recheckLabel({ hash: 'abc', text: 'Edit issues for Contractors' }, { role: 'checkbox', region: 'content', mode: 'vendor', attested: false });
  check('server strips a content label from an unattested vendor install', !('text' in attestedServer));
  const unpromoted = R.recheckLabel({ hash: 'abc', text: 'Actions' }, { role: 'button', region: 'chrome', mode: 'customer', promoted: new Set() });
  check('server strips unpromoted text in customer mode', !('text' in unpromoted));
  const fine = R.recheckLabel({ hash: 'abc', text: 'Actions' }, { role: 'button', region: 'chrome', mode: 'vendor' });
  check('server keeps a safe vendor label', fine.text === 'Actions');
  check('server rejects a label with no hash', R.recheckLabel({ text: 'Actions' }, { role: 'button', mode: 'vendor' }) === null);
  check('server rejects a non-object label', R.recheckLabel('Actions', { role: 'button', mode: 'vendor' }) === null);
  const long = R.recheckLabel({ hash: 'a'.repeat(500) }, { role: 'button', mode: 'vendor' });
  check('server bounds an oversized hash', long.hash.length === 32);
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
