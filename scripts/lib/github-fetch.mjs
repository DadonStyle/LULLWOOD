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

// GraphQL companion to ghFetch -- needed for anything the REST API can't
// answer, e.g. a PR's statusCheckRollup with isRequired(pullRequestNumber),
// which is the only field that reflects what `PUT /pulls/{n}/merge` actually
// evaluates (LUL-762: the REST check-runs endpoint shows a workflow_dispatch
// run as a green, name-matched, app-matched success, but that run is
// invisible to this rollup and cannot satisfy a required check).
async function ghGraphQL(query, variables, token) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`POST graphql -> HTTP ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  if (body.errors) {
    throw new Error(`graphql errors: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

export { fetchJson, ghFetch, ghGraphQL };
