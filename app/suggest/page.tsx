import type { Metadata } from 'next';
import Link from 'next/link';
import SuggestionBox from '@/components/SuggestionBox';
import JsonLd from '@/components/JsonLd';
import { SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER, breadcrumbJsonLd } from '@/lib/seo';

// LUL-1918: standalone route, not a HUD overlay. This is a deliberate choice
// against embedding the box in GameMenu.tsx -- a separate page can never
// collide with an in-game HUD element (the founder's hard "no collisions"
// rule from LUL-1918) because no HUD renders on this route at all. See
// wiki game/lul1918-suggestion-box for the reasoning.
export const metadata: Metadata = {
  title: 'Suggest something',
  description: 'Send the Lullwood team an idea. The founder reads every suggestion by hand.',
  // LUL-2375: was inheriting the layout's canonical ("/") and telling Google
  // this page is a duplicate of the homepage.
  alternates: { canonical: '/suggest' },
  openGraph: {
    ...SOCIAL_OPEN_GRAPH,
    title: 'Suggest something — Lullwood',
    description: 'Send the Lullwood team an idea. The founder reads every suggestion by hand.',
    url: '/suggest',
    type: 'website',
  },
  twitter: {
    ...SOCIAL_TWITTER,
    title: 'Suggest something — Lullwood',
    description: 'Send the Lullwood team an idea. The founder reads every suggestion by hand.',
  },
};

export default function SuggestPage() {
  return (
    <main className="suggest-page">
      <JsonLd data={breadcrumbJsonLd([{ name: 'Suggest something', path: '/suggest' }])} />
      <h1>Suggest something</h1>
      <p className="suggest-page__intro">
        Have an idea for Lullwood? Type it below. No login, no forms beyond this
        one box. The founder reads every suggestion by hand, in order, and
        writes up the ones that get built.
      </p>
      <p className="suggest-page__intro">
        Looking for an answer rather than an idea? The{" "}
        <Link href="/faq">Lullwood FAQ</Link> and the{" "}
        <Link href="/how-to-survive">guide to surviving Lullwood</Link> may already
        have it.
      </p>
      <SuggestionBox />
      {/* The only route with no way back: a visitor landing here from search
          had to edit the URL to reach the game. */}
      <p className="suggest-page__back"><Link href="/">Back to the game</Link></p>
    </main>
  );
}
