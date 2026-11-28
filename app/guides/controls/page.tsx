import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { socialImage } from "@/lib/seo";

// Controls guide (SEO/GEO, LUL-6468, idea S-023). Every key below is read from
// the shipped game on origin/release/next, never from memory or a doc:
//   engine/forest-engine.js  keyMap defaults (the 11 remappable verbs),
//     KEYMAP_RESERVED_CODES, setKeyMap() collision check, the keydown handler,
//     the hardcoded KeyF mist-veil hold, arrow-key fallback, Shift run, Esc/F11.
//   components/SettingsPanel.tsx  the Controls fieldset (verb labels, order)
//     and the Accessibility "Toggle to run" row.
//   components/Hud.tsx  the in-game controls panel text.
// The win condition is "press E to lift her, no trip home" (BRAND.md,
// /guides/how-to-win). If a key is added, moved or made remappable, update
// this page.
const TITLE = "What Are the Controls in Lullwood? Every Key and How to Remap Them";
const DESCRIPTION =
  "The controls in Lullwood: WASD to move, mouse to look, Shift to run, H to hide, F for the mist veil, E to lift the child. Every key, and which can be remapped.";
const PUBLISHED = "2026-11-16";
const MODIFIED = "2026-11-16";
const PATH = "/guides/controls";
const PAGE_URL = `${SITE_URL}${PATH}`;

