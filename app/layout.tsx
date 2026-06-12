import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { StorageGuard } from "@/components/StorageGuard";
import { VersionWatcher } from "@/components/VersionWatcher";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Freemind",
  description: "A canvas for the mind.",
};

// Runs in <head> before React hydrates — prevents a theme flash on first paint.
// Keep it minimal: localStorage read + data-theme set. New users (no stored
// value) default to light; an explicit dark choice persists and wins.
const themeBootstrap = `try{var t=localStorage.getItem('canvas-ai:theme');document.documentElement.setAttribute('data-theme',(t==='light'||t==='dark')?t:'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <StorageGuard />
        <VersionWatcher />
        {children}
      </body>
    </html>
  );
}
