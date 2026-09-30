import { loadCorpus, type Section } from './corpus.ts';

/* Lexical retrieval. Deliberately not embeddings yet: the fixture corpus is a
   few hundred words, and an embedding call per request would cost money and
   latency to rank five sections. This module is the seam. When a real vendor
   corpus arrives, replace score() with a vector search and nothing else moves. */

const STOP = new Set([
  'the', 'a', 'an', 'to', 'of', 'and', 'or', 'in', 'on', 'for', 'is', 'are',
  'be', 'can', 'do', 'does', 'i', 'it', 'this', 'that', 'my', 'me', 'but',
  'not', 'so', 'they', 'them', 'their', 'with', 'from', 'at', 'by', 'want',
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function idf(corpus: Section[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const section of corpus) {
    for (const term of new Set(terms(section.text))) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const out = new Map<string, number>();
  for (const [term, count] of df) out.set(term, Math.log(1 + corpus.length / count));
  return out;
}

export function retrieve(tool: string, query: string, limit = 6): Section[] {
  const corpus = loadCorpus(tool);
  const weights = idf(corpus);
  const queryTerms = terms(query);
  if (!queryTerms.length) return corpus.slice(0, limit);

  const scored = corpus.map((section) => {
    const sectionTerms = new Set(terms(section.text));
    const headingTerms = new Set(terms(section.heading));
    let score = 0;
    for (const term of queryTerms) {
      const weight = weights.get(term) ?? 0;
      if (sectionTerms.has(term)) score += weight;
      /* A term in the heading is a much stronger signal than one in the body. */
      if (headingTerms.has(term)) score += weight * 2;
    }
    return { section, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.section);
}

/* Below this size, sending the whole corpus beats retrieving from it: it fits in
   a cacheable prefix, so it is read at cache rates on every later request, and
   nothing relevant can be ranked out. Retrieval only earns its place once the
   corpus stops fitting. */
const WHOLE_CORPUS_CHAR_BUDGET = 24_000;

export function contextFor(tool: string, query: string): { text: string; cacheable: boolean } {
  const corpus = loadCorpus(tool);
  const whole = corpus.map((s) => s.text).join('\n\n---\n\n');
  if (whole.length <= WHOLE_CORPUS_CHAR_BUDGET) {
    return { text: whole, cacheable: true };
  }
  return { text: retrieve(tool, query).map((s) => s.text).join('\n\n---\n\n'), cacheable: false };
}
