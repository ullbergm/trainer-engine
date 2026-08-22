/* Persistence: card scheduling state + answer stats in localStorage.
   Synced from the trainer-engine repo; do not edit in an app repo. */
const Store = (() => {
  const KEY = EXAM_CONFIG.storageKey;
  const LOG_MAX = 10000; // ~20k reviews would outlast any exam prep; cap the log well before quota
  // Correct answers in a row that retire a card from the practice pool. Two,
  // so one lucky guess does not clear it, and the pool always empties: every
  // drill moves a card toward the exit instead of chasing a lifetime tally.
  const MISS_CLEARED = 2;

  const defaults = () => ({
    cards: {},          // id -> {stability, difficulty, due, lastReview, reps, lapses, state, wrong, right, streak}
    settings: {
      newPerDay: 10,   // relaxed steady pace; auto-boosted when an exam date demands it
      tests: [],        // exam keys being studied for; empty = all of them
      examDate: '',     // 'YYYY-MM-DD'; drives retention ramp + final review
      theme: 'system',  // 'system' | 'light' | 'dark'
      // Whether the on-screen calculator starts open on a question that
      // offers one. Opening it once is a preference, not a per-card choice.
      calcOpen: false,
    },
    daily: {},          // 'YYYY-MM-DD' -> {new: n, reviews: n, correct: n, extra?: n}
    exams: [],          // {date, type, total, correct, passed}
    log: [],            // {id, rating, ts} per scheduled review; raw history for future FSRS parameter optimization
  });

  const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
  const STATES = ['new', 'learning', 'relearning', 'review'];
  const THEMES = ['system', 'light', 'dark'];

  // The selection is stored as the exams being studied for, not as the
  // sections they happen to cover today. A section list is a snapshot: add
  // chapters to an exam, as a new manual or a body of law does, and everyone
  // who narrowed their selection stays pinned to the old list, silently
  // studying less than the exam now asks. Test keys keep meaning what the
  // user chose, and the sections are derived on read.
  //
  // Which leaves the earlier shape to migrate. A saved `sections` list was
  // the union of the chosen exams' sections, so ordinarily the exams it stood
  // for are the ones whose sections it wholly contains. Bare numbers in it
  // predate the second manual and were all the first one's chapters.
  //
  // Containment alone is not enough, because the lists most in need of
  // migrating are exactly the stale ones: a list written before an exam
  // gained a section can no longer contain that exam, and every exam would
  // drop out at once, silently resetting the selection to everything. So a
  // list that matches nothing falls back to the exams it overlaps, which is
  // what it was a snapshot of.
  // Config section lists may be bare numbers (sections in the default book);
  // qualify them so the containment checks below compare one shape of key.
  const normSec = s => (typeof s === 'number' ? `default:${s}` : String(s));
  const TESTS = (EXAM_CONFIG.tests || [])
    .map(t => ({ ...t, sections: (t.sections || []).map(normSec) }))
    .filter(t => t.sections.length);
  function chosenTests(st) {
    const keys = Array.isArray(st.tests)
      ? st.tests.filter(k => TESTS.some(t => t.key === k))
      : fromSections(st.sections);
    // Everything chosen is stored the same way as nothing chosen: empty,
    // meaning "all of them", so a later exam is included by default rather
    // than needing the picker touched again.
    return keys.length === TESTS.length ? [] : [...new Set(keys)];
  }
  function fromSections(sections) {
    if (!Array.isArray(sections) || !sections.length) return [];
    const had = new Set(sections
      .map(s => (Number.isInteger(s) ? `default:${s}` : s))
      .filter(s => typeof s === 'string' && s.includes(':')));
    if (!had.size) return [];
    const covers = t => t.sections.every(sec => had.has(sec));
    const touches = t => t.sections.some(sec => had.has(sec));
    const contained = TESTS.filter(covers);
    return (contained.length ? contained : TESTS.filter(touches)).map(t => t.key);
  }

  // Anything read from outside the running app (a backup file, but also the
  // localStorage value itself, which extensions or an unrelated writer at the
  // same key could have mangled) must not smuggle NaN/undefined into card
  // state where it would silently break scheduling. Coerce every field to a
  // sane value; never throw.
  function sanitize(parsed) {
    const base = defaults();
    if (!parsed || typeof parsed !== 'object') return base;
    const cards = {};
    if (parsed.cards && typeof parsed.cards === 'object') {
      Object.entries(parsed.cards).forEach(([id, c]) => {
        if (!c || typeof c !== 'object') return;
        cards[id] = {
          stability: num(c.stability), difficulty: num(c.difficulty),
          due: num(c.due), lastReview: num(c.lastReview),
          reps: num(c.reps), lapses: num(c.lapses),
          state: STATES.includes(c.state) ? c.state : 'new',
          wrong: num(c.wrong), right: num(c.right),
          // streak = correct answers in a row since the last miss. Backups
          // written before it existed carry lastWrong instead: a card that was
          // last answered right counts as cleared, so an old file does not
          // refill the practice pool on import.
          streak: num(c.streak, c.lastWrong === true ? 0 : MISS_CLEARED),
        };
      });
    }
    const st = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {};
    return {
      cards,
      settings: {
        newPerDay: Math.max(0, num(st.newPerDay, base.settings.newPerDay)),
        tests: chosenTests(st),
        examDate: typeof st.examDate === 'string' ? st.examDate : '',
        theme: THEMES.includes(st.theme) ? st.theme : 'system',
        calcOpen: st.calcOpen === true,
      },
      daily: parsed.daily && typeof parsed.daily === 'object' && !Array.isArray(parsed.daily)
        ? parsed.daily : {},
      exams: Array.isArray(parsed.exams) ? parsed.exams : [],
      log: Array.isArray(parsed.log)
        ? parsed.log
            .filter(e => e && typeof e === 'object' && typeof e.id === 'string'
              && Number.isFinite(e.ts) && [1, 2, 3, 4].includes(e.rating))
            .slice(-LOG_MAX)
        : [],
    };
  }

  let state = null;

  function load() {
    if (state) return state;
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? sanitize(JSON.parse(raw)) : defaults();
    } catch {
      state = defaults();
    }
    return state;
  }

  // localStorage.setItem can throw (quota, restricted browsing modes). The
  // in-memory session must keep working, so swallow the failure and tell the
  // user once through the onSaveError hook instead of dying mid-answer.
  let saveWarned = false;
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      if (!saveWarned && typeof api.onSaveError === 'function') api.onSaveError(err);
      saveWarned = true;
    }
  }

  function card(id) {
    const s = load();
    if (!s.cards[id]) {
      s.cards[id] = { stability: 0, difficulty: 0, due: 0, lastReview: 0,
                      reps: 0, lapses: 0, state: 'new', wrong: 0, right: 0, streak: 0 };
    }
    return s.cards[id];
  }

  function todayKey(ts = Date.now()) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function bumpDaily(field, by = 1) {
    const s = load();
    const k = todayKey();
    if (!s.daily[k]) s.daily[k] = { new: 0, reviews: 0, correct: 0 };
    // guard: optional fields (like 'extra') are absent on older records
    s.daily[k][field] = (s.daily[k][field] || 0) + by;
  }

  // One entry per scheduled review (study/final modes; misses and exams do
  // not touch the schedule). The aggregate card state cannot be turned back
  // into a history, so this is what makes per-user FSRS parameter
  // optimization possible later. Callers save(); this only appends.
  function logReview(id, rating, ts = Date.now()) {
    const s = load();
    s.log.push({ id, rating, ts });
    if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
  }

  // version stamps the backup format, so a future importer can tell old
  // files apart and migrate them instead of guessing. sanitize copies
  // fields explicitly, so the stamp never leaks into live state. Version 2
  // stores the chosen exams rather than their sections; sanitize migrates a
  // version 1 file by its shape, so the stamp is a label, not a branch.
  function exportJSON() {
    return JSON.stringify({ version: 2, ...load() }, null, 2);
  }

  function importJSON(text) {
    const parsed = JSON.parse(text); // throws on bad input
    if (!parsed || typeof parsed !== 'object'
        || typeof parsed.cards !== 'object' || !parsed.cards
        || typeof parsed.settings !== 'object' || !parsed.settings) {
      throw new Error('Not a valid backup file');
    }
    state = sanitize(parsed);
    save();
  }

  function reset() {
    state = defaults();
    save();
  }

  const api = { load, save, card, todayKey, bumpDaily, logReview, exportJSON, importJSON, reset,
                MISS_CLEARED, onSaveError: null };
  return api;
})();
