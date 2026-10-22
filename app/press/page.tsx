import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Press kit (SEO + GEO, LUL-6056). Every fact below is checked against the
// shipped game and the repo, not BRAND.md's wording alone: BRAND.md's "for
// players" line and fact-sheet core loop still say "carry her home", but
// LUL-2281 made lifting the child the win with no carry-home leg (see
// app/page.tsx's "no trip home to survive afterward" and
// SEO_GEO_CHECKLIST.md's "in-game rules say lift the child, not carry them
// home"). This page uses the verified mechanic; BRAND.md needs the same
// correction (flagged on LUL-6056).
const TITLE = "Lullwood Press Kit";
const DESCRIPTION =
  "Press kit for Lullwood: fact sheet, screenshots, description copy and video for journalists, streamers and portals covering the free browser horror game.";
const PUBLISHED = "2026-10-22";
const MODIFIED = "2026-10-22";
const PAGE_URL = `${SITE_URL}/press`;
const SOCIAL_IMAGE_ALT =
  "Lullwood: a glowing child alone in a foggy night forest, first-person browser horror game";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/press" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/press",
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
        { "@type": "ListItem", position: 2, name: "Press", item: PAGE_URL },
      ],
    },
  ],
};

const SCREENSHOTS = [
  {
    src: "/screenshots/lullwood-night-forest-pine-trees.png",
    alt: "First-person view of Lullwood's snowy pine forest under a starry night sky, with grey boulders and a snowbank ahead",
  },
  {
    src: "/screenshots/lullwood-dense-pine-forest-snow.png",
    alt: "First-person view deep in a dense, snow-covered pine forest in Lullwood, trees close on every side",
  },
  {
    src: "/screenshots/lullwood-forest-rock-outcrop-night.png",
    alt: "A rocky outcrop breaking up the tree line in Lullwood's night forest",
  },
  {
    src: "/press/lullwood-04-distant-glow.png",
    alt: "The lost child's glow visible far off through the trees in Lullwood's foggy night forest",
  },
  {
    src: "/press/lullwood-05-under-canopy.png",
    alt: "First-person view looking up through a dense forest canopy at night in Lullwood",
  },
  {
    src: "/press/lullwood-06-night-clearing.png",
    alt: "An open clearing in Lullwood's forest at night, fog rolling across the open ground",
  },
];

const COVERS = [
  { src: "/press/lullwood-cover-a.png", alt: "Lullwood cover art A: the glowing child in the fog" },
  { src: "/press/lullwood-cover-b.png", alt: "Lullwood cover art B: the glowing child in the fog" },
];

