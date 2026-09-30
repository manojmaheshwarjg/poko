import './globals.css';

export const metadata = {
  title: 'Sekva',
  description: 'A copilot that learns your product from how people use it, and never acts without a nod.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
