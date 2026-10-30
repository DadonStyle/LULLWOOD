'use client';

import { useEffect } from 'react';
import { readAttribution } from '@/lib/analytics';

// LUL-6229: stores first-touch referrer/UTM on whatever route the visitor lands on,
// so a devlog -> game click-through doesn't turn the referrer into "internal".
export function AttributionCapture() {
  useEffect(() => {
    readAttribution();
  }, []);
  return null;
}
