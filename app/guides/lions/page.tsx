import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Player guide (SEO): the lion spoke beside /guides/wolves and /guides/bears
// (LUL-6174). Every mechanic below was read from the shipped code on
// origin/release/next (56d50eb) the day this was written:
//   engine/tuning.js          PSPEC.lion (:319 speed/detect/budget/nose),
//                             CHASE_GAP (:325), SCENT_LOCK_ENDURANCE_MULTIPLIER
//                             (:333), DIFFICULTY_PRESETS (:374), CHARGE_COOLDOWN (:383)
//   engine/forest-engine.js   speed = RUN + CHASE_GAP/budget (:2301-2302),
//                             timeOfRunDetectMulFor() lion branch (:3098-3100),
//                             effectiveDetect()/canSee() (:3101-3108), wolf/lion-only
//                             charge gate (:3418-3431), charge resolution (:3194-3210),
//                             scentLock = SCENT_TRACK_TIME * multiplier (:2865),
//                             duskLion hint text (:2709) and its 90 s trigger (:9361),
//                             lion hint "hide (H) or veil (F)" (:2694)
//   lib/game/dayNight.ts      duskLionDetectMul and DUSK_LION_SIGHT_* (:29-43),
//                             TIME_OF_RUN_DETECT_MUL (:11) for wolf and bear
//   lib/game/charge.ts        CHARGE_TRIGGER_MIN/MAX (:40-41), CHARGE_WINDOW/TELL (:52-53)
//   lib/game/veil.ts          VEIL_DETECT_MUL (:36), VEIL_MAX_HOLD (:29)
//   lib/game/scent.ts         SCENT_TRACK_TIME (:28)
// A retune there makes this copy stale, so check it when those constants move.
// Deliberately silent on the mist veil overload (Q): it never breaks a scent
// lock, and that is not this page's subject.
const TITLE = "How to Survive Lions in Lullwood: the Dusk Guide";
const DESCRIPTION =
  "How to survive lions in Lullwood: the fastest hunter gives about 4 seconds' warning, then goes half-blind at dusk. Hide, veil, jump the charge.";
const PUBLISHED = "2026-11-02";
const MODIFIED = "2026-11-02";
const PAGE_URL = `${SITE_URL}/guides/lions`;
// Same text as app/opengraph-image.alt.txt / twitter-image.alt.txt.
const SOCIAL_IMAGE_ALT = "Lullwood: a glowing child alone in a foggy night forest, first-person browser horror game";

export const metadata: Metadata = {
  // `absolute`: the layout template would append " — Lullwood" to a title that
  // already leads with the brand.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/guides/lions" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/guides/lions",
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
      image: `${SITE_URL}/screenshots/lullwood-dense-pine-forest-snow.png`,
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
        { "@type": "ListItem", position: 3, name: "How to survive lions", item: PAGE_URL },
      ],
    },
  ],
};

