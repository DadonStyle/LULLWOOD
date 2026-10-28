import type { Metadata } from "next";
import Link from "next/link";
import { FAQ, faqJsonLd } from "@/lib/faq";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// The one URL that carries the FAQPage JSON-LD. The home page renders the same
// list as visible text only: the same FAQPage on two URLs is duplicate
// structured data. Both read lib/faq.ts, so the markup matches the text.
const TITLE = "Lullwood FAQ — Questions About the Free Horror Game";
const DESCRIPTION =
  "Answers to common questions about Lullwood, the free first-person horror game you play in your browser: price, phones, controls, predators and more.";
const MODIFIED = "2026-10-27";
const PAGE_URL = `${SITE_URL}/faq`;
// Same text as app/opengraph-image.alt.txt / twitter-image.alt.txt.
const SOCIAL_IMAGE_ALT = "Lullwood: a glowing child alone in a foggy night forest, first-person browser horror game";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/faq" },
  // A page-level openGraph/twitter object replaces the layout's wholesale, so
  // the root social images are named here (same as /how-to-survive).
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/faq",
    siteName: SITE_NAME,
    locale: "en_US",
    type: "website",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: SOCIAL_IMAGE_ALT }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/twitter-image.png", width: 1200, height: 630, alt: SOCIAL_IMAGE_ALT }],
  },
};

const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "FAQ", item: PAGE_URL },
  ],
};

export default function FaqPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Built from lib/faq.ts, the same list rendered below.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c") }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, "\\u003c") }}
      />
      <main className="devlog-post guide-page">
        <nav className="devlog-back" aria-label="Breadcrumb">
          <Link href="/">Lullwood</Link> / FAQ
        </nav>
        <article>
          <header>
            <h1>Lullwood FAQ</h1>
            <time dateTime={MODIFIED}>Updated October 27, 2026</time>
          </header>
          <div className="devlog-body">
            <p>
              Lullwood is a free first-person horror game you play in your web
              browser, with nothing to download or install. You cross a foggy
              night forest to reach a lost, glowing child and lift her while
              wolves, bears and lions hunt you by sight and by scent. Hiding and
              holding still is how you survive.
            </p>
            {FAQ.map(({ question, answer }) => (
              <section key={question}>
                <h2>{question}</h2>
                <p>{answer}</p>
              </section>
            ))}
            <p>
              For the long versions, read{" "}
              <Link href="/guides/how-to-win">how you win Lullwood</Link>,{" "}
              <Link href="/how-to-survive">surviving the forest in Lullwood</Link>,
              or <Link href="/games-like-slender">how Lullwood compares to games like Slender</Link>.
            </p>
          </div>
        </article>
        <footer className="devlog-footer">
          <p><Link href="/">Play Lullwood free in your browser</Link></p>
          <p><Link href="/how-to-survive">How to survive Lullwood</Link> covers predators, hiding and the mist veil in depth.</p>
          <p><Link href="/devlog">Read the Lullwood devlog</Link> for how the game is built.</p>
        </footer>
      </main>
    </>
  );
}
