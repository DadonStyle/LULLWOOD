import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Player guide (SEO): deliberately narrower than /how-to-survive -- every
// number below is the wolf-only detail that page's general predator section
// has no room for. Source is the shipped code, read on origin/release/next
// the day this was written: lib/game/pack.ts (flank geometry, FLANK_ANGLE/
// FLANK_DIST_MUL/FLANK_SPEED_MUL/FLANK_ARRIVE_R/FLANK_RECOMPUTE),
// lib/game/predator.ts (rollSniffs/stepFlankHold), engine/forest-engine.js
// (updateWolfPack, the Beacon Hunter wind channel) and engine/tuning.js
// (PSPEC wolf speed/detect, BEACON_HUNTER_LOCK_MUL, DIFFICULTY_PRESETS). A
// retune there makes this copy stale, so check it when those constants move.
const TITLE = "How to Survive Wolves in Lullwood: the Pack Flank Guide";
const DESCRIPTION =
  "How to survive wolves in Lullwood: the pack flanks 60° off your line while a Beacon Hunter reads the wind. Real distances, timings and how to break both.";
const PUBLISHED = "2026-10-22";
const MODIFIED = "2026-10-22";
const PAGE_URL = `${SITE_URL}/guides/wolves`;
// Same text as app/opengraph-image.alt.txt / twitter-image.alt.txt.
const SOCIAL_IMAGE_ALT = "Lullwood: a glowing child alone in a foggy night forest, first-person browser horror game";

export const metadata: Metadata = {
  // `absolute`: the layout template would append " — Lullwood" to a title that
  // already leads with the brand (65 chars, truncated in results). 57 as-is.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/guides/wolves" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/guides/wolves",
    siteName: SITE_NAME,
    locale: "en_US",
    type: "article",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: SOCIAL_IMAGE_ALT }],
    publishedTime: PUBLISHED,
    modifiedTime: MODIFIED,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/twitter-image.png", width: 1200, height: 630, alt: SOCIAL_IMAGE_ALT }],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "@id": `${PAGE_URL}#article`,
      headline: TITLE,
      description: DESCRIPTION,
      image: `${SITE_URL}/screenshots/lullwood-forest-rock-outcrop-night.png`,
      datePublished: PUBLISHED,
      dateModified: MODIFIED,
      inLanguage: "en",
      author: { "@id": `${SITE_URL}#org` },
      publisher: { "@id": `${SITE_URL}#org` },
      mainEntityOfPage: { "@type": "WebPage", "@id": PAGE_URL },
      about: { "@id": `${SITE_URL}#game` },
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "How to survive wolves", item: PAGE_URL },
      ],
    },
  ],
};

