import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/* The coverage page became the map. Old links land on it. */
export default async function Coverage({ searchParams }: { searchParams: Promise<{ origin?: string }> }) {
  const { origin = 'http://localhost:4500' } = await searchParams;
  const product = getDb().prepare('SELECT id FROM products WHERE origin = ?').get(origin) as { id: string } | undefined;
  redirect(product ? `/p/${product.id}/map` : '/products');
}
