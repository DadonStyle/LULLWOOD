// Shared authed-GitHub-GET helper. Extracted from board-integrity-check.mjs
// and check-review-gap.mjs, which each hand-rolled the same fetch-and-throw
// wrapper (flagged as a DRY hit on LUL-672's review, wiki
// game/lul672-board-integrity-detector). Every scripts/*-check.mjs detector
// that only needs a read-only GitHub REST call should use this instead of a
// fourth copy.

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function ghFetch(url, token) {
  return fetchJson(url, {
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
}

export { fetchJson, ghFetch };
