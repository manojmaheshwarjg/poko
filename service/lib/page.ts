/* A plain result page for form posts that come without the console (an old bookmark,
   a script): what happened, and the way back. Light only, like the console. */
export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function resultPage(title: string, bodyHtml: string, back: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>:root{color-scheme:light;--bg:#f7f8fa;--card:#fff;--sunken:#f3f4f6;--border:#e5e7eb;--text:#111827;--dim:#6b7280;--accent:#4f46e5;--ok:#166534;--warn:#92400e;--bad:#991b1b}
body{margin:0;background:var(--bg);color:var(--text);font:13px/1.5 -apple-system,BlinkMacSystemFont,'SF Pro Text','Inter',system-ui,sans-serif}
main{max-width:640px;margin:48px auto;padding:0 16px}.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:20px}
h1{font-size:16px;margin:0 0 10px}p,li{color:var(--dim)}code{font:12px ui-monospace,'SF Mono',Menlo,monospace;background:var(--sunken);padding:2px 6px;border-radius:5px;overflow-wrap:anywhere}
.big{display:block;font-size:16px;padding:12px;margin:12px 0;border:1px solid var(--border)}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
ul{padding-left:20px}a{color:var(--accent)}</style></head><body><main><div class="card"><h1>${esc(title)}</h1>${bodyHtml}<p><a href="${esc(back)}">Back</a></p></div></main></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
