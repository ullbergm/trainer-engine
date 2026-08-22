/* Runs before app.js boots: plant a mid-study session so the resume path
 * (restoreSession) is exercised by the real boot sequence. engine-suite.js
 * asserts on the result, then navigates away and starts clean.
 * Synced from the trainer-engine repo; do not edit in an app repo. */
localStorage.clear();
// The resumed question is one with an "All of the above" choice, so the
// resume assertions double as a check that positional choices render last.
// A bank without one falls back to an ordinary question and that check is
// skipped in the suite.
const AOTA = QUESTION_BANK.find(x => x.choices.some(c => /^all of the above$/i.test(c)))
  || QUESTION_BANK[1];
sessionStorage.setItem(EXAM_CONFIG.sessionKey, JSON.stringify({
  mode: 'study',
  queue: [QUESTION_BANK[0].id, AOTA.id, QUESTION_BANK[2].id],
  pos: 1, done: 1, correct: 1,
}));
