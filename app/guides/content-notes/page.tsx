import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Content notes (S-028, LUL-6469). Every claim below was read off the shipped
// game on origin/release/next at 0206a79 (2026-11-16); nothing here is stated
// from how the game "feels". Sources, so a retune can find what to re-check:
//   spot stinger + red edge flash   engine/forest-engine.js spotOnto :3838-3847,
//                                   spotSting :4765-4775, spotFlash :8877-8878,
//                                   #spotFlash components/GameCanvas.tsx :1028-1029
//   death sequence                  triggerDeath call sites :3215/:3321/:3455,
//                                   deathAudio :4752-4763 (chomp at +1.35 s),
//                                   <video id="deathVideo"> GameCanvas.tsx :1088
//   first death unskippable         HAS_DIED_KEY :3887-3895, skipCutsceneIfAllowed :3995
//   win flash (white, full screen)  FLASH_PEAK_OPACITY 0.65 :2039, fireBoom :2124-2132,
//                                   hold 1.5 s + 0.3 s fade :2159, #flash background
//                                   #fff GameCanvas.tsx :1055; no motionReduced() check
//   rustle sting + green edge       rustleSting :4783, rollCoverRustle :4473-4481,
//                                   rustleFlash :8883-8884 (reduced motion -> 0.15)
//   approach notes + bearing pulse  pianoTimer :8847-8858 (interval 1.3 s -> 0.35 s
//                                   within 46 units), pianoNote :4805, bearingPulseT
//                                   :8894-8896, #bearingPulse GameCanvas.tsx :1042-1045
//   child's cry                     childCry :3011, cryTimer :9132-9139
//   settings                        components/SettingsPanel.tsx :278-303 (reduced
//                                   motion, captions, Predator Audio), captionsOn
//                                   default false Hud.tsx :387, Sound button Hud.tsx :981
// The death clip (public/death.mp4, 3.54 s, 640x360) was decoded in Chrome and
// 15 evenly spaced frames inspected on 2026-11-16: eyes in black 0-0.8 s, a toothed
// mouth 1.0-1.3 s, red slashes and specks 1.5-3.5 s, fade to black. No body, no wound.
// NOT claimed anywhere on this page: "no jump scares", "no gore", "no flashing",
// an age rating, or any photosensitivity result -- none was established.
const TITLE = "Does Lullwood Have Jump Scares or Gore? Content Notes";
const DESCRIPTION =
  "Does Lullwood have jump scares or gore? It has sudden moments: a sharp stinger, a red edge flash and a 3.5-second death clip. What each is, and how to turn it down.";
const PUBLISHED = "2026-11-16";
const MODIFIED = "2026-11-16";
const PAGE_URL = `${SITE_URL}/guides/content-notes`;
// Same text as app/opengraph-image.alt.txt / twitter-image.alt.txt.
const SOCIAL_IMAGE_ALT = "Lullwood: a glowing child alone in a foggy night forest, first-person browser horror game";

const QUICK = [
  {
    question: "Is Lullwood safe for people sensitive to flashing lights?",
    answer:
      "We cannot say. We have not tested Lullwood for photosensitivity triggers. It has several screen-edge colour pulses and one full-screen white flash when you lift the child, all listed on this page. If flashing light is a risk for you, do not treat this page as a clearance.",
  },
  {
    question: "Can I turn the scary sounds off in Lullwood?",
    answer:
      "Yes. The Sound button in the game silences the game's sound. The Predator Audio slider in Settings lowers predator calls and the death roar, but not the sharp stinger when a predator spots you or the bite sound at the end of the death clip.",
  },
  {
    question: "Can I skip Lullwood's death clip?",
    answer:
      "After your first death, yes: any input skips it. The first time you die it plays in full, about 3.5 seconds.",
  },
];

