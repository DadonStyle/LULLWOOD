import type { Metadata, Viewport } from "next";
import "./globals.css";
import {
  SITE_URL,
  SITE_NAME,
  SITE_TITLE,
  SITE_DESCRIPTION,
  SITE_TAGLINE,
  GOOGLE_SITE_VERIFICATION,
} from "../lib/site";

// LUL-529: two things this repo had zero of before.
// - `viewportFit: 'cover'` is what makes every `env(safe-area-inset-*)` in
//   components/MobileControls.tsx (and anywhere else) resolve to a real
//   value instead of silently falling back to 0 on a notched/rounded-corner
//   phone -- without this line those rules are dead code.
// - `maximumScale`/`userScalable: false` stop iOS/Android's double-tap and
//   pinch zoom from firing mid-run (twin-stick drags read as pinch gestures
//   on some Android WebViews otherwise) -- this is a real-time 3D scene, not
//   a page of text, so there's nothing on-screen a player legitimately wants
//   to pinch-zoom into.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // `template` applies to every future route (the LUL-47 devlog especially) --
  // a child page sets `title: "Devlog"` and gets "Devlog — Lullwood" for free.
  title: {
    default: SITE_TITLE,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "horror game",
    "browser game",
    "free horror game",
    "online horror game",
    "first-person horror",
    "no download game",
    "WebGL game",
    "Three.js",
    "Lullwood",
  ],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "games",
  alternates: {
    canonical: "/",
  },
  verification: {
    google: GOOGLE_SITE_VERIFICATION,
  },
  // Without this block Google defaults to a *thumbnail-sized* image preview and
  // a truncated snippet. `max-image-preview: large` is what allows the big
  // card in search results, and it is opt-in -- absent, you silently get small.
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    title: SITE_TITLE,
    // Social cards are read by people, not crawlers -- lead with the mood.
    description: `${SITE_TAGLINE} A free first-person horror game you play in the browser.`,
    url: "/",
    siteName: SITE_NAME,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: `${SITE_TAGLINE} A free first-person horror game you play in the browser.`,
  },
};

const videoGameJsonLd = {
  "@context": "https://schema.org",
  "@type": "VideoGame",
  "@id": `${SITE_URL}#game`,
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  // `image` is what lets the entry qualify for an image-bearing rich result;
  // without it the VideoGame node is text-only. Reuses the OG asset Next
  // already generates from app/opengraph-image.png.
  image: `${SITE_URL}/opengraph-image.png`,
  screenshot: `${SITE_URL}/opengraph-image.png`,
  genre: ["Horror", "Survival", "Adventure"],
  gamePlatform: "Web Browser",
  applicationCategory: "Game",
  applicationSubCategory: "Horror Game",
  operatingSystem: "Any",
  browserRequirements: "Requires a WebGL-capable browser",
  playMode: "SinglePlayer",
  inLanguage: "en",
  isAccessibleForFree: true,
  author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
  publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
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
