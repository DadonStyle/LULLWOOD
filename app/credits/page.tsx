import type { Metadata } from 'next';
import Link from 'next/link';
import { CreditsList } from '@/components/CreditsList';
import JsonLd from '@/components/JsonLd';
import { socialOpenGraph, socialTwitter, breadcrumbJsonLd } from '@/lib/seo';

// Third-party asset credits (lib/credits.ts). The in-game menu shows the same
// CreditsList in a popup; this standalone route stays for links and search.
export const metadata: Metadata = {
  title: 'Credits',
  description: 'Third-party 3D models and icons used in Lullwood, the free browser horror game, with their authors and licenses.',
  alternates: { canonical: '/credits' },
  openGraph: {
    ...socialOpenGraph('Credits'),
    title: 'Credits — Lullwood',
    description: 'Third-party 3D models and icons used in Lullwood, the free browser horror game, with their authors and licenses.',
    url: '/credits',
    type: 'website',
  },
  twitter: {
    ...socialTwitter('Credits'),
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
      <p>
        Lullwood is made by Independence AI Studio, one human founder plus
        Claude agents: see <Link href="/devlog/who-makes-lullwood">who makes Lullwood</Link>.
        Writing about the game? The <Link href="/press">Lullwood press kit</Link> has
        the fact sheet and images.
      </p>

      <p><Link href="/">back to the game</Link></p>
    </main>
  );
}
