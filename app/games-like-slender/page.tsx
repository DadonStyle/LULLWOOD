import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// "Games like Slender" landing page (SEO). Lullwood claims are checked against
// the shipped code -- engine/tuning.js (PSPEC, walk speed), engine/forest-engine.js
// (KeyH bramble hide, KeyF veil + playerLight dimming, child cry) and lib/game/*
// (scent, veil, childGlow). Facts about other games were checked against their
// Wikipedia articles and store listings (sources in the PR body); keep them
// minimal and neutral, and never link to download mirrors.
const TITLE = "Games Like Slender You Can Play Free in Your Browser";
const DESCRIPTION =
  "Games like Slender: what makes the genre work, the Slender games and their successors, and Lullwood, a free browser horror game where predators hunt you.";
const PUBLISHED = "2026-10-18";
const MODIFIED = "2026-10-18";
const PAGE_URL = `${SITE_URL}/games-like-slender`;
// Same text as app/opengraph-image.alt.txt / twitter-image.alt.txt.
const SOCIAL_IMAGE_ALT = "Lullwood: a glowing child alone in a foggy night forest, first-person browser horror game";

export const metadata: Metadata = {
  // `absolute`: with the layout template's " — Lullwood" suffix this would be
  // 63 chars and truncate in results. 52 as-is.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/games-like-slender" },
  // A page-level openGraph/twitter object replaces the layout's wholesale, and
  // the root app/opengraph-image.png + twitter-image.png do NOT carry over once
  // it does -- so the same assets are named here (as in app/how-to-survive).
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/games-like-slender",
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
        { "@type": "ListItem", position: 2, name: "Games like Slender", item: PAGE_URL },
      ],
    },
  ],
};

