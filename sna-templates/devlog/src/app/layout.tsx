import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Skills-Native Application",
  description: "Build AI-powered apps using Claude Code as your runtime. No API calls, no infrastructure — just Skills and SQLite.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="flex h-screen overflow-hidden">
          <div className="flex-1 overflow-auto">{children}</div>
          <TerminalPanel />
        </div>
      </body>
    </html>
  );
}
