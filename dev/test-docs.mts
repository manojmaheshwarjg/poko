/* Docs ingestion tests against an in-process HTTP server that records every request.
   "Robots respected" is checked at the request level: a disallowed page must never be
   asked for, not merely fetched and then discarded. No external site is contacted. */
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extract, decodeEntities } from '../service/lib/docs/extract.ts';
import { crawl, parseRobots, allowedByRobots, writeCorpus } from '../service/lib/docs/crawl.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

const page = (title: string, main: string, extra = '') => `<!doctype html><html><head><title>${title} | Acme Docs</title>
<script>window.analytics = "SECRET_TRACKER_TOKEN";</script><style>.x{color:red}</style></head>
<body><header>Acme header BANNER</header><nav><a href="/docs/index.html">Home</a> <a href="/pricing">Pricing NAVLINK</a></nav>
<main>${main}</main>${extra}<footer>Copyright FOOTERTEXT</footer></body></html>`;
const filler = 'This paragraph exists so the page carries enough real content to be worth keeping in the corpus, rather than being skipped as thin. '.repeat(3);

const SITE: Record<string, { status?: number; type?: string; body?: string; location?: string }> = {
  '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /docs/private/\nAllow: /docs/private/public-note.html\n' },
  '/docs/index.html': { body: page('Getting started', `<h1>Getting started</h1><p>${filler}</p>
    <a href="permissions.html">Permissions</a> <a href="access.html#top">Access</a> <a href="private/secret.html">Secret</a>
    <a href="private/public-note.html">Note</a> <a href="guide.pdf">PDF</a> <a href="https://external.example/page">External</a>
    <a href="/pricing">Pricing</a> <a href="thin.html">Thin</a> <a href="deep/l1.html">Deep</a> <a href="redirect.html">Moved</a>`) },
  '/docs/permissions.html': { body: page('Permissions', `<h1>Permissions</h1><p>${filler}</p><h2>Schemes</h2>
    <p>Schemes are shared &amp; reused. Use &lt;Edit&gt; carefully, it&#39;s&nbsp;global.</p>
    <pre>line one
  line two indented</pre><ul><li>Browse projects</li><li>Edit issues</li></ul>`) },
  '/docs/access.html': { body: page('Access', `<article><h1>Access</h1><h2>Membership</h2><p>${filler}</p></article>`) },
  '/docs/private/secret.html': { body: page('Secret', `<h1>Secret</h1><p>${filler} DO NOT CRAWL</p>`) },
  '/docs/private/public-note.html': { body: page('Public note', `<h1>Public note</h1><p>${filler}</p>`) },
  '/docs/thin.html': { body: page('Thin', `<h1>Thin</h1><p>Too short.</p>`) },
  '/docs/deep/l1.html': { body: page('L1', `<h1>L1</h1><p>${filler}</p><a href="l2.html">next</a>`) },
  '/docs/deep/l2.html': { body: page('L2', `<h1>L2</h1><p>${filler}</p><a href="l3.html">next</a>`) },
  '/docs/deep/l3.html': { body: page('L3', `<h1>L3</h1><p>${filler}</p><a href="l4.html">next</a>`) },
  '/docs/deep/l4.html': { body: page('L4', `<h1>L4</h1><p>${filler}</p>`) },
  '/docs/redirect.html': { status: 302, location: '/pricing' },
  '/pricing': { body: page('Pricing', `<h1>Pricing</h1><p>${filler}</p>`) },
};

