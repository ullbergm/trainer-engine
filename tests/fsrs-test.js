#!/usr/bin/env node
/* Property tests for the FSRS-6 scheduler (js/fsrs.js).
 * The e2e suite proves the UI wires up; these assert the math itself, so a
 * parameter typo or a broken formula fails loudly instead of quietly
 * mis-scheduling reviews. */
const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'fsrs.js'), 'utf8')
  .replace('const FSRS', 'globalThis.FSRS'));

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1700000000000; // fixed epoch so runs are reproducible
let failed = 0;
const t = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) failed += 1; };
const newCard = () => ({ stability: 0, difficulty: 0, due: 0, lastReview: 0,
  reps: 0, lapses: 0, state: 'new' });

// ---- new cards
const good = FSRS.schedule(newCard(), 3, T0);
t('new + Good enters review state', good.state === 'review');
t('new + Good schedules at least a day out', good.intervalDays >= 1 && good.due > T0);
t('new + Good counts one rep, no lapse', good.reps === 1 && good.lapses === 0);
t('difficulty stays in 1..10', good.difficulty >= 1 && good.difficulty <= 10);

const again = FSRS.schedule(newCard(), 1, T0);
t('new + Again stays due now for the session requeue', again.due === T0 && again.intervalDays === 0);
t('new + Again is learning, not a lapse', again.state === 'learning' && again.lapses === 0);

// ---- grade ordering on the same card (memory model, pre-fuzz)
const base = FSRS.schedule(newCard(), 3, T0);
const atDue = { ...base };
const hard = FSRS.schedule({ ...atDue }, 2, atDue.due);
const goodR = FSRS.schedule({ ...atDue }, 3, atDue.due);
const easy = FSRS.schedule({ ...atDue }, 4, atDue.due);
t('stability: Hard <= Good <= Easy', hard.stability <= goodR.stability
  && goodR.stability <= easy.stability);
t('difficulty: Hard >= Good >= Easy', hard.difficulty >= goodR.difficulty
  && goodR.difficulty >= easy.difficulty);

// ---- lapses
const lapse = FSRS.schedule({ ...atDue }, 1, atDue.due);
t('lapse never increases stability', lapse.stability <= atDue.stability);
t('lapse increments the counter and relearns', lapse.lapses === atDue.lapses + 1
  && lapse.state === 'relearning');
t('lapse stays due now', lapse.due === atDue.due);

// ---- growth over a streak of on-time Good answers
let card = FSRS.schedule(newCard(), 3, T0);
let ok = true;
for (let i = 0; i < 10; i++) {
  const next = FSRS.schedule({ ...card }, 3, card.due);
  if (next.stability <= card.stability) ok = false;
  card = next;
}
t('stability grows across an on-time Good streak', ok);
t('interval never exceeds MAX_INTERVAL', card.intervalDays <= FSRS.MAX_INTERVAL);

// ---- same-day (short-term memory) reviews
const sameDay = FSRS.schedule({ ...base }, 3, base.lastReview + 60 * 1000);
t('same-day Good never shrinks stability', sameDay.stability >= base.stability);

// ---- retention target and exam clamp
t('higher retention target means shorter intervals',
  FSRS.nextIntervalDays(50, 0.95) < FSRS.nextIntervalDays(50, 0.9));
t('interval bounds hold at the extremes',
  FSRS.nextIntervalDays(0.01) >= 1 && FSRS.nextIntervalDays(1e9) === FSRS.MAX_INTERVAL);
const examDay = T0 + 3 * DAY;
const clamped = FSRS.schedule({ ...atDue }, 4, T0 + DAY, { maxDueTs: examDay });
t('no review scheduled past the exam date', clamped.due <= examDay);
t('clamped interval reported consistently', clamped.intervalDays >= 1
  && clamped.intervalDays <= 3);
// A clamp onto exam day itself must not round up to "1d": the review is due
// today and the grade-button preview shows it as "<1d".
const sameDayClamp = FSRS.schedule({ ...atDue }, 4, examDay - DAY / 4, { maxDueTs: examDay });
t('same-day exam clamp reports a sub-day interval',
  sameDayClamp.due === examDay && sameDayClamp.intervalDays === 0);

// ---- retrievability curve
t('retrievability starts at 1', FSRS.retrievability(0, 10) === 1);
t('retrievability decays with elapsed time',
  FSRS.retrievability(5, 10) > FSRS.retrievability(20, 10));
t('R(interval = S) is the 90% design point',
  Math.abs(FSRS.retrievability(10, 10) - 0.9) < 1e-9);

// ---- determinism (interval fuzz must be seeded, not random)
const a = FSRS.schedule({ ...atDue }, 3, atDue.due);
const b = FSRS.schedule({ ...atDue }, 3, atDue.due);
t('identical inputs give identical schedules', JSON.stringify(a) === JSON.stringify(b));

if (failed) {
  console.error(`${failed} FSRS test(s) failed`);
  process.exit(1);
}
console.log('FSRS scheduler OK');
