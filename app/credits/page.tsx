import type { Metadata } from 'next';
import Link from 'next/link';
import { CreditsList } from '@/components/CreditsList';
import JsonLd from '@/components/JsonLd';
import { SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER, breadcrumbJsonLd } from '@/lib/seo';

// Third-party asset credits (lib/credits.ts). The in-game menu shows the same
// CreditsList in a popup; this standalone route stays for links and search.
export const metadata: Metadata = {
  title: 'Credits',
  description: 'Third-party 3D models and icons used in Lullwood, the free browser horror game, with their authors and licenses.',
  alternates: { canonical: '/credits' },
  openGraph: {
    ...SOCIAL_OPEN_GRAPH,
    title: 'Credits — Lullwood',
    description: 'Third-party 3D models and icons used in Lullwood, the free browser horror game, with their authors and licenses.',
    url: '/credits',
    type: 'website',
  },
  twitter: {
    ...SOCIAL_TWITTER,
    title: 'Credits — Lullwood',
    description: 'Third-party 3D models and icons used in Lullwood, the free browser horror game, with their authors and licenses.',
  },
};

export default function CreditsPage() {
  return (
    <main className="credits-page">
      <JsonLd data={breadcrumbJsonLd([{ name: 'Credits', path: '/credits' }])} />
      <h1>Credits</h1>
      <CreditsList />
      <p><Link href="/">back to the game</Link></p>
    </main>
  );
}
