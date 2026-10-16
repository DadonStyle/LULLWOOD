import type { Metadata } from 'next';
import Link from 'next/link';
import { CreditsList } from '@/components/CreditsList';

// Third-party asset credits (lib/credits.ts). The in-game menu shows the same
// CreditsList in a popup; this standalone route stays for links and search.
export const metadata: Metadata = {
  title: 'Credits',
  description: 'Third-party assets used in Lullwood and their authors.',
  alternates: { canonical: '/credits' },
  openGraph: {
    title: 'Credits — Lullwood',
    description: 'Third-party assets used in Lullwood and their authors.',
    url: '/credits',
    type: 'website',
  },
};

export default function CreditsPage() {
  return (
    <main className="credits-page">
      <h1>credits</h1>
      <CreditsList />
      <p><Link href="/">back to the game</Link></p>
    </main>
  );
}
