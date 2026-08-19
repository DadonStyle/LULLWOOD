import { test, expect } from '@playwright/test';

// LUL-479 scratch proof, NOT real coverage — deliberately red so we can observe
// `mergeable_state` actually go `blocked` on a genuine required-check failure
// once the same-repo `pull_request` self-skip run no longer shares the
// `playwright smoke suite` check-run name. Deleted in the very next commit on
// this branch once the block is confirmed — do not build on top of this file.
test('LUL-479 scratch: deliberately fails to prove the merge gate blocks', async () => {
  expect(true).toBe(false);
});
