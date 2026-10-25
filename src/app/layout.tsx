import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { template: "%s · PharmaStock", default: "PharmaStock — Pharmacy POS with batch and expiry control" },
  description: "Pharmacy point of sale and inventory for Ghana, Nigeria and Kenya: batches and expiry alerts 90 days early, FEFO at the counter, reorder lists, prescriptions, a controlled-drug register and a WhatsApp owner summary. The till works offline.",
  applicationName: "PharmaStock",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }], apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "PharmaStock", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#0d2a1f",
};

// Applies the saved theme before first paint (no flash). Values: "light" | "dark" (night) | "system" (default: light).
const THEME_SCRIPT = `try{var h=document.head;if(h){for(var n=h.firstChild;n;){var x=n.nextSibling;if(n.nodeType===8&&/Netlify/.test(n.nodeValue||""))h.removeChild(n);n=x}}var t=localStorage.getItem("ps-theme")||"light";if(t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}>
      <head>
        <Script id="boot" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
