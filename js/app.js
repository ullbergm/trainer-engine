/* Trainer engine: UI and session logic. Everything that names the exam being
   studied (tests, pass mark, manual links, prose) comes from
   data/exam-config.js; nothing below knows which exam it is.
   Synced from the trainer-engine repo; do not edit in an app repo. */
(() => {
  const CFG = EXAM_CONFIG;

  // Optional capability modules. An app that ships a drill generator and an
  // on-screen calculator loads them before this file and attaches them to
  // `self` (self.Problems, self.Calculator); an app without them gets these
  // inert stubs and every drill code path is a no-op.
  const Problems = self.Problems
    || { isDrill: () => false, newSeed: () => 0, reroll: () => {}, templates: [] };
  const Calculator = self.Calculator
    || { owns: () => false, reset: () => {}, html: () => '', wire: () => {} };
  const DAY = 24 * 60 * 60 * 1000;
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Each manual numbers its chapters from 1, so a chapter is the pair
  // (manual, number) and "<manual>:<number>" is how that pair is keyed
  // wherever one chapter has to be told from another: the exam config's
  // section lists, the saved chapter selection, and every grouping below.
  // A question without a `manual` belongs to `default`, so a single-manual
  // bank needs no manual field at all.
  //
  // A bank whose section numbers are topics rather than chapters — the same
  // section can hold questions citing different manuals, and `manual` says
  // only where the citation points — sets CFG.flatSections, and every section
  // keys under `default` regardless of what the question cites.
  const secManual = q => (CFG.flatSections ? 'default' : q.manual) || 'default';
  const secKey = q => `${secManual(q)}:${q.section}`;
  // How a section refers to itself in prose: "ch. 3" by default, or under
  // whatever word the config picks ("§" for topic sections). Back matter sets
  // `sectionLabel` ("app. C") because its designation is not its position.
  const secWord = n => `${CFG.sectionWord || 'ch.'} ${n}`;
  const SECTION_NAMES = {};
  const SECTION_REFS = {};
  QUESTION_BANK.forEach(q => {
    SECTION_NAMES[secKey(q)] = q.sectionName;
    SECTION_REFS[secKey(q)] = q.sectionLabel || secWord(q.section);
  });
  // Bank order, which is each manual's chapters and then its back matter, in
  // printed order.
  const SECTION_IDS = Object.keys(SECTION_NAMES);
  // What a section calls itself, with no manual attached: "ch. 3", "app. C".
  // Use this under a heading that already names the manual, which is most
  // places, since repeating it on every row says nothing.
  const secRef = key => SECTION_REFS[key] || secWord(key.slice(key.indexOf(':') + 1));
  // Whether the sections actually span more than one book. Derived from the
  // bank rather than from CFG.manuals: a flat-sectioned bank keys everything
  // under `default` however many documents its citations point at.
  const MANY_BOOKS = new Set(
    Object.keys(SECTION_NAMES).map(k => k.slice(0, k.indexOf(':')))).size > 1;
  // The same with the manual in front, for the few places a section appears
  // with no surrounding context to say which book it is from. Falls back to
  // the bare reference when the bank has only one book.
  const secLabel = key => {
    const manual = key.slice(0, key.indexOf(':'));
    const m = CFG.manuals && CFG.manuals[manual];
    return `${MANY_BOOKS && m ? `${m.short || m.cite || manual} ` : ''}${secRef(key)}`;
  };
  // A test's section list as one short phrase: "Core ch. 1-11, app. C/D". Runs
  // of consecutive numbers collapse to a range; anything else is listed, so
  // lettered back matter stays readable and no section is implied that the
  // test does not actually draw on.
  const secRange = keys => {
    const byManual = new Map();
    keys.forEach(k => {
      const manual = k.slice(0, k.indexOf(':'));
      if (!byManual.has(manual)) byManual.set(manual, []);
      byManual.get(manual).push(SECTION_REFS[k] || secWord(k.slice(k.indexOf(':') + 1)));
    });
    return [...byManual].map(([manual, refs]) => {
      const kinds = new Map(); // "ch." -> ["1", "2", ...]
      refs.forEach(ref => {
        const at = ref.lastIndexOf(' ');
        const kind = at === -1 ? '' : ref.slice(0, at);
        const val = at === -1 ? ref : ref.slice(at + 1);
        if (!kinds.has(kind)) kinds.set(kind, []);
        kinds.get(kind).push(val);
      });
      const parts = [...kinds].map(([kind, vals]) => {
        const nums = vals.map(Number);
        const run = nums.every(Number.isFinite)
          && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
        const body = vals.length === 1 ? vals[0]
          : run ? `${vals[0]}-${vals[vals.length - 1]}`
          : vals.join('/');
        return kind ? `${kind} ${body}` : body;
      });
      const m = CFG.manuals && CFG.manuals[manual];
      const prefix = MANY_BOOKS && m ? `${m.short || m.cite || manual} ` : '';
      return prefix + parts.join(', ');
    }).join('; ');
  };

  // Chapters divided the way the exams divide them: every chapter drawn on by
  // the same set of exams lands in one group, so the core manual's chapters
  // group under "Commercial Core · Private Applicator" and the aerial manual's
  // under "Aerial Methods" without either being listed twice. Bank order is
  // preserved, so groups come out in each manual's printed order.
  // Pass a narrower list to group only part of the bank; Stats passes the
  // sections actually being studied, Browse passes all of them.
  const sectionGroups = (sections = SECTION_IDS) => {
    const groups = new Map();
    sections.forEach(sec => {
      const label = EXAMS.filter(e => (e.sections || []).includes(sec))
        .map(e => e.name).join(' · ') || 'Not on any exam';
      if (!groups.has(label)) groups.set(label, { label, sections: [] });
      groups.get(label).sections.push(sec);
    });
    return [...groups.values()];
  };

  // Totals for a set of chapters: how much of it has been studied and how
  // often it has been answered right. Shown on a group's summary line so the
  // number is there before the group is expanded.
  const chapterStats = (sections, cards) => {
    const secs = new Set(sections);
    let total = 0, studied = 0, right = 0, wrong = 0;
    QUESTION_BANK.forEach(q => {
      if (!secs.has(secKey(q))) return;
      total++;
      const c = cards[q.id];
      if (c && c.lastReview) studied++;
      if (c) { right += c.right; wrong += c.wrong; }
    });
    return {
      total, studied, right, wrong,
      acc: right + wrong ? Math.round((right / (right + wrong)) * 100) + '%' : '-',
    };
  };

  const groupSummary = st =>
    `<small>${st.studied}/${st.total} studied${st.right + st.wrong ? ` · ${st.acc} right` : ''}</small>`;

  const BY_ID = {};
  QUESTION_BANK.forEach(q => { BY_ID[q.id] = q; });

  // Section lists in the config may be written as bare numbers when the
  // sections live in the default book (every flat-sectioned config, and any
  // single-manual one); qualify them here so everything downstream compares
  // one shape of key.
  const normSec = s => (typeof s === 'number' ? `default:${s}` : String(s));
  const EXAMS = (CFG.exams || []).map(e => ({ ...e, sections: (e.sections || []).map(normSec) }));
  const TESTS = (CFG.tests || []).map(t => ({ ...t, sections: (t.sections || []).map(normSec) }));
  const TEST_GROUPS = CFG.testGroups;

  const shuffle = arr => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // Choices like "All of the above" refer to the other choices by position,
  // so they must stay below them no matter how the rest are shuffled.
  const POSITIONAL = /^(all|none|any|both) of (the above|these)/i;
  const choiceOrder = q => {
    const order = shuffle([0, 1, 2, 3]);
    return order.filter(i => !POSITIONAL.test(q.choices[i]))
      .concat(order.filter(i => POSITIONAL.test(q.choices[i])));
  };

  // The sections the studied exams cover, in bank order. Derived on every
  // read rather than stored: an exam's section list grows when the bank does,
  // and a stored copy would go stale the day that happens.
  const enabledTests = () => {
    const sel = Store.load().settings.tests;
    const studiable = TESTS.filter(tst => tst.sections.length);
    return sel && sel.length
      ? studiable.filter(tst => sel.includes(tst.key))
      : studiable;
  };
  const enabledSections = () => {
    const secs = new Set(enabledTests().flatMap(tst => tst.sections));
    return SECTION_IDS.filter(sec => secs.has(sec));
  };

  const endOfToday = () => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  };

  // ---------- exam-date awareness ----------
  function examInfo() {
    const dateStr = Store.load().settings.examDate;
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return null;
    const end = new Date(y, m - 1, d, 23, 59, 59).getTime();
    if (end < Date.now()) return null; // exam already happened
    return { end, daysLeft: Math.ceil((end - Date.now()) / DAY), dateStr };
  }

  // Target retention ramps 90% -> 95% over the last 21 days before the exam.
  function targetRetention() {
    const exam = examInfo();
    if (!exam || exam.daysLeft > 21) return FSRS.DEFAULT_RETENTION;
    return Math.min(0.95, 0.9 + 0.05 * (21 - exam.daysLeft) / 21);
  }

  function schedOpts() {
    const exam = examInfo();
    return { retention: targetRetention(), maxDueTs: exam ? exam.end : null };
  }

  // ---------- exam readiness ----------
  // "Am I ready" answered with a number: each selected test projected forward
  // to exam day (or to right now, with no date set) from the memory model the
  // scheduler already maintains. Weakest test first, which is the order worth
  // acting on.
  function readinessRows() {
    const exam = examInfo();
    const ts = exam ? exam.end : Date.now();
    const cards = Store.load().cards;
    // The tests picked in Settings, and only those. Asking instead which tests
    // the studied sections happen to cover would volunteer any test whose
    // material is a subset of another's: studying for Core covers everything
    // the Pesticide Dealer exam draws on, and projecting a dealer score for
    // someone who never asked for one is noise. `enabledTests` has already
    // dropped the tests the bank has no questions for, which have nothing to
    // project and would score a flat 0% beside the exams actually studied.
    return enabledTests()
      .map(tst => {
        const meta = EXAMS.find(e => e.key === tst.key);
        const pool = QUESTION_BANK.filter(q => tst.sections.includes(secKey(q)));
        // Per-section projections score the whole section, so they compare
        // like for like regardless of how many questions the test draws.
        const sections = tst.sections
          .map(sec => ({
            sec,
            proj: Readiness.project(pool.filter(q => secKey(q) === sec), cards, ts, Infinity),
          }))
          .sort((a, b) => a.proj.expected - b.proj.expected);
        return {
          test: tst,
          proj: Readiness.project(pool, cards, ts, meta ? meta.count : pool.length),
          weakest: sections[0],
        };
      })
      .sort((a, b) => a.proj.expected - b.proj.expected);
  }

  const pct = x => Math.round(x * 100);
  const PASS_PCT = pct(Readiness.PASS_MARK);

  // Pass chance is a model output, not a measurement; hard 0% and 100% would
  // read as promises, so the ends are shown as bounds.
  const chanceText = p => p < 0.005 ? '<1%' : p > 0.995 ? '>99%' : pct(p) + '%';

  function readinessBar(proj) {
    return `<div class="rbar" role="img"
      aria-label="projected ${pct(proj.expected)} percent, ${PASS_PCT} percent to pass">
      <div class="rfill${proj.expected >= Readiness.PASS_MARK ? '' : ' low'}"
           style="width:${pct(proj.expected)}%"></div>
      <div class="rmark" style="left:${pct(Readiness.PASS_MARK)}%"></div>
    </div>`;
  }

  // Home: one compact line per test. Hidden until something has been studied,
  // since an untouched bank projects a flat 25% guess rate for every test.
  function readinessBlock() {
    const rows = readinessRows();
    if (!rows.length || rows.every(r => r.proj.unseen === r.proj.pool)) return '';
    return `<div class="readiness">
      <h3>Projected score ${examInfo() ? 'on exam day' : 'if you tested today'}</h3>
      ${rows.map(r => `<div class="rrow">
        <span class="rname">${esc(r.test.name)}</span>
        ${readinessBar(r.proj)}
        <span class="rpct ${r.proj.expected >= Readiness.PASS_MARK ? 'pass' : 'fail'}"
          >${pct(r.proj.expected)}%</span>
      </div>`).join('')}
      <p class="hint">${PASS_PCT}% passes. See <a href="#stats">Stats</a> for the odds and the weak spots.</p>
    </div>`;
  }

  // Stats: the same projection with the odds and what is dragging it down.
  function readinessTable() {
    const rows = readinessRows();
    if (!rows.length || rows.every(r => r.proj.unseen === r.proj.pool)) return '';
    const exam = examInfo();
    const when = exam
      ? `for exam day (${new Date(exam.end).toLocaleDateString()})`
      : 'as of right now';
    return `<div class="readiness">
      <h3>Exam readiness</h3>
      <p class="hint">Projected ${when} from how well each answer is predicted to
        hold, plus a one-in-four guess on the rest. A question you have never
        seen counts as a guess, and a rusty one is predicted to have slipped
        below the ${pct(Readiness.RUSTY)}% recall the scheduler aims for. ${PASS_PCT}% passes.</p>
      <table>
        <tr><th>Test</th><th>Projected</th><th>Chance to pass</th><th>Weak spots</th></tr>
        ${rows.map(r => {
          // Non-breaking spaces: the column is narrow enough that a count
          // would otherwise wrap away from the word it belongs to.
          const weak = [
            r.proj.unseen ? `${r.proj.unseen}&nbsp;unseen` : '',
            r.proj.rusty ? `${r.proj.rusty}&nbsp;rusty` : '',
          ].filter(Boolean).join(' · ') || 'none';
          const drag = r.test.sections.length > 1
            ? `<br><small>weakest: ${esc(secRef(r.weakest.sec))} ${esc(SECTION_NAMES[r.weakest.sec])}
               at ${pct(r.weakest.proj.expected)}%</small>`
            : '';
          return `<tr>
            <td>${esc(r.test.name)}${drag}</td>
            <td class="${r.proj.expected >= Readiness.PASS_MARK ? 'pass' : 'fail'}"
              >${pct(r.proj.expected)}% <small>±${pct(r.proj.sd)}</small></td>
            <td>${chanceText(r.proj.passChance)}</td>
            <td>${weak}</td>
          </tr>`;
        }).join('')}
      </table>
    </div>`;
  }

  // ---------- queue building ----------
  function dueReviewIds() {
    const secs = new Set(enabledSections());
    const cutoff = endOfToday();
    return QUESTION_BANK
      .filter(q => secs.has(secKey(q)))
      .filter(q => {
        const c = Store.load().cards[q.id];
        return c && c.state !== 'new' && c.lastReview && c.due <= cutoff;
      })
      .map(q => q.id);
  }

  function newIds(limit) {
    if (limit <= 0) return [];
    const secs = new Set(enabledSections());
    const unseen = QUESTION_BANK
      .filter(q => secs.has(secKey(q)))
      .filter(q => {
        const c = Store.load().cards[q.id];
        return !c || !c.lastReview;
      });
    // Round-robin across sections, so early sections are not drilled to
    // exhaustion before later ones are ever seen.
    const bySection = new Map();
    unseen.forEach(q => {
      if (!bySection.has(secKey(q))) bySection.set(secKey(q), []);
      bySection.get(secKey(q)).push(q.id);
    });
    const lists = [...bySection.values()];
    const take = Math.min(limit, unseen.length);
    const out = [];
    for (let i = 0; out.length < take; i++) {
      const list = lists[i % lists.length];
      if (list.length) out.push(list.shift());
    }
    return out;
  }

  const unseenCount = () => newIds(Infinity).length;

  // The pace actually used: the user's setting, auto-boosted when it wouldn't
  // get through every unseen card before the exam (last day reserved for review).
  function effectiveNewPerDay() {
    const base = Store.load().settings.newPerDay;
    const exam = examInfo();
    if (!exam) return base;
    const days = Math.max(1, exam.daysLeft - 1);
    return Math.max(base, Math.ceil(unseenCount() / days));
  }

  function newRemainingToday() {
    const t = Store.load().daily[Store.todayKey()] || {};
    return Math.max(0, effectiveNewPerDay() + (t.extra || 0) - (t.new || 0));
  }

  // "I want to do more today": raise today's new-card allowance by n on top
  // of whatever is currently on offer. Stored with the daily counters, so the
  // configured pace is untouched and tomorrow is a normal day.
  function addExtraToday(n) {
    const t = Store.load().daily[Store.todayKey()] || {};
    const shortfall = Math.max(0,
      (t.new || 0) - (effectiveNewPerDay() + (t.extra || 0)));
    Store.bumpDaily('extra', n + shortfall);
    Store.save();
  }

  function extraControls() {
    const unseen = unseenCount();
    if (!unseen) return '';
    const amounts = [...new Set([5, 10, 25].map(n => Math.min(n, unseen)))];
    return `<div class="extra"><span>Extra new cards today:</span>
      ${amounts.map(n => `<button data-extra="${n}">+${n}</button>`).join('')}</div>`;
  }

  function wireExtra() {
    view.querySelectorAll('button[data-extra]').forEach(b =>
      b.addEventListener('click', () => {
        addExtraToday(Number(b.dataset.extra));
        if (currentView === 'study') startStudy();
        else go('study');
      }));
  }

  // ---------- views ----------
  const view = $('#view');
  let session = null; // active study/miss/exam session

  // ---------- session persistence ----------
  // The active session is mirrored to sessionStorage so a reload mid-session
  // (or mid-exam) resumes where it left off. Navigating away still abandons
  // the session, and closing the tab drops it with the tab.
  const SESSION_KEY = CFG.sessionKey;

  function saveSession() {
    try {
      const { mode, queue, pos, done, correct, answers, draws } = session;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        mode, queue, pos, done, correct, answers, draws,
        examKey: session.exam && session.exam.key,
      }));
    } catch { /* storage unavailable: a reload just loses the session */ }
  }

  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  function restoreSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!Array.isArray(s.queue) || !s.queue.every(id => BY_ID[id])
          || !(s.pos < s.queue.length)) return false;
      // The drawn numbers of any drill in the queue, so the resumed card is
      // the problem that was on screen and not a new one.
      if (!s.draws || typeof s.draws !== 'object') s.draws = {};
      if (s.mode === 'exam') {
        s.exam = EXAMS.find(e => e.key === s.examKey);
        // a malformed answers list would only throw later, on the next answer
        if (!s.exam || !Array.isArray(s.answers)) return false;
      }
      session = s;
      currentView = s.mode;
      setNav(s.mode);
      (s.mode === 'exam' ? renderExamQuestion : renderQuestion)();
      return true;
    } catch { return false; }
  }

  function setNav(active) {
    document.querySelectorAll('nav a').forEach(b => {
      const on = b.dataset.view === active;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  // Each view swap replaces #view's DOM, which drops keyboard and screen
  // reader focus on the floor; put it on the given element instead.
  function focusEl(el) {
    if (el) el.focus();
  }

  // A Map rather than an object literal: view names come from the URL hash, and
  // a plain object would resolve names like "toString" off Object.prototype and
  // then call something that is not a view.
  const ROUTES = new Map([
    ['home', renderHome], ['study', startStudy], ['misses', startMisses],
    ['exam', renderExamSetup], ['final', startFinal], ['drill', startDrills],
    ['browse', renderBrowse], ['stats', renderStats],
    ['settings', renderSettings], ['about', renderAbout],
  ]);
  // Extra views: an app module loaded before this file may register routes by
  // assigning self.APP_VIEWS = { name: render }. Each render receives the
  // engine surface it may touch. A nav tab with a matching data-view routes
  // like any built-in view, and tabs with no route are removed at boot, so a
  // module that declines to register (no credential, say) costs its tab
  // nothing.
  Object.entries(self.APP_VIEWS || {}).forEach(([name, renderView]) => {
    ROUTES.set(name, () => renderView({ view, $, esc, go, cfg: CFG }));
  });
  let currentView = null;

  function render(name) {
    const view = ROUTES.get(name);
    if (typeof view !== 'function') return render('home');
    currentView = name;
    // A correct answer awaiting its grade has already bumped the daily
    // counters and the card's right count, but not its schedule. Leaving
    // mid-grade would let a later save persist that half-applied answer, so
    // roll it back: the question simply goes back to unanswered.
    if (session && session.pendingGrade) rollbackAnswer();
    session = null;
    clearSession();
    setNav(name);
    view();
  }

  // Renders immediately (hashchange fires async) and records the view in the
  // URL hash, so views are linkable and the back button moves between them.
  function go(name) {
    render(name);
    if (location.hash !== '#' + name) location.hash = name;
  }

  window.addEventListener('hashchange', () => {
    const name = location.hash.slice(1) || 'home';
    if (name !== currentView) render(name);
  });

  // ---------- home ----------
  function renderHome() {
    const due = dueReviewIds().length;
    const fresh = newIds(newRemainingToday()).length;
    const missPool = missIds().length;
    const s = Store.load();
    const today = s.daily[Store.todayKey()] || { reviews: 0, correct: 0 };
    const exam = examInfo();
    const studiedCount = QUESTION_BANK.filter(q => {
      const c = s.cards[q.id];
      return c && c.lastReview;
    }).length;
    const boosted = exam && effectiveNewPerDay() > s.settings.newPerDay;
    const banner = exam
      ? `<div class="exambanner">Exam ${exam.daysLeft === 0 ? 'today' :
          exam.daysLeft === 1 ? 'tomorrow' : 'in ' + exam.daysLeft + ' days'}
          · retention target ${Math.round(targetRetention() * 100)}%${
          boosted ? ' · pace boosted to ' + effectiveNewPerDay() + ' new/day' : ''}</div>`
      : '';
    view.innerHTML = `
      <div class="home">
        <p class="sub">${CFG.homeSubtitle}</p>
        ${banner}
        <div class="tiles">
          <div class="tile"><div class="big">${due}</div><div>reviews due</div></div>
          <div class="tile"><div class="big">${fresh}</div><div>new today</div></div>
          <div class="tile"><div class="big">${missPool}</div><div>to fix</div></div>
          <div class="tile"><div class="big">${today.reviews}</div><div>done today</div></div>
        </div>
        <div class="actions">
          <button class="primary" data-view="study" ${due + fresh ? '' : 'disabled'}>Study (${due + fresh})</button>
          <button data-view="misses" ${missPool ? '' : 'disabled'}>Practice misses (${missPool})</button>
          <button data-view="exam">Mock exam</button>
          ${exam && exam.daysLeft <= 5 && studiedCount
            ? '<button data-view="final" class="primary">Final review sweep</button>' : ''}
        </div>
        ${due + fresh === 0 ? extraControls() : ''}
        ${readinessBlock()}
        <p class="disclaimer">${CFG.disclaimerHTML}</p>
      </div>`;
    view.querySelectorAll('button[data-view]').forEach(b =>
      b.addEventListener('click', () => go(b.dataset.view)));
    wireExtra();
  }

  // Spread new cards evenly through the review queue instead of appending
  // them all at the end.
  function interleave(reviews, fresh) {
    if (!reviews.length || !fresh.length) return reviews.concat(fresh);
    const queue = reviews.slice();
    const total = reviews.length + fresh.length;
    fresh.forEach((id, k) => {
      const at = Math.min(queue.length, Math.round((k + 0.5) * total / fresh.length));
      queue.splice(at, 0, id);
    });
    return queue;
  }

  // ---------- study session (FSRS) ----------
  function startStudy() {
    const reviews = shuffle(dueReviewIds());
    const fresh = newIds(newRemainingToday());
    const queue = interleave(reviews, fresh);
    if (!queue.length) {
      view.innerHTML = `<div class="done"><h2>All caught up</h2>
        <p>Nothing due right now. Come back tomorrow, or take a mock exam.</p>
        <button class="primary" id="back">Home</button>
        ${extraControls()}</div>`;
      $('#back').addEventListener('click', () => go('home'));
      wireExtra();
      return;
    }
    session = { mode: 'study', queue, pos: 0, done: 0, correct: 0 };
    renderQuestion();
  }

  // ---------- misses drill (no scheduling changes) ----------
  // A card is in the pool once it has been answered wrong and leaves it after
  // Store.MISS_CLEARED correct answers in a row, in any mode. Deliberately not
  // a lifetime wrong-vs-right tally: a card missed early enough would sit in
  // the pool for as many drills as it had misses, and one more slip pushed the
  // exit two drills further away, so the last few misses looked stuck.
  function missIds() {
    const secs = new Set(enabledSections());
    return QUESTION_BANK
      .filter(q => secs.has(secKey(q)))
      .filter(q => {
        const c = Store.load().cards[q.id];
        return c && c.wrong > 0 && c.streak < Store.MISS_CLEARED;
      })
      .map(q => q.id);
  }

  function startMisses() {
    const queue = shuffle(missIds()).slice(0, 25);
    if (!queue.length) {
      view.innerHTML = `<div class="done"><h2>No missed questions</h2>
        <p>Everything you've gotten wrong has since been answered correctly.</p>
        <button class="primary" id="back">Home</button></div>`;
      $('#back').addEventListener('click', () => go('home'));
      return;
    }
    session = { mode: 'misses', queue, pos: 0, done: 0, correct: 0 };
    renderQuestion();
  }

  // ---------- calculation drills on demand (#drill) ----------
  // Deliberately a route and not a nav tab. A drill belongs in the ordinary
  // Study queue, scheduled by the same FSRS as everything else; a "Math" tab
  // would be practised by the people who already like arithmetic and skipped
  // by the ones who need it. This is the linkable way to drill the
  // calculations on purpose — the night before an exam, or to look at a
  // template — and like the misses drill it leaves the schedule alone, so
  // using it cannot pull a card forward or push it back.
  function startDrills() {
    const secs = new Set(enabledSections());
    const queue = shuffle(QUESTION_BANK
      .filter(q => q.drill && secs.has(secKey(q)))
      .map(q => q.id));
    if (!queue.length) {
      view.innerHTML = `<div class="done"><h2 tabindex="-1">No calculation drills</h2>
        <p>The exams you are studying for have no calculation drills.</p>
        <button class="primary" id="back">Home</button></div>`;
      $('#back').addEventListener('click', () => go('home'));
      focusEl(view.querySelector('h2'));
      return;
    }
    session = { mode: 'drill', queue, pos: 0, done: 0, correct: 0, draws: {} };
    renderQuestion();
  }

  // ---------- final review sweep (last days before the exam) ----------
  // Ignores due dates: every studied card, weakest memory first, then unseen cards.
  function startFinal() {
    const secs = new Set(enabledSections());
    const s = Store.load();
    const pool = QUESTION_BANK.filter(q => secs.has(secKey(q)));
    const studied = pool.filter(q => s.cards[q.id] && s.cards[q.id].lastReview)
      .sort((a, b) => s.cards[a.id].stability - s.cards[b.id].stability);
    const unseen = pool.filter(q => !s.cards[q.id] || !s.cards[q.id].lastReview);
    const queue = studied.concat(unseen).map(q => q.id);
    if (!queue.length) return go('home');
    session = { mode: 'final', queue, pos: 0, done: 0, correct: 0 };
    renderQuestion();
  }

  // ---------- calculation drills ----------
  // A drill is an ordinary bank question whose numbers are drawn fresh; see
  // js/problems.js. The numbers are drawn the first time the card is about to
  // be shown and kept with the session, so Undo re-asks the same problem, a
  // reload mid-session resumes the one that was on screen, and a mock exam
  // grades against the problem it actually asked. Nothing is stored with the
  // card: one that comes due tomorrow should be a new problem.
  function drawFor(id) {
    if (!Problems.isDrill(id)) return;
    if (!session.draws) session.draws = {};
    if (session.draws[id] === undefined) session.draws[id] = Problems.newSeed();
    Problems.reroll(id, session.draws[id]);
  }

  // A question that asks for arithmetic gets a calculator, because the exam
  // site allows a nonprogrammable one and doing the sums in your head is not
  // what is being tested. Every card starts with a cleared calculator, the way
  // picking one up off the desk does; whether it starts open is remembered,
  // since opening it is a preference rather than a per-card choice.
  function calculatorFor(q) {
    if (!q.drill) return '';
    Calculator.reset();
    return Calculator.html(Store.load().settings.calcOpen === true);
  }

  // A question may carry an illustration (q.image: {src, alt}) — a table or
  // figure from the manual that the question is posed against. It renders
  // between the stem and the choices, in study and exam alike.
  function imageFor(q) {
    if (!q.image) return '';
    return `<img class="qimage" src="${esc(q.image.src)}" alt="${esc(q.image.alt)}">`;
  }

  function wireCalculator() {
    if (!view.querySelector('#calc')) return;
    Calculator.wire(view, open => {
      Store.load().settings.calcOpen = open;
      Store.save();
    });
  }

  // ---------- shared question renderer (study + misses + final) ----------
  function renderQuestion() {
    if (session.pos >= session.queue.length) return renderSessionDone();
    drawFor(session.queue[session.pos]); // before the mirror, so the seed is in it
    saveSession();
    const q = BY_ID[session.queue[session.pos]];
    const order = choiceOrder(q);
    const total = session.queue.length;
    // Fraction of answers given over answers the session will take. Requeuing
    // a missed card grows both sides by one, so the bar never moves backward
    // (pos / queue.length would drop every time a wrong answer is requeued).
    const answered = session.done;
    const expected = session.done + (session.queue.length - session.pos);
    const card = Store.load().cards[q.id];
    const badge = !card || !card.lastReview ? '<span class="badge new">new</span>'
      : card.state === 'relearning' || card.state === 'learning' ? '<span class="badge relearn">again</span>'
      : '<span class="badge review">review</span>';
    view.innerHTML = `
      <div class="quiz">
        <div class="meta">
          <span>${session.pos + 1} / ${total}</span>
          ${badge}
          <span class="section">${esc(secLabel(secKey(q)))} ${esc(q.sectionName)}</span>
        </div>
        <div class="progress" role="progressbar" aria-label="Session progress"
          aria-valuemin="0" aria-valuemax="${expected}" aria-valuenow="${answered}">
          <div style="width:${(answered / expected) * 100}%"></div></div>
        <h2 class="qtext" tabindex="-1">${esc(q.question)}</h2>
        ${imageFor(q)}
        <div class="choices">
          ${order.map((i, k) => `<button class="choice" data-i="${i}"><kbd>${k + 1}</kbd>${esc(q.choices[i])}</button>`).join('')}
        </div>
        ${calculatorFor(q)}
        <div id="feedback" aria-live="polite"></div>
      </div>`;
    view.querySelectorAll('.choice').forEach(btn =>
      btn.addEventListener('click', () => answer(q, Number(btn.dataset.i), btn)));
    wireCalculator();
    focusEl(view.querySelector('.qtext'));
  }

  // Snapshot everything answer() is about to mutate, so a stray tap can be
  // taken back from the feedback screen. Lives only on the in-memory session
  // (saveSession does not persist it): once the user continues, grades, or
  // reloads, the answer is final.
  function snapshotForUndo(q) {
    const s = Store.load();
    const today = Store.todayKey();
    session.undo = {
      id: q.id,
      card: s.cards[q.id] ? { ...s.cards[q.id] } : null,
      daily: s.daily[today] ? { ...s.daily[today] } : null,
      logLen: s.log.length,
      pos: session.pos, done: session.done, correct: session.correct,
      // A requeued drill is redrawn, so undo has to put the seeds back before
      // the question is re-rendered from them.
      draws: session.draws ? { ...session.draws } : null,
    };
  }

  // Restore everything answer() mutated. Used by the Undo button and by
  // render() when a view change abandons an answer that was never graded.
  function rollbackAnswer() {
    const u = session.undo;
    if (!u) return;
    const s = Store.load();
    if (u.card) s.cards[u.id] = u.card; else delete s.cards[u.id];
    if (u.daily) s.daily[Store.todayKey()] = u.daily; else delete s.daily[Store.todayKey()];
    s.log.length = Math.min(s.log.length, u.logLen);
    session.pos = u.pos; session.done = u.done; session.correct = u.correct;
    if (u.draws) session.draws = u.draws;
    if (u.requeuedAt !== undefined) session.queue.splice(u.requeuedAt, 1);
    session.undo = null;
    session.pendingGrade = false;
    Store.save();
  }

  function undoAnswer() {
    if (!session || !session.undo) return;
    rollbackAnswer();
    renderQuestion();
  }

  const undoButton = '<button id="undo">Undo<kbd class="after">U</kbd></button>';

  // What the reader actually did, for the choice they actually picked. A
  // question may carry `whyWrong[]` parallel to `choices`, naming the mistake
  // each wrong choice comes from and holding null at the correct one; a
  // question without it simply says nothing here. Each entry completes the
  // sentence "You ...", so the diagnosis reads before the explanation teaches:
  // "You left the 100-gallon divisor out. Multiply the gallons the tank
  // holds..." Every calculation drill emits these (js/problems.js builds them
  // from the named slip behind each distractor) and a written question may.
  const slipText = (q, picked) => {
    const why = Array.isArray(q.whyWrong) && q.whyWrong[picked];
    return why ? `<em class="slip">You ${esc(why)}.</em> ` : '';
  };

  function answer(q, picked, btn) {
    const correct = picked === q.answer;
    snapshotForUndo(q);
    view.querySelectorAll('.choice').forEach(b => {
      b.disabled = true;
      const i = Number(b.dataset.i);
      if (i === q.answer) b.classList.add('correct');
      else if (b === btn && !correct) b.classList.add('wrong');
    });

    const c = Store.card(q.id);
    const wasNew = !c.lastReview;
    if (correct) { c.right++; c.streak++; } else { c.wrong++; c.streak = 0; }

    const scheduling = session.mode === 'study' || session.mode === 'final';
    if (scheduling) {
      Store.bumpDaily('reviews');
      if (correct) Store.bumpDaily('correct');
      if (wasNew) Store.bumpDaily('new');
    }
    session.done++;
    if (correct) session.correct++;

    const fb = $('#feedback');
    const cite = `${manualCite(q)} ${reportLink(q)}`;
    if (!correct) {
      if (scheduling) {
        Object.assign(c, FSRS.schedule(c, 1, Date.now(), schedOpts())); // Again
        Store.logReview(q.id, 1);
        // requeue a few cards later so it comes back this session
        const at = Math.min(session.pos + 4, session.queue.length);
        session.queue.splice(at, 0, q.id);
        session.undo.requeuedAt = at;
        // A missed drill comes back with new numbers. The explanation just
        // worked these ones through, so re-asking them would test nothing but
        // whether the reader remembers the figure it ended on.
        if (session.draws && Problems.isDrill(q.id)) session.draws[q.id] = Problems.newSeed();
      }
      fb.innerHTML = `<div class="explain wrongbg"><strong>Incorrect.</strong> ${
        slipText(q, picked)}${esc(q.explanation || '')} ${cite}</div>
        <button class="primary" id="next">Continue<kbd class="after">Enter</kbd></button>${undoButton}`;
      $('#next').addEventListener('click', () => { session.pos++; renderQuestion(); });
      focusEl($('#next'));
    } else if (scheduling) {
      // Compute the three candidate schedules once so the interval shown on a
      // grade button is exactly what clicking it applies. Re-running
      // schedule() at click time could land a day off: Date.now() has moved,
      // and the deterministic fuzz is seeded from the card state fed to it.
      const now = Date.now();
      const opts = schedOpts();
      const scheds = {};
      [2, 3, 4].forEach(r => { scheds[r] = FSRS.schedule({ ...c }, r, now, opts); });
      const preview = r => scheds[r].intervalDays >= 1 ? `${scheds[r].intervalDays}d` : '<1d';
      fb.innerHTML = `<div class="explain okbg"><strong>Correct.</strong> ${esc(q.explanation || '')} ${cite}</div>
        <div class="grades">
          <button data-r="2"><kbd>1</kbd>Hard <small>${preview(2)}</small></button>
          <button data-r="3" class="primary" title="Shortcut: 2 or Enter"><kbd>2</kbd>Good <small>${preview(3)}</small></button>
          <button data-r="4"><kbd>3</kbd>Easy <small>${preview(4)}</small></button>
        </div>${undoButton}`;
      session.pendingGrade = true; // counters are bumped, schedule is not
      fb.querySelectorAll('.grades button').forEach(b =>
        b.addEventListener('click', () => {
          Object.assign(c, scheds[Number(b.dataset.r)]);
          Store.logReview(q.id, Number(b.dataset.r));
          session.pendingGrade = false;
          Store.save();
          session.pos++;
          renderQuestion();
        }));
      $('#undo').addEventListener('click', undoAnswer);
      focusEl(fb.querySelector('[data-r="3"]'));
      return; // save happens on grade click
    } else {
      fb.innerHTML = `<div class="explain okbg"><strong>Correct.</strong> ${esc(q.explanation || '')} ${cite}</div>
        <button class="primary" id="next">Continue<kbd class="after">Enter</kbd></button>${undoButton}`;
      $('#next').addEventListener('click', () => { session.pos++; renderQuestion(); });
      focusEl($('#next'));
    }
    $('#undo').addEventListener('click', undoAnswer);
    Store.save();
  }

  function renderSessionDone() {
    clearSession();
    const pct = session.done ? Math.round((session.correct / session.done) * 100) : 0;
    view.innerHTML = `
      <div class="done">
        <h2 tabindex="-1">Session complete</h2>
        <p>${session.correct} / ${session.done} correct (${pct}%)</p>
        <button class="primary" id="home">Home</button>
        ${extraControls()}
      </div>`;
    $('#home').addEventListener('click', () => go('home'));
    session = null;
    wireExtra();
    focusEl(view.querySelector('h2'));
  }

  // ---------- mock exam ----------
  function renderExamSetup() {
    const counts = {};
    QUESTION_BANK.forEach(q => { counts[secKey(q)] = (counts[secKey(q)] || 0) + 1; });
    // Offered: the exams picked in Settings, plus the ones the bank has
    // nothing for yet, which are listed unselectable so the gap shows. An
    // exam that shares its key with a test follows the picker directly —
    // keyed by exam rather than by whether the studied sections happen to
    // cover it, for the reason readinessRows gives. An exam keyed on its own
    // (the FCC elements sit behind several licenses) has no picker entry to
    // follow, so it is offered when the picked tests cover its sections.
    const selected = new Set(enabledTests().map(tst => tst.key));
    const testKeys = new Set(TESTS.map(tst => tst.key));
    const activeSecs = new Set(enabledSections());
    const available = EXAMS.filter(e => !e.sections.length
      || (testKeys.has(e.key) ? selected.has(e.key)
        : e.sections.every(sec => activeSecs.has(sec))));
    const hidden = EXAMS.length - available.length;
    view.innerHTML = `
      <div class="examsetup">
        <h2>Mock exam</h2>
        <p class="sub">Real-test format: no feedback until the end, ${PASS_PCT}% to pass.</p>
        <div class="examlist">
          ${available.map(e => {
            const avail = e.sections.reduce((n, s) => n + (counts[s] || 0), 0);
            const n = Math.min(e.count, avail);
            // An exam with nothing written for it yet says so, rather than
            // offering a button that reads "0 questions".
            const label = e.sections.length ? `${n} questions` : 'not written yet';
            return `<button class="examopt${e.sections.length ? '' : ' empty'}"
              data-key="${e.key}" ${n < 5 ? 'disabled' : ''}>
              <strong>${esc(e.name)}</strong><span>${label}</span></button>`;
          }).join('')}
        </div>
        ${hidden ? `<p class="hint">${hidden} more hidden. Enable their tests in Settings.</p>` : ''}
      </div>`;
    view.querySelectorAll('.examopt').forEach(b =>
      b.addEventListener('click', () => startExam(b.dataset.key)));
  }

  function startExam(key) {
    const exam = EXAMS.find(e => e.key === key);
    const secs = new Set(exam.sections);
    const pool = shuffle(QUESTION_BANK.filter(q => secs.has(secKey(q))).map(q => q.id));
    const queue = pool.slice(0, exam.count);
    session = { mode: 'exam', exam, queue, pos: 0, answers: [] };
    renderExamQuestion();
  }

  function renderExamQuestion() {
    if (session.pos >= session.queue.length) return renderExamResult();
    drawFor(session.queue[session.pos]); // before the mirror, so the seed is in it
    saveSession();
    const q = BY_ID[session.queue[session.pos]];
    const order = choiceOrder(q);
    const total = session.queue.length;
    view.innerHTML = `
      <div class="quiz">
        <div class="meta"><span>${session.pos + 1} / ${total}</span>
          <span class="section">${esc(session.exam.name)}</span></div>
        <div class="progress" role="progressbar" aria-label="Exam progress"
          aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${session.pos}">
          <div style="width:${(session.pos / total) * 100}%"></div></div>
        <h2 class="qtext" tabindex="-1">${esc(q.question)}</h2>
        ${imageFor(q)}
        <div class="choices">
          ${order.map((i, k) => `<button class="choice" data-i="${i}"><kbd>${k + 1}</kbd>${esc(q.choices[i])}</button>`).join('')}
        </div>
        ${calculatorFor(q)}
      </div>`;
    view.querySelectorAll('.choice').forEach(btn =>
      btn.addEventListener('click', () => {
        session.answers.push({ id: q.id, picked: Number(btn.dataset.i) });
        session.pos++;
        renderExamQuestion();
      }));
    wireCalculator();
    focusEl(view.querySelector('.qtext'));
  }

  function renderExamResult() {
    clearSession();
    const wrong = session.answers.filter(a => BY_ID[a.id].answer !== a.picked);
    const correct = session.answers.length - wrong.length;
    const pct = Math.round((correct / session.answers.length) * 100);
    const passed = pct >= PASS_PCT;

    // feed exam misses into the practice pool (stats only, no rescheduling)
    session.answers.forEach(a => {
      const c = Store.card(a.id);
      const ok = BY_ID[a.id].answer === a.picked;
      if (ok) { c.right++; c.streak++; } else { c.wrong++; c.streak = 0; }
    });
    const s = Store.load();
    s.exams.push({ date: Date.now(), type: session.exam.name,
                   total: session.answers.length, correct, passed });
    Store.save();

    view.innerHTML = `
      <div class="examresult">
        <h2 class="${passed ? 'pass' : 'fail'}" tabindex="-1">${passed ? 'PASS' : 'FAIL'} ${pct}%</h2>
        <p>${correct} / ${session.answers.length} correct on ${esc(session.exam.name)} (${PASS_PCT}% needed)</p>
        ${wrong.length ? `<h3>Missed questions</h3>
          <div class="misslist">${wrong.map(a => {
            const q = BY_ID[a.id];
            return `<div class="missitem">
              <div class="q">${esc(q.question)}</div>
              <div class="you">Your answer: ${esc(q.choices[a.picked])}</div>
              <div class="ans">Correct: ${esc(q.choices[q.answer])}</div>
              <div class="ex">${slipText(q, a.picked)}${esc(q.explanation || '')} ${manualCite(q)} ${reportLink(q)}</div>
            </div>`;
          }).join('')}</div>` : '<p>Perfect score.</p>'}
        <button class="primary" id="home">Home</button>
      </div>`;
    $('#home').addEventListener('click', () => go('home'));
    focusEl(view.querySelector('h2'));
    session = null;
  }

  // ---------- browse ----------
  function renderBrowse() {
    const s = Store.load();
    // Browse lists the bank as it stands, and a drill's numbers are whatever
    // was last drawn for it. Draw again, so what is listed is a new problem
    // rather than the one the last session happened to leave behind.
    Problems.templates.forEach(t => Problems.reroll(t.id, Problems.newSeed()));
    view.innerHTML = `
      <div class="browse">
        <h2>Question bank</h2>
        ${sectionGroups().map((g, i) => {
          const gs = chapterStats(g.sections, s.cards);
          // The first group is the one most readers came for; the rest stay
          // folded so the whole bank is a short list to start from.
          return `<details class="group"${i === 0 ? ' open' : ''}>
          <summary>${esc(g.label)} ${groupSummary(gs)}</summary>
        ${g.sections.map(sec => {
          const qs = QUESTION_BANK.filter(q => secKey(q) === sec);
          return `<details class="chapter"><summary>${esc(secRef(sec))} ${esc(SECTION_NAMES[sec])} <small>(${qs.length})</small></summary>
            ${qs.map(q => {
              const c = s.cards[q.id];
              const status = !c || !c.lastReview ? 'new'
                : c.due <= Date.now() ? 'due'
                : `next in ${Math.max(1, Math.ceil((c.due - Date.now()) / DAY))}d`;
              const acc = c && (c.right + c.wrong) ? ` · ${c.right}/${c.right + c.wrong} right` : '';
              return `<details class="qrow"><summary>${esc(q.question)} <small>[${status}${acc}]</small></summary>
                <div class="qdetail"><strong>${esc(q.choices[q.answer])}</strong><br>
                ${esc(q.explanation || '')} ${manualCite(q)} ${reportLink(q)}</div>
              </details>`;
            }).join('')}
          </details>`;
        }).join('')}
        </details>`;
        }).join('')}
      </div>`;
  }

  // ---------- stats ----------
  function renderStats() {
    const s = Store.load();
    // Calendar-day stepping via setDate, not now - i * DAY: DST days are 23
    // or 25 hours long, and fixed 24h steps skip or repeat a day key there.
    const dayAt = n => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + n);
      return d;
    };
    let studied = 0, mature = 0, due = 0;
    QUESTION_BANK.forEach(q => {
      const c = s.cards[q.id];
      if (c && c.lastReview) {
        studied++;
        if (c.stability >= 21) mature++;
        if (c.due <= endOfToday()) due++;
      }
    });

    // streak: consecutive days with reviews, ending today or yesterday
    let streak = 0;
    for (let i = 0; ; i++) {
      const k = Store.todayKey(dayAt(-i).getTime());
      const d = s.daily[k];
      if (d && d.reviews > 0) streak++;
      else if (i === 0) continue; // today can still be empty
      else break;
    }

    // 30-day review history from the daily counters
    const hist = [];
    for (let i = 29; i >= 0; i--) {
      const d = s.daily[Store.todayKey(dayAt(-i).getTime())];
      hist.push({ daysAgo: i, n: (d && d.reviews) || 0 });
    }
    const hmax = Math.max(1, ...hist.map(h => h.n));
    const total30 = hist.reduce((a, h) => a + h.n, 0);
    const histBar = h => {
      const when = dayAt(-h.daysAgo).toLocaleDateString();
      return `<div class="hbar${h.n ? '' : ' zero'}"
        style="height:${Math.max(2, Math.round((h.n / hmax) * 60))}px"
        title="${when}: ${h.n} review${h.n === 1 ? '' : 's'}"></div>`;
    };

    // 7-day due forecast
    const forecast = [];
    for (let i = 0; i < 7; i++) {
      const lo = dayAt(i).getTime(), hi = dayAt(i + 1).getTime();
      let n = 0;
      QUESTION_BANK.forEach(q => {
        const c = s.cards[q.id];
        if (c && c.lastReview && c.due >= (i === 0 ? 0 : lo) && c.due < hi) n++;
      });
      forecast.push(n);
    }
    const fmax = Math.max(1, ...forecast);
    const dayName = i => i === 0 ? 'today'
      : dayAt(i).toLocaleDateString(undefined, { weekday: 'short' });

    view.innerHTML = `
      <div class="stats">
        <h2>Progress</h2>
        <div class="tiles">
          <div class="tile"><div class="big">${studied}</div><div>of ${QUESTION_BANK.length} studied</div></div>
          <div class="tile"><div class="big">${mature}</div><div>mastered (21d+)</div></div>
          <div class="tile"><div class="big">${due}</div><div>due today</div></div>
          <div class="tile"><div class="big">${streak}</div><div>day streak</div></div>
        </div>
        ${readinessTable()}
        <h3>Reviews, last 30 days <small>${total30} total</small></h3>
        <div class="history" role="img"
          aria-label="${total30} reviews over the last 30 days, day by day">
          ${hist.map(histBar).join('')}
        </div>
        <div class="histlabels" aria-hidden="true"><span>30 days ago</span><span>today</span></div>
        <h3>Due next 7 days</h3>
        <div class="forecast">
          ${forecast.map((n, i) => `<div class="fcol">
            <div class="fbar" style="height:${Math.round((n / fmax) * 60)}px"></div>
            <div class="fnum">${n}</div><div class="flab">${dayName(i)}</div>
          </div>`).join('')}
        </div>
        <h3>By section</h3>
        ${sectionGroups(enabledSections()).map(g => {
          // Progress is about the exams being studied for, so this follows the
          // Settings selection rather than listing the whole bank, and stays
          // expanded because the per-section numbers are the point of it.
          const gs = chapterStats(g.sections, s.cards);
          return `<details class="group" open><summary>${esc(g.label)} ${groupSummary(gs)}</summary>
        <div class="table-scroll"><table>
          <tr><th>Section</th><th>Studied</th><th>Accuracy</th></tr>
          ${g.sections.map(sec => {
            const qs = QUESTION_BANK.filter(q => secKey(q) === sec);
            let st = 0, r = 0, w = 0;
            qs.forEach(q => {
              const c = s.cards[q.id];
              if (c && c.lastReview) st++;
              if (c) { r += c.right; w += c.wrong; }
            });
            const acc = r + w ? Math.round((r / (r + w)) * 100) + '%' : '-';
            return `<tr><td>${esc(secRef(sec))} ${esc(SECTION_NAMES[sec])}</td>
              <td>${st}/${qs.length}</td><td>${acc}</td></tr>`;
          }).join('')}
        </table></div>
        </details>`;
        }).join('')}
        ${s.exams.length ? `<h3>Exam history</h3>
        <table>
          <tr><th>Date</th><th>Exam</th><th>Score</th><th></th></tr>
          ${s.exams.slice(-10).reverse().map(e =>
            `<tr><td>${new Date(e.date).toLocaleDateString()}</td><td>${esc(e.type)}</td>
             <td>${e.correct}/${e.total}</td>
             <td class="${e.passed ? 'pass' : 'fail'}">${e.passed ? 'PASS' : 'FAIL'}</td></tr>`).join('')}
        </table>` : ''}
      </div>`;
  }

  // ---------- settings ----------
  // The stylesheet keys its dark palette off prefers-color-scheme unless
  // data-theme forces a side; 'system' removes the attribute.
  function applyTheme() {
    const theme = Store.load().settings.theme;
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }

  function paceInfo() {
    const exam = examInfo();
    const base = Store.load().settings.newPerDay;
    const unseen = unseenCount();
    if (!exam) {
      return `No exam date: steady pace of ${base} new cards/day at a 90% retention target. ` +
        `Setting a date tightens the schedule toward test day and raises the pace if needed.`;
    }
    const eff = effectiveNewPerDay();
    const boost = eff > base
      ? `Pace boosted from ${base} to ${eff} new cards/day to cover all ${unseen} remaining ` +
        `questions before the exam.`
      : `Your ${base}/day pace covers the ${unseen} remaining questions in time.`;
    return `Exam in ${exam.daysLeft} day${exam.daysLeft === 1 ? '' : 's'}, retention target ` +
      `${Math.round(targetRetention() * 100)}%. ${boost}`;
  }

  function renderSettings() {
    const s = Store.load();
    const active = new Set(enabledTests().map(tst => tst.key));
    view.innerHTML = `
      <div class="settings">
        <h2>Settings</h2>
        <label>New cards per day
          <input type="number" id="newperday" min="0" max="200" value="${s.settings.newPerDay}">
        </label>
        <label>Exam date
          <input type="date" id="examdate" value="${esc(s.settings.examDate || '')}">
          <button id="cleardate" ${s.settings.examDate ? '' : 'disabled'}>No exam, just studying</button>
        </label>
        <p class="hint" id="paceinfo">${paceInfo()}</p>
        <label>Theme
          <select id="theme">
            ${[['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) =>
              `<option value="${v}" ${s.settings.theme === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <h3>Tests I'm studying for</h3>
        <p class="hint">Only checked tests feed the study queue and the mock exam list.
          Progress on unchecked sections is kept, so add endorsements whenever you're ready.</p>
        <div class="seclist">
          ${TEST_GROUPS.map(([group, label]) => `
            <h4>${label}</h4>
            ${TESTS.filter(tst => tst.group === group).map(tst => {
              const count = QUESTION_BANK.filter(q => tst.sections.includes(secKey(q))).length;
              const checked = active.has(tst.key);
              // Nothing to select for an exam the bank does not cover yet, so
              // it is shown but disabled rather than offering an empty study
              // queue. It becomes selectable as soon as it has questions.
              if (!tst.sections.length) {
                return `<label class="seccheck empty">
                  <input type="checkbox" data-test="${tst.key}" disabled>
                  <span>${esc(tst.name)} <small>no questions yet${
                    tst.note ? ' · ' + esc(tst.note) : ''}</small></span></label>`;
              }
              return `<label class="seccheck">
                <input type="checkbox" data-test="${tst.key}" ${checked ? 'checked' : ''}>
                <span>${esc(tst.name)} <small>${esc(secRange(tst.sections))} · ${count} q${
                  tst.note ? ' · ' + esc(tst.note) : ''}</small></span></label>`;
            }).join('')}`).join('')}
        </div>
        <h3>Data</h3>
        <p class="hint">Everything is stored locally in this browser and never sent to a
          server. Export makes a JSON backup you can import on another device.</p>
        <div class="actions">
          <button id="export">Export progress</button>
          <button id="import">Import progress</button>
          <button id="reset" class="danger">Reset everything</button>
        </div>
        <input type="file" id="importfile" accept=".json" hidden>
      </div>`;

    $('#newperday').addEventListener('change', e => {
      s.settings.newPerDay = Math.max(0, Number(e.target.value) || 0);
      Store.save();
      $('#paceinfo').textContent = paceInfo();
    });
    $('#examdate').addEventListener('change', e => {
      s.settings.examDate = e.target.value || '';
      Store.save();
      $('#cleardate').disabled = !s.settings.examDate;
      $('#paceinfo').textContent = paceInfo();
    });
    $('#theme').addEventListener('change', e => {
      s.settings.theme = e.target.value;
      Store.save();
      applyTheme();
    });
    $('#cleardate').addEventListener('click', () => {
      s.settings.examDate = '';
      Store.save();
      renderSettings();
    });
    view.querySelectorAll('input[data-test]').forEach(cb =>
      cb.addEventListener('change', () => {
        // What the boxes mean is what gets stored: the exams being studied
        // for. The sections they cover are worked out on read, so an exam
        // that grows a chapter later grows for everyone who picked it.
        // An exam the bank has no questions for is filtered out rather than
        // trusted to stay unchecked: it would store a choice that selects
        // nothing, and leave the "everything is selected" test below unable
        // to match.
        const studiable = new Set(TESTS.filter(tst => tst.sections.length).map(tst => tst.key));
        const chosen = [...view.querySelectorAll('input[data-test]:checked')]
          .map(x => x.dataset.test).filter(key => studiable.has(key));
        // empty or complete selection both mean "study everything"
        s.settings.tests =
          chosen.length === 0 || chosen.length === studiable.size ? [] : chosen;
        Store.save();
        if (chosen.length === 0) { renderSettings(); return; } // re-render so boxes show reality
        $('#paceinfo').textContent = paceInfo(); // pace depends on the selected sections
      }));
    $('#export').addEventListener('click', () => {
      const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${CFG.exportPrefix}-${Store.todayKey()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $('#import').addEventListener('click', () => $('#importfile').click());
    $('#importfile').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      if (!confirm('Importing replaces ALL progress on this device with the backup. Continue?')) {
        e.target.value = ''; // allow re-picking the same file later
        return;
      }
      try {
        Store.importJSON(await f.text());
        alert('Progress imported.');
        go('home');
      } catch (err) {
        alert('Import failed: ' + err.message);
      }
    });
    $('#reset').addEventListener('click', () => {
      if (confirm('Delete ALL progress? This cannot be undone.')) {
        Store.reset();
        go('home');
      }
    });
  }

  // ---------- about ----------
  // Citation that opens the manual at the page the question came from. A
  // question picks its manual by its `manual` field, or `default` without one.
  // The printed label ("2-15") is not the PDF's physical page number, which is
  // what the #page= fragment takes, so the manual's pages map translates; a
  // question may carry its own pdfPage where one label is printed on several
  // pages. Falls back to plain text if the page is not in the map or the
  // manual has no public URL, since a wrong #page= is worse than none. The
  // whole citation is optional: a question without a page, or an exam whose
  // config lists no manuals, simply renders none.
  //
  // Not every document is cited by page. A statute or an administrative rule
  // is cited by its number, and a reader sent to "§ 143-452(a)" is not helped
  // by being told it sits on page 12, so a question from one carries a `ref`
  // and its citation reads as that reference. The page is still what opens the
  // PDF in the right place, which is why a question keeps both.
  //
  // A source the config marks `web` is a web publication rather than a PDF: it
  // has no pages at all, so `page` names the heading the fact is printed
  // under, the citation reads as that heading, and the link is the anchor on
  // it rather than a "#page=" fragment. Either way the source's `pages` map
  // turns what the question cites into what the link points at.
  const manualCite = q => {
    const m = CFG.manuals[q.manual || 'default'];
    if (!m || !q.page) return '';
    const where = q.ref ? esc(q.ref) : m.web ? esc(q.page) : `p. ${esc(q.page)}`;
    const label = `${esc(m.cite || 'Manual')} ${where}`;
    const target = q.pdfPage || (m.pages && m.pages[q.page]);
    return m.url && target
      ? `<a class="cite" href="${m.url}#${m.web ? '' : 'page='}${encodeURIComponent(target)}"
           target="_blank" rel="noopener"
           title="${m.web ? `Open the source at ${esc(q.page)}`
             : `Open the manual at page ${esc(q.page)}`}">${label}</a>`
      : `<span class="cite">${label}</span>`;
  };

  // Question-correction issue with the id and cited page prefilled, so a
  // reader who spots a bad question can report it from where they see it.
  const reportLink = q => `<a class="report" target="_blank" rel="noopener"
    href="${CFG.repo}/issues/new?template=question-correction.yml&question-id=${
      encodeURIComponent(q.id)}&manual-page=${encodeURIComponent(q.page || '')}">Report an error</a>`;

  // Escapes, then converts markdown [text](url) links to anchors.
  const mdLinks = s => esc(s).replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Minimal renderer for the release-please CHANGELOG.md: headings, bullets, links.
  function changelogHTML(md) {
    const out = [];
    let inList = false;
    md.split('\n').forEach(line => {
      const item = line.match(/^[*-] (.*)/);
      if (!item && inList) { out.push('</ul>'); inList = false; }
      if (/^# /.test(line)) return; // top-level "Changelog" title, the page has its own
      if (/^## /.test(line)) out.push(`<h4>${mdLinks(line.replace(/^## /, ''))}</h4>`);
      else if (/^#+ /.test(line)) out.push(`<h5>${mdLinks(line.replace(/^#+ /, ''))}</h5>`);
      else if (item) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push(`<li>${mdLinks(item[1])}</li>`);
      } else if (line.trim()) out.push(`<p>${mdLinks(line)}</p>`);
    });
    if (inList) out.push('</ul>');
    return out.join('');
  }

  // Where the questions came from: each manual with the chapters drawn from it
  // and how many questions those chapters hold. Built from the bank itself, so
  // it cannot drift from what is actually loaded.
  function sourcesHTML() {
    const manuals = CFG.manuals || {};
    // With flat sections the manual/chapter breakdown below is not meaningful
    // (a section is a topic, not a place in one book), and these apps already
    // describe their sources in aboutIntroHTML.
    if (CFG.flatSections || !Object.keys(manuals).length) return '';
    const rows = Object.entries(manuals).map(([key, m]) => {
      const mine = SECTION_IDS.filter(id => id.startsWith(`${key}:`));
      if (!mine.length) return '';
      // Written questions only: a calculation drill is generated from the
      // method rather than extracted from a page, and one drill is
      // unboundedly many questions, so counting it here would state a number
      // that is neither right nor checkable.
      const count = QUESTION_BANK.filter(q => (q.manual || 'default') === key && !q.drill).length;
      const nums = mine.map(id => id.slice(id.indexOf(':') + 1));
      const span = nums.length > 1 ? `chapters ${nums[0]}-${nums[nums.length - 1]}` : `chapter ${nums[0]}`;
      const title = m.url
        ? `<a href="${m.url}" target="_blank" rel="noopener">${esc(m.title)}</a>`
        : esc(m.title);
      return `<li>${title} — ${span}, ${count} questions</li>`;
    }).join('');
    return rows ? `<h3>Sources</h3><ul class="sources">${rows}</ul>` : '';
  }

  // What the bank covers, exam by exam, including the ones with nothing
  // written for them. NC licenses on Core plus a category, so a bank that
  // stops at Core covers only the first half of the requirement; listing the
  // empty exams is what makes that visible rather than implied.
  function coverageHTML() {
    // Worth a table only when there is a gap to show (or the config insists):
    // an app whose every exam has questions would list rows that all read
    // "covered", which says nothing.
    if (!EXAMS.length) return '';
    if (!CFG.showCoverage && EXAMS.every(e => e.sections.length)) return '';
    const counts = {};
    QUESTION_BANK.forEach(q => { counts[secKey(q)] = (counts[secKey(q)] || 0) + 1; });
    const rows = EXAMS.map(e => {
      const n = e.sections.reduce((sum, sec) => sum + (counts[sec] || 0), 0);
      return `<tr class="${n ? '' : 'empty'}">
        <td>${esc(e.name)}</td>
        <td>${n || '—'}</td>
        <td>${n ? 'covered' : 'not written yet'}</td>
      </tr>`;
    }).join('');
    const done = EXAMS.filter(e => e.sections.length).length;
    return `
      <h3>Coverage <small>${done} of ${EXAMS.length} exams</small></h3>
      ${CFG.coverageIntroHTML ? `<p>${CFG.coverageIntroHTML}</p>` : ''}
      <div class="table-scroll">
        <table class="coverage">
          <thead><tr><th>Exam</th><th>Questions</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // Optional reference table of the licenses the exams lead to. Config-driven
  // and skipped entirely when an exam config lists none.
  function licensesHTML() {
    const L = CFG.licenses;
    if (!L || !L.groups) return '';
    const groups = L.groups.map(g => `
      <h4>${esc(g.name)}</h4>
      <div class="table-scroll">
        <table class="licenses">
          <thead><tr><th>License</th><th>Who it is for</th><th>Exams</th><th>Term</th></tr></thead>
          <tbody>${g.items.map(it => `
            <tr>
              <td><strong>${esc(it.code)}</strong> ${esc(it.name)}</td>
              <td>${esc(it.who)}</td>
              <td>${esc(it.exams)}</td>
              <td>${esc(it.term)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`).join('');
    const cats = (L.categories || []).map(([code, name]) =>
      `<li><strong>${esc(code)}</strong> ${esc(name)}</li>`).join('');
    return `
      <h3>${esc(L.title || 'Licenses and certifications')}</h3>
      ${L.intro ? `<p>${esc(L.intro)}</p>` : ''}
      ${groups}
      ${cats ? `<h4>Category exams</h4><ul class="categories">${cats}</ul>` : ''}
      ${L.source ? `<p class="hint">Summarized from
        <a href="${L.source}" target="_blank" rel="noopener">${esc(L.sourceName || 'the licensing authority')}</a>,
        which is the authority on fees, terms, and requirements; check it before you apply.</p>` : ''}`;
  }

  function renderAbout() {
    view.innerHTML = `
      <div class="about">
        <h2>About</h2>
        ${CFG.aboutIntroHTML}
        <p>Study sessions are scheduled with FSRS, a spaced-repetition algorithm that
          predicts when you are about to forget a card and shows it to you just before
          that. Set your exam date in Settings and the scheduler works backward from it,
          raising the retention target and the daily pace as the test gets close.</p>
        <p>All progress is stored locally in your browser and never sent to a server.
          Use Export in Settings to move it to another device.</p>
        ${sourcesHTML()}
        ${coverageHTML()}
        ${CFG.aboutCaveatHTML}
        ${licensesHTML()}
        <h3>Links</h3>
        <ul>
          <li><a href="${CFG.repo}" target="_blank" rel="noopener">Source code on GitHub</a> (MIT license)</li>
          <li><a href="${CFG.repo}/issues/new?template=question-correction.yml" target="_blank" rel="noopener">Report a question error</a></li>
          <li><a href="${CFG.repo}/issues/new?template=bug-report.yml" target="_blank" rel="noopener">Report a bug</a></li>
          ${Object.values(CFG.manuals).filter(m => m.url).map(m =>
            `<li><a href="${m.url}" target="_blank" rel="noopener">${esc(m.title)} (PDF)</a></li>`).join('')}
        </ul>
        <h3>Changelog${appVersion ? ` <small>current: v${appVersion}</small>` : ''}</h3>
        <div id="changelog" class="changelog"><p class="hint">Loading changelog...</p></div>
      </div>`;
    // The reader may have left About before the fetch settles, taking
    // #changelog with it; a settled fetch with nowhere to render is not an
    // error, so both handlers tolerate the missing element.
    fetch('CHANGELOG.md')
      .then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status))))
      .then(md => {
        const el = $('#changelog');
        if (el) el.innerHTML = changelogHTML(md);
      })
      .catch(() => {
        const el = $('#changelog');
        if (!el) return;
        el.innerHTML = `<p class="hint">The changelog could not be loaded.
          See the <a href="${CFG.repo}/releases" target="_blank" rel="noopener">releases
          page on GitHub</a>.</p>`;
      });
  }

  // ---------- boot ----------
  // Keyboard shortcuts: 1-4 pick an answer, Enter continues after a wrong
  // answer, 1/2/3 (or Enter for Good) grade a correct one, and U takes back
  // the answer just given.
  document.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    // A digit typed at the calculator is a digit, not answer number 3. The
    // calculator handles its own keys and the shortcuts below stand aside
    // while the focus is inside it.
    if (Calculator.owns(e.target) || Calculator.owns(document.activeElement)) return;
    // Enter on a focused button or link activates it (the browser handles
    // it); intercepting would redirect it to Continue or Good instead.
    if (e.key === 'Enter' && (tag === 'BUTTON' || tag === 'A')) return;
    const next = $('#next');
    const grades = [...view.querySelectorAll('.grades button')];
    const choices = [...view.querySelectorAll('.choice:not(:disabled)')];
    const undoBtn = $('#undo');
    if (undoBtn && (e.key === 'u' || e.key === 'U')) {
      e.preventDefault();
      undoBtn.click();
    } else if (next && e.key === 'Enter') {
      e.preventDefault();
      next.click();
    } else if (grades.length) {
      const b = e.key === 'Enter' ? grades.find(g => g.dataset.r === '3')
        : ['1', '2', '3'].includes(e.key) ? grades[Number(e.key) - 1] : null;
      if (b) { e.preventDefault(); b.click(); }
    } else if (choices.length && ['1', '2', '3', '4'].includes(e.key)) {
      const b = choices[Number(e.key) - 1];
      if (b) { e.preventDefault(); b.click(); }
    }
  });

  applyTheme();
  // The footer repo link lives in the config with the rest of the exam's
  // identity; absent from the test page, which has no footer.
  const repoLink = $('#repolink');
  if (repoLink) repoLink.href = CFG.repo;
  // Nav entries are real links (middle-click and open-in-new-tab work); the
  // click handler only makes the render immediate instead of waiting for the
  // async hashchange. The default action then sets the same hash, a no-op.
  // Drop any nav tab whose route was withheld (the License tab when no portal
  // credential is configured), so nothing links to a view that is not there.
  document.querySelectorAll('nav a').forEach(a => {
    if (!ROUTES.has(a.dataset.view)) { a.remove(); return; }
    a.addEventListener('click', () => go(a.dataset.view));
  });
  if (!restoreSession()) render(location.hash.slice(1) || 'home');

  // The service worker serves everything cache-first, so after a deploy the
  // user keeps studying on the old version until the next full load. When a
  // new worker finishes installing behind a page that already has one, offer
  // the reload instead of waiting to be noticed. The active session survives
  // the reload via sessionStorage.
  function showToast(id, message, label, onClick) {
    if ($('#' + id)) return;
    const div = document.createElement('div');
    div.id = id;
    div.className = 'toast';
    div.setAttribute('role', 'status');
    const span = document.createElement('span');
    span.textContent = message;
    div.appendChild(span);
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.addEventListener('click', () => onClick(div));
    div.appendChild(btn);
    document.body.appendChild(div);
  }

  function showUpdateToast() {
    showToast('updatetoast', 'A new version is ready.', 'Reload', () => location.reload());
  }

  // Storage failures (full or blocked localStorage) surface once as a toast;
  // the session keeps running on the in-memory state.
  Store.onSaveError = () => showToast('savetoast',
    'Progress could not be saved. Browser storage is full or blocked.',
    'Dismiss', div => div.remove());

  // Installable, offline-capable PWA. Skipped on file:// and http:// (the
  // service worker API needs a secure context), where the app still works.
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          // "installed" with a controller present = an update, not first install
          if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast();
        });
      });
    }).catch(() => {});
  }

  // version.txt is written by the deploy workflow from the release tag; absent
  // when running from the filesystem, in which case the footer stays empty.
  let appVersion = '';
  fetch('version.txt')
    .then(r => (r.ok ? r.text() : null))
    .then(v => {
      if (!v || !/^\d/.test(v.trim())) return;
      appVersion = v.trim();
      $('#version').textContent = 'v' + appVersion;
    })
    .catch(() => {});
})();
