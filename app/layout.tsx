import type { Metadata } from "next";
import "./globals.css";
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION, GOOGLE_SITE_VERIFICATION } from "../lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  keywords: ["horror game", "browser game", "first-person horror", "Three.js", "Lullwood"],
  authors: [{ name: SITE_NAME }],
  alternates: {
    canonical: "/",
  },
  verification: {
    google: GOOGLE_SITE_VERIFICATION,
  },
  openGraph: {
    type: "website",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: SITE_NAME,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
};

const videoGameJsonLd = {
  "@context": "https://schema.org",
  "@type": "VideoGame",
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  genre: "Horror",
  gamePlatform: "Web Browser",
  applicationCategory: "Game",
  operatingSystem: "Any",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <head>
        <script
          // LUL-135: GameCanvas's overlay <style> (overflow: hidden on
          // html/body) is client-only and doesn't land in the DOM until
          // GameCanvas actually mounts -- ~130ms after DOMContentLoaded on
          // prod, per the ticket's measurements. During that window the SSR
          // content shell (app/page.tsx's <main class="about">, pushed below
          // the fold by globals.css) is genuinely reachable by a fast
          // scroll/wheel or a restored scroll position. This blocking
          // <head> script runs synchronously during HTML parsing, before
          // <body> exists or paints, so it closes the window entirely for
          // anyone with JS enabled. It's a deliberate no-op with JS
          // disabled: GameCanvas never mounts in that case either, so the
          // about content staying reachable is the correct fallback, not a
          // bug -- see the "no JS still sees it in normal document flow"
          // comment in globals.css.
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.style.overflow='hidden';",
          }}
        />
      </head>
      <body>
        <script
          type="application/ld+json"
          // Static, hand-authored object above -- nothing user-supplied ever
          // reaches this JSON, but escape "<" anyway so a future edit can't
          // accidentally break out of the script tag.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(videoGameJsonLd).replace(/</g, "\\u003c"),
          }}
        />
        {children}
      </body>
    </html>
  );
}
