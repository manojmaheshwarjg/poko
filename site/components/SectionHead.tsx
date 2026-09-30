import type { ReactNode } from 'react';

/* Every section opens the Stripe way: one two-tone intro, the statement in navy and the
   explanation in slate, in a single breath. (n and label stay for the page outline.) */
export function SectionHead({
  n,
  label,
  id,
  title,
  quiet,
  children,
}: {
  n: string;
  label: string;
  id: string;
  title: ReactNode;
  quiet?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="sh" data-n={n} data-label={label}>
      <h2 className="h2" id={id}>
        {title}
        {quiet ? (
          <>
            {' '}
            <span className="q">{quiet}</span>
          </>
        ) : null}
      </h2>
      {children}
    </header>
  );
}