export default function GamesLikeSlenderPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static object above; escape "<" so an edit can't break out of the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / Games like Slender
        </nav>
        <article>
          <header>
            <h1>Games like Slender</h1>
            <time dateTime={MODIFIED}>Updated October 18, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              If you want a game like Slender that you can play free in your
              browser with no download, try Lullwood. It keeps what made Slender
              frightening: you are alone in a dark forest at night, you have no
              weapon, and something is hunting you. Instead of eight pages, you
              are searching for one lost child who glows faintly through the fog.
              Instead of one stalker, wolves, bears and lions track you by sight
              and by scent. Below is what makes this kind of game work, a short
              history of the Slender games, a few other well-known games in the
              same mold, and how Lullwood fits in.
            </p>

            <h2>What makes a Slender-style game work</h2>
            <p>
              <strong>You are the prey.</strong> The threat is not something you
              fight. It finds you, and the only answers are to keep moving, stay
              out of sight, or hide. Taking away the weapon turns every encounter
              into a decision about where to go next.
            </p>
            <p>
              <strong>You can barely see.</strong> Darkness, fog and a weak light
              source keep the threat just beyond what you can make out. Most of
              the fear comes from what you think might be there.
            </p>
            <p>
              <strong>You have a reason to go deeper.</strong> Collecting pages,
              finding keys or reaching a goal forces you away from safety. The
              objective is what stops you from simply standing still in a corner.
            </p>
            <p>
              <strong>The pressure builds.</strong> The longer you take, the more
              dangerous the world becomes, so a run gets tenser as it goes on.
            </p>

            <h2>The original: Slender: The Eight Pages and The Arrival</h2>
            <p>
              Slender Man began in 2009 as images posted to the Something Awful forums by
              Eric Knudsen. <em>Slender: The Eight Pages</em>, by Mark J. Hadley
              of Parsec Productions, came out in June 2012 as a free game for
              Windows and Mac. You walk a dark forest with a flashlight whose
              battery runs down, collecting eight pages while Slender Man closes
              in. There is no way to fight back; you can only keep moving.
            </p>
            <p>
              Its sequel, <em>Slender: The Arrival</em>, was made by Blue Isle
              Studios with Parsec Productions and released for PC in March 2013,
              later reaching consoles and phones. It expands the idea with a story
              about a missing friend and more locations, still with only a
              flashlight to defend yourself.
            </p>

            <h2>Other well-known games in this mold</h2>
            <p>
              <strong>Amnesia: The Dark Descent</strong> (Frictional Games, 2010,
              PC, later consoles). You cannot fight the monsters, so you avoid
              them, run or hide. Darkness hides you but wears down your sanity,
              and light comes from a lantern and a limited supply of tinderboxes.
            </p>
            <p>
              <strong>Outlast</strong> (Red Barrels, 2013, PC, later consoles).
              You explore an asylum with no way to fight, hiding in lockers and
              under beds. You see in the dark through a camcorder whose night
              vision uses up scarce batteries.
            </p>
            <p>
              <strong>Granny</strong> (DVloper, 2017, Android and iOS, free to
              download). You have five days to escape a locked house. Granny
              hears everything, so dropping an object brings her running, and you
              hide in wardrobes and under beds.
            </p>
            <p>
              Each of these is a paid or app-store game that you install. If you
              want the same feeling without installing anything, a browser game
              is the shortest route.
            </p>

            <figure>
              <Image
                src="/screenshots/lullwood-night-forest-pine-trees.png"
                alt="First-person view of Lullwood's snowy pine forest under a starry night sky, with grey boulders and a snowbank ahead"
                width={3840}
                height={2160}
                sizes="(min-width: 640px) 592px, 100vw"
                style={{ width: "100%", height: "auto" }}
              />
            </figure>

            <h2>How Lullwood fits the mold</h2>
            <p>
              Lullwood is a first-person horror game that runs in your browser.
              You cross a foggy forest at night to reach a lost child. She glows,
              and her cry carries through the trees, so you can find her by
              listening. You have no weapon. Lifting her ends the run as a win (<Link href="/guides/how-to-win">how to win Lullwood</Link>{" "}
              has the details); getting caught ends it as a loss.
            </p>
            <p>
              Like Slender, you cannot outrun the threat. Every predator is
              faster than your full sprint, so an escape comes from reaching cover
              and breaking line of sight, not from running in a straight line.
              Your light is a faint glow around you, and the fog does the rest.
            </p>

            <h2>How Lullwood is different</h2>
            <p>
              <strong>Predators use sight and scent.</strong> Wolves, bears and
              lions see you at different distances, and every step you take
              leaves a scent trail that the wind carries downwind. A predator
              that crosses your trail can follow it without ever seeing you. Each
              species is different: the lion sees farthest, the bear has the best
              nose, and wolves hunt as a pack, which the{" "}
              <Link href="/guides/wolves">wolf survival guide</Link> covers in depth.
            </p>
            <p>
              <strong>You can hide.</strong> Walk into a bramble bush and press
              H. Holding still there makes you very hard to spot, though staying
              in one bush too long makes the brush rustle and give you away.
            </p>
            <p>
              <strong>You have a mist veil.</strong> Hold F and mist rolls in,
              cutting how far predators can see you. It hides you from sight
              only, not from scent, and it runs out if you hold it too long.
            </p>
            <p>
              <strong>Wind matters.</strong> Moving into the wind shrinks your
              scent, so the direction you travel changes how easy you are to
              track.
            </p>
            <p>
              <strong>One goal instead of a checklist.</strong> You are not
              gathering items. You are crossing the forest to reach one child,
              and the danger is in the getting there.
            </p>
            <p>
              For the exact numbers behind sight ranges, scent, hiding and the
              veil, read the <Link href="/how-to-survive">Lullwood survival guide</Link>.
            </p>

            <h2>Which one should you play?</h2>
            <p>
              If you want the original experience, the Slender games and their
              successors are still the reference points. If you want to be hunted
              in a dark forest right now, in a browser tab, with predators that
              follow your scent as well as your silhouette, you can <Link href="/">play Lullwood free in the browser</Link>,
              and it takes a few seconds to start.
            </p>
          </div>
        </article>
        <footer className="devlog-footer">
          <p><Link href="/">Play Lullwood free in your browser</Link></p>
          <p><Link href="/devlog">Read the Lullwood devlog</Link> for how the predators and scent were built.</p>
        </footer>
      </main>
    </>
  );
}
