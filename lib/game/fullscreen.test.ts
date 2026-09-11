// No jsdom in this repo's test setup (see lib/analytics.test.ts) -- stub just
// enough of `document`/`document.documentElement` on globalThis for
// fullscreen.ts's checks to resolve without throwing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fullscreenSupported,
  isFullscreenActive,
  toggleFullscreen,
} from './fullscreen.ts';

function installFakeDocument(overrides: Record<string, unknown> = {}) {
  const fakeDocumentElement = {
    requestFullscreen: () => {
      fakeDocument.fullscreenElement = fakeDocumentElement;
      return Promise.resolve();
    },
  };
  const fakeDocument: Record<string, unknown> = {
    fullscreenEnabled: true,
    fullscreenElement: null,
    documentElement: fakeDocumentElement,
    exitFullscreen: () => {
      fakeDocument.fullscreenElement = null;
      return Promise.resolve();
    },
    ...overrides,
  };
  (globalThis as { document?: unknown }).document = fakeDocument;
  return fakeDocument;
}

test('fullscreenSupported: true when fullscreenEnabled, true when only webkitFullscreenEnabled, false when neither', () => {
  try {
    installFakeDocument({ fullscreenEnabled: true });
    assert.equal(fullscreenSupported(), true);

    installFakeDocument({ fullscreenEnabled: false, webkitFullscreenEnabled: true });
    assert.equal(fullscreenSupported(), true);

    installFakeDocument({ fullscreenEnabled: false, webkitFullscreenEnabled: false });
    assert.equal(fullscreenSupported(), false);
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
});

test('toggleFullscreen: requests fullscreen when inactive, exits when active (unprefixed API)', async () => {
  try {
    const doc = installFakeDocument();
    assert.equal(isFullscreenActive(), false);

    toggleFullscreen();
    await Promise.resolve();
    assert.equal(doc.fullscreenElement, doc.documentElement);
    assert.equal(isFullscreenActive(), true);

    toggleFullscreen();
    await Promise.resolve();
    assert.equal(doc.fullscreenElement, null);
    assert.equal(isFullscreenActive(), false);
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
});

test('toggleFullscreen: falls back to webkit-prefixed API when unprefixed is absent', async () => {
  try {
    const fakeDocumentElement = {
      webkitRequestFullscreen: () => {
        fakeDocument.webkitFullscreenElement = fakeDocumentElement;
        return Promise.resolve();
      },
    };
    const fakeDocument: Record<string, unknown> = {
      webkitFullscreenEnabled: true,
      webkitFullscreenElement: null,
      documentElement: fakeDocumentElement,
      webkitExitFullscreen: () => {
        fakeDocument.webkitFullscreenElement = null;
        return Promise.resolve();
      },
    };
    (globalThis as { document?: unknown }).document = fakeDocument;

    assert.equal(isFullscreenActive(), false);
    toggleFullscreen();
    await Promise.resolve();
    assert.equal(fakeDocument.webkitFullscreenElement, fakeDocumentElement);
    assert.equal(isFullscreenActive(), true);

    toggleFullscreen();
    await Promise.resolve();
    assert.equal(fakeDocument.webkitFullscreenElement, null);
    assert.equal(isFullscreenActive(), false);
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
});
