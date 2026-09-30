import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Doto, Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import './sections.css';

/* Geist for everything read or copied, Geist Mono for labels and code, and the dot
   matrix for the big numbers and the footer mark. */
const dot = Doto({ subsets: ['latin'], axes: ['ROND'], variable: '--font-dot', display: 'swap' });
const sans = Geist({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

const title = 'Poko: every new user, a power user';
const description =
  'Poko is an AI guide that lives inside your product. It learns the hard flows from your docs and your best users, then does them with every new user: Poko handles the clicks, your user makes the calls. Free during the beta.';

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: 'website', siteName: 'Poko' },
  twitter: { card: 'summary_large_image', title, description },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${dot.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        {children}
      </body>
    </html>
  );
}
