import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Player guide (SEO): can you distract wolves? Every number below was read from
// the shipped code on origin/release/next (b5d5978) the day this was written:
// engine/forest-engine.js (THROWABLE_* constants, grabThrowable, throwThrowable,
// hearThrowableNoise, the investigate/approach branch of updatePredators, the E
// and left-click handlers, enter()'s Pocket Stones arming), lib/game/noise.ts
// (THROWABLE_NOISE_RADIUS, checkThrowableNoise), lib/game/predator.ts
// (stepApproach, shouldRevertInvestigateToChase), lib/game/economy.ts (Pocket
// Stones reserve and price) and components/Hud.tsx / MobileControls.tsx (the
// prompts). The THROWABLE_* constants live in forest-engine.js, not tuning.js.
// A retune there makes this copy stale, so check it when those constants move.
// Deliberately silent on: how many stones the map holds (a dev comment on the
// count is stale against the current pickup radius) and any speed in units per
// second for the walk to the stone.
const TITLE = "Can You Distract Wolves in Lullwood? Throw a Stone";
const DESCRIPTION =
  "Can you distract wolves in Lullwood? Yes, briefly: a thrown stone lands 18 units ahead and draws predators within 24 units of it away from you.";
const PUBLISHED = "2026-10-29";
const MODIFIED = "2026-10-29";
const PAGE_URL = `${SITE_URL}/guides/throwing-stones`;
// Same text as app/opengraph-image.alt.txt / twitter-image.alt.txt.
const SOCIAL_IMAGE_ALT = "Lullwood: a glowing child alone in a foggy night forest, first-person browser horror game";

export const metadata: Metadata = {
  // `absolute`: the layout template would append " — Lullwood" to a title that
  // already leads with the brand.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/guides/throwing-stones" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/guides/throwing-stones",
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
      image: `${SITE_URL}/screenshots/lullwood-night-forest-pine-trees.png`,
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
        { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE_URL}/guides` },
        { "@type": "ListItem", position: 3, name: "Throwing stones", item: PAGE_URL },
      ],
    },
  ],
};

export default function ThrowingStonesGuidePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static object above; escape "<" so an edit can't break out of the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / <Link href="/guides">Guides</Link> / Throwing stones
        </nav>
        <article>
          <header>
            <h1>Can you distract wolves in Lullwood?</h1>
            <time dateTime={MODIFIED}>Updated October 29, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              Yes, briefly. In Lullwood you pick a stone up with E and throw it
              with a left click. It lands 18 units ahead of you, and any wolf,
              bear or lion within 24 units of that spot will usually turn and
              walk over to it. It buys you seconds, not safety.
            </p>

            <h2>How do you pick up and throw a stone?</h2>
            <ul>
              <li>
                <strong>Pick up with E.</strong> Stand within 3 units of a stone
                on the ground and the game shows &ldquo;Press E to pick up the
                stone&rdquo;. On a phone, the E button does the same.
              </li>
              <li>
                <strong>Throw with a left click.</strong> Once you hold one, the
                prompt reads &ldquo;Holding a stone &mdash; click to throw&rdquo;.
                The click only throws while the game has your mouse; the first
                click after a pause just takes the mouse back. On a phone, a
                Throw button appears while you hold a stone.
              </li>
              <li>
                <strong>You hold one at a time.</strong> While a stone is in
                your hand you cannot pick up another. Only the direction you face
                matters; looking up or down does not change where it lands.
              </li>
            </ul>

            <h2>Which predators hear the stone?</h2>
            <p>
              The noise is made where the stone lands, not where you stand. The
              landing spot is 18 units ahead of you along the direction you are
              facing, and every wolf, bear and lion closer than 24 units to that
              spot hears it. Predators farther away do not.
            </p>
            <p>
              The arithmetic that matters in a chase: a predator in front of
              you, straight along your line of sight, hears the stone out to 42
              units away (18 + 24). One directly behind you only hears a stone
              thrown forward if it is within about 6 units, so turn and throw
              toward it. A whole wolf pack inside the 24 units is pulled over
              together.
            </p>

            <h2>What does a predator do when it hears the stone?</h2>
            <p>
              A hunting predator switches to investigating the landing spot,
              chase included, and walks there at 0.45 of its normal speed
              instead of running. Four things then decide whether you gain
              anything.
            </p>
            <ul>
              <li>
                <strong>The detour is short.</strong> The stone sets a timer of 3
                to 5 seconds. When it runs out, the predator&apos;s approach
                points back at you instead of the stone.
              </li>
              <li>
                <strong>Reaching the stone does not end the hunt.</strong> A
                predator that arrives and sniffs while you are standing in the
                open goes straight back to chasing. A predator that arrives while
                you are hidden carries on sniffing and, as in the{" "}
                <Link href="/guides/wolves">wolf guide</Link>, gives up.
              </li>
              <li>
                <strong>Some states ignore the stone.</strong> A predator in the
                middle of a charge finishes the charge first. One in a forced
                hunt keeps coming straight at you for as long as it can see you.
                Blackout&apos;s opening hunt can still be pulled to the stone
                once it loses sight of you. The 30-second escalation, when
                nothing has come near you, cannot: it keeps tracking you by
                scent after it loses sight and ignores the stone.
              </li>
              <li>
                <strong>A stone does not hide you.</strong> It only moves
                the predator&apos;s attention. Use the seconds to break
                line of sight and hide.
              </li>
            </ul>
            <p>
              So the stone is a way to get from &ldquo;being hunted in the
              open&rdquo; to &ldquo;hidden in bramble&rdquo;, not a way to
              escape on foot. The{" "}
              <Link href="/how-to-survive">Lullwood survival guide</Link> covers
              hiding and the mist veil.
            </p>

            <h2>Does Pocket Stones give you more throws?</h2>
            <p>
              Yes. Pocket Stones is a one-time purchase in the Embers shop. Every
              run then starts with a stone already in your hand and a second one
              in reserve, which replaces the first the moment you throw it. The
              prompt shows the reserve, for example &ldquo;+1 in reserve&rdquo;.
              Price: 80 Embers on Lantern, 120 on Night and 140 on Blackout. Both
              stones are in addition to any you find on the ground.
            </p>

            <h2>How to use stones well</h2>
            <ul>
              <li>
                <strong>Pick one up the first time you see one.</strong> You can
                only hold one, so a stone in hand is a stone ready for the next
                chase.
              </li>
              <li>
                <strong>Throw before the predator is on you.</strong> The
                redirect needs the predator to be near the landing spot, and the
                closer it already is to you, the less distance there is to put
                between you.
              </li>
              <li>
                <strong>Face the predator, then throw.</strong> Aim past it, not at
                your feet: the stone lands 18 units out, and it is the
                predator&apos;s distance from that spot that counts.
              </li>
              <li>
                <strong>Move the moment it lands.</strong> Run for cover while
                the predator walks the other way; hiding is what turns the detour
                into a lost trail.
              </li>
            </ul>
            <p>
              Short answers on controls and price are in the{" "}
              <Link href="/faq">Lullwood FAQ</Link>, and{" "}
              <Link href="/guides/difficulty-tiers">is Lullwood too hard?</Link>{" "}
              explains how many predators each tier puts in the forest.
            </p>
          </div>
        </article>
        <footer className="devlog-footer">
          <p>
            <Link href="/how-to-survive">Read how to survive Lullwood</Link>{" "}
            for hiding, the mist veil and each difficulty tier.
          </p>
          <p><Link href="/guides">See all Lullwood guides</Link></p>
          <p><Link href="/">Play Lullwood free in your browser</Link></p>
        </footer>
      </main>
    </>
  );
}
