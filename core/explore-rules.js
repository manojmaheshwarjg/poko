/* Which links read-only exploration may open (Phase G).
 *
 * Exploration loads pages of a signed-in product on its own, so the rule is: when in
 * doubt, do not open it. A link is opened only if it is an http(s) link on the same
 * origin, inside the scope, not the page itself, not wired to an action, and no word
 * in its path, query or text suggests it could change, end, pay for, send or export
 * something. Only one URL per normalised pattern is opened: the goal is to find
 * SCREENS, not to walk every record.
 *
 * A GET is supposed to be safe. The deny-list exists because in real products it is
 * not always: sign-out links, one-click unsubscribe, legacy delete links, exports.
 *
 * Shared by the explorer in the browser, the Node tests and the server, so the rules
 * that are tested are the rules that run. */
(function (root, factory) {
  const redact =
    root && root.CC && root.CC.redact ? root.CC.redact : typeof require === 'function' ? require('./redact.js') : null;
  const api = factory(redact);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.CC = root.CC || {};
    root.CC.exploreRules = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (redact) {
  /* Base words. Each also matches its inflections (deletes, deleted, deleting,
     deletion) wherever it appears as a word: in the path, the query or the link's
     text, including camelCase and split spellings (logOut, log-out, log_out).

     Deliberately broad. A false positive only means a screen is not pre-mapped, and
     real use maps it later. Nouns that name ordinary list pages (releases, reports,
     orders, runs, tests) are left out on purpose; words about sessions, secrets and
     money are not. */
  const GROUPS = {
    session: [
      'logout', 'logoff', 'signout', 'signoff', 'login', 'logon', 'signin', 'signup', 'register', 'session',
      'exit', 'quit', 'auth', 'authorize', 'authorise', 'oauth', 'sso', 'saml', 'callback', 'impersonate',
      'masquerade', 'sudo', 'become', 'switch',
    ],
    secrets: ['token', 'password', 'passwd', 'credential', 'secret', 'key', 'api', 'webhook'],
    money: [
      'pay', 'paid', 'payment', 'payout', 'checkout', 'purchase', 'buy', 'bought', 'billing', 'invoice',
      'subscribe', 'subscription', 'unsubscribe', 'upgrade', 'downgrade', 'refund', 'charge', 'transfer',
      'withdraw', 'deposit', 'donate',
    ],
    destructive: [
      'delete', 'destroy', 'remove', 'revoke', 'revocation', 'purge', 'erase', 'wipe', 'drop', 'trash', 'discard',
      'clear', 'truncate', 'kill', 'abort', 'terminate', 'deactivate', 'disable', 'suspend', 'block', 'unlink',
      'disconnect', 'detach', 'uninstall', 'leave', 'close', 'cancel',
    ],
    outward: [
      'download', 'export', 'print', 'backup', 'dump', 'share', 'invite', 'publish', 'unpublish', 'send', 'sent',
      'resend', 'broadcast',
    ],
    changes: [
      'confirm', 'approve', 'reject', 'accept', 'decline', 'verify', 'reset', 'restore', 'undo', 'redo', 'revert',
      'rollback', 'archive', 'unarchive', 'toggle', 'enable', 'activate', 'reactivate', 'lock', 'unlock', 'follow',
      'unfollow', 'watch', 'unwatch', 'vote', 'like', 'unlike', 'mute', 'unmute', 'join', 'rerun', 'execute',
      'exec', 'trigger', 'redeploy', 'restart', 'reboot', 'stop', 'pause', 'resume', 'retry', 'sync', 'refresh',
      'reindex', 'rebuild', 'import', 'generate', 'regenerate', 'rotate', 'migrate', 'merge', 'assign',
      'unassign', 'promote', 'demote', 'grant', 'move', 'copy', 'clone', 'duplicate', 'convert', 'apply',
      'submit', 'save', 'ping',
    ],
  };
  const DANGEROUS = Object.values(GROUPS).flat();

  /* Every inflection of every base word, mapped back to its base. Over-generation
     ("deleteed") is harmless; a missed form ("deletion") is not. */
  function inflections(base) {
    const out = new Set([base]);
    for (const s of ['s', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'ion', 'ions', 'al', 'ment', 'ments', 'ation', 'ations']) out.add(base + s);
    if (base.endsWith('e')) {
      for (const s of ['ing', 'ion', 'ions', 'ation', 'ations', 'al', 'er', 'ers']) out.add(base.slice(0, -1) + s);
    }
    if (base.endsWith('y')) for (const s of ['ies', 'ied', 'ier']) out.add(base.slice(0, -1) + s);
    /* verify -> verification. Only -fy verbs: apply -> application is an ordinary page. */
    if (base.endsWith('fy')) for (const s of ['fication', 'fications']) out.add(base.slice(0, -2) + s);
    /* drop -> dropped, cancel -> cancelled. */
    const last = base[base.length - 1];
    if (!/[aeiouy]/.test(last)) for (const s of ['ed', 'ing', 'er']) out.add(base + last + s);
    return out;
  }
  const WORD_TO_BASE = new Map();
  for (const base of DANGEROUS) for (const w of inflections(base)) if (!WORD_TO_BASE.has(w)) WORD_TO_BASE.set(w, base);

  /* Words from free text: camelCase split, then anything that is not a letter or a
     digit separates. Each word is checked, and so is each adjacent pair joined, which
     catches log-out, sign_in and checkOut without listing every spelling. */
  function words(text) {
    return String(text || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  function dangerousWord(text) {
    const ws = words(text);
    for (let i = 0; i < ws.length; i++) {
      if (WORD_TO_BASE.has(ws[i])) return WORD_TO_BASE.get(ws[i]);
      if (i + 1 < ws.length && WORD_TO_BASE.has(ws[i] + ws[i + 1])) return WORD_TO_BASE.get(ws[i] + ws[i + 1]);
    }
    return null;
  }

  /* Query parameters that mean "do something" whatever their value. */
  const ACTION_PARAMS = /[?&](action|do|op|cmd|command|method|_method|task|confirm|token|key|signature|sig|nonce|csrf)=/i;

  const REASONS = {
    invalid: 'not a valid link',
    scheme: 'not a web link',
    offsite: 'another site',
    scope: 'outside the part of the product being explored',
    self: 'the page itself',
    download: 'a download link',
    'action-link': 'wired to an action rather than a page',
    confirm: 'asks for confirmation when clicked',
    unsafe: 'looks like it could change something',
    'action-param': 'carries an action parameter',
    seen: 'a page of this kind is already mapped',
    limit: 'over the page limit',
    unvisited: 'not opened before the run ended',
  };

  function describe(reason, word) {
    const text = REASONS[reason] || reason;
    return word ? `${text} (${word})` : text;
  }

  /* Hash-router apps put the route after "#/"; that part is the page. Any other
     fragment is a place on the same page. */
  function isHashRoute(hash) {
    return hash.startsWith('#/') || hash.startsWith('#!/');
  }

  function pageKey(u) {
    return u.origin + u.pathname + u.search + (isHashRoute(u.hash) ? u.hash : '');
  }

  function decode(s) {
    try {
      return decodeURIComponent(s);
    } catch {
      return null;
    }
  }

  /* One link, as the explorer read it from the page:
       { href, text, download, method, confirm }
     `href` is enough; the rest makes the check stricter, never looser.
     Returns null when the link may be opened, or { reason, word? }. */
  function check(link, pageUrl, opts = {}) {
    const l = typeof link === 'string' ? { href: link } : link || {};
    let u;
    let page;
    try {
      page = new URL(pageUrl);
      u = new URL(l.href, page);
    } catch {
      return { reason: 'invalid' };
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { reason: 'scheme' };
    if (u.origin !== page.origin) return { reason: 'offsite' };
    const scope = opts.scope || page.origin + '/';
    if (!(u.origin + u.pathname).startsWith(scope)) return { reason: 'scope' };
    if (pageKey(u) === pageKey(page)) return { reason: 'self' };
    if (l.download) return { reason: 'download' };
    const method = String(l.method || '').toLowerCase();
    if (method && method !== 'get') return { reason: 'action-link' };
    if (l.confirm) return { reason: 'confirm' };

    const path = decode(u.pathname);
    const query = decode(u.search);
    const route = isHashRoute(u.hash) ? decode(u.hash) : '';
    if (path === null || query === null || route === null) return { reason: 'invalid' };
    const word = dangerousWord(`${path} ${query} ${route} ${l.text || ''}`);
    if (word) return { reason: 'unsafe', word };
    if (ACTION_PARAMS.test(u.search) || ACTION_PARAMS.test(route.replace(/^[^?]*/, ''))) return { reason: 'action-param' };
    return null;
  }

  /* The screen a URL would show, for "one visit per pattern". Uses the same URL
     normaliser as redaction, so /items/1 and /items/2 are one pattern. */
  function patternOf(href) {
    const n = redact && redact.normalizeUrl ? redact.normalizeUrl(href) : null;
    return n || href;
  }

  /* The links from one page, in document order. `visited` holds the patterns already
     opened or queued and is updated in place. `limit` is how many more may be queued. */
  function selectLinks(links, pageUrl, visited, limit, opts = {}) {
    const allowed = [];
    const skipped = [];
    for (const link of links) {
      const l = typeof link === 'string' ? { href: link } : link;
      const verdict = check(l, pageUrl, opts);
      if (verdict) {
        skipped.push({ href: l.href, ...verdict });
        continue;
      }
      const u = new URL(l.href, pageUrl);
      if (!isHashRoute(u.hash)) u.hash = '';
      const url = u.toString();
      const pattern = patternOf(url);
      if (visited.has(pattern)) {
        skipped.push({ href: l.href, reason: 'seen' });
        continue;
      }
      if (allowed.length >= limit) {
        skipped.push({ href: l.href, reason: 'limit' });
        continue;
      }
      visited.add(pattern);
      allowed.push({ ...l, url, text: l.text || '' });
    }
    return { allowed, skipped };
  }

  return { check, describe, dangerousWord, words, patternOf, selectLinks, isHashRoute, REASONS, DANGEROUS, GROUPS };
});
