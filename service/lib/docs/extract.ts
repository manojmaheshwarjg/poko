/* HTML to corpus markdown, with no dependency.
 *
 * A small tokenizer rather than a regex soup: it walks tags and text in order,
 * tracks elements whose content is never documentation (scripts, styles, site nav,
 * headers, footers, forms), prefers <main>/<article> when a page has one, and emits
 * headings as markdown headings and everything else as paragraphs. The output is
 * shaped for corpus.ts, which splits on "#" and "##".
 *
 * It is deliberately modest. Docs sites are mostly well-formed; where one is not, the
 * worst outcome is some boilerplate in a section, which retrieval tolerates. */

/* Two kinds of skipping. HARD: never documentation and never a place to find links
   (scripts, styles). SOFT: site chrome whose TEXT is not documentation but whose LINKS
   are exactly how a docs site is navigated. A sidebar table of contents is usually a
   <nav> or <aside>, and pages reachable only from it would otherwise never be found. */
const HARD_SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'select']);
const SOFT_SKIP = new Set(['nav', 'header', 'footer', 'aside', 'form', 'button']);
const SKIP = new Set([...HARD_SKIP, ...SOFT_SKIP]);
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'wbr', 'track', 'param']);
const BLOCK = new Set(['p', 'div', 'li', 'dd', 'dt', 'tr', 'td', 'th', 'pre', 'blockquote', 'section', 'article', 'main', 'table', 'ul', 'ol', 'dl', 'figcaption', 'details', 'summary']);
const HEADING: Record<string, string> = { h1: '#', h2: '##', h3: '##', h4: '###', h5: '###', h6: '###' };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '-', ndash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', copy: '(c)' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export type Extracted = { title: string; markdown: string; links: string[]; chars: number };

export function extract(html: string, baseUrl: string): Extracted {
  const TOKEN = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const scoped = /<(main|article)\b|role\s*=\s*["']main["']/i.test(html);

  let skip = 0;
  let hardSkip = 0;
  let inScope = scoped ? 0 : 1;
  let pre = 0;
  let title = '';
  let inTitle = false;
  let headingLevel: string | null = null;
  const blocks: string[] = [];
  let buf = '';
  const links: string[] = [];

  const flush = () => {
    const text = pre ? buf.replace(/^\n+|\s+$/g, '') : buf.replace(/\s+/g, ' ').trim();
    if (text && inScope > 0) blocks.push(headingLevel ? `${headingLevel} ${text}` : text);
    buf = '';
  };

  let last = 0;
  let m: RegExpExecArray | null;
  const text = (chunk: string) => {
    if (!chunk) return;
    const t = decodeEntities(chunk);
    if (inTitle) title += t;
    if (skip === 0) buf += t;
  };

  while ((m = TOKEN.exec(html))) {
    text(html.slice(last, m.index));
    last = TOKEN.lastIndex;
    const [, close, rawName, attrs, selfClose] = m;
    if (!rawName) continue;
    const name = rawName.toLowerCase();

    if (name === 'title') {
      inTitle = !close;
      continue;
    }
    const isScopeEl = scoped && (name === 'main' || name === 'article' || /role\s*=\s*["']main["']/i.test(attrs ?? ''));

    if (!close) {
      if (name === 'a' && hardSkip === 0) {
        const href = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs ?? '');
        const value = href ? decodeEntities(href[2] ?? href[3] ?? href[4] ?? '') : '';
        if (value) {
          try {
            links.push(new URL(value, baseUrl).toString());
          } catch {
            /* malformed href: ignore */
          }
        }
      }
      if (SKIP.has(name)) {
        if (!VOID.has(name) && !selfClose) {
          skip++;
          if (HARD_SKIP.has(name)) hardSkip++;
        }
        continue;
      }
      if (isScopeEl) inScope++;
      if (name === 'br') {
        buf += '\n';
        continue;
      }
      if (HEADING[name]) {
        flush();
        headingLevel = HEADING[name];
      } else if (BLOCK.has(name)) {
        flush();
        if (name === 'pre') pre++;
      }
    } else {
      if (SKIP.has(name)) {
        if (skip > 0) skip--;
        if (HARD_SKIP.has(name) && hardSkip > 0) hardSkip--;
        continue;
      }
      if (HEADING[name]) {
        flush();
        headingLevel = null;
      } else if (BLOCK.has(name)) {
        flush();
        if (name === 'pre' && pre > 0) pre--;
      }
      if (isScopeEl && inScope > 0) inScope--;
    }
  }
  text(html.slice(last));
  flush();

  title = title.replace(/\s+/g, ' ').trim();
  const firstH1 = blocks.find((b) => b.startsWith('# '));
  const heading = firstH1 ? firstH1.slice(2) : title || 'Untitled';
  const body = blocks.filter((b) => b !== firstH1 && b.replace(/^#+\s/, '').length >= 3);
  const markdown = [`# ${heading}`, ...body].join('\n\n') + '\n';
  return { title: heading, markdown, links: [...new Set(links)], chars: body.join(' ').length };
}
