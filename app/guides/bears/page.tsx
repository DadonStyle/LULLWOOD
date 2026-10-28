import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Player guide (SEO): the bear spoke beside /guides/wolves. Every mechanic
// below was read from the shipped code on origin/release/next (f021db0) the
// day this was written: engine/tuning.js (PSPEC.bear, CHASE_GAP,
// SCENT_LOCK_ENDURANCE_MULTIPLIER, DIFFICULTY_PRESETS), lib/game/scent.ts
// (scent radii, SCENT_TRACK_TIME, scentVeilTriggerActive, SCENT_VEIL_STAMINA_COST),
// lib/game/stamina.ts, lib/game/veil.ts and engine/forest-engine.js (the
// wolf/lion-only charge gate, wolf-only updateWolfPack, scentOnto, breakScentVeil,
// the KeyG handler). A retune there makes this copy stale, so check it when
// those constants move. Deliberately silent on the veil overload (Q): whether
// it breaks a scent lock is disputed between the code and /how-to-survive.
const TITLE = "How to Escape a Bear in Lullwood: the Scent Guide";
const DESCRIPTION =
  "How to escape a bear in Lullwood: it never charges or flanks, but a scent lock keeps it on you for about 11 seconds. What breaks it and what doesn't.";
const PUBLISHED = "2026-10-28";
const MODIFIED = "2026-10-28";
const PAGE_URL = `${SITE_URL}/guides/bears`;
// Same text as app/opengraph-image.alt.txt / twitter-image.alt.txt.
const SOCIAL_IMAGE_ALT = "Lullwood: a glowing child alone in a foggy night forest, first-person browser horror game";

export const metadata: Metadata = {
  // `absolute`: the layout template would append " — Lullwood" to a title that
  // already leads with the brand.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/guides/bears" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/guides/bears",
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
        { "@type": "ListItem", position: 3, name: "How to escape a bear", item: PAGE_URL },
      ],
    },
  ],
};

