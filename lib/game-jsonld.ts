import { SCREENSHOTS, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "./site.ts";
import { ORG_REF } from "./seo.ts";

// The game itself, as a schema.org VideoGame. Homepage-only (app/page.tsx):
// it describes what that page is about, and repeating the full entity on every
// devlog, guide and 404 page made it sitewide boilerplate. Other pages point at
// it by @id ("#game").
export const videoGameJsonLd = {
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
  // LUL-4841: schema.org's `screenshot` property is repeatable -- an array
  // qualifies for Google's screenshot gallery in a way a single value does
  // not. These are the in-engine screenshots app/page.tsx's gallery shows.
  screenshot: SCREENSHOTS.map((file) => `${SITE_URL}/screenshots/${file}`),
  genre: ["Horror", "Survival", "Adventure"],
  gamePlatform: "Web Browser",
  // LUL-2375: "Game" is not a schema.org SoftwareApplication category value;
  // "GameApplication" is the enumerated one Google's software-app rich result
  // recognises.
  applicationCategory: "GameApplication",
  applicationSubCategory: "Horror Game",
  operatingSystem: "Any browser with WebGL",
  datePublished: "2026-08-14",
  browserRequirements: "Requires a WebGL-capable browser",
  playMode: "SinglePlayer",
  inLanguage: "en",
  isAccessibleForFree: true,
  // The same #org node app/layout.tsx emits, by @id, so Google reads one
  // organisation rather than two more anonymous copies.
  author: ORG_REF,
  publisher: ORG_REF,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
  },
};
