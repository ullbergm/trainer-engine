#!/usr/bin/env node
/* Property tests for the exam readiness projection (js/readiness.js).
 * The projection is the number a user decides "am I ready" on, so the math
 * gets checked directly: the expected score, the spread, and the pass odds,
 * the last of those against a Monte Carlo simulation of the real draw. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
// vm.runInThisContext instead of eval so V8 attributes the executed lines
// to the js/ files and `npm run test:coverage` can report on the engine code.
const load = (f, g) => {
  const p = path.join(__dirname, '..', 'js', f);
  vm.runInThisContext(fs.readFileSync(p, 'utf8')
    .replace('const ' + g, 'globalThis.' + g), { filename: p });
};
load('fsrs.js', 'FSRS');
load('readiness.js', 'Readiness');

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1700000000000; // fixed epoch so runs are reproducible
let failed = 0;
const t = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) failed += 1; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const pool = n => Array.from({ length: n }, (_, i) => ({ id: 'q' + i }));
// A studied card reviewed at T0 with the given stability.
const studied = (stability, ts = T0) => ({ stability, difficulty: 5, lastReview: ts, due: ts, reps: 1, lapses: 0, state: 'review' });
const cardsFor = (ids, make) => Object.fromEntries(ids.map((q, i) => [q.id, make(i)]));

// ---- per-card chance
t('unseen card is a pure guess', Readiness.correctChance(undefined, T0) === Readiness.GUESS);
t('a card with no review history is a guess',
  Readiness.correctChance({ stability: 0, lastReview: 0 }, T0) === Readiness.GUESS);
t('just-reviewed card is a near-certain answer',
  Readiness.correctChance(studied(30), T0) === 1);
t('recall decays but never below the guess floor', (() => {
  const soon = Readiness.correctChance(studied(30), T0 + 10 * DAY);
  const later = Readiness.correctChance(studied(30), T0 + 300 * DAY);
  return soon > later && later > Readiness.GUESS && soon < 1;
})());
t('more stability holds up better at the same distance',
  Readiness.correctChance(studied(60), T0 + 30 * DAY)
  > Readiness.correctChance(studied(10), T0 + 30 * DAY));

// ---- whole-pool projections
const P50 = pool(50);
const empty = Readiness.project(P50, {}, T0, 25);
t('untouched bank projects the guess rate', near(empty.expected, Readiness.GUESS, 1e-12));
t('untouched bank counts every question unseen', empty.unseen === 50 && empty.rusty === 0);
t('untouched bank is not passing', empty.passChance < 0.001);

const perfect = Readiness.project(P50, cardsFor(P50, () => studied(1000)), T0, 25);
t('fully fresh memory projects a full score', near(perfect.expected, 1, 1e-9));
t('a certain score has no spread', near(perfect.sd, 0, 1e-9));
t('a certain score passes', perfect.passChance === 1);
t('fresh cards are neither unseen nor rusty', perfect.unseen === 0 && perfect.rusty === 0);

t('empty pool projects nothing', (() => {
  const z = Readiness.project([], {}, T0, 25);
  return z.pool === 0 && z.expected === 0 && z.passChance === 0;
})());

// expected is exactly the mean per-question chance
const mixedCards = cardsFor(P50, i => (i % 3 === 0 ? undefined : studied(2 + i)));
const mixed = Readiness.project(P50, mixedCards, T0 + 5 * DAY, 25);
const meanByHand = P50.reduce((a, q) =>
  a + Readiness.correctChance(mixedCards[q.id], T0 + 5 * DAY), 0) / P50.length;
t('expected score is the pool mean', near(mixed.expected, meanByHand, 1e-12));
t('unseen and rusty are counted separately',
  mixed.unseen === P50.filter((_, i) => i % 3 === 0).length
  && mixed.rusty + mixed.unseen <= 50);
t('a card past its stability counts as rusty', (() => {
  const one = pool(1);
  const late = Readiness.project(one, { q0: studied(1, T0 - 30 * DAY) }, T0, 1);
  return late.rusty === 1 && late.unseen === 0
    && Readiness.recall(studied(1, T0 - 30 * DAY), T0) < Readiness.RUSTY;
})());
t('a card reviewed inside its interval is not rusty',
  Readiness.project(pool(1), { q0: studied(30, T0 - 3 * DAY) }, T0, 1).rusty === 0);

// ---- projecting further out lowers the score
const near5 = Readiness.project(P50, mixedCards, T0 + 5 * DAY, 25);
const far60 = Readiness.project(P50, mixedCards, T0 + 60 * DAY, 25);
t('a later test date projects a lower score', far60.expected < near5.expected);
t('a later test date is less likely to pass', far60.passChance < near5.passChance);
t('projections stay inside the guess floor and 100%',
  far60.expected > Readiness.GUESS && near5.expected < 1);

// ---- sampling
t('sample size is clamped to the pool', Readiness.project(pool(10), {}, T0, 25).sample === 10);
t('a whole-pool test has only coin-flip spread', (() => {
  const cards = cardsFor(P50, i => studied(3 + i));
  const part = Readiness.project(P50, cards, T0 + 20 * DAY, 25);
  const whole = Readiness.project(P50, cards, T0 + 20 * DAY, Infinity);
  // Same expected score, but drawing 25 of 50 adds which-questions variance
  // on top, and averaging over fewer questions widens it further.
  return near(part.expected, whole.expected, 1e-12) && part.sd > whole.sd;
})());
t('a bigger test narrows the spread', (() => {
  const cards = cardsFor(P50, i => studied(3 + i));
  const small = Readiness.project(P50, cards, T0 + 20 * DAY, 10);
  const big = Readiness.project(P50, cards, T0 + 20 * DAY, 40);
  return small.sd > big.sd;
})());

// ---- pass odds against a simulation of the actual draw
// Mulberry32: deterministic, so a CI failure here is a real regression.
function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function simulate(ps, n, trials, seed) {
  const rand = rng(seed);
  const need = Math.ceil(Readiness.PASS_MARK * n);
  let passes = 0;
  for (let k = 0; k < trials; k++) {
    const idx = ps.map((_, i) => i);
    let correct = 0;
    for (let i = 0; i < n; i++) { // partial Fisher-Yates draw without replacement
      const j = i + Math.floor(rand() * (idx.length - i));
      [idx[i], idx[j]] = [idx[j], idx[i]];
      if (rand() < ps[idx[i]]) correct++;
    }
    if (correct >= need) passes++;
  }
  return passes / trials;
}

// Three profiles spanning the interesting range: clearly short, borderline,
// and comfortably ready. The normal approximation is checked against each.
[
  ['a shaky bank', i => studied(1 + (i % 5), T0 - 20 * DAY)],
  ['a borderline bank', i => (i % 4 === 0 ? undefined : studied(4 + (i % 9), T0 - 6 * DAY))],
  ['a well-drilled bank', i => studied(40 + (i % 20), T0 - 4 * DAY)],
].forEach(([label, make], n) => {
  const cards = cardsFor(P50, make);
  const proj = Readiness.project(P50, cards, T0, 25);
  const ps = P50.map(q => Readiness.correctChance(cards[q.id], T0));
  const sim = simulate(ps, 25, 20000, 12345 + n);
  t(`pass odds match simulation for ${label} (${(proj.passChance * 100).toFixed(1)}% vs ${(sim * 100).toFixed(1)}%)`,
    near(proj.passChance, sim, 0.03));
});

t('pass odds stay a probability', (() => {
  for (let d = 0; d <= 400; d += 7) {
    const p = Readiness.project(P50, cardsFor(P50, i => studied(5 + i)), T0 + d * DAY, 25).passChance;
    if (!(p >= 0 && p <= 1) || Number.isNaN(p)) return false;
  }
  return true;
})());

if (failed) {
  console.error(`${failed} readiness test(s) failed`);
  process.exit(1);
}
console.log('readiness projection OK');
