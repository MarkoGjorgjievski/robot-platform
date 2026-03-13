import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import { Sidebar } from '@/components/sidebar';
import './globals.css';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Robot Platform',
  description: 'Extractor Management Dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${jetbrainsMono.variable} workspace antialiased`}
        style={{ fontFamily: "var(--font-mono), 'JetBrains Mono', monospace" }}
      >
        <Sidebar />
        <main className="ml-12 min-h-screen p-6" style={{ background: 'var(--ws-bg)', color: 'var(--ws-text)' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
