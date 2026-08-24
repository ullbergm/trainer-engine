#!/usr/bin/env node
/* Validates data/questions.js (schema, unique ids, answer bounds, page format)
 * and checks that the test shell's nav matches index.html.
 * Synced from the trainer-engine repo; do not edit in an app repo. */
const fs = require('fs');
const path = require('path');

// Load the app's whole data/ directory the way the page does: the bank first,
// the page maps and any other data files next, the exam config (which reads
// all of them) last. Browser scripts declare top-level consts, which eval
// scopes away, so hoist every file-level const onto globalThis.
const dataDir = path.join(__dirname, '..', 'data');
const globalize = s => s.replace(/^const (\w+)/gm, 'globalThis.$1');
const loadOrder = f => (f === 'questions.js' ? 0 : f === 'exam-config.js' ? 2 : 1);
fs.readdirSync(dataDir)
  .filter(f => f.endsWith('.js'))
  .sort((a, b) => loadOrder(a) - loadOrder(b) || a.localeCompare(b))
  .forEach(f => eval(globalize(fs.readFileSync(path.join(dataDir, f), 'utf8'))));

// A PDF ends a few pages past the last labelled one (back matter), so allow
// a little slack above the highest mapped page when bounding pdfPage. A `web`
// source maps headings to anchors rather than to page numbers, so there is no
// last page to bound and nothing here to compute.
const lastPage = {};
for (const [key, m] of Object.entries(EXAM_CONFIG.manuals)) {
  const numbered = m.pages ? Object.values(m.pages).filter(v => typeof v === 'number') : [];
  if (numbered.length) lastPage[key] = Math.max(...numbered) + 5;
}

const errors = [];

// What a manual's page map is allowed to hold follows from how its links are
// built: "#page=N" wants numbers, and a `web` source's "#anchor" wants
// strings. Mixing them produces a link that resolves to nothing, silently.
for (const [key, m] of Object.entries(EXAM_CONFIG.manuals)) {
  if (!m.pages) continue;
  const want = m.web ? 'string' : 'number';
  const wrong = Object.entries(m.pages).filter(([, v]) => typeof v !== want);
  if (wrong.length) {
    errors.push(`manual "${key}" is ${m.web ? 'a web publication, so its map must hold anchors'
      : 'a PDF, so its map must hold page numbers'}; ${wrong.length} entries do not `
      + `(first: ${JSON.stringify(wrong[0])})`);
  }
}

const ids = new Set();
const questionTexts = new Map();
const positions = [0, 0, 0, 0];
const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

// Explanations are optional for an exam whose questions come verbatim from a
// published pool with nothing further to say; the config opts out. A verbatim
// pool also relaxes the duplicate rules below: pools repeat a stem with
// different choices (and repeat questions across elements), so only a full
// section+stem+choices match is an error there, and the config may except
// specific ids whose published choices repeat in the source itself.
const requiredFields = ['id', 'section', 'sectionName', 'question', 'choices', 'answer'];
if (EXAM_CONFIG.requireExplanations !== false) requiredFields.push('explanation');
const dupExceptions = new Set(EXAM_CONFIG.allowDuplicateChoices || []);

