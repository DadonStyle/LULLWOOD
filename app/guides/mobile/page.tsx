import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Phone-play guide (SEO/GEO, LUL-6205). The control list below was checked
// two ways, because a button that exists in code but never renders is the
// failure this page must not have: read from components/MobileControls.tsx,
// components/Hud.tsx, components/OrientationGate.tsx, lib/input-mode.ts and
// engine/forest-engine.js, then rendered on the live site in Chromium's Pixel 5
// emulation (851x393 and 932x430, landscape), with taps on E and the prompt rows. The short-screen limit
// comes from the max-height: 420px rules in components/GameCanvas.tsx. Not
// tested on a physical phone, and the page says so. If a control is added,
// removed or moved, update this page.
const TITLE = "Can You Play Lullwood on a Phone? Touch Controls Explained";
const DESCRIPTION =
  "Yes, Lullwood runs on a phone in landscape, with no keyboard. Every on-screen control, what is a tap row, and what short phone screens hide.";
const PUBLISHED = "2026-10-29";
const MODIFIED = "2026-10-29";
const PATH = "/guides/mobile";
const PAGE_URL = `${SITE_URL}${PATH}`;
// Same text as app/opengraph-image.alt.txt / twitter-image.alt.txt.
const SOCIAL_IMAGE_ALT = "Lullwood: a glowing child alone in a foggy night forest, first-person browser horror game";
const CONTROLS_IMAGE = "/marketing/lullwood-phone-landscape-controls.png";

// Rendered below and emitted as FAQPage JSON-LD from this one list, so the
// markup cannot drift from the visible text. None of these questions is in
// lib/faq.ts (the home page / /faq list): the same Q&A on two URLs is
// duplicate structured data.
const QA = [
  {
    question: "Does Lullwood work in portrait mode on a phone?",
    answer:
      "No. Lullwood only plays in landscape. If you hold the phone upright, the game shows a full-screen rotate prompt that reads \"Rotate your device to play\" until you turn the phone on its side.",
  },
  {
    question: "Do you need a keyboard to play Lullwood on a phone?",
    answer:
      "No. Every desktop key has an on-screen counterpart: two sticks for movement and look, buttons for E, Jump, Hide, Shuffle, Veil and Pause, and tappable prompt rows for the vantage-rock climb, the stone throw, the emergency veil burn and the scent-trail break.",
  },
  {
    question: "How do you sprint in Lullwood on a phone?",
    answer:
      "Push the left stick most of the way to its edge, past about three quarters of its travel, and you run. If you turn on the toggle-run setting, a Run button appears next to Jump and the stick no longer needs to be held that far.",
  },
  {
    question: "Can you win Lullwood on a phone?",
    answer:
      "Yes. The win is the same as on desktop: reach the lost child and tap the E button to lift her. We played that through on the live site in a Pixel 5 landscape emulation and the win screen came up.",
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
  // the root social images are named here (same as /how-to-survive).
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
      image: `${SITE_URL}${CONTROLS_IMAGE}`,
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
        { "@type": "ListItem", position: 3, name: "Playing on a phone", item: PAGE_URL },
      ],
    },
    faqJsonLd,
  ],
};

