import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { KEYWORDS, TYPES, checkSchema, validate } from './_jsonSchemaSubset.mjs';

// Pins: the ported checkSchema refuses everything outside the host's subset and
// accepts type unions, so a manifest outputSchema cannot lean on an ignored keyword.
test('checkSchema rejects keywords outside the subset and malformed schemas, accepts unions', () => {
  assert.throws(() => checkSchema({ type: 'string', pattern: '^a' }), /pattern/);
  assert.throws(() => checkSchema({ $ref: '#/x' }), /\$ref/);
  assert.throws(() => checkSchema({ oneOf: [] }), /oneOf/);
  assert.throws(() => checkSchema({ type: 'object', properties: {} }), /additionalProperties/);
  assert.throws(() => checkSchema({ type: 'object', additionalProperties: false, required: ['x'], properties: {} }), /not a property/);
  assert.doesNotThrow(() => checkSchema({ type: ['string', 'null'] }));
});

// Pins: the ported validate reports each error class a typed reply can hit.
test('validate reports type, enum, required and extra-property errors', () => {
  const schema = {
    type: 'object', additionalProperties: false, required: ['a'],
    properties: { a: { type: 'string', enum: ['x'] }, b: { type: ['string', 'null'] } },
  };
  assert.deepEqual(validate(schema, { a: 'x', b: null }), []);
  assert.match(validate(schema, { a: 1 }).join('\n'), /expected string, got integer/);
  assert.match(validate(schema, { a: 'y' }).join('\n'), /is not one of/);
  assert.match(validate(schema, {}).join('\n'), /missing required 'a'/);
  assert.match(validate(schema, { a: 'x', z: 1 }).join('\n'), /unexpected property 'z'/);
});

// Pins: the port's keyword and type sets equal the host's source (opt-in).
test('keyword and type sets match code-conductor (opt-in via CODE_CONDUCTOR_DIR)', (t) => {
  const dir = process.env.CODE_CONDUCTOR_DIR;
  const file = dir && path.join(dir, 'src', 'mcp', 'jsonSchemaSubset.ts');
  if (!file || !existsSync(file)) return t.skip('CODE_CONDUCTOR_DIR not set');
  const src = readFileSync(file, 'utf8');
  const set = (name) => [...src.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...KEYWORDS].sort(), set('KEYWORDS').sort());
  assert.deepEqual([...TYPES].sort(), set('TYPES').sort());
});