for (const q of QUESTION_BANK) {
  const label = q.id || '(missing id)';
  for (const field of requiredFields) {
    if (q[field] === undefined || q[field] === '') errors.push(`${label}: missing ${field}`);
  }
  if (ids.has(q.id)) errors.push(`${label}: duplicate id`);
  ids.add(q.id);
  const qn = EXAM_CONFIG.verbatimPool
    ? norm(q.section + ' :: ' + q.question + ' :: ' + (Array.isArray(q.choices) ? q.choices.join(' | ') : ''))
    : norm(q.question);
  if (questionTexts.has(qn)) errors.push(`${label}: duplicate question (also ${questionTexts.get(qn)})`);
  questionTexts.set(qn, q.id);
  if (!Array.isArray(q.choices) || q.choices.length !== 4) errors.push(`${label}: needs exactly 4 choices`);
  else if (new Set(q.choices.map(norm)).size !== 4
      && !dupExceptions.has(q.id)) errors.push(`${label}: duplicate choices`);
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) errors.push(`${label}: answer out of range`);
  // Optional: the mistake behind each wrong choice, parallel to `choices` and
  // null at the correct one, which the feedback screen shows for the choice
  // actually picked. Each entry completes the sentence "You ...", so it is a
  // verb phrase rather than a sentence of its own.
  if (q.whyWrong !== undefined) {
    if (!Array.isArray(q.whyWrong) || q.whyWrong.length !== (q.choices || []).length) {
      errors.push(`${label}: whyWrong needs one entry per choice`);
    } else {
      q.whyWrong.forEach((why, i) => {
        if (i === q.answer) {
          if (why !== null) errors.push(`${label}: whyWrong names a mistake for the correct choice`);
        } else if (typeof why !== 'string' || !why.trim()) {
          errors.push(`${label}: whyWrong[${i}] is not a named mistake`);
        } else if (/[.!?]$/.test(why.trim()) || /^[A-Z][a-z]/.test(why)) {
          errors.push(`${label}: whyWrong[${i}] should complete "You ...", `
            + 'so it starts lowercase and ends without a full stop');
        }
      });
    }
  }
  // Optional illustration ({src, alt}) rendered with the question. The file
  // must exist and ride the service worker precache via data/app-assets.js —
  // offline study would silently lose it otherwise — and must carry alt text,
  // since a sighted reader gets whatever the picture says.
  if (q.image !== undefined) {
    if (typeof q.image !== 'object' || q.image === null
        || typeof q.image.src !== 'string' || !q.image.src.trim()) {
      errors.push(`${label}: image needs a src`);
    } else {
      if (!fs.existsSync(path.join(__dirname, '..', q.image.src))) {
        errors.push(`${label}: image "${q.image.src}" does not exist`);
      }
      if (!Array.isArray(globalThis.APP_ASSETS) || !globalThis.APP_ASSETS.includes(q.image.src)) {
        errors.push(`${label}: image "${q.image.src}" is not precached in data/app-assets.js`);
      }
    }
    if (typeof q.image !== 'object' || q.image === null
        || typeof q.image.alt !== 'string' || !q.image.alt.trim()) {
      errors.push(`${label}: image needs alt text`);
    }
  }
  if (!Number.isInteger(q.section) || q.section < 1) errors.push(`${label}: bad section`);
  // Citations are optional (an exam may have nothing citable) unless the
  // config demands them, but a question that carries one must resolve
  // cleanly through the config either way.
  const mkey = q.manual || 'default';
  const manual = EXAM_CONFIG.manuals[mkey];
  if (q.manual !== undefined && !manual) errors.push(`${label}: unknown manual "${q.manual}"`);
  if (EXAM_CONFIG.requireCitations && q.page === undefined) errors.push(`${label}: missing page`);
  if (q.page !== undefined) {
    if (typeof q.page !== 'string' || !q.page.trim()) errors.push(`${label}: bad page "${q.page}"`);
    else if (q.page && !manual) errors.push(`${label}: cites a page but the config lists no "${mkey}" manual`);
    // Without a mapping the citation cannot deep link into the PDF, so it
    // would silently fall back to plain text.
    else if (manual.url && manual.pages && !manual.pages[q.page] && q.pdfPage === undefined) {
      errors.push(`${label}: page "${q.page}" is not in the "${mkey}" manual's pages map`);
    }
  }
  // A statute or a rule is cited by its number rather than by a page, which
  // the question carries as `ref`. Manuals cited that way say so, because a
  // law question that forgets its ref renders as "NC Pesticide Law p. 12" —
  // right about the PDF, useless to a reader looking for the section.
  if (q.ref !== undefined && (typeof q.ref !== 'string' || !q.ref.trim())) {
    errors.push(`${label}: bad ref "${q.ref}"`);
  }
  if (manual && manual.citeByRef && q.ref === undefined) {
    errors.push(`${label}: the "${mkey}" manual is cited by reference, so the question needs a ref`);
  }
  if (q.pdfPage !== undefined && (!Number.isInteger(q.pdfPage) || q.pdfPage < 1
      || (lastPage[mkey] && q.pdfPage > lastPage[mkey]))) {
    errors.push(`${label}: bad pdfPage "${q.pdfPage}"`);
  }
  if (Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3) positions[q.answer]++;
}

// Each manual numbers its chapters from 1, so a chapter is the pair
// (manual, number), keyed "<manual>:<number>" here and in the app. Two ways
// that goes wrong: a chapter's questions disagree about its name, which means
// a question landed in the wrong chapter or a manual's key was forgotten and
// its questions merged into the other manual's chapter of the same number;
// and a newly authored chapter is never added to an exam, so nothing can draw
// it. Both are silent in the app, so they fail the build here.
// A flat-sectioned bank (CFG.flatSections: sections are topics shared across
// manuals, and `manual` says only what a question cites) keys everything
// under `default`, exactly as the app does.
const flat = !!EXAM_CONFIG.flatSections;
const normSec = s => (typeof s === 'number' ? `default:${s}` : String(s));
const chapterNames = new Map();
const chapterRefs = new Map();
for (const q of QUESTION_BANK) {
  const key = `${(flat ? 'default' : q.manual) || 'default'}:${q.section}`;
  if (!chapterNames.has(key)) chapterNames.set(key, new Set());
  chapterNames.get(key).add(q.sectionName);
  // Optional; back matter sets it ("app. C") because its designation is not
  // its position in the book. Chapters leave it off and render as "ch. N".
  if (!chapterRefs.has(key)) chapterRefs.set(key, new Set());
  chapterRefs.get(key).add(q.sectionLabel === undefined ? '' : q.sectionLabel);
}
for (const [key, names] of chapterNames) {
  if (names.size > 1) {
    errors.push(`chapter ${key} has more than one name [${[...names].sort().join(' | ')}]; `
      + 'every question in a chapter shares its sectionName');
  }
}
for (const [key, refs] of chapterRefs) {
  if (refs.size > 1) {
    errors.push(`chapter ${key} disagrees on sectionLabel [${[...refs].sort().join(' | ')}]; `
      + 'set it on every question in the section or on none');
  }
}
const examined = new Set((EXAM_CONFIG.exams || []).flatMap(e => (e.sections || []).map(normSec)));
for (const key of chapterNames.keys()) {
  if (!examined.has(key)) {
    errors.push(`chapter ${key} has questions but no exam draws on it; `
      + 'add it to an exam in data/exam-config.js');
  }
}
for (const key of examined) {
  const manual = String(key).slice(0, String(key).indexOf(':'));
  if (!String(key).includes(':')) {
    errors.push(`exam section "${key}" is not a "<manual>:<chapter>" key`);
  } else if (!flat && !EXAM_CONFIG.manuals[manual]) {
    // With flat sections `default` is synthetic and need not be a manual.
    errors.push(`exam section "${key}" names manual "${manual}", which the config does not list`);
  }
}

