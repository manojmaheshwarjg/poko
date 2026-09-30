/* Exploration link rules (Phase G). Most cases try to get a dangerous link past them. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const X = require('../core/explore-rules.js');

let failures = 0;
let count = 0;
const check = (label, ok, detail = '') => {
  count++;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
const PAGE = 'https://app.acme.com/projects/42/board';
const verdict = (link, page = PAGE, opts) => X.check(link, page, opts);

console.log('\nlinks that must never be opened');
for (const href of [
  '/logout', '/auth/sign-out', '/account/signout?next=/', '/users/sign_out', '/session/logOut', '/Logout',
  '/items/7/delete', '/items/7/Delete', '/items/7/%64elete', '/items/7/deleteItem', '/items/7/deletion',
  '/users/3/remove', '/team/9/deactivate', '/notifications/unsubscribe', '/subscriptions/5/cancelled',
  '/billing/checkout', '/cart/check-out', '/plans/pro/upgrade', '/payments', '/invoices/7',
  '/reports/export.csv', '/reports/exporter', '/files/9/download', '/invite/abc', '/share?doc=9',
  '/projects/42/archive', '/oauth/callback', '/sso/saml', '/admin/impersonate/12', '/settings/api-keys',
  '/settings/tokens', '/account/password', '/x?action=delete', '/x?do=reset', '/x?_method=DELETE',
  '/emails/3/verification', '/integrations/slack/disconnect', '/jobs/4/rerun', '/items/7/dropped',
  '/#/projects/42/delete', '/#!/logout',
]) {
  const v = verdict(href);
  check(`never opens ${href}`, !!v, v ? X.describe(v.reason, v.word) : 'OPENED');
}

console.log('\nlink text and attributes count too');
{
  const v = verdict({ href: '/session/end', text: 'Log out' });
  check('a URL labelled "Log out" is not opened', v && v.reason === 'unsafe', JSON.stringify(v));
  const w = verdict({ href: '/account/end', text: 'Log out' });
  check('even when the URL itself says nothing', w && w.reason === 'unsafe' && w.word === 'logout', JSON.stringify(w));
  check('a download link is not opened', verdict({ href: '/reports/q3', download: true })?.reason === 'download');
  check('a link wired to DELETE (Rails data-method) is not opened', verdict({ href: '/items/7', method: 'delete' })?.reason === 'action-link');
  check('a link that asks for confirmation is not opened', verdict({ href: '/items/7', confirm: true })?.reason === 'confirm');
  check('an explicit GET method is fine', verdict({ href: '/items/7', method: 'get' }) === null);
  check('a signature or nonce parameter is an action parameter',
    verdict('/items/7?sig=abc')?.reason === 'action-param' && verdict('/items/7?nonce=1')?.reason === 'action-param');
}

console.log('\nother reasons');
for (const [href, reason] of [
  ['https://evil.example/projects', 'offsite'],
  ['http://app.acme.com/projects', 'offsite'],
  ['mailto:help@acme.com', 'scheme'],
  ['javascript:void(0)', 'scheme'],
  ['/projects/42/board', 'self'],
  ['/projects/42/board#comments', 'self'],
  ['/x/%E0%A4%A', 'invalid'],
]) {
  const v = verdict(href);
  check(`skips ${href}: ${reason}`, v?.reason === reason, JSON.stringify(v));
}
check('scope limits exploration to a part of the product',
  verdict('/blog/post-1', PAGE, { scope: 'https://app.acme.com/projects/' })?.reason === 'scope' &&
  verdict('/projects/42/settings', PAGE, { scope: 'https://app.acme.com/projects/' }) === null);

console.log('\nordinary pages are opened');
for (const href of [
  '/projects', '/projects/42/settings', '/projects/42/issues', '/projects/42/settings/access',
  '/projects/42/settings/notifications', '/projects/42/permissions/edit', '/projects/new', '/help/getting-started',
  '/projects/42/board?tab=backlog', '/reports/payroll-summary', '/applications', '/activity', '/releases',
  '/#/projects/42/settings', '/keyboard-shortcuts', '/authors',
]) {
  const v = verdict(href);
  check(`opens ${href}`, v === null, v ? X.describe(v.reason, v.word) : '');
}
check('"payroll" is not "pay", "application" is not "apply"', !X.dangerousWord('payroll application'));
check('reasons name only words from the fixed list, never raw text', (() => {
  const v = verdict('/items/7/customerSecretName-DELETE-me');
  return v && X.DANGEROUS.includes(v.word);
})());

console.log('\none visit per pattern');
{
  const visited = new Set();
  const { allowed, skipped } = X.selectLinks(
    ['/items/1', '/items/2', '/items/3', '/items/1#top', '/projects', '/logout', { href: '/settings', text: 'Settings' }],
    PAGE, visited, 10
  );
  check('/items/1 opened, /items/2 and /3 not, /settings kept with its text',
    allowed.length === 3 && allowed[0].url.endsWith('/items/1') && allowed[1].url.endsWith('/projects') && allowed[2].text === 'Settings',
    allowed.map((a) => a.url).join(' '));
  check('the reasons are recorded', skipped.filter((s) => s.reason === 'seen').length === 3 && skipped.some((s) => s.word === 'logout'));
  const frag = X.selectLinks(['/docs#intro'], PAGE, new Set(), 10);
  check('a fragment is dropped from the URL opened', frag.allowed.length === 1 && frag.allowed[0].url === 'https://app.acme.com/docs', frag.allowed[0]?.url);
  check('patterns stay mapped across pages', X.selectLinks(['/items/99'], PAGE, visited, 10).allowed.length === 0);
  const capped = X.selectLinks(['/a', '/b', '/c'], PAGE, new Set(), 2);
  check('the page limit holds', capped.allowed.length === 2 && capped.skipped[0]?.reason === 'limit');
  const hash = X.selectLinks(['/#/projects/1/settings', '/#/projects/2/settings', '/#/projects/1/board'], 'https://app.acme.com/', new Set(), 10);
  check('hash routes keep their route and dedupe by pattern', hash.allowed.length === 2 && hash.allowed[0].url.endsWith('#/projects/1/settings'),
    hash.allowed.map((a) => a.url).join(' '));
}

console.log(failures ? `\n${failures} of ${count} failing` : `\nall passing (${count} assertions)`);
process.exit(failures ? 1 : 0);
