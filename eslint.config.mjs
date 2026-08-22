import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/'] },
  js.configs.recommended,
  {
    // Browser scripts loaded via <script> tags. Each defines one shared
    // global (FSRS, Store), consumed by js/app.js; storage.js reads its
    // localStorage key out of the app's EXAM_CONFIG.
    files: ['js/fsrs.js', 'js/storage.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, EXAM_CONFIG: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^(FSRS|Store)$' }],
    },
  },
  {
    files: ['js/readiness.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, FSRS: 'readonly', EXAM_CONFIG: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^Readiness$' }],
    },
  },
  {
    files: ['js/app.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        QUESTION_BANK: 'readonly',
        EXAM_CONFIG: 'readonly',
        FSRS: 'readonly',
        Readiness: 'readonly',
        Store: 'readonly',
      },
    },
  },
  {
    // APP_ASSETS comes from the app's data/app-assets.js via importScripts.
    files: ['sw.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.serviceworker, APP_ASSETS: 'readonly' },
    },
  },
  {
    files: ['tools/**/*.js', 'tests/*-test.js', 'tests/validate-bank.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        QUESTION_BANK: 'readonly', EXAM_CONFIG: 'readonly',
        FSRS: 'readonly', Readiness: 'readonly',
      },
    },
  },
  {
    // The pre-boot session plant runs inside tests/test.html before app.js
    // and defines AOTA for the suite.
    files: ['tests/plant-session.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, QUESTION_BANK: 'readonly', EXAM_CONFIG: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^AOTA$' }],
    },
  },
  {
    // The browser test suite runs inside tests/test.html against the real app.
    files: ['tests/engine-suite.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        QUESTION_BANK: 'readonly', EXAM_CONFIG: 'readonly',
        FSRS: 'readonly', Readiness: 'readonly', Store: 'readonly',
        AOTA: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^TestSuite$' }],
    },
  },
];