// tests/test.html duplicates the app shell's nav markup; the e2e suite drives
// the app through it, so fail loudly if the two ever drift apart.
const navViews = file => {
  const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const nav = (html.match(/<nav[\s\S]*?<\/nav>/) || [''])[0];
  return [...nav.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]).join(',');
};
const appNav = navViews('index.html');
const testNav = navViews('tests/test.html');
if (!appNav || appNav !== testNav) {
  errors.push(`nav drift: index.html has [${appNav}] but tests/test.html has [${testNav}]`);
}

// sw.js precaches CORE with cache.addAll, which is all-or-nothing: one bad
// path and the new worker never installs, silently killing offline support
// and update toasts on the live site. Every entry must exist in the repo (or
// be generated at deploy time) and be covered by the release staging step.
const root = path.join(__dirname, '..');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const coreSrc = (sw.match(/const CORE = \[([\s\S]*?)\];/) || ['', ''])[1];
const core = [...coreSrc.matchAll(/'([^']+)'/g)].map(m => m[1]);
if (core.length < 5) errors.push('sw.js: could not parse the CORE precache list');
// sw.js spreads data/app-assets.js into CORE; those entries precache the same
// all-or-nothing way, so they are held to the same must-exist rule.
if (Array.isArray(globalThis.APP_ASSETS)) core.push(...globalThis.APP_ASSETS);
else errors.push('data/app-assets.js must define the APP_ASSETS array sw.js precaches');
const release = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const staged = ((release.match(/cp -r (.+) dist\//) || ['', ''])[1]).split(/\s+/);
for (const entry of core) {
  const p = entry === './' ? 'index.html' : entry;
  const generatedAtDeploy = release.includes(`dist/${p}`);
  if (!fs.existsSync(path.join(root, p)) && !generatedAtDeploy) {
    errors.push(`sw.js CORE entry "${entry}" does not exist and is not generated at deploy`);
  }
  if (!staged.includes(p.split('/')[0]) && !generatedAtDeploy) {
    errors.push(`sw.js CORE entry "${entry}" is not staged by release.yml`);
  }
}

// README states the bank size in prose; fail when it drifts from the bank.
// Counts well under the bank size (per-exam question counts and the like)
// are ignored; the cap keeps that working for a fork with a small bank.
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const readmeCounts = [...readme.matchAll(/\b(\d+) (?:multiple-choice )?questions\b/g)]
  .map(m => Number(m[1]))
  .filter(n => n >= Math.min(100, QUESTION_BANK.length));
if (!readmeCounts.length) {
  errors.push('README no longer states the bank size (expected "N questions" somewhere)');
}
readmeCounts.filter(n => n !== QUESTION_BANK.length).forEach(n =>
  errors.push(`README says ${n} questions but the bank has ${QUESTION_BANK.length}`));

// Answer-length tell: if the correct choice is disproportionately often the
// longest (or shortest) option, test-savvy users can score without knowing the
// material. Chance for either is ~25%; warn well before it becomes a pattern.
let longestCorrect = 0, shortestCorrect = 0;
for (const q of QUESTION_BANK) {
  if (!Array.isArray(q.choices) || q.choices.length !== 4) continue;
  const lens = q.choices.map(c => String(c).length);
  const others = lens.filter((_, i) => i !== q.answer);
  if (lens[q.answer] > Math.max(...others)) longestCorrect++;
  if (lens[q.answer] < Math.min(...others)) shortestCorrect++;
}
const pct = n => Math.round((n / QUESTION_BANK.length) * 100);
console.log(`${QUESTION_BANK.length} questions, answer positions ${positions.join('/')}`);
console.log(`answer-length: correct is uniquely longest in ${pct(longestCorrect)}%, uniquely shortest in ${pct(shortestCorrect)}% (chance ~25%)`);
if (pct(longestCorrect) > 35) {
  console.warn('WARN correct answers skew long; "pick the longest" beats chance. Rebalance before it grows.');
}
if (errors.length) {
  errors.forEach(e => console.error('ERROR ' + e));
  process.exit(1);
}
console.log('question bank and test shell OK');
