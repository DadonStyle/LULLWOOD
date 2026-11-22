'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { isGameRoute, showPlayHeader } from '../lib/site-chrome';

export function SiteHeader() {
  const pathname = usePathname();
  useEffect(() => {
    // The head script locked html scroll on a hard load of "/"; a client-side
    // navigation to any other route keeps that inline style unless cleared.
    if (!isGameRoute(pathname)) document.documentElement.style.overflow = '';
  }, [pathname]);
  if (!showPlayHeader(pathname)) return null;
  return (
    <header className="site-header">
      <Link href="/" className="site-header__play">
        ▶ Play Lullwood free in your browser
      </Link>
    </header>
  );
}
