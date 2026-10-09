import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TZ Arb Night Desk",
  description: "Scans overseas news while the U.S. sleeps, matches it to Kalshi and Polymarket markets, and paper-trades the gaps.",
  applicationName: "TZ Arb",
  appleWebApp: { capable: true, title: "TZ Arb", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#070b14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
