/* End-to-end tests driven through the real UI, generic to every trainer:
 * everything the suite expects is derived from the exam config and the bank,
 * so swapping data/ for another exam does not break the assertions.
 *
 * Results land in #testlog as "RESULTS::" + one PASS/FAIL entry per check,
 * separated by "||" — the CI workflow greps for FAIL/EXCEPTION after dumping
 * the DOM headlessly. The test shell calls TestSuite.flush() after this file
 * (and any app-specific suite run through TestSuite.run) has finished.
 * Synced from the trainer-engine repo; do not edit in an app repo. */
const TestSuite = (() => {
  const log = [];
  const t = (name, cond) => log.push((cond ? 'PASS ' : 'FAIL ') + name);
  const nav = v => document.querySelector(`nav a[data-view="${v}"]`).click();
  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const run = fn => {
    try { fn(); } catch (e) {
      log.push('EXCEPTION ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]);
    }
  };
  const flush = () => {
    document.getElementById('testlog').textContent = 'RESULTS::' + log.join('||');
  };

  // Mirror the app's section keying: "<manual>:<number>", with everything
  // under `default` when the config declares flat (topic) sections. Config
  // section lists may hold bare numbers; qualify them the same way.
  const secKey = x =>
    `${(EXAM_CONFIG.flatSections ? 'default' : x.manual) || 'default'}:${x.section}`;
  const normSec = s => (typeof s === 'number' ? `default:${s}` : String(s));

  // Some banks (the FCC pools) repeat a stem with different choices, so
  // identify the on-screen question by its stem and the choice text behind
  // each button (each <kbd> badge is a single leading character to strip).
  const bankOnScreen = () => {
    const qt = q('.qtext').textContent;
    return QUESTION_BANK.find(x => x.question === qt
      && qa('.choice').every(b => x.choices[Number(b.dataset.i)] === b.textContent.slice(1)));
  };

  run(() => {
    const TESTS = EXAM_CONFIG.tests
      .map(tst => ({ ...tst, sections: (tst.sections || []).map(normSec) }));
    // An exam the bank has no questions for is listed in the config and shown
    // in the app, but there is nothing to schedule or project for it, so the
    // readiness views cover only the ones that have sections.
    const STUDIABLE = TESTS.filter(tst => tst.sections.length);
    const PASS_PCT = Math.round(Readiness.PASS_MARK * 100);
    const SECTION_COUNT = new Set(QUESTION_BANK.map(secKey)).size;
    // How the app refers to a section in prose ("ch. 3", "§ 3"), for the
    // weakest-section assertion below.
    const SEC_WORD = (EXAM_CONFIG.sectionWord || 'ch.')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // --- boot resumed the session planted before app.js loaded ---
    t('reload resumes mid-study session', !!q('.qtext'));
    t('resume is at the saved position', q('.quiz .meta span').textContent === '2 / 3');
    t('resume shows the saved queue question', q('.qtext').textContent === AOTA.question);
    t('all-of-the-above rendered as the last choice',
      !AOTA.choices.some(c => /^all of the above$/i.test(c))
      || /all of the above$/i.test(qa('.choice').pop().textContent));
    t('resume highlights the study nav entry',
      q('nav a[data-view="study"]').classList.contains('active'));
    nav('home');
    t('navigating away abandons the session',
      sessionStorage.getItem(EXAM_CONFIG.sessionKey) === null);

    localStorage.clear();
    sessionStorage.clear(); // start the rest of the suite from a clean slate

    // --- study session: answer correctly, grade Good ---
    nav('study');
    t('study renders question', !!q('.qtext'));
    const qid1 = q('.qtext').textContent;
    const bank1 = bankOnScreen();
    const correctBtn = qa('.choice').find(b => Number(b.dataset.i) === bank1.answer);
    correctBtn.click();
    t('correct answer highlighted', correctBtn.classList.contains('correct'));
    t('grade buttons appear', qa('.grades button').length === 3);
    q('.grades button[data-r="3"]').click();
    t('advances to next question', q('.qtext').textContent !== qid1);
    t('graded review appended to the log', Store.load().log.length === 1
      && Store.load().log[0].rating === 3 && typeof Store.load().log[0].ts === 'number');
    const mirrored = JSON.parse(sessionStorage.getItem(EXAM_CONFIG.sessionKey));
    t('active session mirrored to sessionStorage',
      mirrored && mirrored.mode === 'study' && mirrored.pos === 1 && Array.isArray(mirrored.queue));

    // --- answer wrongly: requeue + explanation ---
    const bank2 = bankOnScreen();
    const progressBefore = parseFloat(q('.progress div').style.width);
    const wrongBtn = qa('.choice').find(b => Number(b.dataset.i) !== bank2.answer);
    const noCalc = !q('#calc');
    wrongBtn.click();
    t('wrong shows explanation', !!q('.explain.wrongbg'));
    // Both are opt-in per question: only a card that asks for arithmetic gets
    // a calculator, and only a question that names the mistakes behind its
    // wrong choices says what you did.
    t('a question with nothing to calculate offers no calculator', !!bank2.drill || noCalc);
    t('a question with no named mistakes says nothing extra',
      !!bank2.whyWrong || !q('.explain .slip'));
    t('wrong answer logged as Again', Store.load().log.at(-1).rating === 1
      && Store.load().log.at(-1).id === bank2.id);
    t('feedback links to a prefilled error report',
      q('.explain a.report').href.includes('question-id=' + bank2.id));
    // Only a cited question with a publicly linkable manual renders a deep
    // link; anything else renders plain text or nothing, and the assertion is
    // skipped. A PDF is linked by physical page, a web publication by the
    // anchor on the heading its `page` names.
    const manual2 = EXAM_CONFIG.manuals[bank2.manual || 'default'];
    const target2 = manual2 && (bank2.pdfPage || (manual2.pages && manual2.pages[bank2.page]));
    t('feedback deep links into the source',
      !manual2 || !manual2.url || !bank2.page
      || q('.explain a.cite').href.endsWith((manual2.web ? '#' : '#page=') + target2));
    t('continue button appears', !!q('#next'));
    // Enter with focus on a nav link must not be hijacked into Continue
    // (a synthetic keydown never triggers the native activation, so if the
    // shortcut handler wrongly fires, the feedback screen would advance).
    document.querySelector('nav a[data-view="stats"]').focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    t('Enter on a focused link is left to the browser', !!q('#next'));
    q('#next').click();
    t('moves on after wrong', !!q('.qtext'));
    t('progress bar does not move backward on requeue',
      parseFloat(q('.progress div').style.width) > progressBefore);

    // --- undo takes back an answer from the feedback screen ---
    const qtext3 = q('.qtext').textContent;
    const bank3 = bankOnScreen();
    const cardBefore = JSON.stringify(Store.load().cards[bank3.id] || null);
    const dailyBefore = JSON.stringify(Store.load().daily);
    const logBefore = Store.load().log.length;
    qa('.choice').find(b => Number(b.dataset.i) !== bank3.answer).click();
    t('undo button appears after answering', !!q('#undo'));
    q('#undo').click();
    t('undo re-asks the same question', q('.qtext').textContent === qtext3);
    t('undo restores card state', JSON.stringify(Store.load().cards[bank3.id] || null) === cardBefore);
    t('undo restores daily counters', JSON.stringify(Store.load().daily) === dailyBefore);
    t('undo removes the log entry', Store.load().log.length === logBefore);
    qa('.choice').find(b => Number(b.dataset.i) === bank3.answer).click();
    t('undo also offered after a correct answer', !!q('#undo'));
    q('.grades button[data-r="3"]').click();
    t('undo gone after grading finalizes the answer', !q('#undo'));

    // --- leaving mid-grade rolls the ungraded answer back ---
    const bank4 = bankOnScreen();
    const daily4 = JSON.stringify(Store.load().daily);
    qa('.choice').find(b => Number(b.dataset.i) === bank4.answer).click();
    nav('home'); // grades were showing; navigating away abandons the answer
    const c4 = Store.load().cards[bank4.id];
    t('leaving mid-grade rolls back the daily counters', JSON.stringify(Store.load().daily) === daily4);
    t('leaving mid-grade leaves the card unseen', !c4 || !c4.lastReview);

    // state checks
    const st = Store.load();
    const c2 = st.cards[bank2.id];
    t('wrong card streak reset', c2 && c2.streak === 0 && c2.wrong > 0);
    t('wrong card state learning/relearning', c2 && (c2.state === 'learning' || c2.state === 'relearning'));
    const c1 = Object.values(st.cards).find(c => c.state === 'review');
    t('graded card scheduled for future', c1 && c1.due > Date.now());

    // --- misses drill available ---
    nav('misses');
    t('misses drill shows the missed question', !!q('.qtext'));

    // --- exam flow ---
    nav('exam');
    t('exam setup lists every configured exam', qa('.examopt').length === EXAM_CONFIG.exams.length);
    qa('.examopt').find(b => !b.disabled).click();
    t('exam question renders', !!q('.qtext'));
    let guard = 200;
    while (q('.choice') && guard--) q('.choice').click();
    t('exam result renders', !!q('.examresult'));
    t('exam recorded', Store.load().exams.length === 1);

    // --- exam readiness projection ---
    nav('home');
    t('home projects a score per studiable test',
      qa('.home .readiness .rrow').length === STUDIABLE.length);
    t('projection reads as a percentage', /^\d{1,3}%$/.test(q('.home .rpct').textContent.trim()));
    // The first studied question of the run belongs to some test; that test's
    // projection must have moved off the guess-rate floor an untouched one
    // sits at. A handful of cards moves the pool mean by a fraction of a
    // point once the pool is large, which the rendered whole number rounds
    // away, so the lift is asserted on the projection itself and the rendered
    // number is checked against the same projection.
    const liftedTest = TESTS.find(tst => tst.sections.includes(secKey(bank1)));
    const liftedRow = qa('.home .rrow')
      .find(r => r.querySelector('.rname').textContent === liftedTest.name);
    const liftedProj = Readiness.project(
      QUESTION_BANK.filter(x => liftedTest.sections.includes(secKey(x))),
      Store.load().cards, Date.now(), Infinity);
    t('studied cards lift the projection off the guess rate',
      liftedProj.expected > Readiness.GUESS);
    t('the rendered projection is the one the memory model computes',
      parseInt(liftedRow.querySelector('.rpct').textContent, 10)
      === Math.round(liftedProj.expected * 100));
    t('home sorts the weakest test first', (() => {
      const p = qa('.home .rpct').map(e => parseInt(e.textContent, 10));
      return p.every((v, i) => i === 0 || p[i - 1] <= v);
    })());
    t('pass mark is drawn on the bar', q('.home .rmark').style.left === PASS_PCT + '%');

    // --- stats & browse & settings render ---
    nav('stats');
    t('stats renders table', !!q('.stats table'));
    t('stats details the readiness projection', !!q('.stats .readiness table'));
    t('readiness table has a row per test',
      qa('.stats .readiness tr').length === STUDIABLE.length + 1); // + the header row
    t('readiness reports odds of passing',
      /(<1%|>99%|\d{1,3}%)/.test(qa('.stats .readiness td')[2].textContent));
    t('multi-section tests name their weakest section',
      !TESTS.some(tst => tst.sections.length > 1)
      || new RegExp('weakest: .*' + SEC_WORD + ' \\S').test(q('.stats .readiness').textContent));
    t('stats renders 30-day history', qa('.history .hbar').length === 30);
    t('history shows today as active', !qa('.history .hbar')[29].classList.contains('zero'));
    nav('browse');
    t('browse renders a group per section',
      qa('.browse details.chapter').length === SECTION_COUNT);
    nav('settings');
    t('settings renders', !!q('#newperday'));

    // --- theme override ---
    t('theme select renders', !!q('#theme'));
    q('#theme').value = 'dark';
    q('#theme').dispatchEvent(new Event('change'));
    t('dark override applied', document.documentElement.dataset.theme === 'dark');
    t('dark override saved', Store.load().settings.theme === 'dark');
    q('#theme').value = 'system';
    q('#theme').dispatchEvent(new Event('change'));
    t('system theme clears the override', !('theme' in document.documentElement.dataset));

    // --- test/endorsement picker: keep only the tests in the first group ---
    t('test picker renders every configured test', qa('input[data-test]').length === TESTS.length);
    // An exam with no questions is listed so the gap is visible, but there is
    // nothing to study for it, so it must not be selectable.
    t('an exam with no questions is listed but not selectable',
      TESTS.every(tst => {
        const cb = qa('input[data-test]').find(x => x.dataset.test === tst.key);
        return !!cb && cb.disabled === !tst.sections.length;
      }));
    const keepTests = TESTS.filter(tst => tst.group === EXAM_CONFIG.testGroups[0][0]
      && tst.sections.length);
    const keep = new Set(keepTests.map(tst => tst.key));
    const keepSecs = [...new Set(keepTests.flatMap(tst => tst.sections))].sort();
    qa('input[data-test]').forEach(cb => {
      if (cb.checked !== keep.has(cb.dataset.test)) {
        cb.checked = keep.has(cb.dataset.test);
        cb.dispatchEvent(new Event('change'));
      }
    });
    // The picker stores the exams themselves, not the sections they cover, so
    // an exam that grows a section later grows for whoever picked it.
    const stored = [...Store.load().settings.tests].sort();
    t('picker stores the kept tests', JSON.stringify(stored)
      === JSON.stringify(keepTests.length === STUDIABLE.length ? [] : [...keep].sort()));
    nav('settings');
    t('picker state survives re-render', qa('input[data-test]:checked').length === keepTests.length);
    nav('study');
    const sq = bankOnScreen();
    t('study draws from selected sections only', keepSecs.includes(secKey(sq)));
    nav('exam');
    // Offered: the exams picked in Settings, plus the ones with no questions,
    // which are listed unselectable so the gap shows. An exam sharing its key
    // with a test follows the picker (an exam whose material is a subset of
    // another's is not volunteered to someone who never picked it); an exam
    // keyed on its own (the FCC elements sit behind several licenses) is
    // offered when the kept tests cover its sections.
    const testKeySet = new Set(TESTS.map(tst => tst.key));
    const keepSecSet = new Set(keepSecs);
    const offered = e => {
      const secs = (e.sections || []).map(normSec);
      return !secs.length || (testKeySet.has(e.key) ? keep.has(e.key)
        : secs.every(sec => keepSecSet.has(sec)));
    };
    const availExams = EXAM_CONFIG.exams.filter(offered).length;
    t('exam list filtered to selected tests', qa('.examopt').length === availExams);
    t('only offered exams are listed', qa('.examopt').every(b =>
      offered(EXAM_CONFIG.exams.find(x => x.key === b.dataset.key))));
    t('hidden exams hint shows', availExams === EXAM_CONFIG.exams.length
      || /hidden/.test(q('.examsetup').textContent));
    nav('settings');
    qa('input[data-test]').forEach(cb => {
      if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
    });
    t('all checked stores empty (= everything)', Store.load().settings.tests.length === 0);

    // --- exam date features ---
    const d3 = new Date(Date.now() + 3 * 86400000);
    const iso = `${d3.getFullYear()}-${String(d3.getMonth() + 1).padStart(2, '0')}-${String(d3.getDate()).padStart(2, '0')}`;
    const ed = q('#examdate');
    t('exam date input exists', !!ed);
    ed.value = iso;
    ed.dispatchEvent(new Event('change'));
    t('exam date saved', Store.load().settings.examDate === iso);
    // Pin the pace low so the auto-boost scenario holds for any bank size: a
    // pace of 1 can never cover the remaining unseen cards before the date.
    const npd0 = q('#newperday');
    npd0.value = 1;
    npd0.dispatchEvent(new Event('change'));

    nav('home');
    t('exam banner shows', !!q('.exambanner'));
    t('banner shows raised retention', /9[1-5]%/.test(q('.exambanner').textContent));
    const finalBtn = q('button[data-view="final"]');
    t('final review button appears', !!finalBtn);

    finalBtn.click();
    t('final review renders question', !!q('.qtext'));
    const fq = bankOnScreen();
    qa('.choice').find(b => Number(b.dataset.i) === fq.answer).click();
    t('final review grades appear', qa('.grades button').length === 3);
    q('.grades button[data-r="4"]').click(); // Easy
    const fc = Store.load().cards[fq.id];
    const examEnd = new Date(d3.getFullYear(), d3.getMonth(), d3.getDate(), 23, 59, 59).getTime();
    t('due never past exam date', fc.due <= examEnd);

    // --- pace auto-boost with exam deadline ---
    nav('home');
    const newTile = Number(qa('.tile .big')[1].textContent);
    t('pace boosted for exam deadline', newTile > Store.load().settings.newPerDay);
    t('banner mentions boost', /boosted/.test(q('.exambanner').textContent));

    nav('settings');
    t('picker grouped into a heading per group',
      qa('.seclist h4').length === EXAM_CONFIG.testGroups.length);
    t('pace info mentions boost', /boost/i.test(q('#paceinfo').textContent));
    const paceBefore = q('#paceinfo').textContent;
    // Unchecking the last test only narrows the studied sections when the
    // other tests do not already cover them; an exam config can make this a
    // no-op.
    const otherSecs = TESTS.slice(0, -1).flatMap(tst => tst.sections);
    const narrows = !TESTS.at(-1).sections.every(sec => otherSecs.includes(sec));
    const tog = qa('input[data-test]').find(cb => cb.dataset.test === TESTS.at(-1).key);
    tog.checked = false;
    tog.dispatchEvent(new Event('change'));
    t('pace info updates on section toggle', narrows
      ? q('#paceinfo').textContent !== paceBefore
      : q('#paceinfo').textContent === paceBefore);
    tog.checked = true;
    tog.dispatchEvent(new Event('change'));
    q('#cleardate').click();
    t('no-exam button clears date', Store.load().settings.examDate === '');
    nav('home');
    t('banner gone after clearing date', !q('.exambanner'));
    t('pace back to steady after clearing', Number(qa('.tile .big')[1].textContent) <= Store.load().settings.newPerDay);

    // --- extra new cards on demand ---
    nav('settings');
    const npd = q('#newperday');
    npd.value = 0;
    npd.dispatchEvent(new Event('change'));
    nav('home');
    t('idle home offers extra new cards', !!q('.home .extra button'));
    nav('study');
    t('caught-up screen offers extra new cards', !!q('.done .extra button'));
    q('.done .extra button[data-extra="5"]').click();
    t('extra cards start a study session', !!q('.qtext'));
    t('extra allowance recorded with today\'s counters',
      (Store.load().daily[Store.todayKey()].extra || 0) >= 5);
    t('exactly the requested extra cards queued', q('.quiz .meta span').textContent === '1 / 5');

    // --- a failing save warns instead of throwing ---
    const origSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    let saveThrew = false;
    try { Store.save(); } catch { saveThrew = true; }
    Storage.prototype.setItem = origSetItem;
    t('failing save does not throw', !saveThrew);
    t('failing save shows a warning toast', !!q('#savetoast'));
    q('#savetoast button').click();
    t('save warning is dismissible', !q('#savetoast'));
    Store.save(); // real save so later state assertions see current data

    // --- export/import round trip ---
    const dump = Store.exportJSON();
    t('export stamps a schema version', JSON.parse(dump).version === 2);
    Store.importJSON(dump);
    t('export/import round trip', Store.load().exams.length === 1);
    t('version stamp does not leak into live state', Store.load().version === undefined);

    // --- corrupt import is sanitized, not applied verbatim ---
    Store.importJSON(JSON.stringify({
      cards: { 'x1': { stability: 'oops', due: null, state: 'bogus', lastWrong: 'yes' }, 'x2': 42 },
      settings: { newPerDay: -3, tests: 'all', examDate: 7, theme: 'purple' },
      daily: null, exams: { nope: true },
      log: [{ id: 5 }, 'x', { id: 's1-001', rating: 3, ts: 1 }],
    }));
    const bad = Store.load();
    t('corrupt card fields coerced to numbers', bad.cards.x1.stability === 0 && bad.cards.x1.due === 0);
    t('corrupt card state falls back to new', bad.cards.x1.state === 'new');
    t('non-object card entries dropped', !bad.cards.x2);
    t('corrupt settings sanitized', bad.settings.newPerDay === 0
      && Array.isArray(bad.settings.tests) && bad.settings.examDate === ''
      && bad.settings.theme === 'system');
    t('corrupt daily/exams reset', Object.keys(bad.daily).length === 0 && bad.exams.length === 0);
    t('corrupt log filtered to valid entries', bad.log.length === 1 && bad.log[0].id === 's1-001');
    let rejected = false;
    try { Store.importJSON('{"nope":1}'); } catch { rejected = true; }
    t('backup without cards/settings rejected', rejected);

    // --- a pre-v2 selection migrates to the exams it stood for ---
    // Backups and saved progress from before v2 hold the sections an exam
    // covered at the time, not the exam. Such a list goes stale the moment an
    // exam gains a section, which is the whole reason the selection is stored
    // as exams now, so the migration has to recover the choice and the views
    // have to show the exam's sections as they are today, not as the backup
    // listed them.
    const secName = sec => QUESTION_BANK.find(x => secKey(x) === sec).sectionName;
    // Prefer a section that does not sit on every studiable test, so the
    // migration has something narrower than "all of them" to recover; a
    // config whose every section is shared by every test (none known) can
    // only migrate to the empty everything-selection, and the assertion
    // accepts that.
    const touching = sec => STUDIABLE.filter(tst => tst.sections.includes(sec));
    let oldTest = STUDIABLE[0];
    let oldSec = oldTest.sections[0];
    outer: for (const tst of STUDIABLE) {
      for (const sec of tst.sections) {
        if (touching(sec).length < STUDIABLE.length) { oldTest = tst; oldSec = sec; break outer; }
      }
    }
    Store.importJSON(JSON.stringify({
      cards: {}, settings: { sections: [oldSec] },
    }));
    const migrated = Store.load().settings.tests;
    t('a pre-v2 section list migrates to the exams it stood for',
      touching(oldSec).length === STUDIABLE.length
        ? migrated.length === 0
        : migrated.includes(oldTest.key)
          && migrated.every(k => touching(oldSec).some(tst => tst.key === k)));
    nav('stats');
    const statsText = q('.stats').textContent;
    t('a migrated selection covers the exam\'s sections as they are now',
      oldTest.sections.every(sec => statsText.includes(secName(sec))));

    // --- a fresh install starts on the configured starter tests ---
    // defaults() is only reachable with no saved state, which reset()
    // recreates: without EXAM_CONFIG.defaultTests the selection is empty
    // (= all of them); with it, a new user's picker comes pre-checked with
    // the starter exams, while anyone already studying keeps their choice
    // (the sanitize tests above never saw starter tests leak in).
    Store.reset();
    const starter = [...new Set((EXAM_CONFIG.defaultTests || [])
      .filter(k => STUDIABLE.some(tst => tst.key === k)))].sort();
    const fresh = [...Store.load().settings.tests].sort();
    t('fresh state starts on the configured starter tests', JSON.stringify(fresh)
      === JSON.stringify(starter.length === STUDIABLE.length ? [] : starter));

    Store.importJSON(dump); // restore real state for the remaining tests

    // --- the practice pool always empties ---
    // Card A is a fresh miss; card B is the shape that used to get stuck:
    // more lifetime wrongs than rights, but answered right last.
    const missA = QUESTION_BANK[0], missB = QUESTION_BANK[1];
    const legacyCard = extra => ({ stability: 1, difficulty: 5, lastReview: 1, due: 1,
                                   reps: 4, lapses: 2, state: 'review', ...extra });
    Store.importJSON(JSON.stringify({
      cards: {
        [missA.id]: legacyCard({ wrong: 3, right: 1, lastWrong: true }),
        [missB.id]: legacyCard({ wrong: 5, right: 4, lastWrong: false }),
      },
      settings: { sections: [] },
    }));
    const toFix = () => {
      nav('home');
      return Number(qa('.home .tile').find(el => /to fix/.test(el.textContent))
        .querySelector('.big').textContent);
    };
    t('pre-streak backup keeps a last-wrong card in the pool',
      Store.load().cards[missA.id].streak === 0);
    t('pre-streak backup clears a card answered right last',
      Store.load().cards[missB.id].streak >= Store.MISS_CLEARED);
    t('home counts only the outstanding miss', toFix() === 1);
    const drill = () => {
      nav('misses');
      const bank = bankOnScreen();
      qa('.choice').find(b => Number(b.dataset.i) === bank.answer).click();
      q('#next').click();
    };
    drill();
    t('one correct answer is not enough to retire a miss', toFix() === 1);
    drill();
    t('two correct answers in a row empty the pool', toFix() === 0);
    t('practice button disabled with an empty pool',
      q('.home button[data-view="misses"]').disabled);

    // --- about page ---
    nav('about');
    t('about renders', !!q('.about'));
    t('about links to repo', qa('.about a').some(a => /github\.com/.test(a.href)));
    t('about has changelog container', !!q('#changelog'));
  });

  return { log, t, q, qa, nav, run, flush, secKey, normSec };
})();
