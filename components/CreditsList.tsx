import { CREDITS, STUDIO_CREDIT } from '@/lib/credits';

// The credits themselves (lib/credits.ts): the studio line first, then every
// third-party asset with its author, license and changes. Shared by the
// /credits page and the in-game Credits popup so the two can't drift.
export function CreditsList() {
  return (
    <>
      <ul className="credits-page__list">
        <li className="credits-page__item credits-page__studio">
          Lullwood is made by {STUDIO_CREDIT.studio}, created by{' '}
          <a href={STUDIO_CREDIT.authorUrl} target="_blank" rel="noopener noreferrer">{STUDIO_CREDIT.author}</a>
        </li>
      </ul>
      <p className="credits-page__intro">It also uses these assets, with thanks to their authors.</p>
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
    </>
  );
}
