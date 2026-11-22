import Link from 'next/link';

// Site-wide section links, rendered server-side by app/layout.tsx on every
// route so no sitemap URL depends on a hand-authored link from some other page.
export const SITE_FOOTER_LINKS = [
  { href: '/', label: 'Play Lullwood' },
  { href: '/guides', label: 'Guides' },
  { href: '/devlog', label: 'Devlog' },
  { href: '/how-to-survive', label: 'How to survive' },
  { href: '/games-like-slender', label: 'Games like Slender' },
  { href: '/faq', label: 'FAQ' },
  { href: '/press', label: 'Press kit' },
  { href: '/credits', label: 'Credits' },
] as const;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="Lullwood site">
        <ul>
          {SITE_FOOTER_LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href}>{l.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
