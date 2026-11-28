import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { socialImage } from "@/lib/seo";

// Player guide (SEO): walk or run? Every number below was read from the shipped
// code on origin/release/next (3a184da) the day this was written:
//   lib/game/noise.ts      NOISE_RADIUS_WALK (14), NOISE_RADIUS_RUN (24),
//                          NOISE_RADIUS_RUN_WIND (24 * 0.7 = 16.8), HEAR_CHANCE_PER_SEC (0.5)
//   lib/game/stamina.ts    STAMINA_SPRINT_MUL (1.8), STAMINA_DRAIN_TIME (6),
//                          STAMINA_REGEN_MUL (0.4 -> 6 / 0.4 = 15 s), WIND_ASSIST_SPEED_MUL (1.2),
//                          sprintSpeedMul() (linear 1.8 -> 1.0, never below walk speed)
//   lib/game/scent.ts      SCENT_RADIUS_WALK (2.2), SCENT_RADIUS_RUN (3.6), SCENT_VEIL_STAMINA_COST (0.3)
//   lib/game/mud.ts        MUD_SPEED_MUL (0.6), MUD_NOISE_MUL (1.5)
//   engine/tuning.js       CONFIG.walk (6), BRAMBLE_SNAG_DURATION_S (0.3), BRAMBLE_SNAG_SPEED_MUL (0.4),
//                          ROOST_TRIGGER_RADIUS (6), ROOST_NOISE_RADIUS (14), ROOST_COOLDOWN (32),
//                          BEACON_HUNTER_LOCK_MUL (1.0), CHASE_GAP (28), PSPEC budgets (6 / 9 / 4)
//   engine/forest-engine.js  the movement block (maxSpd = walk * sprintSpeedMul(staminaCharge);
//                          noiseRadius picks NOISE_RADIUS_RUN on `running`, not on stamina),
//                          the roam branch of updatePredators() (sight, scent, Beacon Hunter, then
//                          noise, in that order), updateRoosts(), enterHide()/exitHide(),
//                          HINT_TEXT.stamina, hearNoise() (the "heard you" caption).
//   components/Hud.tsx     the Stamina readout sits inside #panel, which GameCanvas.tsx hides
//                          unless Admin mode is on (SettingsPanel.tsx, default off).
// A retune there makes this copy stale, so check it when those constants move.
// Deliberately silent on: a stamina bar for ordinary players (there is none),
// any noise readout (there is none), and stamina as a detection input (no
// predator code reads staminaCharge; it limits speed and pays for the veil).
const TITLE = "Walk or Run in Lullwood? What Sprinting Costs You";
const DESCRIPTION =
  "Walk or run in Lullwood? Sprinting makes footsteps carry 24 units instead of 14 and widens your scent trail, and it still cannot outrun a chasing predator.";
const PUBLISHED = "2026-11-23";
const MODIFIED = "2026-11-23";
const PATH = "/guides/sprinting";
const PAGE_URL = `${SITE_URL}${PATH}`;

// No table styles exist in app/globals.css and that file is outside this
// page's allowed paths, so the one table carries its own.
const TABLE_STYLE = { width: "100%", borderCollapse: "collapse", fontSize: 15, marginBottom: 20 } as const;
const CELL_STYLE = { border: "1px solid #1e2d42", padding: "10px 12px", verticalAlign: "top", textAlign: "left" } as const;

// Rendered below and emitted as FAQPage JSON-LD from this one list, so the
// markup cannot drift from the visible text. None of these questions is in
// lib/faq.ts, /how-to-survive or /guides/controls: the same Q&A on two URLs
// is duplicate structured data.
const QA = [
  {
    question: "Does sprinting make noise in Lullwood?",
    answer:
      "Yes. Walking, your footsteps carry 14 units. Sprinting, they carry 24, which is nearly three times the ground. A roaming predator inside that radius has a 50% chance each second to hear you and come to investigate. Standing still or hiding makes no footstep noise.",
  },
  {
    question: "How long does stamina last when you sprint in Lullwood?",
    answer:
      "Holding Shift empties stamina in about six seconds, and walking refills it in about fifteen. Stamina only limits the speed bonus: sprint speed falls from 10.8 units a second to the walking 6 as it drains. It does not change how predators detect you, but a sprint that empties it leaves nothing for the scent veil, which costs 30%.",
  },
  {
    question: "Does sprinting change how far predators see you in Lullwood?",
    answer:
      "No. Sprinting changes how far your footsteps carry and how wide your scent trail is, and nothing in the sight check takes your pace into account. Difficulty, the mist veil, fog tides, firefly glow and hiding do.",
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
        { "@type": "ListItem", position: 3, name: "Walk or run?", item: PAGE_URL },
      ],
    },
    faqJsonLd,
  ],
};

