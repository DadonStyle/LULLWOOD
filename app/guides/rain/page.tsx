import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { socialImage } from "@/lib/seo";

// Player guide (SEO): does rain help you sneak? Every number below was read
// from the shipped code on origin/release/next (7eaf116) the day this was
// written: lib/game/rainfallEvent.ts (RAINFALL_CONFIG, RAINFALL_NOISE_MUL,
// RAINFALL_RAMP, RAINFALL_FOG_BOOST, rainfallNoiseScalar), lib/game/
// eventScheduler.ts (phase math), lib/game/noise.ts (NOISE_RADIUS_*,
// HEAR_CHANCE_PER_SEC) and engine/forest-engine.js (the tick that eases
// rainfallAmount, the one updatePredators() call that takes the noise scalar,
// the fog line, the rain audio bed and the HINT_TEXT entry).
// A retune there makes this copy stale, so check it when those constants move.
// Deliberately silent on: any claim that rain changes predator sight, scent or
// speed (the code feeds rain into none of them), and the volume of the rain
// bed (a gain value, not something a player can read).
const TITLE = "Does Rain Help You Sneak in Lullwood? Footsteps Carry 35% Less";
const DESCRIPTION =
  "Does rain help you sneak in Lullwood? Partly: for 20 seconds of every 80, footsteps carry 35% less far. Sight and scent are unchanged, and the fog thickens.";
const PUBLISHED = "2026-11-22";
const MODIFIED = "2026-11-22";
const PATH = "/guides/rain";
const PAGE_URL = `${SITE_URL}${PATH}`;

// No table styles exist in app/globals.css and that file is outside this
// page's allowed paths, so the one table carries its own.
const TABLE_STYLE = { width: "100%", borderCollapse: "collapse", fontSize: 15, marginBottom: 20 } as const;
const CELL_STYLE = { border: "1px solid #1e2d42", padding: "10px 12px", verticalAlign: "top", textAlign: "left" } as const;

// Rendered below and emitted as FAQPage JSON-LD from this one list, so the
// markup cannot drift from the visible text. None of these questions is in
// lib/faq.ts (the home page / /faq list): the same Q&A on two URLs is
// duplicate structured data.
const QA = [
  {
    question: "Does rain help you sneak in Lullwood?",
    answer:
      "Partly. For 20 seconds of every 80-second cycle, rain cuts how far your footsteps carry by 35%, so a wandering predator has to be closer to hear you. It does not change how far predators see you or how far they smell you, and it thickens the fog.",
  },
  {
    question: "How long does rain last in Lullwood?",
    answer:
      "Rain runs on an 80-second cycle: 50 seconds of nothing, about 10 seconds of rain sound as a warning, then 20 seconds of rain. The effect eases in and out over a few seconds rather than switching on and off.",
  },
  {
    question: "Does rain hide your scent in Lullwood?",
    answer:
      "No. Rain only changes the footstep noise radius and the fog. The scent trail and the distance predators can smell you from are the same in rain as out of it.",
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
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: PATH,
    siteName: SITE_NAME,
    locale: "en_US",
    type: "article",
    images: [socialImage(TITLE)],
    publishedTime: PUBLISHED,
    modifiedTime: MODIFIED,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [socialImage(TITLE)],
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
        { "@type": "ListItem", position: 3, name: "Does rain help you sneak?", item: PAGE_URL },
      ],
    },
    faqJsonLd,
  ],
};

