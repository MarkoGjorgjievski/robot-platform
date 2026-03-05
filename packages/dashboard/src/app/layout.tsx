import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Sidebar } from '@/components/sidebar';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
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
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        <Sidebar />
        <main className="ml-64 min-h-screen bg-gray-50 p-8">
          {children}
        </main>
      </body>
    </html>
  );
}
