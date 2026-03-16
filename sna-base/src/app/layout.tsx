import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SnaProvider } from "sna/components/sna-provider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LLM-Native Application",
  description: "Build AI-powered apps using Claude Code as your runtime. No API calls, no infrastructure — just Skills and SQLite.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <SnaProvider>{children}</SnaProvider>
      </body>
    </html>
  );
}
