import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Guides hub (LUL-6092). This is an index, not an article -- no claim here
// goes beyond what /how-to-survive or /guides/wolves already state, and both
// of those are re-verified against the shipped game, not restated from
// memory. Lions have no guide yet: name that honestly, and do not
// link a page that 404s (BRAND.md bans claims we cannot back).
const TITLE = "Lullwood Guides: How to Survive the Night Forest";
const DESCRIPTION =
  "Guides for Lullwood, the free browser horror game with no download: how to survive wolves, read scent and wind, and reach the lost child alive.";
const MODIFIED = "2026-10-29";
const PAGE_URL = `${SITE_URL}/guides`;
// Same text as app/opengraph-image.alt.txt / twitter-image.alt.txt.
const SOCIAL_IMAGE_ALT = "Lullwood: a glowing child alone in a foggy night forest, first-person browser horror game";

export const metadata: Metadata = {
  // `absolute`: the layout template would append " — Lullwood" to a title that
  // already leads with the brand.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/guides" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/guides",
    siteName: SITE_NAME,
    locale: "en_US",
    // Index page, not an article -- "website" here, no publishedTime.
    type: "website",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: SOCIAL_IMAGE_ALT }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/twitter-image.png", width: 1200, height: 630, alt: SOCIAL_IMAGE_ALT }],
  },
};

// Hub page: BreadcrumbList only. No Article type here -- this page has no
// single author/date the way a guide or devlog post does, it is an index.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "Guides", item: PAGE_URL },
  ],
};

export default function GuidesHubPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static object above; escape "<" so an edit can't break out of the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / Guides
        </nav>
        <article>
          <header>
            <h1>Lullwood guides</h1>
            <time dateTime={MODIFIED}>Updated October 29, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              You survive Lullwood, the free browser horror game with no
              download, by staying hidden rather than outrunning anything:
              break line of sight, keep your scent trail thin, and freeze in
              bramble when a predator is close. These guides cover the
              general systems and go deep on each predator, starting with the
              wolf pack&apos;s flanking and the bear&apos;s scent lock.
            </p>

            <h2>Guides live now</h2>
            <ul>
              <li>
                <strong>
                  <Link href="/how-to-survive">How to survive Lullwood</Link>
                </strong>{" "}
                — the full system: how wolves, bears and lions track you by
                sight and scent, hiding in bramble, the mist veil, and each
                difficulty tier.
              </li>
              <li>
                <strong>
                  <Link href="/guides/wolves">How to survive wolves</Link>
                </strong>{" "}
                — the pack&apos;s flanking geometry, the sniff-and-give-up
                timing, and how the Beacon Hunter&apos;s wind lock really
                works, in depth.
              </li>
              <li>
                <strong>
                  <Link href="/guides/bears">How to escape a bear</Link>
                </strong>{" "}
                — why a bear is not a big wolf: no charge, no flank, the best
                nose, and the scent veil that breaks its lock.
              </li>
              <li>
                <strong>
                  <Link href="/guides/fireflies">Do fireflies help in Lullwood?</Link>
                </strong>{" "}
                — no: standing in a firefly cluster&apos;s glow raises how far
                predators can see you by up to 30%. When they appear and what
                rain does.
              </li>
              <li>
                <strong>
                  <Link href="/guides/difficulty-tiers">Is Lullwood too hard?</Link>
                </strong>{" "}
                — Lantern, Night and Blackout: what each tier changes, why
                Blackout is harder even though its predators see less far, and
                how to switch.
              </li>
              <li>
                <strong>
                  <Link href="/guides/how-to-win">How you win Lullwood</Link>
                </strong>{" "}
                — the win condition: reach the child and press E. There is no
                trip home afterwards.
              </li>
              <li>
                <strong>
                  <Link href="/guides/mobile">Can you play Lullwood on a phone?</Link>
                </strong>{" "}
                — yes, in landscape with no keyboard: every on-screen control,
                which prompts are tap rows, and what a short phone screen hides.
              </li>
              <li>
                <strong>
                  <Link href="/games-like-slender">Games like Slender: how Lullwood compares</Link>
                </strong>{" "}
                — what makes a Slender-style game work, the well-known games in
                the mold, and where Lullwood differs.
              </li>
            </ul>

            <h2>Coming later</h2>
            <p>
              Lions don&apos;t have their own guide yet. Until they do,{" "}
              <Link href="/how-to-survive">the full survival guide</Link>{" "}
              covers them at a general level.
            </p>
          </div>
        </article>
        <footer className="devlog-footer">
          <p><Link href="/">Play Lullwood free in your browser</Link></p>
        </footer>
      </main>
    </>
  );
}
