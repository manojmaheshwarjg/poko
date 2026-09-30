import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/* Phase M: vendor enrollment.
 *
 * Vendor mode sends control labels in clear and may run exploration, so an install
 * must not be able to simply claim it. For a product on a real web origin, the first
 * registration of a vendor install has to present a one-time code the product's admin
 * issued for that product. Codes are stored only as hashes, expire, and are spent by
 * the first install that uses them. Local development products (localhost, *.localhost)
 * are exempt: they are this machine's fixtures.
 *
 * Customer mode never needs a code: it is the restricted mode, and claiming it gains
 * nothing. */

export const DEFAULT_TTL_DAYS = 7;
const hash = (code: string) => createHash('sha256').update(code.trim()).digest('hex');

export function createEnrollment(db: DatabaseSync, productId: string, opts: { ttlDays?: number; now?: number; note?: string } = {}) {
  const now = opts.now ?? Date.now();
  const code = `enr_${randomBytes(12).toString('hex')}`;
  const expiresAt = now + (opts.ttlDays ?? DEFAULT_TTL_DAYS) * 86_400_000;
  db.prepare('INSERT INTO enrollments (code_hash, product_id, created_at, expires_at, note) VALUES (?, ?, ?, ?, ?)').run(
    hash(code), productId, now, expiresAt, opts.note ?? null
  );
  /* The only time the code exists in clear. */
  return { code, expiresAt };
}

export function redeemEnrollment(db: DatabaseSync, productId: string, code: string, installId: string, now = Date.now()): { ok: true } | { ok: false; reason: string } {
  const row = db.prepare('SELECT product_id, expires_at, used_by FROM enrollments WHERE code_hash = ?').get(hash(code)) as
    | { product_id: string; expires_at: number; used_by: string | null }
    | undefined;
  if (!row || row.product_id !== productId) return { ok: false, reason: 'no such code for this product' };
  if (row.used_by) return { ok: false, reason: 'that code has already been used' };
  if (row.expires_at < now) return { ok: false, reason: 'that code has expired' };
  const spent = db.prepare('UPDATE enrollments SET used_by = ?, used_at = ? WHERE code_hash = ? AND used_by IS NULL').run(installId, now, hash(code));
  if (spent.changes !== 1) return { ok: false, reason: 'that code has already been used' };
  return { ok: true };
}

export type EnrollmentRow = { created_at: number; expires_at: number; used_by: string | null; used_at: number | null; note: string | null };
export function enrollmentsFor(db: DatabaseSync, productId: string): EnrollmentRow[] {
  return db
    .prepare('SELECT created_at, expires_at, used_by, used_at, note FROM enrollments WHERE product_id = ? ORDER BY created_at DESC')
    .all(productId) as EnrollmentRow[];
}