export default function PressPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / Press
        </nav>
        <article>
          <header>
            <h1>Lullwood press kit</h1>
            <time dateTime={MODIFIED}>Updated October 22, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              Lullwood is a free first-person horror game you play in your
              web browser, with no download and no account. You cross a
              foggy night forest to reach a lost, glowing child while
              wolves, bears and lions hunt you by sight and by scent, and
              lifting her is the win. Everything below is free to use:
              fact sheet, screenshots, cover art, a clip and description
              copy at three lengths.
            </p>

            <h2>Fact sheet</h2>
            <ul>
              <li><strong>Name:</strong> Lullwood</li>
              <li><strong>Studio:</strong> Independence AI Studio</li>
              <li><strong>Genre:</strong> first-person survival horror</li>
              <li><strong>Platform:</strong> web browser, desktop and mobile (WebGL, no download, no install)</li>
              <li><strong>Price:</strong> free, no ads, no account</li>
              <li><strong>Release status:</strong> live now at www.lullwoodgame.com, shipping updates continuously</li>
              <li><strong>URL:</strong> <Link href="/">https://www.lullwoodgame.com</Link></li>
              <li>
                <strong>Difficulty tiers:</strong> Lantern (forgiving), Night,
                and Blackout — the default, with no minimap and the child
                placed further from the start
              </li>
              <li><strong>Predators:</strong> wolves, bears and lions, which hunt by sight and by scent</li>
              <li>
                <strong>Core loop:</strong> cross the night forest, find the
                glowing child, and reach her — lifting her is the win,
                instantly, with no trip home. Hide in cover and hold still
                while predators sniff for you; moving, and especially
                sprinting, makes you louder and leaves a stronger scent
                trail
              </li>
              <li><strong>Mobile:</strong> landscape only — portrait shows a rotate prompt</li>
            </ul>

            <h2>Description copy</h2>
            <p>Use whichever length fits. Wording is ours to quote directly.</p>
            <p>
              <strong>One line:</strong> &ldquo;Lullwood is a free browser
              horror game where you cross a foggy night forest to reach a
              lost, glowing child while wolves, bears and lions hunt you by
              sight and scent.&rdquo;
            </p>
            <p>
              <strong>One paragraph:</strong> &ldquo;Lullwood is a free
              first-person horror game that runs in the browser, no download
              or account required. A child is lost, glowing faintly
              somewhere in a foggy night forest, and you have to reach her.
              Wolves, bears and lions hunt you by sight and by a scent trail
              the wind carries, and you have no weapon — the only tool is
              stillness: duck into cover, hold still, and let a predator
              lose your trail. Reaching the child and lifting her is the
              win, on the spot, with three difficulty tiers from the
              forgiving Lantern up to the default Blackout, which drops the
              minimap entirely.&rdquo;
            </p>
            <p>
              <strong>~150 words:</strong> &ldquo;Lullwood is a free
              first-person horror game that runs in any modern browser, on
              desktop or phone, with no download, no install and no
              account. A lost child is glowing somewhere in a foggy night
              forest, and crossing that forest to reach her is the entire
              game. You carry no weapon: wolves, bears and lions hunt you by
              line of sight and by a scent trail that the wind carries, so
              running — especially sprinting — makes you louder and easier
              to track. The only defenses are stillness and cover: duck into
              bramble and hold still to let a predator lose you, or hold the
              mist veil to dim your light and cut how far you can be seen.
              Reaching the child and lifting her ends the run instantly as a
              win; there is no trip home to survive afterward. Three
              difficulty tiers change how much help you get, from the
              forgiving Lantern tier up to Blackout, the default, which
              removes the minimap and starts you further from the child.
              Lullwood is built by a fleet of Claude agents orchestrated
              with Paperclip, with one human founder who sets direction and
              approves every release.&rdquo;
            </p>

            <h2>Screenshots</h2>
            <p>
              Six screenshots, right-click or long-press to save. Three are
              also linked from <Link href="/">the homepage</Link>.
            </p>
            {SCREENSHOTS.map((shot) => (
              <figure key={shot.src}>
                <Image
                  src={shot.src}
                  alt={shot.alt}
                  width={3840}
                  height={2160}
                  sizes="(min-width: 640px) 592px, 100vw"
                  style={{ width: "100%", height: "auto" }}
                />
              </figure>
            ))}

            <h2>Cover art</h2>
            <p>Two cover images, portrait orientation, for thumbnails and listings.</p>
            {COVERS.map((cover) => (
              <figure key={cover.src}>
                <Image
                  src={cover.src}
                  alt={cover.alt}
                  width={2520}
                  height={2000}
                  sizes="(min-width: 640px) 592px, 100vw"
                  style={{ width: "100%", height: "auto" }}
                />
              </figure>
            ))}

            <h2>Video</h2>
            <p>
              A short in-game clip of a run ending in death, for a b-roll
              moment or a thumbnail frame:{" "}
              <a href="/death.mp4">/death.mp4</a>.
            </p>

            <h2>Built by an AI studio</h2>
            <p>
              Lullwood is built by a fleet of Claude agents orchestrated with
              Paperclip. One human founder sets direction and approves every
              release; no human writes game code. Source is public at{" "}
              <a href="https://github.com/DadonStyle/LULLWOOD">
                github.com/DadonStyle/LULLWOOD
              </a>
              .
            </p>

            <h2>Contact</h2>
            <p>
              No public press contact is set up yet. Check back, or reach us
              through{" "}
              <Link href="/suggest">the suggestion form</Link> in the
              meantime.
            </p>
          </div>
        </article>
        <footer className="devlog-footer">
          <p><Link href="/">Play Lullwood free in your browser</Link></p>
          <p><Link href="/devlog">Read the Lullwood devlog</Link> for how the game is built.</p>
        </footer>
      </main>
    </>
  );
}
