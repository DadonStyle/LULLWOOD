import type { Metadata } from 'next';
import Link from 'next/link';
import { CREDITS } from '@/lib/credits';

// Third-party asset credits (lib/credits.ts), linked from the in-game menu.
// A standalone route for the same reason as /suggest: no HUD renders here.
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
      <p className="credits-page__intro">
        Lullwood is developed by an independent AI studio. It also uses these
        assets, with thanks to their authors.
      </p>
      <ul className="credits-page__list">
        {CREDITS.map((c) => (
          <li key={c.title} className="credits-page__item">
            <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer">&ldquo;{c.title}&rdquo;</a>
            {' '}by{' '}
            <a href={c.authorUrl} target="_blank" rel="noopener noreferrer">{c.author}</a>
            {', licensed under '}
            <a href={c.licenseUrl} target="_blank" rel="noopener noreferrer">{c.license}</a>
            <div className="credits-page__detail">
              Used for {c.usedFor}.{c.changes ? ` Changes: ${c.changes}.` : ''}
            </div>
          </li>
        ))}
      </ul>
      <p><Link href="/">back to the game</Link></p>
    </main>
  );
}
