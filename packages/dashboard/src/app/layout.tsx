import type { Metadata } from 'next';
import { DM_Sans, IBM_Plex_Mono } from 'next/font/google';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import './globals.css';

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'Robot Platform',
  description: 'AI-powered data extraction',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${ibmPlexMono.variable} antialiased`}>
        <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b bg-background px-6">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4" />
            Robot Platform
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/extractions" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Extractions
            </Link>
          </nav>
        </header>
        <main className="mx-auto p-8">
          {children}
        </main>
      </body>
    </html>
  );
}