async function serve(site: typeof SITE): Promise<{ base: string; requests: string[]; close: () => void }> {
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    requests.push(path);
    const r = site[path];
    if (!r) { res.writeHead(404); res.end('nope'); return; }
    if (r.location) { res.writeHead(r.status ?? 302, { location: r.location }); res.end(); return; }
    res.writeHead(r.status ?? 200, { 'content-type': r.type ?? 'text/html; charset=utf-8' });
    res.end(r.body ?? '');
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  const { port } = server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}`, requests, close: () => server.close() };
}

/* 1. extraction */
{
  const e = extract(SITE['/docs/permissions.html'].body!, 'http://x/docs/permissions.html');
  check('1. title from the first heading', e.title === 'Permissions');
  check('1. scripts never reach the corpus', !e.markdown.includes('SECRET_TRACKER_TOKEN') && !e.markdown.includes('color:red'));
  check('1. site header, nav and footer are dropped', !/BANNER|NAVLINK|FOOTERTEXT/.test(e.markdown));
  check('1. sections become ## headings', e.markdown.includes('## Schemes'));
  check('1. entities decoded', e.markdown.includes("Schemes are shared & reused. Use <Edit> carefully, it's global."), e.markdown.split('\n').find((l) => l.startsWith('Schemes')) ?? '');
  check('1. preformatted text keeps its lines', e.markdown.includes('line one\n  line two indented'));
  check('1. list items survive', e.markdown.includes('Browse projects') && e.markdown.includes('Edit issues'));
  check('1. numeric entities', decodeEntities('&#65;&#x42;') === 'AB');
  const noMain = extract('<html><body><nav>NAVX</nav><h1>T</h1><p>Body text here.</p></body></html>', 'http://x/');
  check('1. pages without <main> still extract, minus nav', noMain.markdown.includes('Body text here.') && !noMain.markdown.includes('NAVX'));
}

/* 2. robots parsing */
{
  const rules = parseRobots('User-agent: *\nDisallow: /a/\nAllow: /a/ok\n\nUser-agent: CopilotDocsBot\nDisallow: /b/\n', 'ContextualCopilotDocsBot/0.1');
  check('2. a group naming this crawler wins over *', rules.length === 1 && rules[0].path === '/b/');
  const star = parseRobots('User-agent: *\nDisallow: /a/\nAllow: /a/ok\n', 'SomeoneElse');
  check('2. longest match wins: specific allow beats broad disallow', allowedByRobots('/a/ok', star) && !allowedByRobots('/a/other', star));
}

/* 3. a full crawl */
{
  const s = await serve(SITE);
  const r = await crawl({ start: `${s.base}/docs/index.html`, delayMs: 0, maxPages: 40, maxDepth: 3 });
  s.close();
  const got = r.pages.map((p) => new URL(p.url).pathname).sort();
  /* maxDepth 3: index is depth 0, so l1..l3 are fetched and l4 never is. */
  check('3. the right pages were kept', got.join(',') === '/docs/access.html,/docs/deep/l1.html,/docs/deep/l2.html,/docs/deep/l3.html,/docs/index.html,/docs/permissions.html,/docs/private/public-note.html', got.join(','));
  check('3. a robots-disallowed page was never even requested', !s.requests.includes('/docs/private/secret.html'));
  check('3. but the explicitly allowed page inside it was', s.requests.includes('/docs/private/public-note.html'));
  check('3. out-of-scope pages were never requested, not even through a redirect', !s.requests.includes('/pricing'), s.requests.filter((x) => x === '/pricing').length + ' requests');
  check('3. a PDF link was never requested', !s.requests.includes('/docs/guide.pdf'));
  check('3. a thin page was fetched but not kept', s.requests.includes('/docs/thin.html') && r.skipped.some((x) => /too little/.test(x.reason) && x.url.endsWith('thin.html')));
  check('3. the depth limit held', !s.requests.includes('/docs/deep/l4.html'));
  check('3. a redirect out of scope is refused', r.skipped.some((x) => x.url.endsWith('redirect.html') && /redirected outside/.test(x.reason)));
  check('3. the external link was skipped, not followed', r.skipped.some((x) => x.url.startsWith('https://external.example')));
  check('3. the fragment link did not cause a second fetch', s.requests.filter((x) => x === '/docs/access.html').length === 1);
}

/* 3a. a page linked only from the sidebar is still found, but sidebar text is not kept */
{
  const site = { ...SITE, '/docs/index.html': { body: `<html><body><aside><a href="sidebar-only.html">Only in the sidebar</a> SIDEBARTEXT</aside><main><h1>Start</h1><p>${filler}</p></main></body></html>` },
    '/docs/sidebar-only.html': { body: page('Sidebar only', `<h1>Sidebar only</h1><p>${filler}</p>`) } };
  const s = await serve(site);
  const r = await crawl({ start: `${s.base}/docs/index.html`, delayMs: 0 });
  s.close();
  check('3a. a page reachable only from the sidebar is crawled', r.pages.some((p) => p.url.endsWith('/docs/sidebar-only.html')));
  check('3a. but the sidebar text never reaches the corpus', r.pages.every((p) => !p.markdown.includes('SIDEBARTEXT')));
  check('3a. links inside a script are never followed', !extract('<script>var a = "<a href=/x>";</script><main><p>t</p></main>', 'http://h/').links.length);
}

/* 3b. an in-scope redirect is followed, through the normal checks */
{
  const site = { ...SITE, '/docs/old.html': { status: 301, location: '/docs/permissions.html' },
    '/docs/index.html': { body: page('Start', `<h1>Start</h1><p>${filler}</p><a href="old.html">old</a>`) } };
  const s = await serve(site);
  const r = await crawl({ start: `${s.base}/docs/index.html`, delayMs: 0 });
  s.close();
  check('3b. a redirect within scope still reaches its target', r.pages.some((p) => p.url.endsWith('/docs/permissions.html')));
}

/* 4. limits and fail-closed robots */
{
  const s = await serve(SITE);
  const r = await crawl({ start: `${s.base}/docs/index.html`, delayMs: 0, maxPages: 2 });
  s.close();
  check('4. the page limit caps fetches', s.requests.filter((x) => x !== '/robots.txt').length === 2 && /page limit/.test(r.stoppedBecause ?? ''));

  const broken = { ...SITE, '/robots.txt': { status: 500, type: 'text/plain', body: 'oops' } };
  const b = await serve(broken);
  const rb = await crawl({ start: `${b.base}/docs/index.html`, delayMs: 0 });
  b.close();
  check('4. an unreadable robots.txt stops the crawl before any page', rb.pages.length === 0 && b.requests.every((x) => x === '/robots.txt') && rb.robots === 'unreadable');

  const none = { ...SITE };
  delete (none as any)['/robots.txt'];
  const n = await serve(none);
  const rn = await crawl({ start: `${n.base}/docs/index.html`, delayMs: 0, maxPages: 3 });
  n.close();
  check('4. a missing robots.txt (404) means no rules, and the crawl proceeds', rn.robots === 'none' && rn.pages.length > 0);
}

/* 5. writing the corpus never touches hand-written files */
{
  const root = mkdtempSync(join(tmpdir(), 'corpus-'));
  mkdirSync(join(root, 'acme'));
  writeFileSync(join(root, 'acme', 'handwritten.md'), '# Mine\n\nKeep me.\n');
  const s = await serve(SITE);
  const r = await crawl({ start: `${s.base}/docs/index.html`, delayMs: 0 });
  s.close();
  const first = writeCorpus(root, 'acme', `${s.base}/docs/`, r.pages);
  const files = readdirSync(join(root, 'acme')).sort();
  check('5. ingested pages are namespaced web-*', first.written.every((f) => f.startsWith('web-')) && first.written.length === r.pages.length);
  check('5. the hand-written file is untouched', readFileSync(join(root, 'acme', 'handwritten.md'), 'utf8') === '# Mine\n\nKeep me.\n');
  check('5. a manifest records every source', JSON.parse(readFileSync(join(root, 'acme', '_sources.json'), 'utf8')).pages.length === r.pages.length);
  const second = writeCorpus(root, 'acme', `${s.base}/docs/`, r.pages.slice(0, 2));
  const after = readdirSync(join(root, 'acme')).filter((f) => f.startsWith('web-'));
  check('5. re-ingesting replaces the ingested set wholesale', second.removed === first.written.length && after.length === 2, files.join(','));
  let threw = false;
  try { writeCorpus(root, '../etc', 'x', []); } catch { threw = true; }
  check('5. a tool name cannot escape the corpus directory', threw);
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
