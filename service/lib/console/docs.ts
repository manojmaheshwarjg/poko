import { hasCorpus, loadCorpus, type Section } from '../corpus.ts';

/* The docs layer: which screens the product's docs talk about.
 *
 * A screen counts as in the docs when its name appears in a docs section, as a whole
 * phrase and ignoring case. That is all it claims: the docs mention the screen, not
 * that they explain it well. It is a text match, so the console says "mentioned in the
 * docs" rather than "documented". */

export type DocsHit = { doc: string; heading: string };

function phrase(name: string): RegExp | null {
  const words = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const body = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(`(^|[^a-z0-9])${body}($|[^a-z0-9])`, 'i');
}

export function mentions(name: string, sections: Section[], limit = 3): DocsHit[] {
  const re = phrase(name);
  if (!re) return [];
  const hits: DocsHit[] = [];
  for (const s of sections) {
    if (re.test(s.text)) hits.push({ doc: s.doc, heading: s.heading });
    if (hits.length >= limit) break;
  }
  return hits;
}

export function docsCoverage(tool: string, names: Array<{ id: string; name: string }>): Map<string, DocsHit[]> {
  const out = new Map<string, DocsHit[]>();
  const sections = hasCorpus(tool) ? loadCorpus(tool) : [];
  for (const n of names) out.set(n.id, mentions(n.name, sections));
  return out;
}
