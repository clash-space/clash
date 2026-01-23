import type { Metadata } from 'next';
import { Inter, Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import LayoutContent from './components/LayoutContent';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Clash - Video Agent',
  description: 'AI-powered video creation and editing platform',
  icons: {
    icon: '/icon',
    apple: '/apple-icon',
  },
  openGraph: {
    title: 'Clash - Video Agent',
    description: 'AI-powered video creation and editing platform',
    type: 'website',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Clash - Video Agent',
    description: 'AI-powered video creation and editing platform',
    images: ['/opengraph-image'],
  },
};

import { headers } from 'next/headers';
import { getUserIdFromHeaders } from '@/lib/auth/session';

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const h = new Headers(await headers());
  const userId = await getUserIdFromHeaders(h);
  const isAuthenticated = !!userId;

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <LayoutContent isAuthenticated={isAuthenticated}>{children}</LayoutContent>
      </body>
    </html>
  );
}
