import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Player guide (SEO): what Lantern, Night and Blackout change. Every number
// is read from origin/release/next at 6b536bb, the day this was written, and
// the sight/roster/minimap/apply-timing claims were also checked in a local
// build of that commit: engine/tuning.js DIFFICULTY_PRESETS (:374-377),
// engine/forest-engine.js (placePredators :2425/:2441, canSee/effectiveDetect
// :3103/:3107, rustle :8382-8383, setDifficulty :8051-8066, child spawn
// :1455), lib/game/mission.ts (BLACKOUT_MIN_RADIUS), lib/game/noise.ts,
// lib/game/economy.ts (TIER_MULTIPLIERS) and components/GameCanvas.tsx
// (the admin-gated minimap rule). A retune there makes this copy stale, so
// re-check it when those constants move.
const TITLE = "Is Lullwood Too Hard? Lantern, Night and Blackout";
const DESCRIPTION =
  "Is Lullwood too hard? New players start on Blackout, the hardest of three tiers. What Lantern, Night and Blackout change and how to switch.";
const PUBLISHED = "2026-10-29";
const MODIFIED = "2026-10-29";
const PATH = "/guides/difficulty-tiers";
const PAGE_URL = `${SITE_URL}${PATH}`;
// Same text as app/opengraph-image.alt.txt / twitter-image.alt.txt.
const SOCIAL_IMAGE_ALT = "Lullwood: a glowing child alone in a foggy night forest, first-person browser horror game";

// Not the questions on /faq (lib/faq.ts): the same Q&A on two URLs is
// duplicate structured data.
const QA = [
  {
    question: "Is there an easy mode in Lullwood?",
    answer:
      "Yes. Lantern is the forgiving tier: one wolf, one bear and one lion instead of three of each, predators that see 30% less far than on Night, a child whose glow is 1.6 times as strong, and a longer wait before hiding in one spot starts to rustle. Pick it in Settings under Difficulty.",
  },
  {
    question: "What is the default difficulty in Lullwood?",
    answer:
      "Blackout. A new player starts on the hardest of the three tiers: nine predators that begin hunting, no minimap and, once the setting is saved, a child who spawns at least 192 units from where you start. The setting you choose is saved in your browser.",
  },
  {
    question: "Do wolves, bears and lions see further on Blackout?",
    answer:
      "No. Blackout predators see 30% less far than Night predators, the same reduction Lantern has. Blackout is harder because there are nine of them, they start hunting, you get no minimap, and the brush gives you away sooner when you hide too long.",
  },
  {
    question: "Does Lullwood have a minimap?",
    answer:
      "Not for a normal run on any tier. Blackout turns the minimap off, and Lantern and Night only show it when Admin mode is switched on in Settings. A run with Admin mode on cannot count for the leaderboard.",
  },
  {
    question: "Which Lullwood difficulty counts for the leaderboard?",
    answer:
      "Only Blackout, with Admin mode off for the whole run. A win on Lantern or Night shows a note telling you to switch to Blackout to compete.",
  },
];

const faqJsonLd = {
  "@type": "FAQPage",
  mainEntity: QA.map(({ question, answer }) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: { "@type": "Answer", text: answer },
  })),
};

export const metadata: Metadata = {
  // `absolute`: the layout template would append " — Lullwood" to a title that
  // already leads with the brand.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  // A page-level openGraph/twitter object replaces the layout's wholesale, so
  // the root social images are named here (same as the other guides).
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: PATH,
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
        { "@type": "ListItem", position: 3, name: "Difficulty tiers", item: PAGE_URL },
      ],
    },
    faqJsonLd,
  ],
};