// Rendered below and emitted as FAQPage JSON-LD from this one list, so the
// markup cannot drift from the visible text. None of these questions is in
// lib/faq.ts (the home page / /faq list): the same Q&A on two URLs is
// duplicate structured data.
const QA = [
  {
    question: "Can you remap the controls in Lullwood?",
    answer:
      "Yes, on a keyboard. Open the menu, choose Settings, and click an action in the Controls list, then press the new key. Eleven actions can be remapped: the four movement keys, interact, veil overload, scent veil, hide, climb, shuffle and jump. Shift, F, Esc and the arrow keys are fixed.",
  },
  {
    question: "Does Lullwood have a sprint toggle?",
    answer:
      "Yes. Run is hold Shift by default. Turn on \"Toggle to run (instead of hold Shift)\" under Accessibility in Settings and a Shift press switches running on and off instead.",
  },
  {
    question: "Why does a key I picked get refused in Lullwood?",
    answer:
      "Lullwood will not bind a key that another action already uses, or one of Esc, F11, Enter and Shift, which the game keeps for pause, fullscreen and running. The row shows a short warning that the key is already used, and your old binding stays.",
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
        { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE_URL}/guides` },
        { "@type": "ListItem", position: 3, name: "Controls", item: PAGE_URL },
      ],
    },
    faqJsonLd,
  ],
};

export default function ControlsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static object above; escape "<" so an edit can't break out of the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / <Link href="/guides">Guides</Link> / Controls
        </nav>
        <article>
          <header>
            <h1>What are the controls in Lullwood?</h1>
            <time dateTime={MODIFIED}>Updated November 16, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              The controls in Lullwood are WASD to move, the mouse to look, Shift
              to run, Space to jump, H to hide in bramble, F to hold the mist veil
              and E to lift the child. Eleven of those actions can be remapped in
              Settings; F, Shift and Esc cannot.
            </p>

            <h2>Which key do people miss?</h2>
            <p>
              You already know WASD, the mouse and Shift. The one that is not
              obvious is <strong>F</strong>. Unlike every action you can
              remap, you hold it instead of tapping it, the game will not let you
              rebind it, and it is the one that helps when something is already
              hunting you: hold it and mist rolls in so predators see only 35% as
              far. It hides you from sight, not scent, and a full hold empties it
              in about five seconds, so release it early.{" "}
              <Link href="/how-to-survive">How to survive Lullwood</Link> covers
              when to spend it.
            </p>

            <figure>
              <Image
                src="/screenshots/lullwood-forest-rock-outcrop-night.png"
                alt="Low-poly pine trees, boulders and a large snow-covered slope under a starry night sky in Lullwood's forest, seen from the player's eye level"
                width={3840}
                height={2160}
                sizes="(min-width: 640px) 592px, 100vw"
              />
            </figure>

            <h2>What are the default keys for moving and looking?</h2>
            <ul>
              <li>
                <strong>W, A, S, D</strong> — walk forward, strafe left, walk
                back, strafe right. The arrow keys do the same and always work,
                even after you remap WASD.
              </li>
              <li>
                <strong>Mouse</strong> — look. The game captures the pointer
                when you start.
              </li>
              <li>
                <strong>Shift (hold)</strong> — run. Running is louder and lays a
                stronger scent trail. A Settings option turns it into a toggle.
                The numbers are in{" "}
                <Link href="/guides/sprinting">Walk or run in Lullwood?</Link>
              </li>
              <li>
                <strong>Space</strong> — jump, and how you clear a charging
                predator. A hop lasts 0.6 seconds.
              </li>
              <li>
                <strong>Esc</strong> — pause and release the mouse. Click the game
                to look again.
              </li>
              <li>
                <strong>F11</strong> or <strong>Alt+Enter</strong> — fullscreen.
              </li>
            </ul>

            <h2>What are the keys for hiding and the veil?</h2>
            <ul>
              <li>
                <strong>H</strong> — hide. Only bramble bushes count, so pressing
                H behind a rock or log does nothing. Press it again to step out.
                Moving also breaks cover. How long a hiding spot holds is in{" "}
                <Link href="/how-to-survive#how-do-you-hide-in-lullwood">how do you hide in Lullwood</Link>.
              </li>
              <li>
                <strong>R</strong> — shuffle to another spot inside the same
                bramble while you are hidden, with a two-second cooldown.
              </li>
              <li>
                <strong>F (hold)</strong> — the mist veil described above.
              </li>
              <li>
                <strong>G</strong> — scent veil. When a predator has your scent
                and you are moving into the wind, G spends 30% of your stamina
                to break the lock. This is the key against a bear.
              </li>
              <li>
                <strong>Q</strong> — veil overload, a panic burn. It works only
                while a predator is chasing you and only once per run, and for 7
                seconds nothing can see or smell you. Q does not break a scent
                lock; G does.
              </li>
              <li>
                <strong>C</strong> — climb a vantage rock to see over the fog for
                about 2 seconds. Predators see you from 60% farther while you are
                up there, and you cannot climb while hidden.
              </li>
            </ul>

            <h2>Which key wins the game?</h2>
            <p>
              <strong>E.</strong> Reach the lost child, and when the prompt reads
              &ldquo;Press E to lift the child&rdquo;, press it. That is the win:
              the timer stops and there is no trip home afterwards. E also picks up
              a nearby stone, and a left click throws the stone you are holding.
              See <Link href="/guides/how-to-win">how you win Lullwood</Link> for
              what happens after the lift, and{" "}
              <Link href="/guides/throwing-stones">can you distract wolves in Lullwood</Link>{" "}
              for the stones.
            </p>

            <h2>How do you remap the controls in Lullwood?</h2>
            <p>
              Open the menu in the top-left corner, choose{" "}
              <strong>Settings...</strong>, and find the <strong>Controls</strong>{" "}
              list. Click an action, then press the key you want. Esc cancels. The
              list holds eleven actions: move forward, move backward, strafe left,
              strafe right, interact (E), veil overload (Q), scent veil (G), hide
              (H), climb (C), shuffle hide (R) and jump (Space). Your choices are
              saved in the browser, and the list does not appear on a phone.
            </p>
            <p>
              The game refuses a key that another action already uses, and it
              refuses Esc, F11, Enter and Shift, which it keeps for pause,
              fullscreen and running. A refused key shows a short &ldquo;already
              used by another action&rdquo; line and your old binding stays. F, the
              arrow keys, Shift, Esc, F11 and the mouse buttons are not in the
              list at all.
            </p>

            <h2>What are the controls on a phone?</h2>
            <p>
              There is no keyboard, so every action above has an on-screen control
              in landscape. The{" "}
              <Link href="/guides/mobile">Lullwood phone controls guide</Link>{" "}
              lists each one.
            </p>

            <h2>Questions about the controls in Lullwood</h2>
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
          <p><Link href="/how-to-survive">How to survive Lullwood</Link> for the hiding, scent and predator details.</p>
          <p><Link href="/guides">All Lullwood guides</Link></p>
        </footer>
      </main>
    </>
  );
}
