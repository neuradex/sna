import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { appName, appTagline, siteUrl } from '@/lib/shared';
import './global.css';

const inter = Inter({
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${appName}: ${appTagline}`,
    template: `%s · ${appName}`,
  },
  description:
    'SNA is a Skills-Native Application SDK that runs Claude Code, Codex, and OpenCode as backend processes. One canonical session, one event protocol, one permission flow.',
  openGraph: {
    title: appName,
    description: appTagline,
    url: siteUrl,
    siteName: appName,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: appName,
    description: appTagline,
  },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">{children}</body>
    </html>
  );
}
