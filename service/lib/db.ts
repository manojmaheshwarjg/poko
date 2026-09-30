import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/* SQLite via Node's built-in driver: no native dependency to compile, and a single
   file the whole learning pipeline can be re-run against from scratch. */

let shared: DatabaseSync | null = null;

/* Resolved when a database is opened, not when this module is imported. The CLI
   scripts change into the service directory after their imports run, and a path
   fixed at import time silently opened a new, empty database next to wherever the
   script was started from. */
export function openDb(path: string = process.env.COPILOT_DB ?? join(process.cwd(), 'data', 'copilot.db')): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  migrate(db);
  return db;
}

export function getDb(): DatabaseSync {
  shared ??= openDb();
  return shared;
}

/* Columns added after a table first shipped. CREATE TABLE IF NOT EXISTS never
   alters an existing table, so these are added one by one if missing. */
function addColumns(db: DatabaseSync, table: string, columns: Record<string, string>) {
  const have = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
  for (const [name, type] of Object.entries(columns)) {
    if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id          TEXT PRIMARY KEY,
      origin      TEXT UNIQUE NOT NULL,
      key         TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS installs (
      id          TEXT PRIMARY KEY,
      product_id  TEXT NOT NULL REFERENCES products(id),
      mode        TEXT NOT NULL CHECK (mode IN ('vendor', 'customer')),
      attested    INTEGER NOT NULL DEFAULT 0,
      first_seen  INTEGER NOT NULL,
      last_seen   INTEGER NOT NULL
    );

    /* Observations are stored once and referenced, keyed by a hash of their
       content. Many transitions share a screen, and identical screens dedupe. */
    CREATE TABLE IF NOT EXISTS observations (
      hash        TEXT PRIMARY KEY,
      product_id  TEXT NOT NULL REFERENCES products(id),
      json        TEXT NOT NULL,
      first_seen  INTEGER NOT NULL
    );

    /* UNIQUE (install_id, episode, seq) is what turns an uploader that retries into
       storage that never double counts. */
    CREATE TABLE IF NOT EXISTS transitions (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id          TEXT NOT NULL REFERENCES products(id),
      install_id          TEXT NOT NULL REFERENCES installs(id),
      episode             TEXT NOT NULL,
      seq                 INTEGER NOT NULL,
      at                  INTEGER NOT NULL,
      source              TEXT NOT NULL CHECK (source IN ('user', 'copilot')),
      before_hash         TEXT NOT NULL REFERENCES observations(hash),
      after_hash          TEXT NOT NULL REFERENCES observations(hash),
      action_json         TEXT NOT NULL,
      crossed_navigation  INTEGER NOT NULL DEFAULT 0,
      received_at         INTEGER NOT NULL,
      UNIQUE (install_id, episode, seq)
    );
    CREATE INDEX IF NOT EXISTS transitions_by_product ON transitions (product_id, at);

    /* Which installs have seen which label hash. Customer-mode only: this is the
       k-anonymity evidence that lets a label be sent in clear. */
    /* Learned structure. Recomputed from observations on every run, with ids carried
       across runs by member overlap (lib/learn/ids.ts). */
    CREATE TABLE IF NOT EXISTS screens (
      id                  TEXT PRIMARY KEY,
      product_id          TEXT NOT NULL REFERENCES products(id),
      display_name        TEXT NOT NULL,
      url_pattern         TEXT NOT NULL,
      count               INTEGER NOT NULL,
      informative_weight  REAL NOT NULL,
      ambiguous           INTEGER NOT NULL,
      core_keys_json      TEXT NOT NULL,
      updated_at          INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS screen_members (
      obs_hash    TEXT PRIMARY KEY REFERENCES observations(hash),
      screen_id   TEXT NOT NULL REFERENCES screens(id),
      product_id  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS edges (
      product_id   TEXT NOT NULL,
      from_screen  TEXT NOT NULL,
      action_key   TEXT NOT NULL,
      to_screen    TEXT NOT NULL,
      action_json  TEXT NOT NULL,
      users        INTEGER NOT NULL,
      copilot      INTEGER NOT NULL,
      first_seen   INTEGER NOT NULL,
      last_seen    INTEGER NOT NULL,
      PRIMARY KEY (product_id, from_screen, action_key, to_screen)
    );
    /* Routes mined from human sessions. Status: candidate or blocked from mining;
       verified or rejected once Phase D exists; stale when mining stops producing it.
       verified_path_hash pins verification to the exact path that passed it. */
    CREATE TABLE IF NOT EXISTS routes (
      id                  TEXT PRIMARY KEY,
      product_id          TEXT NOT NULL,
      kind                TEXT NOT NULL,
      goal_json           TEXT NOT NULL,
      goal_actions_json   TEXT NOT NULL,
      path_json           TEXT NOT NULL,
      path_hash           TEXT NOT NULL,
      end_screen          TEXT NOT NULL,
      variants_json       TEXT NOT NULL,
      attempts            INTEGER NOT NULL,
      installs            INTEGER NOT NULL,
      status              TEXT NOT NULL,
      status_reason       TEXT,
      verified_path_hash  TEXT,
      first_seen          INTEGER NOT NULL,
      last_seen           INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS struggles (
      product_id   TEXT NOT NULL,
      screen_id    TEXT NOT NULL,
      kind         TEXT NOT NULL,
      control      TEXT NOT NULL,
      action_json  TEXT,
      attempts     INTEGER NOT NULL,
      installs     INTEGER NOT NULL,
      PRIMARY KEY (product_id, screen_id, kind, control)
    );

    /* One row per verification attempt, whatever the outcome. The coverage page's
       claims about verification are read from here (G11). */
    CREATE TABLE IF NOT EXISTS verifications (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id       TEXT NOT NULL,
      route_id         TEXT NOT NULL,
      path_hash        TEXT NOT NULL,
      at               INTEGER NOT NULL,
      outcome          TEXT NOT NULL CHECK (outcome IN ('verified', 'rejected', 'gap', 'skipped')),
      reason           TEXT,
      label            TEXT,
      title            TEXT,
      plan_json        TEXT,
      comparison_json  TEXT,
      model            TEXT,
      calls            INTEGER NOT NULL
    );

    /* What happened when a verified route was used for real. Negative evidence
       demotes it (G7); positive evidence is counted for the coverage page. */
    CREATE TABLE IF NOT EXISTS route_feedback (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id  TEXT NOT NULL,
      route_id    TEXT NOT NULL,
      path_hash   TEXT NOT NULL,
      install_id  TEXT NOT NULL,
      kind        TEXT NOT NULL CHECK (kind IN ('completed', 'skipped', 'repaired', 'wrongScreen')),
      step        INTEGER,
      at          INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS learn_runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id    TEXT NOT NULL,
      at            INTEGER NOT NULL,
      summary_json  TEXT NOT NULL
    );

    /* Ground truth for scoring, from the dev fixture's data-screen markers. Never
       read by clustering. Written only for localhost products. */
    CREATE TABLE IF NOT EXISTS dev_truth (
      install_id     TEXT NOT NULL,
      episode        TEXT NOT NULL,
      seq            INTEGER NOT NULL,
      product_id     TEXT NOT NULL,
      before_screen  TEXT,
      after_screen   TEXT,
      PRIMARY KEY (install_id, episode, seq)
    );

    CREATE TABLE IF NOT EXISTS label_sightings (
      product_id  TEXT NOT NULL,
      label_hash  TEXT NOT NULL,
      install_id  TEXT NOT NULL,
      PRIMARY KEY (product_id, label_hash, install_id)
    );
  `);
  /* The label a route was verified under is what the planner will match requests
     against in Phase E, so it lives on the route itself. */
  addColumns(db, 'routes', { label: 'TEXT', title: 'TEXT' });
  addColumns(db, 'screens', { distinctive_keys_json: "TEXT NOT NULL DEFAULT '[]'" });
  /* When a route was last held back by a failed with/without comparison (G9). A held
     route is re-checked once after each hold, then waits for a passing comparison. */
  addColumns(db, 'routes', { held_at: 'INTEGER' });
  /* Phase G. One row per exploration run and one per page it mapped. Explored pages
     are ordinary observations, so clustering sees them, but they are never
     transitions, so mining cannot (G6): exploration shows what screens exist, never
     what people do on them. */
  db.exec(`
    CREATE TABLE IF NOT EXISTS explorations (
      id              TEXT PRIMARY KEY,
      product_id      TEXT NOT NULL REFERENCES products(id),
      install_id      TEXT NOT NULL REFERENCES installs(id),
      start_url       TEXT,
      started_at      INTEGER NOT NULL,
      finished_at     INTEGER,
      stopped         TEXT,
      pages           INTEGER NOT NULL DEFAULT 0,
      skipped_json    TEXT NOT NULL DEFAULT '[]',
      failures_json   TEXT NOT NULL DEFAULT '[]',
      received_at     INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS explore_pages (
      run_id      TEXT NOT NULL REFERENCES explorations(id),
      product_id  TEXT NOT NULL,
      url         TEXT NOT NULL,
      obs_hash    TEXT NOT NULL REFERENCES observations(hash),
      from_url    TEXT,
      via_json    TEXT,
      at          INTEGER NOT NULL,
      truth       TEXT,
      received_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, url)
    );
  `);
  /* Phase L. What the copilot proposed and what the person did about it, redacted in
     the browser and re-checked here. Rejections, repairs and wrong screens are the
     strongest struggle signal there is: the copilot was wrong and someone had to act. */
  db.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id    TEXT NOT NULL REFERENCES products(id),
      install_id    TEXT NOT NULL REFERENCES installs(id),
      run_id        TEXT NOT NULL,
      step_id       TEXT NOT NULL,
      at            INTEGER NOT NULL,
      kind          TEXT NOT NULL CHECK (kind IN ('approved', 'failed', 'skipped', 'repaired', 'repair-failed', 'wrongScreen')),
      url           TEXT,
      heading_json  TEXT,
      planned_json  TEXT,
      located_json  TEXT,
      action_json   TEXT,
      route_id      TEXT,
      received_at   INTEGER NOT NULL,
      UNIQUE (install_id, run_id, step_id, kind, at)
    );
  `);
  /* Phase M: one-time codes that let an install register in vendor mode. Hashes only. */
  db.exec(`
    CREATE TABLE IF NOT EXISTS enrollments (
      code_hash   TEXT PRIMARY KEY,
      product_id  TEXT NOT NULL REFERENCES products(id),
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      used_by     TEXT,
      used_at     INTEGER,
      note        TEXT
    );
  `);
  /* Added while Phase G was being built, after a dev database had the table. */
  addColumns(db, 'explore_pages', { received_at: 'INTEGER NOT NULL DEFAULT 0' });
  /* Which docs corpus (service/corpus/<tool>) belongs to this product. */
  addColumns(db, 'products', { tool: "TEXT NOT NULL DEFAULT 'jira'" });
  /* The console. Every number it shows about cost is read from model_usage, which is
     written once per model call with what the provider reported (G11): nothing about
     spend is estimated after the fact. jobs holds paid runs a person queued; queueing
     one is the approval to run it, with exactly the calls it showed. route_events is
     a route's history beyond what verifications already record. docs_gaps are notes a
     person wrote about something the docs do not say. */
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_usage (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      at                 INTEGER NOT NULL,
      purpose            TEXT NOT NULL,
      model              TEXT NOT NULL,
      prompt_tokens      INTEGER NOT NULL,
      completion_tokens  INTEGER NOT NULL,
      total_tokens       INTEGER NOT NULL,
      job_id             INTEGER
    );
    CREATE INDEX IF NOT EXISTS model_usage_by_time ON model_usage (at);

    CREATE TABLE IF NOT EXISTS jobs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id   TEXT NOT NULL REFERENCES products(id),
      kind         TEXT NOT NULL CHECK (kind IN ('verify', 'compare')),
      status       TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
      calls        INTEGER NOT NULL,
      est_tokens   INTEGER NOT NULL,
      run_after    INTEGER NOT NULL,
      options_json TEXT NOT NULL DEFAULT '{}',
      created_at   INTEGER NOT NULL,
      started_at   INTEGER,
      finished_at  INTEGER,
      result_json  TEXT,
      error        TEXT
    );
    CREATE INDEX IF NOT EXISTS jobs_by_product ON jobs (product_id, created_at);

    CREATE TABLE IF NOT EXISTS route_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id  TEXT NOT NULL,
      route_id    TEXT NOT NULL,
      at          INTEGER NOT NULL,
      kind        TEXT NOT NULL,
      detail      TEXT
    );
    CREATE INDEX IF NOT EXISTS route_events_by_route ON route_events (route_id, at);

    CREATE TABLE IF NOT EXISTS docs_gaps (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id  TEXT NOT NULL REFERENCES products(id),
      screen_id   TEXT,
      note        TEXT NOT NULL,
      source      TEXT,
      created_at  INTEGER NOT NULL
    );
  `);
}
