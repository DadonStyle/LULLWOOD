import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Win-condition guide (SEO/GEO, LUL-6109). Every mechanic below is read from
// the shipped game, not from a doc: app/page.tsx ("press E to lift her",
// "there's no trip home"), lib/game/outcome.ts (completePickup -- the lift IS
// the win, LUL-2281 removed the carry-home leg), and engine/forest-engine.js
// (pickup(): the run timer freezes when E is accepted, ~11 s lift scene,
// canPickUp radius 3.6, objective line "Find the lost child  ·  <n>m"). If the
// win condition changes, this page is the one answer engines quote -- update it.
const TITLE = "How Do You Win Lullwood? The Win Condition Explained";
const DESCRIPTION =
  "How do you win Lullwood? Reach the lost child and press E to lift her. That is the win: there is no trip home. What happens next, and what you can skip.";
const PUBLISHED = "2026-10-27";
const MODIFIED = "2026-10-27";
const PATH = "/guides/how-to-win";
const PAGE_URL = `${SITE_URL}${PATH}`;
// Same text as app/opengraph-image.alt.txt / twitter-image.alt.txt.
const SOCIAL_IMAGE_ALT = "Lullwood: a glowing child alone in a foggy night forest, first-person browser horror game";

// Rendered below and emitted as FAQPage JSON-LD from this one list, so the
// markup cannot drift from the visible text. None of these questions is in
// lib/faq.ts (the home page / /faq list): the same Q&A on two URLs is
// duplicate structured data.
const QA = [
  {
    question: "Do you have to carry the child anywhere in Lullwood?",
    answer:
      "No. Lullwood has no carry phase and no return trip. You reach the child, press E to lift her, and the run is won on the spot. Older descriptions of the game that mention carrying her home are out of date.",
  },
  {
    question: "What happens after you lift the child in Lullwood?",
    answer:
      "Your run timer stops the instant the lift is accepted, a lift scene of about eleven seconds plays, and then the win screen shows your time and the Embers you earned. A predator that reaches you during the lift scene no longer ends the run.",
  },
  {
    question: "Can you win Lullwood without hiding?",
    answer:
      "No rule requires hiding: Lullwood only asks you to reach the child and press E. In practice you will want cover, because you have no weapons and wolves, bears and lions are all faster than your full sprint. Lantern difficulty, with one predator per species, is the gentlest place to try.",
  },
  {
    question: "How close do you have to be to lift the child in Lullwood?",
    answer:
      "Within about 3.6 units of her, a few steps. When you are close enough, the prompt reads \"Press E to lift the child\". Until then, the line at the top of the screen reads \"Find the lost child\" with the distance in metres.",
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
        { "@type": "ListItem", position: 2, name: "How to win", item: PAGE_URL },
      ],
    },
    faqJsonLd,
  ],
};

export default function HowToWinPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static object above; escape "<" so an edit can't break out of the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / How to win
        </nav>
        <article>
          <header>
            <h1>How do you win Lullwood?</h1>
            <time dateTime={MODIFIED}>Updated October 27, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              Lullwood ends in a win the instant you reach the lost child and
              press E to lift her. There is no trip home afterwards and no second
              objective you must complete. Your timer stops when you lift her, so
              the whole game is getting to her alive through a forest of wolves,
              bears and lions.
            </p>

            <h2>What is the win condition in Lullwood?</h2>
            <p>
              Reach the child and press <strong>E</strong>. That is the whole
              objective of{" "}
              <Link href="/">Lullwood, the free browser horror game</Link>. She
              glows in the fog somewhere across the forest, and you have no
              weapons, so the game is the crossing: staying out of sight of the
              wolves, bears and lions that hunt by sight and scent until you are
              close enough to lift her.
            </p>
            <p>
              Until she is in reach, the line at the top of the screen reads
              &ldquo;Find the lost child&rdquo; with the distance in metres. Inside
              about 3.6 units of her it changes to &ldquo;Press E to lift the
              child&rdquo;.
            </p>

            <figure>
              <Image
                src="/screenshots/lullwood-night-forest-pine-trees.png"
                alt="Low-poly pine trees and snow-covered boulders under a starry night sky in Lullwood's forest, the ground you cross to reach the child"
                width={3840}
                height={2160}
                sizes="(min-width: 640px) 592px, 100vw"
              />
            </figure>

            <h2>Is there a trip home after you lift the child?</h2>
            <p>
              No. An earlier version of Lullwood asked you to carry the child
              back to where you started. That leg was removed on September 9,
              2026, and lifting her became the win. If you have read that you
              must carry her home, that description is out of date: today the run
              is won on the spot.
            </p>

            <h2>What happens when you lift her?</h2>
            <ul>
              <li>
                <strong>The timer stops at once.</strong> The run clock freezes the
                moment the game accepts your E press, not when the scene after it
                ends. Your time is the time it took to reach her.
              </li>
              <li>
                <strong>A lift scene plays</strong> for about eleven seconds. A
                predator that reaches you during it no longer ends the run.
              </li>
              <li>
                <strong>The win screen</strong> shows your time and the Embers you
                earned, which you spend in the shop. On Blackout it also has the
                form for the leaderboard.
              </li>
            </ul>

            <h2>Do you have to do anything else to win?</h2>
            <p>
              No. Lullwood has optional side objectives that pay bonus Embers, and
              the game never requires them for the win. Skip every one and
              reaching the child still wins the run.
            </p>

            <h2>How do you find her?</h2>
            <p>
              Follow her cry, which sounds from her direction, and the coloured
              lights on the landmarks above the fog. How hard that is depends on
              the difficulty: on Lantern she glows brighter and you get a minimap;
              on Blackout, the default, there is no minimap and she is farther out.
              The{" "}
              <Link href="/how-to-survive">how to survive Lullwood guide</Link>{" "}
              covers the predators, hiding, scent and the mist veil that decide
              whether you get there.
            </p>

            <h2>How do you win faster?</h2>
            <p>
              The leaderboard counts only Blackout wins, and the fastest rescue is
              the top rescuer. Because the clock stops at the lift, speed is all
              about the route to her, not about anything after it. The
              leaderboard rules are in{" "}
              <Link href="/how-to-survive">the survival guide</Link>.
            </p>

            <h2>Questions about winning Lullwood</h2>
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
          <p><Link href="/devlog">Read the Lullwood devlog</Link> for how the game is built.</p>
        </footer>
      </main>
    </>
  );
}
