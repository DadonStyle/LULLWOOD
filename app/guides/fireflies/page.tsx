import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Player guide (SEO): do fireflies help? Every number below was read from the
// shipped code on origin/release/next (56d50eb) the day this was written:
// lib/game/fireflyDetect.ts, fireflyClusters.ts, fireflyAlarmResponse.ts,
// eventSites.ts (sitesNear), timeOfDay.ts, engine/tuning.js (FIREFLY_*,
// DIFFICULTY_PRESETS, PSPEC) and engine/forest-engine.js (activeFirefly*
// cluster lists, effectiveDetect/canSee, the mote brightness loop, hint text).
// A retune there makes this copy stale, so check it when those constants move.
// Deliberately silent on: any claim that fireflies light the ground (the motes
// are additive points, not lights), and any "early warning" promise (the alarm
// is predator-to-cluster distance, not predator-to-player).
const TITLE = "Do Fireflies Help in Lullwood? Up to 30% More Visible";
const DESCRIPTION =
  "Do fireflies help in Lullwood? No: a firefly cluster's glow raises how far predators can see you by up to 30%. When they appear and what rain does.";
const PUBLISHED = "2026-10-28";
const MODIFIED = "2026-10-28";
const PAGE_URL = `${SITE_URL}/guides/fireflies`;
// Same text as app/opengraph-image.alt.txt / twitter-image.alt.txt.
const SOCIAL_IMAGE_ALT = "Lullwood: a glowing child alone in a foggy night forest, first-person browser horror game";

export const metadata: Metadata = {
  // `absolute`: the layout template would append " — Lullwood" to a title that
  // already leads with the brand.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/guides/fireflies" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/guides/fireflies",
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
        { "@type": "ListItem", position: 3, name: "Do fireflies help?", item: PAGE_URL },
      ],
    },
  ],
};

export default function FirefliesGuidePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static object above; escape "<" so an edit can't break out of the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / <Link href="/guides">Guides</Link> / Do fireflies help?
        </nav>
        <article>
          <header>
            <h1>Do fireflies help in Lullwood?</h1>
            <time dateTime={MODIFIED}>Updated October 28, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              Fireflies do not help you survive in Lullwood. They make you
              easier to see. Standing inside a firefly cluster raises how far
              predators can spot you by up to 30%, strongest at the
              cluster&apos;s center and fading to nothing 45 units out. They
              only appear if your device clock says between 5 pm and 4 am.
            </p>

            <h2>How much do fireflies raise your detection?</h2>
            <p>
              Each cluster has a 45-unit radius. Your exposure to it is 1 at
              the center, falls in a straight line, and reaches 0 at the edge.
              A predator&apos;s sight range is multiplied by 1 plus 0.3 times
              that exposure.
            </p>
            <ul>
              <li>
                <strong>At the center: sight × 1.3.</strong> On base sight,
                before difficulty, time of day and run length, a wolf&apos;s 42
                units becomes about 55, a bear&apos;s 30 becomes 39 and a
                lion&apos;s 48 becomes about 62.
              </li>
              <li>
                <strong>Halfway out, about 22 units: sight × 1.15.</strong>{" "}
                Half the penalty for half the walk.
              </li>
              <li>
                <strong>At the edge, 45 units out: no change.</strong>
              </li>
              <li>
                <strong>Clusters do not stack.</strong> If two overlap you take
                the stronger one, never the sum.
              </li>
            </ul>
            <p>
              The glow is one more factor in the same product as the
              difficulty tier and the mist veil, so the percentage is the same
              everywhere, whatever the other factors shrink or grow the
              base sight to.
            </p>

            <h2>When do fireflies appear in Lullwood?</h2>
            <p>
              Lullwood reads your device clock once, when the run loads. From
              5 pm to 8 pm the forest counts as evening, and from 8 pm to 4 am
              as night. In both, six clusters are switched on. At any other
              hour there are none, so there is no glow and no penalty. The
              clock is not read again during the run.
            </p>
            <ul>
              <li>
                <strong>Night already helps you a little.</strong> From 8 pm to
                4 am predators see 20% less far (× 0.8). At a cluster&apos;s
                center that is 0.8 × 1.3 = 1.04, so the glow hands the whole
                night discount back. Evening has no discount to lose.
              </li>
              <li>
                <strong>Phones draw four of six, and all six count.</strong> A
                phone renders only the first four clusters to save work, but
                the detection penalty applies to all six. You can be exposed
                standing in a glow you cannot see.
              </li>
            </ul>

            <h2>Where are the fireflies?</h2>
            <p>
              The six clusters are fixed and sit in the same places every run.
              You start in the middle of the 480-unit map; the nearest cluster
              is about 100 units from your start and the farthest about 260.
              The lights brighten as you close in and fade to nothing at 45
              units, using the same falloff as the penalty. In dry weather,
              brighter lights mean a bigger penalty, and the game has a
              caption for it: &ldquo;the brighter you glow, the easier
              predators spot you.&rdquo;
            </p>

            <h2>Does rain make fireflies safer?</h2>
            <p>
              No. Rain dims the lights, to 20% of their dry brightness at full
              rainfall, but it does not touch the penalty. The detection bonus
              is worked out from where you stand and nothing else. A cluster
              that looks faint in the rain is exactly as dangerous as a bright
              one, so do not read a dim glow as permission to rest in it.
            </p>

            <h2>Do the fireflies warn you when a predator is near?</h2>
            <p>
              Only loosely. When a predator gets close to a cluster, the
              lights flare. The alarm starts when the predator is within a
              set range of the cluster (120 units for a wolf, 150 for a bear,
              100 for a lion) and ramps up to 40% brighter as it reaches the
              center. The game captions it &ldquo;they sense danger nearby and
              brighten&rdquo; and plays a short sting the first time in a run.
            </p>
            <ul>
              <li>
                <strong>It measures predator to cluster, not predator to you.</strong>{" "}
                The alarm can be on while the predator is far from you.
              </li>
              <li>
                <strong>Any of the six clusters counts.</strong> With
                several predators out, which is how Blackout starts, the alarm
                can already be on early in a run.
              </li>
              <li>
                <strong>Brighter lights do not raise the penalty.</strong> The
                flare is only the picture; the detection bonus stays the same.
              </li>
            </ul>
            <p>
              Read the flare as &ldquo;a predator is near this glade&rdquo;,
              not as a distance gauge. For distance, use the
              sight and scent rules in the{" "}
              <Link href="/how-to-survive">Lullwood survival guide</Link>.
            </p>

            <h2>How to play around fireflies</h2>
            <ul>
              <li>
                <strong>Do not stop in a cluster.</strong> Resting or waiting
                where the lights are brightest is where predators see you
                farthest.
              </li>
              <li>
                <strong>Cross at the edge, not the center.</strong> Forty-five
                units out costs nothing and halfway costs 15%.
              </li>
              <li>
                <strong>Know where they sit.</strong> The lights fade in from
                nothing at the 45-unit edge, so you cannot see a cluster
                coming. The six positions are fixed, so learn them before
                you need them.
              </li>
            </ul>
            <p>
              For how a predator hunts once it has spotted you, start with the{" "}
              <Link href="/guides/wolves">wolf guide</Link>. Short answers on price, phones and controls are in the{" "}
              <Link href="/faq">Lullwood FAQ</Link>.
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
