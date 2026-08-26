// Shared authed-GitHub-GET helper. Extracted from board-integrity-check.mjs
// and check-review-gap.mjs (LUL-672); check-merge-gap.mjs migrated in LUL-742.
// All scripts/*-check.mjs detectors that need a read-only GitHub REST call
// should import from here.

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
