import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/* The onboarding console moved into the product console: its setup checklist. Old
   links land there. */
export default async function Onboard({ searchParams }: { searchParams: Promise<{ origin?: string }> }) {
  const { origin } = await searchParams;
  const product = origin ? (getDb().prepare('SELECT id FROM products WHERE origin = ?').get(origin) as { id: string } | undefined) : undefined;
  redirect(product ? `/p/${product.id}/setup` : '/products');
}
