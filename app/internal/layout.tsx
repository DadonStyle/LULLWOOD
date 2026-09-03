import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// LUL-155: belt-and-suspenders on top of the middleware secret gate and the
// missing sitemap entry -- explicitly noindex this whole segment so it can
// never compete with the game for search results even if something outside
// our control links to it.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function InternalLayout({ children }: { children: ReactNode }) {
  return children;
}
