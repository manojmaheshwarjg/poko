/* Durable record of every decision a human made about a suggestion.
 *
 * This is deliberately separate from the runner's in-memory log. That one is UI
 * state, scoped to the current plan and cleared on reset, which is correct for
 * rendering ticks next to steps. It is the wrong shape for the thing this log is
 * actually for: approvals and rejections are the signal on intent versus optimal
 * path, and that only has value if it outlives the session it was produced in.
 *
 * Storage is whatever the host offers. chrome.storage.local in the extension so
 * it survives the side panel closing, localStorage in the dev harness. Both can
 * throw or come back empty (private windows, cleared site data, a panel opened
 * before the extension settled), so every path is guarded and a failure to
 * record never blocks the action the user approved.
 */
(function () {
  const CC = (window.CC = window.CC || {});

  const KEY = 'cc-journal';
  const LIMIT = 1000;

  const backend = (() => {
    const hasChrome =
      typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    if (hasChrome) {
      return {
        name: 'chrome.storage.local',
        async read() {
          const got = await chrome.storage.local.get(KEY);
          return got[KEY] || [];
        },
        async write(entries) {
          await chrome.storage.local.set({ [KEY]: entries });
        },
      };
    }
    return {
      name: 'localStorage',
      async read() {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : [];
      },
      async write(entries) {
        localStorage.setItem(KEY, JSON.stringify(entries));
      },
    };
  })();

  async function all() {
    try {
      const entries = await backend.read();
      return Array.isArray(entries) ? entries : [];
    } catch {
      return [];
    }
  }

  /* Append never rejects. A storage failure loses one row; throwing here would
     break the approve path, which is a far worse trade. */
  async function append(entry) {
    try {
      const entries = await all();
      entries.push({ at: Date.now(), ...entry });
      /* Oldest first out. The recent tail is what a later session wants. */
      await backend.write(entries.slice(-LIMIT));
      return true;
    } catch {
      return false;
    }
  }

  async function count() {
    return (await all()).length;
  }

  async function clear() {
    try {
      await backend.write([]);
      return true;
    } catch {
      return false;
    }
  }

  async function download() {
    const entries = await all();
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `copilot-decisions-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return entries.length;
  }

  CC.journal = { append, all, count, clear, download, backend: backend.name, LIMIT };
})();
