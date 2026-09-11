import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_TAGLINE, SITE_THEME_COLOR } from "../lib/site";

// LUL-2375: a web app manifest is what lets Lighthouse/PWA audits, Android
// "add to home screen" and some search features see the game as an
// installable app with a name, colour and icon set. Served at /manifest.webmanifest
// and linked from <head> by Next automatically.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: `${SITE_TAGLINE} A free first-person horror game you play in the browser.`,
    start_url: "/",
    display: "fullscreen",
    orientation: "landscape",
    background_color: SITE_THEME_COLOR,
    theme_color: SITE_THEME_COLOR,
    categories: ["games", "entertainment"],
    icons: [
      { src: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