export default function DifficultyTiersPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static object above; escape "<" so an edit can't break out of the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / <Link href="/guides">Guides</Link> / Difficulty tiers
        </nav>
        <article>
          <header>
            <h1>Is Lullwood too hard?</h1>
            <time dateTime={MODIFIED}>Updated October 29, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              Lullwood starts you on its hardest setting. A new player is put
              on Blackout, the top of three difficulty tiers, so dying fast
              does not mean you are bad at it. Switch to Lantern in Settings
              for one predator per species, or to Night for three of each at
              full sight. Only Blackout wins reach the leaderboard.
            </p>

            <h2>What do Lantern, Night and Blackout change?</h2>
            <p>
              Each tier is a set of numbers the game reads when you play. The
              forest, the three predator species and the goal (reach the child
              and press E) stay the same.
            </p>
            <ul>
              <li>
                <strong>Lantern, the forgiving tier.</strong> One wolf, one
                bear and one lion in the whole forest. Their sight is cut to
                70% of Night&apos;s. The child&apos;s glow is 1.6 times as
                strong. Hiding in one spot starts to rustle after 16 seconds,
                then every 6. A win pays the base Embers.
              </li>
              <li>
                <strong>Night, the middle tier.</strong> Three of each species,
                nine predators, at full sight. Hiding starts to rustle after 12
                seconds, then every 5. A win pays 1.75 times the base Embers.
              </li>
              <li>
                <strong>Blackout, the default.</strong> Nine predators at 70%
                of Night&apos;s sight, all of them starting out hunting. No
                minimap. Hiding starts to rustle after 8 seconds, then every 4.
                With Blackout selected and saved, the child can spawn no closer
                than 192 units from your start, where the other tiers place her
                120 to 192 units out. A win pays 2 times the base Embers.
              </li>
            </ul>
            <p>
              A rustle is a noise: any roaming predator within 20 units hears
              it and goes to look. The Embers you earn for a loss are also
              scaled by tier, 1 on Lantern, 1.35 on Night and 1.25 on Blackout.
            </p>

            <figure>
              <Image
                src="/screenshots/lullwood-night-forest-pine-trees.png"
                alt="Low-poly pine trees, rocks and a snowbank in Lullwood's night forest under a starry sky, seen from ground level"
                width={3840}
                height={2160}
                sizes="(min-width: 640px) 592px, 100vw"
              />
            </figure>

            <h2>Why is Blackout harder if its predators see less far?</h2>
            <p>
              Because Blackout is not harder predator by predator. Its sight
              multiplier is 0.7, the same as Lantern&apos;s. In the game, at the
              start of a run, a wolf notices you from about 24 units on
              Blackout and Lantern and about 34 on Night; a bear about 17 and
              24; a lion about 27 and 38. That cut was added on purpose: Blackout
              used to match Night&apos;s sight, and nine full-sight predators
              on the longest route could not be balanced against any reward.
            </p>
            <p>
              What makes Blackout hard is everything around the predators.
              There are nine of them rather than three. Each starts in a
              hunting state, which sends it straight at you as soon as it can
              see you; one that loses sight of you drops back to
              investigating. You get no minimap. Hiding in one bush starts
              giving you away after 8 seconds instead of 12. And the child is
              farther away. So on Blackout, move from cover to cover rather than
              waiting out a chase in one bush.
            </p>

            <h2>Is there a minimap in Lullwood?</h2>
            <p>
              Not in a normal run. Blackout switches it off. Lantern and Night
              are set up to show it, but the game hides the minimap for
              everyone unless Admin mode is on in Settings, where the option
              reads &quot;Admin mode (show pace/mist panel + minimap)&quot;.
              Admin mode is off by default, and a run played with it on cannot
              count for the leaderboard. In our check of the current build, the
              minimap was hidden on Lantern and Night with Admin mode off and
              visible with it on.
            </p>

            <h2>How do you change the difficulty in Lullwood?</h2>
            <p>
              Open Settings and choose Difficulty: &quot;Lantern&quot;,
              &quot;Night&quot; or &quot;Blackout&quot;. Before your first step
              into the forest the menu has the same three buttons. The choice is
              saved in your browser and applied again each time the page loads.
            </p>
            <p>
              It does not all apply at once. Sight range, the child&apos;s glow
              and the hiding timers switch immediately. How many predators there
              are, whether they start hunting and where the child stands are
              decided when a run starts, so after you change tier press Try
              again to get the full tier. We saw this directly: choosing
              Lantern from the menu and walking in gave a run with nine
              predators but Lantern sight; the next run had three.
            </p>

            <h2>Which difficulty should you play first?</h2>
            <ul>
              <li>
                <strong>Learning the forest:</strong> Lantern. With one wolf
                there is no pack to flank you; see{" "}
                <Link href="/guides/wolves">how to survive wolves in Lullwood</Link>{" "}
                for what changes when there are three.
              </li>
              <li>
                <strong>Comfortable with hiding:</strong> Night, which has the
                full roster and a longer grace before the brush gives you away.
                For the one predator that tracks you hardest, see{" "}
                <Link href="/guides/bears">how to escape a bear</Link>.
              </li>
              <li>
                <strong>Going for the top rescuer spot:</strong> Blackout, with
                Admin mode off for the whole run.{" "}
                <Link href="/guides/how-to-win">How you win Lullwood</Link>{" "}
                covers the goal, and{" "}
                <Link href="/how-to-survive">how to survive Lullwood</Link>{" "}
                covers hiding and the mist veil.
              </li>
            </ul>

            <h2>Lullwood difficulty questions</h2>
            {QA.map(({ question, answer }) => (
              <div key={question}>
                <h3>{question}</h3>
                <p>{answer}</p>
              </div>
            ))}
          </div>
        </article>
        <footer className="devlog-footer">
          <p><Link href="/">Play Lullwood free in your browser</Link></p>
          <p><Link href="/guides">More Lullwood guides</Link></p>
          <p><Link href="/devlog">Read the Lullwood devlog</Link> for how the game is built.</p>
        </footer>
      </main>
    </>
  );
}