export default function BearsGuidePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static object above; escape "<" so an edit can't break out of the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / <Link href="/guides">Guides</Link> / How to escape a bear
        </nav>
        <article>
          <header>
            <h1>How to escape a bear in Lullwood</h1>
            <time dateTime={MODIFIED}>Updated October 28, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              To escape a bear in Lullwood, cut its scent lock, not just its
              line of sight. A bear never charges or flanks, but a scent lock
              keeps it walking at you for about 11 seconds. Walk into the wind,
              press <strong>G</strong>, then hide in bramble.
            </p>

            <h2>What a bear does differently from a wolf</h2>
            <p>
              A bear is not a big wolf. It lacks the two tricks that define a
              wolf hunt and is better at the one thing a wolf is only decent
              at, following your trail.
            </p>
            <ul>
              <li>
                <strong>It never charges.</strong> Wolves and lions telegraph a
                one-second lunge once they are 7 to 16 units away and can see
                you; a jump beats it. The bear is left out of that rule on
                purpose, so there is no lunge to dodge and jumping at a bear
                does nothing for you.
              </li>
              <li>
                <strong>It never flanks.</strong> Only wolves coordinate. A
                chasing bear is one animal coming straight at you, with no
                second animal swinging round to an ambush point. The sideways
                cut that{" "}
                <Link href="/guides/wolves">saves you from a wolf pack</Link>{" "}
                answers a threat the bear never makes.
              </li>
              <li>
                <strong>It has the best nose.</strong> It picks up your scent
                trail from 40% farther out than a wolf does, and once it
                locks on it follows for about 11 seconds, against 8 for a
                wolf and about 6 for a lion.
              </li>
              <li>
                <strong>It sees the shortest.</strong> About 30 units, against
                42 for a wolf and 48 for <Link href="/guides/lions">a lion</Link>. Sight is the bear&apos;s weakest
                sense and scent is its strongest.
              </li>
              <li>
                <strong>It is the slowest, and still faster than you.</strong> A
                bear in a real chase runs at about 13.9 units a second. A wolf
                runs at 15.5, a lion at 17.8, and your full sprint is 10.8. The
                bear gives the longest warning of the three, roughly 9 seconds
                from the moment it spots you, and that is time to act, not to
                outrun it.
              </li>
            </ul>

            <h2>What actually breaks a bear&apos;s pursuit</h2>
            <p>
              Once a bear picks up your trail it is chasing you even with no
              line of sight, at its full running speed, until the lock runs
              out. Breaking sight does not end a scent lock. The lock ends when its
              timer runs out, or when you press <strong>G</strong>, the scent
              veil.
            </p>
            <ul>
              <li>
                <strong>G cuts every scent lock at once.</strong> It works only
                while a predator is scent-locked on you, you are moving into
                the wind, and you have at least 30% of your stamina bar. It
                can be used once per lock. A G prompt appears while it is
                available and greys out when stamina is too low.
              </li>
              <li>
                <strong>Sprinting away spends the thing G costs.</strong> Sprint
                empties stamina in about six seconds and a refill takes about
                fifteen. The 30% price is under two seconds of sprint, but if you
                have sprinted the bar low, the press is refused. Walk into the wind, press G,
                and keep the rest of your stamina.
              </li>
              <li>
                <strong>Then break line of sight.</strong> With the lock cut,
                a bear that cannot see you stops chasing and goes to investigate
                the spot instead. Bramble is the only place you can hide, and
                standing still there cuts how far a predator can see you by
                up to 82%.
              </li>
            </ul>
            <p>
              Hiding first does not end the lock: the bear keeps closing on
              where you are until the lock ends. The order that works is G,
              then hide. The full list of keys and veil rules is in the{" "}
              <Link href="/how-to-survive">Lullwood survival guide</Link>.
            </p>

            <figure>
              <Image
                src="/screenshots/lullwood-night-forest-pine-trees.png"
                alt="Pine trees and snow-covered rocks in Lullwood's night forest under a starry sky: trunks and rocks break a predator's line of sight but do nothing about its nose"
                width={3840}
                height={2160}
                sizes="(min-width: 640px) 592px, 100vw"
              />
            </figure>

            <h2>Do scent and wind work the same on a bear?</h2>
            <p>
              Yes, the rules are the same as for every predator. Only the
              bear&apos;s nose and lock time are bigger.
            </p>
            <ul>
              <li>
                <strong>Moving lays scent, standing still lays none.</strong>{" "}
                You drop a scent point about every 0.3 seconds while you
                walk, and each fades over 14 seconds. A bear smells a fresh
                point from about 3.1 units while you walk and about 5.0 while
                you sprint, shrinking as the point ages.
              </li>
              <li>
                <strong>Wind carries the trail downwind and shrinks it.</strong>{" "}
                Points drift downwind, up to 9 units. Moving into the wind
                cuts the size of the trail you leave by 20%, which is also the
                only direction G will fire.
              </li>
              <li>
                <strong>The mist veil does not help.</strong> Holding F cuts
                predator sight to 35% but has no effect on scent, so
                against a bear following your trail it spends veil charge on
                the sense the bear uses least. The rules behind all of this
                are in{" "}
                <Link href="/devlog/how-scent-and-wind-work">how scent and wind work in Lullwood</Link>.
              </li>
            </ul>

            <h2>How the bear changes by difficulty</h2>
            <ul>
              <li>
                <strong>Lantern:</strong> one bear, with its sight cut to 70%
                (about 21 units). The place to learn the scent lock.
              </li>
              <li>
                <strong>Night:</strong> three bears at full sight (30 units)
                and a minimap.
              </li>
              <li>
                <strong>Blackout</strong> (the default): three bears at 70%
                sight, all hunting from the start, and no minimap. Scent is
                the bear&apos;s strongest sense, so G and a thin trail matter
                most here.
              </li>
            </ul>

            <h2>What not to do against a bear</h2>
            <p>
              Do not sprint away: you cannot outrun it and you empty the
              stamina G needs. Do not jump: there is no charge to dodge. Do
              not hold the mist veil: it cannot stop a scent chase. And do not
              cut sideways as you would against a wolf pack, because there is no pincer to break.
              Walk upwind, press G, and hide.
            </p>
          </div>
        </article>
        <footer className="devlog-footer">
          <p>
            <Link href="/guides/wolves">Read how to survive wolves in Lullwood</Link>{" "}
            for the pack flank, and{" "}
            <Link href="/guides/lions">how to survive lions in Lullwood</Link>{" "}
            for the fastest predator.
          </p>
          <p><Link href="/guides">See all Lullwood guides</Link></p>
          <p><Link href="/">Play Lullwood free in your browser</Link></p>
        </footer>
      </main>
    </>
  );
}
