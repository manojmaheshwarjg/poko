import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { productState } from '@/lib/console/model';
import { shellData } from '@/lib/console/shell';
import { plain } from '@/lib/console/format';
import { Sidebar } from '../../_ui/Sidebar';
import { TopBar } from '../../_ui/TopBar';
import { Toaster } from '../../_ui/Toaster';

export const dynamic = 'force-dynamic';

export default async function ConsoleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ pid: string }> }) {
  const { pid } = await params;
  const db = getDb();
  const base = `/p/${pid}`;
  const state = productState(db, pid, base);
  if (!state) notFound();
  const shell = plain(shellData(db, pid, { done: state.setup.filter((s) => s.done).length, total: state.setup.length })!);
  return (
    <div className="shell">
      <Sidebar base={base} badges={shell.badges} />
      <div className="shell-main">
        <TopBar products={shell.products} product={shell.product} budget={shell.budget} palette={shell.palette} />
        <div className="shell-body">{children}</div>
      </div>
      <Toaster />
    </div>
  );
}
