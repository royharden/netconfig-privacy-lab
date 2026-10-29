// ESLint flat config. PLAN.md row 28 (network/storage ban in src/, src/ui/assets.ts the only exemption), row 44 (process ban in
// src/, scripts/, tools/), HTML-sink ban for every src/ file, and the strategy import ban (PLAN.md M1/M3 acceptance).
// Written in Dirty Mode; this config has not been executed (docs/DEFERRED-VALIDATION.md).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const NETWORK_MESSAGE =
  'Network and storage APIs are banned in src/ (PLAN.md row 28). Only src/ui/assets.ts may load assets, via static imports.';
const HTML_MESSAGE = 'Config text must render as React text nodes only; HTML sinks are banned (PLAN.md M1 acceptance).';
const PROCESS_MESSAGE = 'Spawning processes is banned in src/, scripts/ and tools/ (PLAN.md row 44).';
const CUSTODY_MESSAGE =
  'Strategies, the detector and operatorList must not read scoring material: core/ledger, core/ledgerValidate, core/sidecar, ' +
  'core/labels, core/expected, src/eval, src/gen or fixtures (PLAN.md rows 15, 29, 30; M1/M3 import ban).';

/** Row 28: global network and storage entry points. */
const NETWORK_AND_STORAGE_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
].map((name) => ({ name, message: NETWORK_MESSAGE }));

/** Row 28: the same APIs reached through an object (window.fetch, navigator.sendBeacon, self.indexedDB, ...). */
const NETWORK_AND_STORAGE_SYNTAX = [
  {
    selector:
      'MemberExpression[property.name=/^(fetch|sendBeacon|localStorage|sessionStorage|indexedDB|caches|cookie)$/]',
    message: NETWORK_MESSAGE,
  },
  { selector: 'NewExpression[callee.name=/^(XMLHttpRequest|WebSocket|EventSource)$/]', message: NETWORK_MESSAGE },
];

/** HTML sinks: never render config text as markup. */
const HTML_SINK_SYNTAX = [
  { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: HTML_MESSAGE },
  { selector: 'MemberExpression[property.name=/^(innerHTML|outerHTML)$/]', message: HTML_MESSAGE },
  { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: HTML_MESSAGE },
  { selector: "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]", message: HTML_MESSAGE },
];

/** Row 44: no child_process via require() or dynamic import(). Static imports are covered by no-restricted-imports. */
const PROCESS_SYNTAX = [
  { selector: "CallExpression[callee.name='require'][arguments.0.value=/^(node:)?child_process$/]", message: PROCESS_MESSAGE },
  { selector: 'ImportExpression[source.value=/^(node:)?child_process$/]', message: PROCESS_MESSAGE },
];

const PROCESS_IMPORT_PATHS = [
  { name: 'child_process', message: PROCESS_MESSAGE },
  { name: 'node:child_process', message: PROCESS_MESSAGE },
];

const CUSTODY_IMPORT_PATTERNS = [
  {
    group: [
      '**/core/ledger',
      '**/core/ledgerValidate',
      '**/core/sidecar',
      '**/core/labels',
      '**/core/expected',
      '../core/ledger',
      '../core/ledgerValidate',
      '../core/sidecar',
      '../core/labels',
      '../core/expected',
      './ledger',
      './ledgerValidate',
      './sidecar',
      './labels',
      './expected',
      '**/eval',
      '**/eval/**',
      '../eval',
      '../eval/**',
      '**/gen',
      '**/gen/**',
      '../gen',
      '../gen/**',
      '**/fixtures/**',
    ],
    message: CUSTODY_MESSAGE,
  },
];

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'separate-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // Browser source: every src/ file except the asset module gets the full network/storage + HTML + process ban.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/ui/assets.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-globals': ['error', ...NETWORK_AND_STORAGE_GLOBALS],
      'no-restricted-syntax': ['error', ...NETWORK_AND_STORAGE_SYNTAX, ...HTML_SINK_SYNTAX, ...PROCESS_SYNTAX],
      'no-restricted-imports': ['error', { paths: PROCESS_IMPORT_PATHS }],
    },
  },
  // The single row 28 exemption: src/ui/assets.ts keeps the HTML-sink and process bans but not the network/storage ban.
  {
    files: ['src/ui/assets.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-syntax': ['error', ...HTML_SINK_SYNTAX, ...PROCESS_SYNTAX],
      'no-restricted-imports': ['error', { paths: PROCESS_IMPORT_PATHS }],
    },
  },
  // Custody import ban (this object replaces no-restricted-imports for these files, so it repeats the process paths).
  {
    files: ['src/strategies/**/*.ts', 'src/detect/**/*.ts', 'src/core/operatorList.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: PROCESS_IMPORT_PATHS, patterns: CUSTODY_IMPORT_PATTERNS }],
    },
  },
  // Node scripts and offline tools: process ban only.
  {
    files: ['scripts/**/*.ts', 'tools/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-restricted-syntax': ['error', ...PROCESS_SYNTAX],
      'no-restricted-imports': ['error', { paths: PROCESS_IMPORT_PATHS }],
    },
  },
  {
    files: ['tests/**/*.ts', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
