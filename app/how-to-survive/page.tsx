import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Player guide (SEO): every number below is read from the shipped tuning, not
// invented -- engine/tuning.js (PSPEC, DIFFICULTY_PRESETS, CHASE_GAP) and
// lib/game/* (scent, noise, veil, veilOverload, stamina, cover, charge, jump,
// rockClimb, predator, dayNight, economy, leaderboard). A retune there makes
// this copy stale, so check it when those constants move.
const TITLE = "How to Survive Lullwood: Hiding, Scent and Predator Guide";
const DESCRIPTION =
  "How to survive Lullwood: how wolves, bears and lions track you by sight and scent, when to hide in bramble, how the mist veil works, and how to win.";
const PUBLISHED = "2026-10-18";
const MODIFIED = "2026-10-18";
const PAGE_URL = `${SITE_URL}/how-to-survive`;
// Same text as app/opengraph-image.alt.txt / twitter-image.alt.txt.
const SOCIAL_IMAGE_ALT = "Lullwood: a glowing child alone in a foggy night forest, first-person browser horror game";

export const metadata: Metadata = {
  // `absolute`: the layout template would append " — Lullwood" to a title that
  // already leads with the brand (68 chars, truncated in results). 57 as-is.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/how-to-survive" },
  // A page-level openGraph/twitter object replaces the layout's wholesale, and
  // the root app/opengraph-image.png + twitter-image.png do NOT carry over once
  // it does (checked in the built HTML) -- so the same assets are named here.
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/how-to-survive",
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
        { "@type": "ListItem", position: 2, name: "How to survive", item: PAGE_URL },
      ],
    },
  ],
};

