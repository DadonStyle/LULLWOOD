import type { Metadata } from "next";
import "./globals.css";
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from "../lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  keywords: ["horror game", "browser game", "first-person horror", "Three.js", "Lullwood"],
  authors: [{ name: SITE_NAME }],
  alternates: {
    canonical: "/",
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
