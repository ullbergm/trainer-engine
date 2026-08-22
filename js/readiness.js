/* Exam readiness: turns FSRS memory state into a projected score for a test.
 *
 * Every question is one Bernoulli trial. Either the answer is recalled, with
 * the probability FSRS already models (retrievability at the moment of the
 * test), or it is not and the guess still lands one time in four. A real
 * knowledge test draws a fixed number of questions from a much larger pool,
 * so the expected score is the pool mean, and the spread around it comes from
 * two places: which questions get drawn, and how the recall coin lands on each.
 *
 * Nothing here touches the DOM or storage; the caller passes the pool, the
 * card states, and the timestamp to project to.
 */
const Readiness = (() => {
  const DAY = 24 * 60 * 60 * 1000;
  const GUESS = 0.25;    // four choices, no partial credit
  // Pass mark comes from the exam config; the fallback keeps this module
  // usable on its own (the node tests eval it without the config loaded).
  const PASS_MARK = (typeof EXAM_CONFIG === 'object' && EXAM_CONFIG.passMark) || 0.8;
  // A studied card counts as rusty once its predicted recall has slipped below
  // the retention the scheduler aims for. Anything lower would barely ever
  // trip: the FSRS-6 forgetting curve is a shallow power law, and the guess
  // floor holds the answer chance up even when the memory is long gone.
  const RUSTY = 0.9;

  // Probability the answer is genuinely remembered at ts. An unseen card
  // scores zero: there is no memory to decay yet.
  function recall(card, ts) {
    if (!card || !card.lastReview || !(card.stability > 0)) return 0;
    const elapsed = Math.max(0, (ts - card.lastReview) / DAY);
    return FSRS.retrievability(elapsed, card.stability);
  }

  // Probability of marking the right box: recall it, or miss it and guess right.
  function correctChance(card, ts) {
    const r = recall(card, ts);
    return r + (1 - r) * GUESS;
  }

  // Standard normal CDF (Abramowitz & Stegun 26.2.17), |error| < 7.5e-8.
  function normalCdf(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989422804014327 * Math.exp(-z * z / 2);
    const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 +
      t * (-1.821255978 + t * 1.330274429))));
    return z >= 0 ? 1 - p : p;
  }

  /* Project the score on a test drawn from `pool`.
   *   pool:       question objects (only .id is read)
   *   cards:      id -> card state, as stored by Store
   *   ts:         when the test is taken
   *   sampleSize: how many questions the real test asks (pass Infinity for
   *               "the whole pool", e.g. when scoring a single section)
   * Returns {pool, sample, expected, sd, passChance, unseen, rusty}, where
   * expected and sd are fractions of the test, not counts.
   */
  function project(pool, cards, ts, sampleSize) {
    const N = pool.length;
    if (!N) {
      return { pool: 0, sample: 0, expected: 0, sd: 0, passChance: 0, unseen: 0, rusty: 0 };
    }
    const n = Math.min(sampleSize > 0 ? sampleSize : N, N);
    let unseen = 0, rusty = 0, sum = 0, sumPq = 0;
    const ps = pool.map(q => {
      const c = cards[q.id];
      const p = correctChance(c, ts);
      if (!c || !c.lastReview) unseen++;
      else if (recall(c, ts) < RUSTY) rusty++;
      sum += p;
      sumPq += p * (1 - p);
      return p;
    });
    const mean = sum / N;
    const varP = ps.reduce((a, p) => a + (p - mean) * (p - mean), 0) / N;
    // Drawing n of N without replacement, then one coin flip per drawn
    // question: Var(S) = n*E[p(1-p)] + n*Var(p)*(N-n)/(N-1). The second term
    // vanishes when the test asks the whole pool, which is exactly right.
    const fpc = N > 1 ? (N - n) / (N - 1) : 0;
    const varS = n * (sumPq / N) + n * varP * fpc;
    // Passing takes ceil(80% of n) correct answers; continuity-correct the
    // normal approximation to the sum, which is a handful of questions wide.
    const need = Math.ceil(PASS_MARK * n);
    const passChance = varS > 0
      ? 1 - normalCdf((need - 0.5 - n * mean) / Math.sqrt(varS))
      : (n * mean >= need ? 1 : 0);
    return {
      pool: N, sample: n, expected: mean, sd: Math.sqrt(varS) / n,
      passChance, unseen, rusty,
    };
  }

  return { project, correctChance, recall, PASS_MARK, GUESS, RUSTY };
})();
