/* Executor: performs one approved action. Only ever called after a human
   approves the step. Actions are deliberately few; the planner has to express
   itself in this vocabulary, which keeps it inside what we can verify. */
(function () {
  const CC = (window.CC = window.CC || {});

  function fire(el, type, init) {
    el.dispatchEvent(new (type.startsWith('key') ? KeyboardEvent : MouseEvent)(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      ...init,
    }));
  }

  function click(el) {
    el.focus?.({ preventScroll: true });
    fire(el, 'pointerdown');
    fire(el, 'mousedown');
    fire(el, 'mouseup');
    el.click();
  }

  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    el.focus?.({ preventScroll: true });
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function act(el, action) {
    if (!el) return { ok: false, error: 'element is gone' };
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
      return { ok: false, error: 'element is disabled' };
    }
    try {
      switch (action.type) {
        case 'click':
          click(el);
          return { ok: true };
        case 'setValue':
          setValue(el, action.value ?? '');
          return { ok: true };
        case 'setChecked': {
          const want = !!action.value;
          const is = el.checked ?? el.getAttribute('aria-checked') === 'true';
          if (is !== want) click(el);
          return { ok: true, noop: is === want };
        }
        default:
          return { ok: false, error: `unknown action: ${action.type}` };
      }
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  CC.executor = { act };
})();
