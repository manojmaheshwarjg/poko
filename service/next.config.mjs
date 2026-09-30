import { fileURLToPath } from 'node:url';

/* The service imports core/redact.js, the same file the browser loads, so that the
   server and client apply identical privacy rules (G4). That file lives outside this
   directory, so the bundler's root has to be the repo rather than the service. */
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
};
