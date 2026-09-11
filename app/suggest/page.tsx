import type { Metadata } from 'next';
import SuggestionBox from '@/components/SuggestionBox';

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
    title: 'Suggest something — Lullwood',
    description: 'Send the Lullwood team an idea. The founder reads every suggestion by hand.',
    url: '/suggest',
    type: 'website',
  },
};

export default function SuggestPage() {
  return (
    <main className="suggest-page">
      <h1>suggest something</h1>
      <p className="suggest-page__intro">
        Have an idea for Lullwood? Type it below. No login, no forms beyond this
        one box. The founder reads every suggestion by hand, in order, and
        writes up the ones that get built.
      </p>
      <SuggestionBox />
    </main>
  );
}