export default function LionsGuidePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static object above; escape "<" so an edit can't break out of the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / <Link href="/guides">Guides</Link> / How to survive lions
        </nav>
        <article>
          <header>
            <h1>How to survive lions in Lullwood</h1>
            <time dateTime={MODIFIED}>Updated November 2, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              To survive a lion in Lullwood, get out of its sight before it
              sees you: once it does you have about 4 seconds, the shortest
              warning of any predator. Hide in bramble (<strong>H</strong>) or
              hold the mist veil (<strong>F</strong>), and jump when it
              charges. Its sight fades after 90 seconds of a run.
            </p>

            <h2>Why a lion is not a wolf or a bear</h2>
            <p>
              A lion shares the wolf&apos;s charge and the bear&apos;s lack of
              a pack, and then differs from both. It is the fastest hunter, the
              farthest-seeing, the worst at following a trail, and the only
              predator whose senses get worse as the run goes on.
            </p>
            <ul>
              <li>
                <strong>It is the fastest.</strong> A lion in a real chase runs
                at about 17.8 units a second. A wolf runs at 15.5, a bear at
                13.9, and your full sprint is 10.8. Its warning budget is 4
                seconds, against 6 for a wolf and 9 for a bear, so once a lion
                has seen you there is time to reach cover and no time to try
                anything else.
              </li>
              <li>
                <strong>It sees the farthest.</strong> About 48 units, against
                42 for a wolf and 30 for a bear. Sight is the lion&apos;s main
                sense, which is why the mist veil helps most against it.
              </li>
              <li>
                <strong>It has the weakest nose.</strong> It smells a trail from
                a smaller radius than a wolf or a bear, and a scent chase on
                your trail lasts about 6 seconds, against 8 for a wolf and
                about 11 for a bear. Scent is the lion&apos;s second sense, not
                its first.
              </li>
              <li>
                <strong>It hunts alone.</strong> Only wolves coordinate, so
                there is no flank to break and no Beacon Hunter to read. The
                sideways cut from{" "}
                <Link href="/guides/wolves">the wolf guide</Link> answers a
                threat a lion never makes.
              </li>
            </ul>

            <h2>The dusk window: the lion goes half-blind</h2>
            <p>
              For the first 90 seconds of a run a lion sees at full range. From
              90 seconds its sight shrinks in a straight line, to half its
              range at 150 seconds, and stays there for the rest of the run. At
              120 seconds it sees at three quarters of its range. The game
              tells you when it starts with a hint: <em>as night falls, the
              lion&apos;s sight weakens, darkness favors the quiet.</em>
            </p>
            <p>
              This is the opposite of what the night does to the other two. Wolves
              and bears gain sight as the run goes on, up to 30% more by 120
              seconds, so the same night that blinds the lion makes a wolf or a
              bear harder to hide from. If you want to cross open ground near a
              lion, the second half of a run is when it is cheapest.
            </p>
            <p>
              Dusk changes nothing else. A half-blind lion is still the fastest
              animal in the forest, still charges, and still follows your scent.
              It sees you from half as far, not from nowhere.
            </p>

            <figure>
              <Image
                src="/screenshots/lullwood-dense-pine-forest-snow.png"
                alt="Low-poly pine trees, snow-covered boulders and a snowy slope under a starry sky in Lullwood's night forest: trunks and rocks like these break a lion's line of sight"
                width={3840}
                height={2160}
                sizes="(min-width: 640px) 592px, 100vw"
              />
            </figure>

            <h2>What to do in the first 90 seconds</h2>
            <ul>
              <li>
                <strong>Break the line before it spots you.</strong> The warning
                clock starts when the lion sees you, not when you see it. Keep
                trunks, rocks and bramble between you and any lion you hear or
                spot, and walk instead of sprinting so you lay a thin scent
                trail.
              </li>
              <li>
                <strong>Use the mist veil.</strong> Holding F cuts predator
                sight to 35% of its range. That is a bad trade against a bear,
                which tracks you by scent, and a good one against a lion, which
                tracks you by sight. A hold lasts up to 5 seconds before the
                veil is spent, and it refills more slowly than it drains, so
                use it as you cross a lion&apos;s line of sight, not while you
                wait.
              </li>
              <li>
                <strong>Hide and hold still.</strong> The lion&apos;s sight
                range falls the longer you stay motionless in bramble. The full
                rules are in the{" "}
                <Link href="/how-to-survive">Lullwood survival guide</Link>.
              </li>
              <li>
                <strong>Do not run.</strong> You cannot outrun it, and a sprint
                lays a wider scent trail while you do it.
              </li>
            </ul>

            <h2>How to beat a lion&apos;s charge</h2>
            <p>
              Lions and wolves are the only predators that charge, and a bear
              never does. A lion that can see you, while you can see it, rolls
              for a charge whenever it is between 7 and 16 units away. A short
              tell comes first, about a third of a second, then the lunge. The
              whole thing lasts one second.
            </p>
            <ul>
              <li>
                <strong>Jump inside that second.</strong> The lion overshoots
                the spot you were standing on and cannot charge again for 10
                seconds.
              </li>
              <li>
                <strong>Do not hide mid-charge.</strong> Once it has committed
                to a line, the charge does not check whether it can still see
                you. It resolves by position alone, so ducking into bramble
                after the tell does not save you. A jump does.
              </li>
              <li>
                <strong>Breaking line of sight prevents it.</strong> A charge
                only starts while the lion can see you. The best answer to a
                charge is the one that never begins.
              </li>
            </ul>

            <h2>How the lion changes by difficulty</h2>
            <ul>
              <li>
                <strong>Lantern:</strong> one lion, with its sight cut to 70%
                (about 34 units). The place to learn the charge.
              </li>
              <li>
                <strong>Night:</strong> three lions at full sight (48 units) and
                a minimap, so you can see where they have gone.
              </li>
              <li>
                <strong>Blackout</strong> (the default): three lions at 70%
                sight, all hunting from the start, and no minimap. The 70%
                stacks with the dusk fade: by 150 seconds a Blackout lion sees
                about 17 units.
              </li>
            </ul>

            <p>
              The one thing to carry out of this page: a lion is a clock, not
              a puzzle. Stay unseen early, use the veil to cross its line, jump
              the charge, and cross open ground after 90 seconds, when it
              sees half as far. What counts as a win is in{" "}
              <Link href="/guides/how-to-win">how to win Lullwood</Link>.
            </p>
          </div>
        </article>
        <footer className="devlog-footer">
          <p>
            <Link href="/guides/wolves">Read how to survive wolves in Lullwood</Link>{" "}
            for the pack flank, and{" "}
            <Link href="/guides/bears">how to escape a bear</Link> for the
            scent lock.
          </p>
          <p><Link href="/guides">See all Lullwood guides</Link></p>
          <p><Link href="/">Play Lullwood free in your browser</Link></p>
        </footer>
      </main>
    </>
  );
}
