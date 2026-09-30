/* Redaction: decides what may leave the browser in clear text.
 *
 * One file, loaded three ways: as a classic script in the page (window.CC.redact),
 * required by the Node tests, and imported by the service, which re-applies the
 * same rules on arrival (guarantee G4). A single source of truth matters here more
 * than anywhere else: two copies of a privacy rule drift, and the drift is a leak.
 *
 * The shape of a redacted label is always { hash } plus, only when allowed, { text }.
 * Hashes are HMAC-SHA256 under a per-product key, so the same label hashes the same
 * for every user of that product. The server builds its model of the product over
 * hashes; clear text exists only so the model has something to read.
 *
 * When in doubt, hash. A false positive costs some learning quality. A false
 * negative leaks a customer's data. Those are not symmetric, and every rule below
 * errs in the safe direction.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.CC = root.CC || {};
    root.CC.redact = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_CLEAR = 60;

  /* Roles whose label is usually part of the product rather than the customer's
     data. Being on this list is necessary, never sufficient. */
  const LABEL_ROLES = new Set([
    'button', 'link', 'menuitem', 'menuitemcheckbox', 'tab', 'checkbox', 'radio',
    'switch', 'option', 'combobox', 'heading', 'navigation', 'textbox', 'main',
    'dialog', 'menu', 'listitem',
  ]);

  /* Anything matching one of these is treated as data, whatever its role. */
  const PERSONAL = [
    /[\w.+-]+@[\w-]+\.[\w.-]+/,                 // email
    /\+?\d[\d\s().-]{7,}\d/,                    // phone-like
    /\d{5,}/,                                   // long number: ids, accounts, amounts
    /[$€£¥₹]\s?\d/,         // currency amount
    /\b[0-9a-f]{8,}\b/i,                        // hex id or hash
    /\b[0-9a-f]{8}-[0-9a-f]{4}-/i,              // uuid
    /\b[A-Z][A-Z0-9]+-\d+\b/,                   // record key like PAY-14
    /\b\d{4}-\d{2}-\d{2}\b/,                    // iso date
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,            // slash date
    /\b(?:\d[ -]?){13,19}\b/,                   // card-number-like
  ];

  function looksPersonal(text) {
    return PERSONAL.some((re) => re.test(text));
  }

  function normalizeLabel(text) {
    return String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /* Two kinds of rule, deliberately treated differently.

     The personal-data patterns are ABSOLUTE. Nothing overrides them: not consent,
     not popularity. A date or an amount can be common across every customer and
     still be data.

     The content-region rule is a HEURISTIC meaning "probably one customer's data".
     It can be overridden by evidence, and only by evidence: in customer mode, the
     same label seen from enough independent installs (k-anonymity); in vendor mode,
     an explicit attestation that the tenant holds no real data. */
  function isSafeLabel({ text, role, region }, { allowContent = false } = {}) {
    if (!text) return false;
    if (!LABEL_ROLES.has(role)) return false;
    if (text.length > MAX_CLEAR) return false;
    if (looksPersonal(text)) return false;
    if (region === 'content' && !allowContent) return false;
    return true;
  }

  function allowedClear({ text, role, region, hash, mode, promoted, attested }) {
    if (mode === 'vendor') return isSafeLabel({ text, role, region }, { allowContent: !!attested });
    /* Anything that is not explicitly vendor is treated as customer. Promotion is
       the only way to clear text there, and it may lift the region heuristic but
       never the personal-data patterns, which isSafeLabel still applies. */
    return !!(promoted && promoted.has(hash)) && isSafeLabel({ text, role, region }, { allowContent: true });
  }

  async function hmac(key, text) {
    const enc = new TextEncoder();
    const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]);
    const sig = await crypto.subtle.sign('HMAC', k, enc.encode(text));
    return [...new Uint8Array(sig)]
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function hashLabel(key, text) {
    return hmac(key, normalizeLabel(text));
  }

  /* mode 'vendor': the vendor's own demo tenant, with consent, so learning is fast.
       Content regions stay hashed unless the install attests the tenant holds no
       real data.
     mode 'customer' (and anything unrecognised): clear text only for a hash the
       server has seen from enough independent installs that it cannot be one
       customer's data. A label nobody else has seen is never sent in clear. */
  async function labelFor(text, { key, mode, role, region, promoted, attested }) {
    if (!text) return null;
    const hash = await hashLabel(key, text);
    return allowedClear({ text, role, region, hash, mode, promoted, attested }) ? { hash, text } : { hash };
  }

  /* URLs are normalised before they leave the browser, not after. Query strings are
     dropped entirely, since they carry searches, tokens and email addresses more
     often than they carry anything the model needs. Path segments that look like
     ids become placeholders. Hash-router paths are kept, their queries dropped. */
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function normalizeSegment(seg) {
    if (!seg) return seg;
    let s = seg;
    try {
      s = decodeURIComponent(seg);
    } catch {
      return ':id';
    }
    if (/^\d+$/.test(s)) return ':id';
    if (UUID.test(s)) return ':id';
    if (/^[0-9a-f]{8,}$/i.test(s)) return ':id';
    if (/^[A-Z][A-Z0-9]+-\d+$/.test(s)) return ':key';
    if (/@/.test(s)) return ':email';
    if (s.length >= 16 && /\d/.test(s) && /[a-z]/i.test(s)) return ':id';
    if (looksPersonal(s)) return ':id';
    return seg;
  }

  function normalizeUrl(href) {
    let u;
    try {
      u = new URL(href);
    } catch {
      return null;
    }
    const path = (p) => p.split('/').map(normalizeSegment).join('/');
    let out = u.origin + path(u.pathname);
    if (u.hash.startsWith('#/')) out += '#' + path(u.hash.slice(1).split('?')[0]);
    return out;
  }

  /* A whole observation. Typed values are dropped in every mode: whatever a person
     typed is theirs, and nothing downstream needs it. Rects are dropped too, since
     learning needs structure rather than pixels. */
  async function redactObservation(obs, opts) {
    const nodes = [];
    for (const n of obs.nodes || []) {
      const common = {
        role: n.role, region: n.region, promoted: opts.promoted, key: opts.key, mode: opts.mode, attested: opts.attested,
      };
      const name = await labelFor(n.name, common);
      const within = n.within ? await labelFor(n.within, { ...common, role: 'heading' }) : null;
      const out = { role: n.role, name };
      if (within) out.within = within;
      if (n.region) out.region = n.region;
      if (n.state) out.state = n.state;
      nodes.push(out);
    }
    const screen = obs.screen || {};
    const headingOpts = {
      role: 'heading', region: 'chrome', promoted: opts.promoted, key: opts.key, mode: opts.mode, attested: opts.attested,
    };
    return {
      url: screen.url ? normalizeUrl(screen.url) : null,
      title: screen.title ? await labelFor(screen.title, headingOpts) : null,
      heading: screen.heading ? await labelFor(screen.heading, headingOpts) : null,
      nodes,
      truncated: !!obs.truncated,
    };
  }

  async function redactAction(action, opts) {
    const t = action.target || {};
    const common = {
      role: t.role, region: t.region, promoted: opts.promoted, key: opts.key, mode: opts.mode, attested: opts.attested,
    };
    const out = {
      type: action.type,
      target: {
        role: t.role ?? null,
        name: await labelFor(t.name, common),
        within: t.within ? await labelFor(t.within, { ...common, role: 'heading' }) : null,
        region: t.region ?? null,
      },
    };
    /* A checkbox's intended state is structure, not data. Typed text never is. */
    if (action.type === 'setChecked' && typeof action.value === 'boolean') out.value = action.value;
    return out;
  }

  async function redactTransition(tr, opts) {
    return {
      at: tr.at,
      episode: tr.episode,
      seq: tr.seq,
      source: tr.source === 'copilot' ? 'copilot' : 'user',
      before: await redactObservation(tr.before, opts),
      action: await redactAction(tr.action, opts),
      after: await redactObservation(tr.after, opts),
    };
  }

  /* A copilot decision (Phase L): what the copilot proposed, what was on screen, and
     what the person did about it. The goal, the step's intent and its reasoning are
     never included: they are written from what the person typed. Only structure and
     labels leave, labels redacted like any other. */
  const DECISIONS = ['approved', 'failed', 'skipped', 'repaired', 'repair-failed', 'wrongScreen'];

  async function redactDecision(d, opts) {
    const kind = d.decision === 'approved' && d.ok === false ? 'failed' : d.decision;
    if (!DECISIONS.includes(kind)) return null;
    const common = { promoted: opts.promoted, key: opts.key, mode: opts.mode, attested: opts.attested };
    const label = (text, role, region) => (text ? labelFor(text, { ...common, role, region }) : null);
    const t = d.plannedTarget || null;
    const l = d.locatedAs || null;
    const s = d.screen || {};
    const a = d.action || null;
    return {
      at: typeof d.at === 'number' ? d.at : Date.now(),
      runId: String(d.runId || '').slice(0, 64),
      stepId: String(d.stepId || '').slice(0, 64),
      kind,
      url: s.url ? normalizeUrl(s.url) : null,
      heading: await label(s.heading, 'heading', 'chrome'),
      planned: t ? { role: t.role ?? null, name: await label(t.name, t.role || 'button'), within: await label(t.within, 'heading') } : null,
      located: l ? { role: l.role ?? null, name: await label(l.name, l.role) } : null,
      action: a ? { type: a.type, ...(a.type === 'setChecked' && typeof a.value === 'boolean' ? { value: a.value } : {}) } : null,
      route: typeof d.route === 'string' ? d.route.slice(0, 64) : null,
    };
  }

  /* Server-side re-check (G4). Given something that claims to be redacted, strip any
     clear text that should not be there and any field that should never exist. It
     cannot un-leak what was sent, but it guarantees nothing unsafe is stored or
     passed on, even from a buggy or hostile client. */
  function recheckLabel(label, { role, region, mode, promoted, attested }) {
    if (!label || typeof label !== 'object' || typeof label.hash !== 'string') return null;
    const hash = label.hash.slice(0, 32);
    if (typeof label.text !== 'string') return { hash };
    const ok = allowedClear({ text: label.text, role, region, hash, mode, promoted, attested });
    return ok ? { hash, text: label.text.slice(0, MAX_CLEAR) } : { hash };
  }

  return {
    MAX_CLEAR,
    LABEL_ROLES,
    looksPersonal,
    normalizeLabel,
    isSafeLabel,
    hashLabel,
    labelFor,
    normalizeUrl,
    normalizeSegment,
    redactObservation,
    redactAction,
    redactTransition,
    redactDecision,
    DECISIONS,
    recheckLabel,
  };
});