export default function MobileGuidePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static object above; escape "<" so an edit can't break out of the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / <Link href="/guides">Guides</Link> / Playing on a phone
        </nav>
        <article>
          <header>
            <h1>Can you play Lullwood on a phone?</h1>
            <time dateTime={MODIFIED}>Updated October 29, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              Yes, Lullwood plays on a phone, free in the browser, with no
              keyboard needed: every action has an on-screen control. Hold the
              phone in landscape, because portrait shows only a rotate prompt.
              The limit: two emergency prompts are tap rows that short phone
              screens can hide.
            </p>

            <figure>
              <Image
                src={CONTROLS_IMAGE}
                alt="Lullwood on a phone held in landscape: a movement stick bottom-left with E and Jump buttons above it, a look stick bottom-right with Hide, Shuffle and Veil buttons above it, a Pause button and menu buttons along the top, and a snowy pine forest behind"
                width={2340}
                height={1081}
                sizes="(min-width: 640px) 592px, 100vw"
              />
              <figcaption>
                The live game at 851 by 393 pixels in landscape, the on-screen
                controls as they render.
              </figcaption>
            </figure>

            <h2>How do you hold the phone?</h2>
            <p>
              Sideways. Lullwood is a first-person game and a portrait screen
              crops too much of the forest, so on a phone held upright the game
              covers the screen with a rotate prompt (&ldquo;Rotate your device
              to play&rdquo;) until you turn it. Touch devices also get a wider
              camera, 85 degrees of vertical view against 70 on desktop, so a
              small screen shows more of the fog.
            </p>
            <p>
              The game picks touch controls when your device has no mouse-style
              pointer, or when the window is 768 pixels wide or narrower. A
              tablet with a touchscreen gets the same controls as a phone.
            </p>

            <h2>What are the on-screen controls in Lullwood?</h2>
            <p>
              Every one of these rendered on the live site in a phone-sized
              landscape window. We tapped E to pick up a stone and to lift the
              child, and both worked.
            </p>
            <ul>
              <li>
                <strong>Left stick:</strong> move. Push it past about three
                quarters of its travel to run.
              </li>
              <li>
                <strong>Right stick:</strong> look around. It turns the camera at
                a rate while you hold it, so a held stick keeps turning.
              </li>
              <li>
                <strong>E</strong> (bottom left): the desktop E key. It lifts the
                child, picks up a stone, buys a veil charm and starts a chapel
                sanctuary, whichever is in reach.
              </li>
              <li>
                <strong>Jump</strong> (bottom left): the space bar. Jump is how
                you clear a charging wolf or lion.
              </li>
              <li>
                <strong>Hide</strong> (bottom right): the H key. It only works at
                bramble, the one hiding spot in the forest, same as desktop.
                When you stand next to one the game prints &ldquo;Tap Hide to
                slip into the bramble&rdquo;.
              </li>
              <li>
                <strong>Shuffle:</strong> the R key. While you are hidden it
                nudges you a short step, about one unit, in the direction you are
                moving or facing, and it has a two-second cooldown.
              </li>
              <li>
                <strong>Veil:</strong> the F key, but you hold the button instead
                of the key. It is the mist veil that holds off what is hunting
                you.
              </li>
              <li>
                <strong>Pause</strong> (top, next to the menu buttons): the Esc
                key. Tapping it again resumes, which Esc cannot do.
              </li>
              <li>
                <strong>Run</strong> (beside Jump): only appears if you turn on
                the toggle-run setting.
              </li>
            </ul>

            <h2>Which actions are tap rows, not buttons?</h2>
            <p>
              Four actions have no permanent button. They appear as a line of
              text at the top of the screen when they apply, and you tap the
              line.
            </p>
            <ul>
              <li>
                <strong>Throw:</strong> after you pick up a stone with E, a Throw
                button joins the E and Jump row and the prompt reads &ldquo;Holding
                a stone, tap Throw&rdquo;.
              </li>
              <li>
                <strong>Climb:</strong> next to a vantage rock the game shows
                &ldquo;Press C to climb the rock&rdquo; with a Climb chip. Tap the
                row. The line still says C, which a phone has no key for, but the
                tap works.
              </li>
              <li>
                <strong>Burn the veil</strong> (Q on desktop): during a chase the
                row &ldquo;Burn veil for a detection-proof escape&rdquo; appears,
                and tapping it uses it.
              </li>
              <li>
                <strong>Break the scent trail</strong> (G on desktop): when a
                predator is following your scent, a row offers to break the trail.
                Tapping it costs stamina, and the row greys out when you have too
                little.
              </li>
            </ul>
            <p>
              When a charging predator gives you a short window to dodge, the
              Jump prompt at the top is tappable too, in addition to the Jump
              button.
            </p>

            <h2>What does not work as well on a phone?</h2>
            <ul>
              <li>
                <strong>Landscape only.</strong> There is no portrait layout.
              </li>
              <li>
                <strong>Short screens hide the emergency rows.</strong> The game
                has one text slot at the top of the screen, and on a landscape
                screen 420 pixels tall or less (a Pixel 5 is 393) it drops the
                lower-priority rows when a higher one is showing. In a chase with
                no cover nearby, the line &ldquo;nowhere to hide, hold Veil&rdquo;
                is showing, so the burn-the-veil row is hidden, and the same rule
                hides the scent-trail row. We saw the burn-the-veil row hidden at
                851 by 393, and showing and responding to a tap at 932 by 430. On a short screen, the Veil
                button is what you have.
              </li>
              <li>
                <strong>Some firefly clusters are not drawn.</strong> A phone
                renders four of the six, and the unrendered ones still make
                predators see you farther. The{" "}
                <Link href="/guides/fireflies">firefly guide</Link> has the detail.
              </li>
              <li>
                <strong>We tested an emulated phone, not a physical one.</strong>{" "}
                Everything above was checked in a desktop browser pretending to be
                a Pixel 5, on October 29, 2026. We have not measured frame rate or
                touch feel on real devices, so we cannot tell you how it runs on
                yours. Of the tap rows, we staged and saw the throw, climb and
                burn-the-veil rows; the scent-trail row and the tappable dodge
                prompt are wired the same way in the code, but we did not stage
                them.
              </li>
            </ul>

            <h2>Can you win Lullwood on a phone?</h2>
            <p>
              Yes. The win is the same as on desktop: reach the lost child, then
              tap <strong>E</strong>. We staged that on the live site in the
              phone emulation, and the win screen came up. The{" "}
              <Link href="/guides/how-to-win">how to win Lullwood guide</Link>{" "}
              covers what happens after the lift, and the{" "}
              <Link href="/how-to-survive">how to survive Lullwood guide</Link>{" "}
              covers the wolves, bears and lions on the way there. If it feels too
              hard on a small screen, Lantern is the gentlest difficulty tier.
            </p>

            <h2>Questions about playing Lullwood on a phone</h2>
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
          <p><Link href="/faq">Lullwood FAQ</Link> for price, controls and the predators.</p>
          <p><Link href="/devlog">Read the Lullwood devlog</Link> for how the game is built.</p>
        </footer>
      </main>
    </>
  );
}