export const metadata: Metadata = {
  // `absolute`: the layout template would append " — Lullwood" to a title that
  // already leads with the brand.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/guides/content-notes" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/guides/content-notes",
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
      image: `${SITE_URL}/opengraph-image.png`,
      datePublished: PUBLISHED,
      dateModified: MODIFIED,
      inLanguage: "en",
      author: { "@id": `${SITE_URL}#org` },
      publisher: { "@id": `${SITE_URL}#org` },
      mainEntityOfPage: { "@type": "WebPage", "@id": PAGE_URL },
      about: { "@id": `${SITE_URL}#game` },
    },
    {
      "@type": "FAQPage",
      "@id": `${PAGE_URL}#faq`,
      mainEntity: QUICK.map(({ question, answer }) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      })),
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE_URL}/guides` },
        { "@type": "ListItem", position: 3, name: "Content notes", item: PAGE_URL },
      ],
    },
  ],
};

export default function ContentNotesPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static object above; escape "<" so an edit can't break out of the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / <Link href="/guides">Guides</Link> / Content notes
        </nav>
        <article>
          <header>
            <h1>Does Lullwood have jump scares or gore?</h1>
            <time dateTime={MODIFIED}>Updated November 16, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              Lullwood has sudden moments, and we will not call it jump-scare
              free. A predator spotting you triggers a sharp sound and a red
              screen-edge flash; being caught plays a 3.5-second clip of glowing
              eyes, a toothed mouth and red claw marks. The clip shows no body
              or wound.
            </p>
            <p>
              This page is for a cautious player, a parent, or a streamer
              deciding whether Lullwood belongs on a screen. Everything below
              was checked against the game&apos;s code or the death clip itself,
              and where we have not checked something, we say so instead of
              reassuring you.
            </p>

            <h2>What Lullwood is, so you know what you are walking into</h2>
            <p>
              Lullwood is a free first-person horror game that runs in your
              browser. You cross a foggy night forest alone and unarmed to reach
              a lost, glowing child while wolves, bears and lions hunt you by
              sight and scent. The run ends the moment you reach her and press E
              to lift her: that is the win, and there is no trip home
              afterwards. How that works is in{" "}
              <Link href="/guides/how-to-win">how you win Lullwood</Link>.
              We have not been given an official age rating, so this page does
              not give one.
            </p>

            <h2>What can startle you</h2>
            <ul>
              <li>
                <strong>A predator spots you.</strong> A short, sharp stinger
                (high buzzing tones over a low thump, about half a second), the
                predator&apos;s call at part volume, and a red glow around the
                screen edge that fades in about 0.6 seconds. It fires each time
                a predator locks on, so a run with several predators can
                trigger it more than once.
              </li>
              <li>
                <strong>A predator catches you.</strong> The game cuts to the
                death clip (described below), the predator roars, the
                background sound is ducked, and a bite sound lands about 1.35
                seconds in. This is the closest thing Lullwood has to a classic
                jump scare, and it happens when a predator reaches you.
              </li>
              <li>
                <strong>A predator is closing in.</strong> A dissonant piano
                note plays whenever a predator that is chasing or searching for
                you is within 46 units, rising in pitch and getting louder as it nears. The notes
                come about every 1.3 seconds at the edge of that range and as
                fast as every 0.35 seconds when one is very close, each with a
                red glow along the screen edge on the side it is approaching
                from.
              </li>
              <li>
                <strong>The brush rustles.</strong> When you move in cover and
                the leaves give you away, a quick three-burst rustle sounds and
                a green glow shows around the screen edge.
              </li>
              <li>
                <strong>The child&apos;s cry.</strong> It is not a scream: it is
                a soft synthesised tone that repeats every few seconds, faster
                and slightly higher the closer you get, so you can find her by
                ear.
              </li>
              <li>
                <strong>The moment you lift her.</strong> A burst of light and a
                full-screen white flash. It is covered under flashing lights
                below.
              </li>
            </ul>

            <h2>What the death clip shows</h2>
            <p>
              The clip is 3.5 seconds of stylised video, not photographic
              footage. From the first frame to about 0.8 seconds, two glowing
              eyes grow in an almost black screen. At about 1 second a mouth
              full of white teeth fills the screen in a sudden bright cut. From
              about 1.5 seconds the screen turns red with three diagonal claw
              slashes and small red specks, fading to black by 3.5 seconds.
            </p>
            <p>
              We looked for a body, a wound or a victim in it and found none.
              The red specks could read as spatter to some players, and that is
              your call to make rather than ours. The first time you die the
              clip cannot be skipped; after that, any input skips it.
            </p>

            <h2>Flashing lights and photosensitivity</h2>
            <p>
              We have not tested Lullwood against any photosensitivity
              standard, and we make no claim that it is safe for people with
              photosensitive epilepsy. These are the full-screen and
              screen-edge light effects we found in the game&apos;s code,
              and the list may not be complete:
            </p>
            <ul>
              <li>
                <strong>White flash on lifting the child.</strong> Once per run,
                a full-screen white layer at 65% opacity, held about 1.5 seconds
                and then faded over 0.3 seconds. The reduced-motion setting does
                not change it.
              </li>
              <li>
                <strong>Red edge flash when a predator spots you.</strong> Up to
                55% opacity around the screen edge, fading in about 0.6 seconds.
                Reduced motion does not change it. We have not measured how
                quickly it can repeat when several predators lock on in turn.
              </li>
              <li>
                <strong>Red edge pulse as a predator closes in.</strong> One pulse
                per piano note, so as often as every 0.35 seconds, just under
                three times a second, when a predator is very close.
              </li>
              <li>
                <strong>Green edge flash when the brush rustles.</strong> Up to
                40% opacity; with reduced motion on it becomes a fixed 15%.
              </li>
              <li>
                <strong>The death clip</strong> cuts from near-black to a bright
                mouth in a quarter of a second or less, then to red.
              </li>
            </ul>

            <h2>Turning it down</h2>
            <ul>
              <li>
                <strong>Sound button</strong> (in the game and in its menu):
                silences the game&apos;s sound, including the stinger and the bite.
              </li>
              <li>
                <strong>Predator Audio slider</strong> (Settings, Accessibility):
                lowers predator calls and the death roar. It does not lower the
                sharp stinger or the bite sound.
              </li>
              <li>
                <strong>Captions for predator calls</strong> (Settings): off by
                default, so turn them on if you play with the sound off.
              </li>
              <li>
                <strong>Reduced motion</strong> (Settings): covers head bob, the
                pickup camera swing and dust, and the rustle flash, but not the
                spot flash or the lift flash above. It also follows your
                system&apos;s reduced-motion preference.
              </li>
            </ul>

            <h2>If you are streaming it or showing it to a child</h2>
            <p>
              Play one run yourself first. The sound is the main source of the
              scare, and the first death clip cannot be skipped. If you are
              unsure about the sudden moments above, the{" "}
              <Link href="/how-to-survive">survival guide</Link> explains how
              predators find you, and{" "}
              <Link href="/guides/wolves">how to survive wolves</Link> covers
              the one that hunts in packs, so you can see what a chase looks
              like before it happens on screen.
            </p>

            <h2>Quick answers</h2>
            {QUICK.map(({ question, answer }) => (
              <section key={question}>
                <h3>{question}</h3>
                <p>{answer}</p>
              </section>
            ))}

            <h2>What we have not checked</h2>
            <p>
              We have not tested for photosensitivity triggers, we have no
              official age rating to give, and we have not audited the game for
              anything beyond the sounds, lights and death clip described here.
              If you find something this page missed, tell us through the
              <Link href="/suggest">Lullwood suggestion box</Link> and we will
              correct the page.
            </p>
          </div>
        </article>
        <footer className="devlog-footer">
          <p><Link href="/guides">See all Lullwood guides</Link></p>
          <p><Link href="/faq">Read the Lullwood FAQ</Link></p>
          <p><Link href="/">Play Lullwood free in your browser</Link></p>
        </footer>
      </main>
    </>
  );
}