export default function SprintingGuidePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static object above; escape "<" so an edit can't break out of the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / <Link href="/guides">Guides</Link> / Walk or run?
        </nav>
        <article>
          <header>
            <h1>Walk or run in Lullwood?</h1>
            <time dateTime={MODIFIED}>Updated November 23, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              In Lullwood, Shift makes you up to 1.8 times faster but widens
              how far a predator can hear your footsteps from 14 units to 24.
              Walk when a predator could be near. Even a full sprint, 10.8
              units a second, is slower than any predator in a real chase.
            </p>

            <h2>How far does sprinting carry in Lullwood?</h2>
            <p>
              Shift is the one thing that changes the number. Walking, your
              footsteps carry 14 units. Sprinting, they carry 24: 71% further,
              which is nearly three times the ground a predator can hear you
              from. Stand still or hide and you make no footstep noise at all.
            </p>
            <table style={TABLE_STYLE}>
              <thead>
                <tr>
                  <th scope="col" style={CELL_STYLE}>What changes</th>
                  <th scope="col" style={CELL_STYLE}>Walking</th>
                  <th scope="col" style={CELL_STYLE}>Sprinting (Shift)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" style={CELL_STYLE}>Footsteps carry</th>
                  <td style={CELL_STYLE}>14 units</td>
                  <td style={CELL_STYLE}>24 units</td>
                </tr>
                <tr>
                  <th scope="row" style={CELL_STYLE}>Scent trail radius</th>
                  <td style={CELL_STYLE}>2.2 units</td>
                  <td style={CELL_STYLE}>3.6 units</td>
                </tr>
                <tr>
                  <th scope="row" style={CELL_STYLE}>Speed</th>
                  <td style={CELL_STYLE}>6 units a second</td>
                  <td style={CELL_STYLE}>Up to 10.8, falling back to 6 as stamina drains</td>
                </tr>
              </tbody>
            </table>
            <p>
              Sprinting straight into the wind is the one exception that helps:
              footsteps carry 16.8 units instead of 24 and you move 20% faster
              than a normal sprint, up to about 13 units a second. It is also
              the exact move the Beacon Hunter wolf reads, covered below.
            </p>

            <h2>How does a predator hear you?</h2>
            <p>
              A roaming predator checks for you every frame. Inside the radius
              it has a 50% chance per second to hear you, so crossing the line
              is neither an instant catch nor safe. A predator that hears you
              comes to investigate. Sight and scent are checked first, so noise
              only matters for one that has neither seen nor smelled you. The
              scent rules are in the{" "}
              <Link href="/how-to-survive">Lullwood survival guide</Link>.
            </p>

            <h2>What else does sprinting cost in Lullwood?</h2>
            <ul>
              <li>
                <strong>A wider scent trail.</strong> Each footprint is picked
                up from 3.6 units instead of 2.2, so a predator crossing your
                path finds the trail more easily.
              </li>
              <li>
                <strong>A speed bonus that runs out.</strong> Holding Shift
                empties stamina in 6 seconds, and your speed falls in a
                straight line from 10.8 to 6 as it does. A full tank covers
                about 50 units in those six seconds, against 36 walking.
                Refilling takes about 15 seconds without Shift, and holding it
                drains stamina even when you are standing still.
              </li>
              <li>
                <strong>An empty tank is still loud.</strong> At zero stamina
                you move at walking speed, never slower, but the 24 unit radius
                follows Shift, not stamina. You get none of the speed and all
                of the noise.
              </li>
              <li>
                <strong>Less left for the veil.</strong> Breaking a scent lock
                with G costs 30% of your stamina, so a sprint that empties it
                leaves you without the break.
              </li>
              <li>
                <strong>A stumble at bramble.</strong> Diving into bramble with
                Shift held, or leaving it the same way, snags you for 0.3
                seconds at 40% speed. Let go of Shift a step before it.
              </li>
              <li>
                <strong>Roosts.</strong> There are five fixed roost sites in
                the canopy. Run within 6 units of one and the flock bursts
                into the air. Any predator within 14 units of the roost goes to
                investigate it, the way it would a{" "}
                <Link href="/guides/throwing-stones">thrown stone</Link>. The
                roost then stays quiet for 32 seconds. Walking past does
                nothing.
              </li>
              <li>
                <strong>The Beacon Hunter.</strong> The first wolf in every
                run locks onto you the moment you sprint into the wind inside
                its ordinary sight range, with no line of sight and no scent
                needed. See the{" "}
                <Link href="/guides/wolves">wolf guide</Link>.
              </li>
              <li>
                <strong>Mud.</strong> A mud zone cuts your speed to 60% and
                multiplies your footstep radius by 1.5, so walking carries 21
                units and sprinting 36. Rain does the opposite, cutting the
                radius by up to 35: see{" "}
                <Link href="/guides/rain">does rain help you sneak</Link>.
              </li>
            </ul>

            <h2>What does sprinting not change in Lullwood?</h2>
            <p>
              How far a predator sees you. That depends on the difficulty
              tier, the mist veil, fog tides, time of night, firefly glow,
              standing on a rock and hiding. Your pace is not an input.
            </p>
            <p>
              It also does not change the chase. A predator in a real chase
              runs at about 13.9 units a second for a bear, 15.5 for a wolf
              and 17.8 for a lion, all faster than your 10.8. Sprinting gets
              you to bramble sooner; it does not get you away. The one gap you
              can use is a flanking wolf&apos;s slow trot, covered in the{" "}
              <Link href="/guides/wolves">wolf guide&apos;s speed section</Link>.
            </p>

            <h2>What does Lullwood show you about sprinting?</h2>
            <ul>
              <li>
                <strong>No noise readout.</strong> Nothing on screen shows the
                14 or the 24, or where the edge is.
              </li>
              <li>
                <strong>A heard-you caption, if you turn it on.</strong>{" "}
                Captions are off by default. With them on, a predator that
                hears you prints &ldquo;wolf heard you&rdquo; with near or far
                and which side. It is the only direct confirmation.
              </li>
              <li>
                <strong>Stamina is mostly a feel.</strong> The Stamina
                percentage exists, but it sits in the Admin mode panel, which
                is off by default, and a run with Admin mode on cannot count
                as the top rescuer. Without it you get a short low tone when
                stamina drops below about 45%, and the first time it hits
                zero, with hints on, a caption reading &ldquo;out of breath —
                walk to recover, running lays a wider scent trail.&rdquo;
              </li>
            </ul>

            <h2>When is running worth it in Lullwood?</h2>
            <ul>
              <li>
                <strong>Short dashes with nothing in earshot.</strong> Stamina
                is only spent while Shift is held, and about 15 seconds of
                walking gives all of it back.
              </li>
              <li>
                <strong>The last stretch to bramble, and then walk in.</strong>{" "}
                Hide with H once you are at it; see{" "}
                <Link href="/how-to-survive">how to survive Lullwood</Link>.
              </li>
              <li>
                <strong>Not past a roost, and not into the wind near a wolf
                you have not identified.</strong> Both are sprint-only
                triggers.
              </li>
              <li>
                <strong>Not as an escape.</strong> A chasing predator is
                faster than a full sprint, and an empty one is walking speed
                at run volume.
              </li>
            </ul>
            <p>
              Shift is hold-to-run by default, and the{" "}
              <Link href="/guides/controls">Lullwood controls guide</Link>{" "}
              covers the Settings option that turns it into a toggle. To try
              all of this yourself, play Lullwood free at{" "}
              <a href="https://www.lullwoodgame.com">www.lullwoodgame.com</a>.
            </p>

            <h2>Questions about sprinting in Lullwood</h2>
            {QA.map(({ question, answer }) => (
              <div key={question}>
                <h3>{question}</h3>
                <p>{answer}</p>
              </div>
            ))}
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
