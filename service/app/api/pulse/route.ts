import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* A version stamp for one product: it changes whenever anything the console shows
   does. The console polls it and refreshes in place when it moves. Reads only. */
export function GET(request: Request) {
  const pid = new URL(request.url).searchParams.get('pid') ?? '';
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
         (SELECT COALESCE(MAX(received_at), 0) FROM transitions WHERE product_id = :p) AS t,
         (SELECT COALESCE(MAX(received_at), 0) FROM explore_pages WHERE product_id = :p) AS x,
         (SELECT COALESCE(MAX(received_at), 0) FROM explorations WHERE product_id = :p) AS xr,
         (SELECT COALESCE(MAX(at), 0) FROM learn_runs WHERE product_id = :p) AS l,
         (SELECT COALESCE(MAX(updated_at), 0) FROM routes WHERE product_id = :p) AS r,
         (SELECT COALESCE(MAX(at), 0) FROM verifications WHERE product_id = :p) AS v,
         (SELECT COALESCE(MAX(COALESCE(finished_at, started_at, created_at)), 0) || ':' || COUNT(*) FROM jobs WHERE product_id = :p) AS j,
         (SELECT COALESCE(MAX(received_at), 0) FROM decisions WHERE product_id = :p) AS d,
         (SELECT COALESCE(MAX(created_at), 0) FROM docs_gaps WHERE product_id = :p) AS g,
         (SELECT COALESCE(MAX(created_at), 0) || ':' || COUNT(*) FROM enrollments WHERE product_id = :p) AS e,
         (SELECT COALESCE(MAX(last_seen), 0) FROM installs WHERE product_id = :p) AS i,
         (SELECT COALESCE(MAX(at), 0) FROM model_usage) AS u`
    )
    .get({ p: pid }) as Record<string, number | string>;
  return NextResponse.json({ v: Object.values(row).join('|') }, { headers: { 'cache-control': 'no-store' } });
}
