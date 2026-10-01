// Pins: frontend/styles.css is dark-only, declares code-conductor's shell token
// names and values on :root, references no custom property it doesn't declare
// there, and copies the host's mono stack and disabled/focus states.
// Reads the stylesheet as text: the fake DOM doesn't resolve cascaded custom
// properties.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../frontend/styles.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const rootMatch = css.match(/:root\s*\{([^}]*)\}/);
const root = rootMatch ? rootMatch[1] : '';
const declared = new Set([...root.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
  selectors: m[1].split(',').map((s) => s.trim()),
  body: m[2],
}));
const decl = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+?)\\s*(?:;|$)`));
  return m ? m[1] : undefined;
};
const ruleFor = (pred) => rules.find((r) => r.selectors.some(pred));

// Copied from the :root block of code-conductor's shell stylesheet
// (public/styles.css). Update both together.
const HOST_ROOT = {
  '--bg': '#0f1117',
  '--panel': '#151823',
  '--panel-2': '#1d2130',
  '--text': '#d8dae6',
  '--muted': '#8a90a3',
  '--border': '#232838',
  '--accent': '#6ea8ff',
  '--green': '#4ade80',
  '--amber': '#f59e0b',
  '--red': '#f87171',
  'font-size': '14px',
  'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
};

test(':root block exists', () => {
  assert.ok(rootMatch, 'styles.css has no :root block');
});

test('dark-only: no prefers-color-scheme query, :root declares color-scheme: dark', () => {
  assert.doesNotMatch(css, /prefers-color-scheme/);
  assert.match(root, /(^|[;\s])color-scheme\s*:\s*dark\s*(;|$)/);
});

test("declares the host shell's token names on :root", () => {
  for (const name of ['--bg', '--panel', '--panel-2', '--text', '--muted', '--border', '--accent', '--green', '--amber', '--red']) {
    assert.ok(declared.has(name), `:root does not declare ${name}`);
  }
});

test('every var(--name) used is declared on :root', () => {
  const used = new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
  assert.ok(used.size > 0);
  for (const name of used) assert.ok(declared.has(name), `var(${name}) is not declared on :root`);
});

test(":root values match code-conductor's shell :root", () => {
  for (const [prop, want] of Object.entries(HOST_ROOT)) {
    assert.equal(decl(root, prop), want, `:root ${prop}`);
  }
});

test('code and pre use the host mono stack', () => {
  const rule = rules.find((r) => r.selectors.includes('code') && r.selectors.includes('pre'));
  assert.ok(rule, 'no `code, pre` rule');
  assert.equal(decl(rule.body, 'font-family'), 'ui-monospace, monospace');
});

test('disabled and focus states copy the host', () => {
  const disabled = ruleFor((s) => s === 'button:disabled');
  assert.ok(disabled, 'no button:disabled rule');
  assert.equal(decl(disabled.body, 'opacity'), '.5');
  assert.equal(decl(disabled.body, 'cursor'), 'not-allowed');
  const focus = ruleFor((s) => /\binput:focus$/.test(s));
  assert.ok(focus, 'no input :focus rule');
  assert.equal(decl(focus.body, 'outline'), '2px solid var(--accent)');
  assert.equal(decl(focus.body, 'outline-offset'), '-1px');
});
