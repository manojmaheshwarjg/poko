/* Docs ingestion: crawl a vendor's public documentation into the corpus.
 *
 * The one manual onboarding step in the design is "point us at your docs", so this
 * has to be a polite, bounded, predictable crawler:
 *
 *   robots.txt is honoured, and read failure fails CLOSED: a missing file (404/410)
 *     means no rules, but a server error or network failure means do not crawl;
 *   scope is the directory of the start URL on the same origin, so pointing it at a
 *     docs section never wanders into the marketing site or another host;
 *   pages, depth, bytes and pace are all capped; only HTML is read;
 *   hand-written corpus files are never touched: ingested pages are written as
 *     web-*.md and replaced as a set on re-ingest, with a manifest of sources. */

import { readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from './extract.ts';

export type CrawlOptions = {
  start: string;
  maxPages?: number;
  maxDepth?: number;
  delayMs?: number;
  minChars?: number;
  maxBytes?: number;
  scope?: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
};
export type CrawledPage = { url: string; title: string; markdown: string; chars: number; depth: number };
export type CrawlResult = {
  pages: CrawledPage[];
  skipped: Array<{ url: string; reason: string }>;
  robots: 'rules' | 'none' | 'unreadable';
  stoppedBecause: string | null;
};

const NON_HTML = /\.(pdf|png|jpe?g|gif|svg|webp|ico|zip|gz|tgz|tar|mp4|mp3|wav|css|js|mjs|json|xml|rss|atom|woff2?|ttf|eot)(\?|$)/i;

type Rule = { allow: boolean; path: string };
export function parseRobots(text: string, agent: string): Rule[] {
  const groups: Array<{ agents: string[]; rules: Rule[] }> = [];
  let cur: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!cur) continue;
      if (field === 'disallow' && value) cur.rules.push({ allow: false, path: value });
      if (field === 'allow' && value) cur.rules.push({ allow: true, path: value });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.toLowerCase().includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

/* Longest matching rule wins; on a tie, allow. The standard reading. */
export function allowedByRobots(path: string, rules: Rule[]): boolean {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!path.startsWith(r.path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

export function scopeOf(start: string): { origin: string; prefix: string } {
  const u = new URL(start);
  return { origin: u.origin, prefix: u.pathname.endsWith('/') ? u.pathname : u.pathname.replace(/[^/]*$/, '') };
}

function normalize(url: string): string {
  const u = new URL(url);
  u.hash = '';
  return u.toString();
}

export async function crawl(opts: CrawlOptions): Promise<CrawlResult> {
  const f = opts.fetchImpl ?? fetch;
  const maxPages = opts.maxPages ?? 40;
  const maxDepth = opts.maxDepth ?? 3;
  const delay = opts.delayMs ?? 500;
  const minChars = opts.minChars ?? 200;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const agent = opts.userAgent ?? 'ContextualCopilotDocsBot/0.1';
  const start = normalize(opts.start);
  const scope = opts.scope ? { origin: new URL(opts.scope).origin, prefix: new URL(opts.scope).pathname } : scopeOf(start);
  const result: CrawlResult = { pages: [], skipped: [], robots: 'none', stoppedBecause: null };

  let rules: Rule[] = [];
  try {
    const r = await f(`${scope.origin}/robots.txt`, { headers: { 'user-agent': agent } });
    if (r.ok) {
      rules = parseRobots(await r.text(), agent);
      result.robots = 'rules';
    } else if (r.status === 404 || r.status === 410) {
      result.robots = 'none';
    } else {
      result.robots = 'unreadable';
      result.stoppedBecause = `robots.txt returned ${r.status}; not crawling without knowing the rules`;
      return result;
    }
  } catch (err) {
    result.robots = 'unreadable';
    result.stoppedBecause = `robots.txt could not be fetched (${err instanceof Error ? err.message : String(err)}); not crawling`;
    return result;
  }

  const inScope = (url: string) => {
    const u = new URL(url);
    return u.origin === scope.origin && u.pathname.startsWith(scope.prefix);
  };

  const queue: Array<{ url: string; depth: number }> = [{ url: start, depth: 0 }];
  const seen = new Set<string>([start]);
  let fetched = 0;

  while (queue.length) {
    if (fetched >= maxPages) {
      result.stoppedBecause = `page limit of ${maxPages} reached`;
      break;
    }
    const { url, depth } = queue.shift()!;
    const path = new URL(url).pathname;
    if (!inScope(url)) {
      result.skipped.push({ url, reason: 'outside the docs scope' });
      continue;
    }
    if (!allowedByRobots(path, rules)) {
      result.skipped.push({ url, reason: 'disallowed by robots.txt' });
      continue;
    }
    if (NON_HTML.test(path)) {
      result.skipped.push({ url, reason: 'not a page' });
      continue;
    }

    if (fetched > 0 && delay > 0) await new Promise((r) => setTimeout(r, delay));
    fetched++;
    let res: Response;
    try {
      /* Redirects are NOT followed automatically. Following them would request the
         target before any check could run, so a docs page redirecting to a login
         domain or another site would make this crawler visit it. Instead the target
         is treated as a new link and goes through the same scope and robots checks. */
      res = await f(url, { headers: { 'user-agent': agent, accept: 'text/html' }, redirect: 'manual' });
    } catch (err) {
      result.skipped.push({ url, reason: `fetch failed: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      let target: string | null = null;
      try {
        target = location ? normalize(new URL(location, url).toString()) : null;
      } catch {
        target = null;
      }
      if (!target) {
        result.skipped.push({ url, reason: `redirect with no usable location (${res.status})` });
      } else if (!inScope(target)) {
        result.skipped.push({ url, reason: `redirected outside the docs scope (${target}), not followed` });
      } else if (!seen.has(target)) {
        seen.add(target);
        queue.push({ url: target, depth });
      }
      continue;
    }
    const finalUrl = url;
    if (!res.ok) {
      result.skipped.push({ url, reason: `HTTP ${res.status}` });
      continue;
    }
    if (!/text\/html/i.test(res.headers.get('content-type') ?? '')) {
      result.skipped.push({ url, reason: 'not HTML' });
      continue;
    }
    if (Number(res.headers.get('content-length') ?? 0) > maxBytes) {
      result.skipped.push({ url, reason: 'too large' });
      continue;
    }
    const html = await res.text();
    if (html.length > maxBytes) {
      result.skipped.push({ url, reason: 'too large' });
      continue;
    }

    const page = extract(html, finalUrl);
    if (page.chars < minChars) result.skipped.push({ url, reason: `too little content (${page.chars} chars)` });
    else result.pages.push({ url: finalUrl, title: page.title, markdown: page.markdown, chars: page.chars, depth });

    if (depth < maxDepth) {
      for (const link of page.links) {
        let n: string;
        try {
          n = normalize(link);
        } catch {
          continue;
        }
        if (!/^https?:/.test(n) || seen.has(n)) continue;
        seen.add(n);
        queue.push({ url: n, depth: depth + 1 });
      }
    }
  }
  return result;
}

/* Replaces the ingested set for a tool, leaving hand-written files alone. */
export function writeCorpus(corpusRoot: string, tool: string, site: string, pages: CrawledPage[]): { written: string[]; removed: number } {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(tool)) throw new Error(`bad tool name: ${tool}`);
  const dir = join(corpusRoot, tool);
  mkdirSync(dir, { recursive: true });
  let removed = 0;
  for (const f of readdirSync(dir)) {
    if (f.startsWith('web-') && f.endsWith('.md')) {
      rmSync(join(dir, f));
      removed++;
    }
  }
  const used = new Set<string>();
  const written: string[] = [];
  const manifest = pages.map((p) => {
    const base = ('web-' + (new URL(p.url).pathname.replace(/\.html?$/i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'index')).toLowerCase().slice(0, 80);
    let name = `${base}.md`;
    for (let i = 2; used.has(name); i++) name = `${base}-${i}.md`;
    used.add(name);
    writeFileSync(join(dir, name), p.markdown);
    written.push(name);
    return { url: p.url, file: name, title: p.title, chars: p.chars };
  });
  writeFileSync(join(dir, '_sources.json'), JSON.stringify({ site, fetchedAt: new Date().toISOString(), pages: manifest }, null, 2) + '\n');
  return { written, removed };
}
