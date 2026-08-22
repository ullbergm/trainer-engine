/* FSRS-6 scheduler (default parameters), plain JS, no dependencies.
 * Reference: https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
 */
const FSRS = (() => {
  const W = [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
    1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
    1.8729, 0.5425, 0.0912, 0.0658, 0.1542
  ];
  const DECAY = -W[20];
  const FACTOR = Math.pow(0.9, 1 / DECAY) - 1; // so R(interval=S) = 0.9
  const DEFAULT_RETENTION = 0.9;
  const MAX_INTERVAL = 365;
  const S_MIN = 0.01;

  // Ratings: 1=Again 2=Hard 3=Good 4=Easy
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  function retrievability(elapsedDays, stability) {
    return Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);
  }

  function nextIntervalDays(stability, retention = DEFAULT_RETENTION) {
    const ivl = (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
    return clamp(Math.round(ivl), 1, MAX_INTERVAL);
  }

  /* Fuzz intervals of 3+ days by up to about 5% so cards learned together
   * drift apart instead of staying due on the same day forever. Deterministic,
   * seeded from the card's own state, so the interval previewed on the grade
   * buttons matches what actually gets scheduled. */
  function fuzzInterval(ivl, seed) {
    if (ivl < 3) return ivl;
    const r = ((Math.imul(seed, 2654435761) >>> 0) % 1000) / 999; // 0..1
    const spread = Math.max(1, Math.round(ivl * 0.05));
    return clamp(ivl + Math.round((r * 2 - 1) * spread), 2, MAX_INTERVAL);
  }

  function initStability(rating) {
    return Math.max(W[rating - 1], S_MIN);
  }

  function initDifficulty(rating) {
    return clamp(W[4] - Math.exp(W[5] * (rating - 1)) + 1, 1, 10);
  }

  function nextDifficulty(d, rating) {
    const delta = -W[6] * (rating - 3);
    const damped = d + delta * (10 - d) / 9; // linear damping
    // mean reversion toward the Easy-card initial difficulty
    return clamp(W[7] * initDifficulty(4) + (1 - W[7]) * damped, 1, 10);
  }

  function nextRecallStability(d, s, r, rating) {
    const hardPenalty = rating === 2 ? W[15] : 1;
    const easyBonus = rating === 4 ? W[16] : 1;
    return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) *
      (Math.exp(W[10] * (1 - r)) - 1) * hardPenalty * easyBonus);
  }

  function nextForgetStability(d, s, r) {
    const ns = W[11] * Math.pow(d, -W[12]) *
      (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
    return Math.min(ns, s); // a lapse never increases stability
  }

  // Same-day review: short-term memory formula (FSRS-6)
  function shortTermStability(s, rating) {
    let sinc = Math.exp(W[17] * (rating - 3 + W[18])) * Math.pow(s, -W[19]);
    if (rating >= 2) sinc = Math.max(sinc, 1); // a successful recall never hurts
    return s * sinc;
  }

  /* Apply a rating to a card's scheduling state.
   * card: {stability, difficulty, lastReview (ms), due (ms), reps, lapses, state}
   * opts: {retention: desired recall probability at next review (default 0.9),
   *        maxDueTs: never schedule past this timestamp (e.g. exam day)}
   * Returns a new scheduling object; `due` is a timestamp.
   */
  function schedule(card, rating, now = Date.now(), opts = {}) {
    const DAY = 24 * 60 * 60 * 1000;
    const retention = opts.retention || DEFAULT_RETENTION;
    let { stability, difficulty, reps = 0, lapses = 0 } = card;
    const isNew = !card.lastReview;
    let s, d;

    if (isNew) {
      s = initStability(rating);
      d = initDifficulty(rating);
    } else {
      const elapsed = Math.max(0, (now - card.lastReview) / DAY);
      d = nextDifficulty(difficulty, rating);
      if (elapsed < 1) {
        s = shortTermStability(stability, rating);
      } else {
        const r = retrievability(elapsed, stability);
        s = rating === 1
          ? nextForgetStability(difficulty, stability, r)
          : nextRecallStability(difficulty, stability, r, rating);
      }
      s = Math.max(s, S_MIN);
    }

    let due, state, intervalDays;
    if (rating === 1) {
      // lapse / failed: keep it due now (the session requeues it)
      if (!isNew) lapses += 1;
      state = isNew ? 'learning' : 'relearning';
      intervalDays = 0;
      due = now;
    } else {
      state = 'review';
      intervalDays = fuzzInterval(nextIntervalDays(s, retention),
        reps * 31 + rating + Math.round(s * 10));
      due = now + intervalDays * DAY;
      // never schedule a review past the exam date; a clamp onto exam day
      // itself may report 0, which the UI shows as "<1d"
      if (opts.maxDueTs && opts.maxDueTs > now && due > opts.maxDueTs) {
        due = opts.maxDueTs;
        intervalDays = Math.round((due - now) / DAY);
      }
    }

    return {
      stability: s, difficulty: d, due, lastReview: now,
      reps: reps + 1, lapses, state, intervalDays
    };
  }

  return { schedule, retrievability, nextIntervalDays, DEFAULT_RETENTION, MAX_INTERVAL };
})();
