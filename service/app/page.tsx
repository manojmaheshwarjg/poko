import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/* Straight to the map of the product that has learned the most (routes, then screens);
   to the product list when there is none yet. Loading this never calls the planner. */
export default function Home() {
  const top = getDb()
    .prepare(
      `SELECT p.id FROM products p
        ORDER BY (SELECT COUNT(*) FROM routes r WHERE r.product_id = p.id AND r.status <> 'blocked') DESC,
                 (SELECT COUNT(*) FROM screens s WHERE s.product_id = p.id) DESC, p.created_at LIMIT 1`
    )
    .get() as { id: string } | undefined;
  redirect(top ? `/p/${top.id}/map` : '/products');
}
