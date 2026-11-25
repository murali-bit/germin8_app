// Small rules of Prepare migration. Plain JavaScript with no React, so they can be tested with node
// (frontend/test/followUps.test.js).

export const PREPARE_POLL_MS = 4000;

// Prepare migration reads its state again on a timer only while something runs that changes it by itself: processing
// (queued or running) or the files being created. Otherwise it reads it when the page gets the focus again (the person
// came back from another screen or window) and after each action taken on the page.
// state: GET /prepare; creating: the page is waiting for "Create files".
export function prepareShouldPoll(state, { creating = false } = {}) {
  if (creating) return true;
  const process = state?.steps?.find(s => s.key === 'process');
  return !!process?.active;
}