export default function HowToSurvivePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static object above; escape "<" so an edit can't break out of the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / How to survive
        </nav>
        <article>
          <header>
            <h1>How to survive Lullwood</h1>
            <time dateTime={MODIFIED}>Updated October 18, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              To survive Lullwood, the free first-person horror game you play in
              the browser, stay out of sight, keep your scent trail thin, and hide
              in bramble instead of trying to outrun anything. Wolves, bears and
              lions are all faster than your full sprint, so every escape comes
              from breaking line of sight, walking rather than running, and
              spending your mist veil at the right moment. Here is how each system
              works, using the game&apos;s real numbers.
            </p>

            <h2>How predators find you</h2>
            <ul>
              <li>
                <strong>Sight.</strong> The lion sees farthest (about 48 units), then
                the wolf (42) and the bear (30). Rocks, reeds, logs, bramble and
                larger trees block the line. A predator that sees you roars and
                gives chase.
              </li>
              <li>
                <strong>Scent.</strong> Moving drops a scent point every 0.3 seconds.
                Each fades over 14 seconds, and the wind carries it up to 9 units
                downwind. Sprinting lays a wider trail (3.6 units against 2.2).
                Standing still lays none. A predator that crosses your trail
                follows it without seeing you.
              </li>
              <li>
                <strong>Noise.</strong> Footsteps carry about 14 units walking and 24
                sprinting. A roaming predator in range may hear you and come to
                investigate.
              </li>
            </ul>
            <p>
              Don&apos;t linger. If no predator comes within 20 units for 30
              seconds, the nearest is sent straight at you unless you are hidden.
              Night also falls: over the first two minutes, wolf and bear sight
              grows by up to 30%.
            </p>

            <h2>Hiding</h2>
            <p>
              Only bramble bushes are hiding spots. Rocks, logs and trees block
              sight, but pressing <strong>H</strong> does nothing there. Walk right
              into a bush and press H.
            </p>
            <ul>
              <li>
                <strong>Hold still.</strong> Over about 1.2 seconds your detection
                range shrinks by up to 82%, and inside the bush a predator only sees
                you once it is close enough to touch you. Any movement breaks cover.
              </li>
              <li>
                <strong>Hiding is noisy.</strong> Entering a bush alerts roaming
                predators within 20 units. Sprinting in or out snags you on thorns
                (40% speed for 0.3 seconds), so walk.
              </li>
              <li>
                <strong>Don&apos;t camp.</strong> After 12 seconds in one spot the
                brush rustles every 5 seconds with the same 20-unit alert (16 and 6
                on Lantern, 8 and 4 on Blackout).
              </li>
              <li>
                <strong>Shuffle (R).</strong> Shifts you about a unit inside the same
                bush and resets that clock, with a two-second cooldown. It is silent
                into the wind and noisy downwind. Face your direction and press R
                without holding a movement key, or you step out.
              </li>
            </ul>
            <p>
              A predator that loses you sweeps the area up to three times, 18 to 28
              units from where it lost you, and keeps going while you stay within
              about 32 units of that spot. Moving on ends the search sooner.
            </p>

            <figure>
              <Image
                src="/screenshots/lullwood-forest-rock-outcrop-night.png"
                alt="A snow-covered rock outcrop in Lullwood's night forest, the kind of rock you can climb for a look over the fog"
                width={3840}
                height={2160}
                sizes="(min-width: 640px) 592px, 100vw"
              />
            </figure>

            <h2>The mist veil and other tools</h2>
            <ul>
              <li>
                <strong>Mist veil (hold F).</strong> Mist rolls in over 1.6 seconds
                and predators see only 35% as far. It hides you from sight only, not
                scent or footsteps. Five seconds of holding empties it, and it
                refills at half speed. Drain it fully and it locks for about three
                seconds, so release early.
              </li>
              <li>
                <strong>Veil overload (Q).</strong> Once per run, while a predator is
                chasing you and you have over a quarter of your veil charge. It
                burns the charge, and for 7 seconds predators can neither see nor
                smell you.
              </li>
              <li>
                <strong>Scent veil (G).</strong> When a predator has your scent and
                you are moving into the wind, G spends 30% stamina to break every
                scent lock at once.
              </li>
              <li>
                <strong>Stamina.</strong> Sprinting reaches 1.8 times walking speed
                and fades as stamina drains. Six seconds empties it, and refilling
                takes about 15. Holding sprint drains it even while you stand still.
              </li>
              <li>
                <strong>Wind.</strong> The arrow at top right shows the map&apos;s
                wind. Moving into it shrinks your scent by 20%. Sprinting into it is
                20% faster and quieter (about 17 units instead of 24).
              </li>
              <li>
                <strong>Rocks (C).</strong> Climb a rock for 2 seconds to see over
                the fog, but predators see you from 60% farther while you are up.
              </li>
              <li>
                <strong>Jump (Space).</strong> A 0.6-second hop, and the only way to
                dodge a charge.
              </li>
              <li>
                <strong>Stones and the cave.</strong> A thrown stone draws predators
                within 24 units of where it lands. About half of runs have a cave
                that makes you undetectable for 25 seconds, once.
              </li>
            </ul>

            <h2>Each predator</h2>
            <p>
              You walk at 6 units a second and sprint at up to 10.8. Bears run at
              about 13.9, wolves 15.5 and lions 17.8. Once one spots you, expect
              roughly 9 seconds against a bear, 6 against a wolf and 4 against a
              lion: enough to reach cover, not to escape.
            </p>
            <ul>
              <li>
                <strong>Wolf.</strong> Wolves hunt as a pack. When one chases you,
                the others move to points about 60 degrees either side of your
                escape line, so running straight can put you into them. One wolf
                each game is a <em>Beacon Hunter</em>: it ignores sight and scent and
                locks on the moment you sprint into the wind within its range. Its
                eyes turn blue-teal when it does.
              </li>
              <li>
                <strong>Bear.</strong> The slowest and shortest-sighted, but the best
                nose: it picks up your trail from 40% farther and holds it about 11
                seconds, against the wolf&apos;s 8. Bears never charge. Against a
                bear, manage scent: walk, stop, stay upwind.
              </li>
              <li>
                <strong>Lion.</strong> The fastest and farthest-seeing, with the
                weakest nose; it loses a trail after about 6 seconds. From 90
                seconds into a run its sight fades, to half by 150 seconds.
              </li>
            </ul>
            <p>
              <strong>Charges.</strong> Wolves and lions charge when they can see
              you, you can see them, and they are 7 to 16 units away. A short tell
              is followed by a lunge, and the whole thing lasts one second. Jump
              inside it and the animal overshoots; it can&apos;t charge again for
              10 seconds. Ducking into a bush mid-charge won&apos;t save you.
            </p>

            <h2>Difficulty tips</h2>
            <ul>
              <li>
                <strong>Lantern:</strong> one predator per species, sight cut to 70%,
                a child who glows 1.6 times brighter, and a minimap. Learn here.
              </li>
              <li>
                <strong>Night:</strong> three per species at full sight, with a
                minimap. With three wolves, expect real flanking.
              </li>
              <li>
                <strong>Blackout</strong> (default): nine predators at 70% sight, all
                hunting from the start, no minimap, and the child farther out. The
                only leaderboard difficulty.
              </li>
            </ul>
            <p>
              Runs earn Embers (a win pays 1.75 times the Lantern amount on Night,
              twice on Blackout) for the shop: Deeper Lungs adds veil time, Quiet
              Step makes scent fade faster, and Pocket Stones gives two extra
              stones a run.
            </p>

            <h2>Reaching the child</h2>
            <p>
              The child is far across the forest. Follow her cry, which sounds from
              her direction, and the coloured lights on the six landmarks above the
              fog. Approach carefully: predators within about 32 units of her hear
              the same cry and investigate. Press E beside her to lift her. That
              wins the run on the spot and stops the timer.
            </p>

            <figure>
              <Image
                src="/screenshots/lullwood-dense-pine-forest-snow.png"
                alt="Dense pine trees in Lullwood's night forest at ground level, where trunks and snowbanks break a predator's line of sight"
                width={3840}
                height={2160}
                sizes="(min-width: 640px) 592px, 100vw"
              />
            </figure>

            <h2>Leaderboard runs</h2>
            <ul>
              <li>Play on Blackout with admin mode off for the whole run.</li>
              <li>Win faster than the top rescuer (any win counts while the board is empty). The timer at top right stops when you lift the child.</li>
              <li>Runs under about 15.7 seconds or over an hour are rejected.</li>
              <li>Submit a nickname of 3 to 20 letters (a to z) and a country, at most once every 10 seconds and 5 times an hour.</li>
            </ul>

            <h2>Common mistakes</h2>
            <ul>
              <li><strong>Sprinting everywhere.</strong> A wider trail, louder steps, and no stamina when a chase starts.</li>
              <li><strong>Trying to outrun a predator.</strong> Run to cover, not away.</li>
              <li><strong>Pressing H behind a rock or log.</strong> Only bramble works.</li>
              <li><strong>Camping one bush.</strong> Shuffle or move on before the brush gives you away.</li>
              <li><strong>Holding the veil until it locks.</strong> Short pulses keep it ready.</li>
              <li><strong>Veiling against a scent chase.</strong> The veil cuts sight only; use G or Q.</li>
              <li><strong>Sprinting into the wind near the Beacon Hunter.</strong> That is exactly what calls it.</li>
            </ul>
          </div>
        </article>
        <footer className="devlog-footer">
          <p><Link href="/">Play Lullwood free in your browser</Link></p>
          <p><Link href="/devlog">Read the Lullwood devlog</Link> for how these systems were built.</p>
        </footer>
      </main>
    </>
  );
}
