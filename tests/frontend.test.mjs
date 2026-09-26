import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const files = readdirSync(DIR).map((n) => [n, readFileSync(path.join(DIR, n), 'utf8')]);

// Invariant: no HTML-string sinks or dynamic code anywhere in the frontend.
test('frontend uses no HTML-string sinks or eval', () => {
  const banned = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function|setAttribute\(\s*['"]style/;
  for (const [n, src] of files) assert.equal(banned.test(src), false, `${n}: ${src.match(banned)?.[0]}`);
});

// Invariant: every URL is relative (the host mounts us under /plugins/code-wiki/).
test('frontend uses no root-relative URLs', () => {
  const rootRel = /(?:src|href)\s*=\s*["']\/|\(\s*['"`]\/api|[`'"]\/api/;
  for (const [n, src] of files) assert.equal(rootRel.test(src), false, `${n}: ${src.match(rootRel)?.[0]}`);
});

// Invariant: the CSP forbids inline script and style, so the shell has none.
test('frontend has no inline script or style attribute', () => {
  for (const [n, src] of files) {
    assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/.test(src), false, `${n}: inline <script>`);
    assert.equal(/<style[\s>]/.test(src), false, `${n}: <style>`);
    assert.equal(/\sstyle\s*=/.test(src), false, `${n}: style=`);
  }
});