export default function WolvesGuidePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static object above; escape "<" so an edit can't break out of the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / How to survive wolves
        </nav>
        <article>
          <header>
            <h1>How to survive wolves in Lullwood</h1>
            <time dateTime={MODIFIED}>Updated October 22, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              To survive wolves in Lullwood, never run in a straight line. The
              instant one wolf spots you, the others peel off to ambush points
              roughly 60 degrees either side of your escape line — so
              sprinting straight runs you into them. Cut sideways and reach
              bramble instead; the flankers trot, slower than the wolf still
              chasing you.
            </p>

            <h2>Why wolves are different</h2>
            <p>
              Bears and lions hunt alone, and{" "}
              <Link href="/how-to-survive">the Lullwood survival guide</Link>{" "}
              covers them. Wolves are the only predator in
              Lullwood that coordinates: the instant one wolf sees or scents
              you and enters a real chase, every other wolf that isn&apos;t
              already hunting on its own becomes a flanker, routed around you
              instead of at you. Treat three wolves as one animal and the
              other two arrive from your sides while you&apos;re still
              watching the one in front.
            </p>

            <h2>How the pack aims the flank</h2>
            <ul>
              <li>
                <strong>Where the flankers go.</strong> Each flanker&apos;s
                ambush point is your own current movement heading, rotated 60
                degrees to one side, out to about 1.4 times that flanker&apos;s
                own distance from you — the farther a wolf already is, the
                wider its swing. With three wolves hunting (the most that ever
                flank at once), the two flankers alternate sides: one angles
                ahead-left, the other ahead-right. Neither flanker aims at the
                chasing wolf — each one tracks only your heading and its own
                distance from you.
              </li>
              <li>
                <strong>Lag you can use.</strong> A flank path recomputes at
                most twice a second. Change direction and the pack&apos;s
                ambush points take up to half a second to catch up — long
                enough to turn a clean pincer into a wasted guess if you cut
                early.
              </li>
            </ul>

            <h2>The ambush itself</h2>
            <p>
              Once a flanker gets within about 4 units of its target point, it
              stops and sniffs there — 1 to 3 times, each lasting 1 to 4
              seconds, so it stands planted anywhere from roughly a second to
              about twelve. It isn&apos;t blind while it waits: stumble into
              its sight or cross a live scent point near it and it converts
              straight into a real chase, the same as a roaming wolf would. If
              nothing re-triggers it, it gives up and returns to roaming
              immediately — no backing off, no searching, unlike a wolf that
              loses a direct chase and sweeps the area a few times first. And
              the whole pincer collapses together: the moment no wolf is
              still actively chasing you, every flanking wolf stands down
              too, even mid-sniff.
            </p>

            <figure>
              <Image
                src="/screenshots/lullwood-forest-rock-outcrop-night.png"
                alt="A snow-covered rock outcrop in Lullwood's night forest — breaking line of sight here can stop a flanking wolf from ever reaching its ambush point"
                width={3840}
                height={2160}
                sizes="(min-width: 640px) 592px, 100vw"
              />
            </figure>

            <h2>The speed gap that actually matters</h2>
            <p>
              A wolf that has you in a real chase closes at about 15.5 units a
              second — you outrun nothing once it&apos;s on you. But a flanker
              on its way to an ambush point moves at a deliberate trot, well
              under half that speed: barely faster than your own walk. That
              trot is the one gap in the pack&apos;s math you can exploit —
              you can put real ground between yourself and a flanker even
              while the wolf actually chasing you is gaining on you, so
              cutting toward cover on a flanker&apos;s approach side, rather
              than away from the one chasing you, is often the faster way to
              bramble.
            </p>

            <h2>The Beacon Hunter: the one wolf the pack math doesn&apos;t cover</h2>
            <p>
              The first wolf placed into every run, on every difficulty, is
              permanently a variant called the Beacon Hunter — its eyes glow
              blue-teal once it locks on. It reads a fourth channel that has
              nothing to do with sight or scent: the moment you sprint against
              the wind within its ordinary sight range, it locks onto you
              outright, no line of sight and no scent trail required. Its lock
              range equals its normal sight distance — it isn&apos;t
              farther-sighted, it&apos;s a shortcut around the two senses
              every other predator needs both of. It is blocked by whatever
              blocks every other detection channel: the mist veil&apos;s
              overload burst and the game&apos;s rare cave immunity shut it out
              exactly like they shut out sight and scent for everyone else.
              The counter is simple once you know the trigger: don&apos;t
              sprint into the wind near a wolf you haven&apos;t identified, and
              if its eyes are already blue-teal, breaking line of sight alone
              will not end the chase.
            </p>

            <h2>Reading the geometry in the moment</h2>
            <ul>
              <li>
                <strong>Lantern has no pack.</strong> One wolf per species
                means there is never a second wolf to send wide — a Lantern
                wolf chase is just a straight chase, nothing to flank with.
              </li>
              <li>
                <strong>Night and Blackout both run three wolves per
                species</strong> — enough for the full one-chaser,
                two-flanker shape. Night, with full-strength sight but a
                minimap to help you track where they&apos;ve gone, is the
                easiest place to learn to read a pincer forming.
              </li>
              <li>
                <strong>Holding a straight line is what lets the pincer
                close.</strong> Because flank points are built off your
                current heading, a diagonal cut or a hard turn drags both
                ambush points toward wherever you&apos;re now heading —
                costing the pack the half-second recompute cap each time.
              </li>
              <li>
                <strong>Bramble beats the clock, not the wolves.</strong>{" "}
                Once you&apos;re hidden, a flanker that&apos;s already
                mid-approach keeps closing on its blind ambush point, not on
                you, and its own give-up timer starts running in your favor
                instead of against you.
              </li>
            </ul>

            <p>
              The single thing to carry out of this page: wolves are the only
              predator in Lullwood that flanks, so the pack reads the same
              straight line you&apos;re running as an invitation, not a
              threat. Break the line, and you break the pincer. What counts as a win is in{" "}
              <Link href="/guides/how-to-win">how to win Lullwood</Link>.
            </p>
          </div>
        </article>
        <footer className="devlog-footer">
          <p>
            <Link href="/how-to-survive">
              Read the full survival guide
            </Link>{" "}
            for hiding, scent, the mist veil and bears and lions.
          </p>
          <p><Link href="/guides">See all Lullwood guides</Link></p>
          <p><Link href="/">Play Lullwood free in your browser</Link></p>
        </footer>
      </main>
    </>
  );
}
