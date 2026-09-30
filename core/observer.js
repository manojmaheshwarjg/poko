/* Observer: derive a semantic (accessibility-shaped) view of the page.
   Deliberately NOT a DOM dump. We keep role + accessible name + state + rect,
   which is what a planner can reason over and what fits in a prompt. */
(function () {
  const CC = (window.CC = window.CC || {});

  const MAX_NAME = 120;
  const MAX_NODES = 250;

  /* Roles whose subtree is structure rather than a label. */
  const CONTAINER_ROLES = new Set(['main', 'navigation', 'dialog', 'menu', 'row', 'listitem']);

  const KEEP_ROLES = new Set([
    'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'menuitem',
    'menuitemcheckbox', 'tab', 'switch', 'option', 'heading', 'navigation',
    'main', 'dialog', 'menu', 'listitem', 'row',
  ]);

  function implicitRole(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'nav') return 'navigation';
    if (tag === 'main') return 'main';
    if (tag === 'dialog') return 'dialog';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
      if (t === 'hidden') return null;
      return 'textbox';
    }
    return null;
  }

  function roleOf(el) {
    const explicit = (el.getAttribute('role') || '').trim().toLowerCase();
    return explicit || implicitRole(el);
  }

  function clean(s) {
    return (s || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  }

  /* Every lookup goes through the element's own document, so the same functions
     read a page loaded in a same-origin frame (exploration, Phase G). */
  function docOf(el) {
    return el.ownerDocument || document;
  }

  function isVisible(el) {
    const style = (docOf(el).defaultView || window).getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (parseFloat(style.opacity) === 0) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }

  /* Simplified accname algorithm. Enough for Phase 0, and the order matches the
     spec closely enough that real apps resolve the way you'd expect. */
  function accessibleName(el) {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const t = labelledby
        .split(/\s+/)
        .map((id) => docOf(el).getElementById(id))
        .filter(Boolean)
        .map((n) => n.textContent)
        .join(' ');
      if (clean(t)) return clean(t);
    }
    const aria = clean(el.getAttribute('aria-label'));
    if (aria) return aria;

    if (el.id) {
      const lbl = docOf(el).querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl && clean(lbl.textContent)) return clean(lbl.textContent);
    }
    const wrapping = el.closest('label');
    if (wrapping && clean(wrapping.textContent)) return clean(wrapping.textContent);

    for (const attr of ['alt', 'title', 'placeholder']) {
      const v = clean(el.getAttribute(attr));
      if (v) return v;
    }
    if (el.tagName === 'INPUT') {
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (['submit', 'button', 'reset'].includes(t)) {
        const v = clean(el.value);
        if (v) return v;
      }
    }

    /* A landmark's subtree is the whole page. Naming it from its text produces a
       120 character blob that identifies nothing, so these are named only when
       the app labels them explicitly or they contain a heading. */
    if (CONTAINER_ROLES.has(roleOf(el))) {
      const heading = el.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
      return heading ? clean(collectText(heading)) : '';
    }

    /* Otherwise the element's own text. A card-shaped link legitimately takes the
       text of everything inside it, but when that is long and it contains a
       heading, the heading is what a person would call it. */
    const text = clean(collectText(el));
    if (text.length >= MAX_NAME) {
      const heading = el.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
      const short = heading ? clean(collectText(heading)) : '';
      if (short && short.length < text.length) return short;
    }
    return text;
  }

  /* textContent concatenates adjacent text nodes with nothing between them, so a
     heading followed by a paragraph came out as "Build Fast on GroqFast LLM
     inference". Joining the text nodes with a space keeps the name readable and,
     more importantly, matchable. */
  function collectText(el) {
    const walker = docOf(el).createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const parts = [];
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (t) parts.push(t);
    }
    return parts.join(' ');
  }

  /* Where customer data tends to live. Used only by redaction, as a heuristic that
     evidence can override (see core/redact.js), never to hide anything from the
     person using the page. `data-copilot-private` is the vendor's explicit opt-out
     and always wins. */
  const CONTENT_SELECTOR = [
    'td', '[role="cell"]', '[role="gridcell"]', 'article', '[role="article"]',
    'blockquote', 'pre', 'code', '[contenteditable="true"]', '[role="log"]', '[role="feed"]',
  ].join(', ');
  const NAV_CONTAINERS = 'nav, [role="navigation"], [role="menu"], [role="menubar"], [role="tablist"], [role="toolbar"]';

  function regionOf(el) {
    if (el.closest('[data-copilot-private]')) return 'content';
    if (el.closest(CONTENT_SELECTOR)) return 'content';
    /* A list item is data unless the list is a menu, a nav or a tab strip. */
    const li = el.closest('li, [role="listitem"]');
    if (li && !li.closest(NAV_CONTAINERS)) return 'content';
    return 'chrome';
  }

  /* The section an element sits in, used to tell apart controls that share a
     name. On a real page the same model button appeared four times under
     different category headings, and {role, name} cannot address that. */
  function sectionOf(el) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      const label = clean(node.getAttribute('aria-label'));
      if (label) return label.slice(0, 60);
      const heading = node.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
      if (heading && !el.contains(heading) && isVisible(heading)) {
        const t = clean(collectText(heading)).slice(0, 60);
        if (t) return t;
      }
    }
    return undefined;
  }

  function stateOf(el) {
    const state = {};
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') state.disabled = true;
    const expanded = el.getAttribute('aria-expanded');
    if (expanded !== null) state.expanded = expanded === 'true';
    const selected = el.getAttribute('aria-selected');
    if (selected !== null) state.selected = selected === 'true';
    const current = el.getAttribute('aria-current');
    if (current !== null && current !== 'false') state.current = true;
    if (el.type === 'checkbox' || el.type === 'radio') state.checked = !!el.checked;
    const ariaChecked = el.getAttribute('aria-checked');
    if (ariaChecked !== null) state.checked = ariaChecked === 'true';
    return Object.keys(state).length ? state : undefined;
  }

  /* Screen signature: what we use to tell "am I still where I thought I was".
     Phase 2 replaces this with a real signature from the UI map. */
  /* Must consider only what is on screen. In a single page app every screen
     lives in the DOM at once and all but one are hidden, so querySelector
     returns whichever comes first in document order rather than the one the
     user is looking at. That made the signature report a stale screen on every
     navigation. */
  function firstVisible(selector, doc) {
    for (const el of doc.querySelectorAll(selector)) {
      if (isVisible(el)) return el;
    }
    return null;
  }

  function screenSignature(doc) {
    const h1 = firstVisible('h1, [role="heading"][aria-level="1"]', doc);
    const marker = firstVisible('[data-screen]', doc);
    return {
      url: doc.URL,
      title: clean(doc.title),
      heading: h1 ? clean(h1.textContent) : null,
      screen: marker ? marker.getAttribute('data-screen') : null,
    };
  }

  function observe(root) {
    const doc = root || document;
    const nodes = [];
    const elements = [];
    let truncated = false;

    const all = doc.querySelectorAll('*');
    for (const el of all) {
      if (nodes.length >= MAX_NODES) {
        truncated = true;
        break;
      }
      const role = roleOf(el);
      if (!role || !KEEP_ROLES.has(role)) continue;
      if (!isVisible(el)) continue;
      const name = accessibleName(el);
      if (!name && role !== 'textbox') continue;

      const r = el.getBoundingClientRect();
      const id = nodes.length;
      elements.push(el);
      nodes.push({
        id,
        role,
        name,
        within: sectionOf(el),
        region: regionOf(el),
        value: el.value !== undefined && role === 'textbox' ? clean(el.value) : undefined,
        state: stateOf(el),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      });
    }

    /* Only the live page's elements are addressable. The copilot never acts inside
       a page it merely observed, so observing one must not replace this list. */
    if (doc === document) CC._elements = elements;
    return { screen: screenSignature(doc), nodes, truncated, at: Date.now() };
  }

  CC.observer = { observe, accessibleName, roleOf, isVisible, collectText, sectionOf, regionOf };
  CC.elementFor = (id) => (CC._elements || [])[id] || null;
})();