export default function RainGuidePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static object above; escape "<" so an edit can't break out of the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / <Link href="/guides">Guides</Link> / Does rain help you sneak?
        </nav>
        <article>
          <header>
            <h1>Does rain help you sneak in Lullwood?</h1>
            <time dateTime={MODIFIED}>Updated November 22, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              Partly. In Lullwood, rain cuts how far your footsteps carry by
              35% for 20 seconds of every 80. A wandering predator has to be
              closer to hear you. Rain does not change how far predators see
              or smell you, and it makes the fog thicker.
            </p>

            <h2>What does rain change in Lullwood?</h2>
            <table style={TABLE_STYLE}>
              <thead>
                <tr>
                  <th scope="col" style={CELL_STYLE}>Rain changes</th>
                  <th scope="col" style={CELL_STYLE}>Rain does not change</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={CELL_STYLE}>
                    <strong>Footstep noise radius: × 0.65.</strong> Walking
                    14 units becomes 9.1; running 24 becomes 15.6.
                  </td>
                  <td style={CELL_STYLE}>
                    <strong>How far predators see you.</strong> Sight range
                    has no rain input.
                  </td>
                </tr>
                <tr>
                  <td style={CELL_STYLE}>
                    <strong>Fog density: +0.08.</strong> The base is 0.04, so
                    at full rain the fog is three times as dense.
                  </td>
                  <td style={CELL_STYLE}>
                    <strong>Your scent trail.</strong> How much you leave and
                    how far a predator smells it are the same.
                  </td>
                </tr>
                <tr>
                  <td style={CELL_STYLE}>
                    <strong>Sound.</strong> A rain bed fades in about 10
                    seconds before the rain proper.
                  </td>
                  <td style={CELL_STYLE}>
                    <strong>The child&apos;s cry and thrown stones.</strong>{" "}
                    Both are separate noises that rain does not dampen.
                  </td>
                </tr>
                <tr>
                  <td style={CELL_STYLE}>
                    <strong>Firefly lights dim</strong> to 20% of their dry
                    brightness.
                  </td>
                  <td style={CELL_STYLE}>
                    <strong>The firefly detection penalty.</strong> See{" "}
                    <Link href="/guides/fireflies">the fireflies guide</Link>.
                  </td>
                </tr>
              </tbody>
            </table>
            <p>
              The footstep multiplier is applied in one place: the check that
              lets a wandering predator hear you. Sight and scent are checked
              first, and neither takes rain into account.
            </p>

            <h2>How long does rain last in Lullwood?</h2>
            <p>
              Rain runs on an 80-second cycle: 50 seconds of nothing, 10
              seconds of rain sound as a warning, then 20 seconds of rain. The
              cycle only advances while you are playing, and a restart does
              not reset it, so the rain can arrive at any point in a run. The
              effect is eased, not switched: it builds over a few seconds
              and fades out the same way, so the full 35% is not there the
              instant the rain starts.
            </p>
            <p>
              That makes rain a window, not a strategy. For three-quarters of
              every cycle it is not raining, and the one change that always
              comes with it is thicker fog that shortens how far you can see
              too.
            </p>

            <h2>Does the game tell you about rain?</h2>
            <p>
              Yes, once. The first time rain is falling, a caption reads
              &ldquo;rain masks footsteps — predators&apos; noise detection
              drops.&rdquo; It shows for a few seconds, only once per install,
              and not at all if you have turned hints off in Settings. The
              rain sound arrives about 10 seconds earlier than the caption.
            </p>

            <h2>How do you use the rain window?</h2>
            <ul>
              <li>
                <strong>Spend it on distance from a roaming predator.</strong>{" "}
                A wandering predator can only hear you inside the noise radius,
                and in rain that radius is a third smaller. If one is close
                but has not noticed you, this is the window to move past it.
              </li>
              <li>
                <strong>Walk anyway.</strong> A run in the rain, at 15.6 units,
                is still louder than a dry walk at 14.
              </li>
              <li>
                <strong>Do not count on it against a predator that can see
                you.</strong> Sight is checked before noise, and rain does not
                touch it. Breaking line of sight is still the job; see the{" "}
                <Link href="/guides/wolves">wolf guide</Link> and the{" "}
                <Link href="/guides/bears">bear guide</Link>.
              </li>
              <li>
                <strong>Remember the fog cuts both ways.</strong> The same
                rain that quiets you thickens the mist you have to navigate by.
              </li>
            </ul>
            <p>
              Hearing is a roll, not an instant catch: inside the radius, a
              predator has a 50% chance per second to notice you. Rain shrinks
              the radius; it does not make you silent. For the rest of the
              sight, scent and hiding rules, read the{" "}
              <Link href="/how-to-survive">Lullwood survival guide</Link>.
              Short answers on price, phones and controls are in the{" "}
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
