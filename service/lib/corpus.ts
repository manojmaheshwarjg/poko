import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type Section = {
  doc: string;
  heading: string;
  body: string;
  text: string;
};

/* Resolved on use, not at import: the CLI scripts change into the service directory
   after their imports run (see lib/db.ts for the same trap). */
const corpusRoot = () => join(process.cwd(), 'corpus');
const cache = new Map<string, { sections: Section[]; stamp: number }>();

/* Split each doc on level-2 headings. A section is the unit of retrieval: small
   enough to be relevant, large enough to carry its own argument. */
function split(doc: string, markdown: string): Section[] {
  const lines = markdown.split('\n');
  const sections: Section[] = [];
  let heading = '';
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (heading && body) sections.push({ doc, heading, body, text: `${heading}\n\n${body}` });
    buffer = [];
  };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flush();
      heading = line.slice(3).trim();
    } else if (line.startsWith('# ')) {
      flush();
      heading = line.slice(2).trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

export function hasCorpus(tool: string): boolean {
  /* Guard against a tool name being used as a path segment. */
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(tool)) return false;
  try {
    return readdirSync(join(corpusRoot(), tool)).some((f) => f.endsWith('.md'));
  } catch {
    return false;
  }
}

export function loadCorpus(tool: string): Section[] {
  const dir = join(corpusRoot(), tool);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    throw new Error(`No corpus for tool "${tool}". Expected ${dir}`);
  }

  /* Key the cache on the newest mtime in the directory. Editing a doc while the
     server runs used to leave the old text cached in memory with nothing to
     invalidate it, because Next does not watch files it never imported. */
  const stamp = files.reduce((newest, file) => {
    const { mtimeMs } = statSync(join(dir, file));
    return Math.max(newest, mtimeMs);
  }, 0);

  const cached = cache.get(tool);
  if (cached && cached.stamp === stamp) return cached.sections;

  const sections = files.flatMap((file) =>
    split(file.replace(/\.md$/, ''), readFileSync(join(dir, file), 'utf8'))
  );
  cache.set(tool, { sections, stamp });
  return sections;
}

/* What the docs corpus for a product holds: hand-written files, plus pages ingested
   from the vendor's site with where and when they came from. Shared by the coverage
   page and the onboarding console. */
export function corpusStatus(tool: string) {
  const dir = join(corpusRoot(), tool);
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(tool) || !existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  let sources: { site: string; fetchedAt: string; pages: unknown[] } | null = null;
  try {
    sources = JSON.parse(readFileSync(join(dir, '_sources.json'), 'utf8'));
  } catch {
    sources = null;
  }
  return { handWritten: files.filter((f) => !f.startsWith('web-')).length, ingested: files.filter((f) => f.startsWith('web-')).length, sources };
}

export const CORPUS_DIR = () => corpusRoot();
