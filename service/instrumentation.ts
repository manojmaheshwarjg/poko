/* Starts the console's queue worker once per server. It runs only paid jobs a person
   queued from the console, when they are due; see lib/console/worker.ts. Set
   SEKVA_WORKER=off to keep queued jobs waiting. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.SEKVA_WORKER === 'off') return;
  const { startWorker } = await import('./lib/console/worker.ts');
  startWorker();
}
