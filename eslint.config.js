// ESLint for the frontend (app/static/*.js), see docs/development.md.
//
// The page loads its scripts as classic scripts that share one global scope (no modules, no build step), so
// a function declared in one file is used in others. ESLint looks at one file at a time: to still catch
// misspelled names (no-undef), the names every file declares at its top level are collected here and made
// known to all of them.
import { readdirSync, readFileSync } from 'node:fs';
import js from '@eslint/js';
import globals from 'globals';

const dir = new URL('./app/static/', import.meta.url);
const shared = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const source = readFileSync(new URL(file, dir), 'utf8');
  // Prettier puts every top-level declaration at the start of a line.
  for (const m of source.matchAll(/^(?:async function|function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
    shared[m[1]] = 'writable';
  }
  for (const m of source.matchAll(/^(?:const|let|var)\s+([^=;]*,[^=;]*?)\s*(?:=|;)/gm)) {
    for (const name of m[1].split(',')) shared[name.trim()] = 'writable'; // let a, b;
  }
}

export default [
  js.configs.recommended,
  {
    files: ['app/static/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...shared },
    },
    rules: {
      // Top-level names are used by other files; only unused locals are a finding.
      'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }],
      // The shared names above are declared in exactly one file each.
      'no-redeclare': ['error', { builtinGlobals: false }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
