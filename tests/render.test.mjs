import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBlocks, ALLOWED_TAGS } from '../frontend/render.js';
import { fakeDoc, allElements } from './_fakedom.mjs';

const ctx = { source: 'orchestrator', onAnchor: () => {} };
const render = (blocks) => renderBlocks(blocks, ctx, fakeDoc);
const txt = (v) => ({ t: 'text', v });
const p = (...c) => ({ t: 'p', c });
const link = (props, label = 'L') => ({ t: 'link', form: 'md', raw: '', line: 1, c: [txt(label)], ...props });

const SAMPLE = [
  { t: 'h', level: 2, id: 'sec', c: [txt('Sec')] },
  p(txt('a '), { t: 'strong', c: [txt('b')] }, { t: 'em', c: [txt('c')] }, { t: 'del', c: [txt('d')] }, { t: 'code', v: 'e' }),
  { t: 'pre', lang: 'js', text: 'x < y' },
  { t: 'ul', tight: true, items: [[p(txt('i1'))], [p(txt('i2')), { t: 'ol', start: 1, tight: true, items: [[p(txt('n'))]] }]] },
  { t: 'quote', c: [p(txt('q'))] },
  { t: 'table', align: ['left', null], head: [[txt('h1')], [txt('h2')]], rows: [[[txt('c1')], [txt('c2')]]] },
  { t: 'hr' },
  p(
    link({ kind: 'page', target: 'global/a b.md' }),
    link({ kind: 'external', href: 'https://e.example/x' }),
    link({ kind: 'dead' }),
    link({ kind: 'ambiguous', candidates: ['global/x.md', 'projects/p/x.md'] }),
    link({ kind: 'outside' }),
    link({ kind: 'blocked', href: 'javascript:alert(1)' }),
    link({ kind: 'anchor', href: '#sec' }),
  ),
];

// Invariant: the renderer only emits allowlisted tags, never on* attributes, and only #/ or http(s) hrefs.
test('render: allowlisted tags, safe attributes, safe hrefs', () => {
  const els = allElements(render(SAMPLE));
  assert.ok(els.length > 20);
  for (const el of els) {
    assert.ok(ALLOWED_TAGS.has(el.tagName.toLowerCase()), `tag ${el.tagName}`);
    for (const [k] of el.attributes) {
      assert.equal(k.toLowerCase().startsWith('on'), false, `attr ${k}`);
      assert.ok(['href', 'id', 'class', 'title', 'target', 'rel'].includes(k) || k.startsWith('data-'), `attr ${k}`);
    }
    const href = el.getAttribute('href');
    if (href !== null) assert.ok(href.startsWith('#/') || /^https?:\/\//.test(href), `href ${href}`);
  }
});

// Invariant: each link kind maps to its element and class.
test('render: link kinds', () => {
  const [para] = render([SAMPLE[7]]);
  const kids = para.childNodes;
  assert.equal(kids[0].tagName, 'A');
  assert.equal(kids[0].getAttribute('href'), '#/page/orchestrator/global/a%20b.md');
  assert.equal(kids[1].getAttribute('href'), 'https://e.example/x');
  assert.equal(kids[1].getAttribute('target'), '_blank');
  assert.equal(kids[1].getAttribute('rel'), 'noopener noreferrer');
  assert.equal(kids[2].tagName, 'SPAN');
  assert.equal(kids[2].getAttribute('class'), 'link-dead');
  assert.equal(kids[3].getAttribute('class'), 'link-ambiguous');
  const cands = allElements([kids[3]]).filter((e) => e.tagName === 'A').map((a) => a.getAttribute('href'));
  assert.deepEqual(cands, ['#/page/orchestrator/global/x.md', '#/page/orchestrator/projects/p/x.md']);
  assert.equal(kids[4].getAttribute('class'), 'link-inert');
  assert.equal(kids[5].getAttribute('class'), 'link-inert');
  assert.equal(kids[5].getAttribute('href'), null);
  assert.equal(kids[6].tagName, 'A');
  assert.equal(kids[6].getAttribute('href'), null, 'anchor links scroll without changing the hash');
  assert.equal(kids[6].listeners.click.length, 1);
});

// Invariant: a forged AST cannot produce script elements or javascript: hrefs.
test('render: forged AST nodes are dropped or inert', () => {
  const out = render([
    { t: 'script', c: [txt('alert(1)')] },
    { t: 'h', level: 'script', id: 'x', c: [txt('h')] },
    p(
      { t: 'img', src: 'x' },
      link({ kind: 'external', href: 'javascript:alert(1)' }),
      link({ kind: 'external', href: ' javascript:alert(1)' }),
      link({ kind: 'page', target: '../../x' }),
      link({ kind: 'weird', href: 'javascript:x' }),
    ),
  ]);
  const els = allElements(out);
  assert.equal(els.some((e) => e.tagName === 'SCRIPT' || e.tagName === 'IMG'), false);
  for (const el of els) {
    assert.ok(ALLOWED_TAGS.has(el.tagName.toLowerCase()));
    const href = el.getAttribute('href');
    if (href !== null) assert.ok(href.startsWith('#/'), `href ${href}`);
  }
  const para = out.find((e) => e.tagName === 'P');
  assert.equal(para.childNodes[0].getAttribute('class'), 'link-inert');
  assert.equal(para.childNodes[2].getAttribute('href'), '#/page/orchestrator/../../x');
});

// Invariant: markup-looking text stays one text node.
test('render: HTML in text stays text', () => {
  const [para] = render([p(txt('<img src=x onerror=alert(1)>'))]);
  assert.equal(para.childNodes.length, 1);
  assert.equal(para.childNodes[0].nodeType, 3);
  assert.equal(para.textContent, '<img src=x onerror=alert(1)>');
});

// Invariant: heading ids are prefixed so page content cannot clobber app element ids.
test('render: heading ids are namespaced', () => {
  const [h] = render([{ t: 'h', level: 2, id: 'sidebar', c: [txt('x')] }]);
  assert.equal(h.tagName, 'H2');
  assert.equal(h.getAttribute('id'), 'h-sidebar');
});
