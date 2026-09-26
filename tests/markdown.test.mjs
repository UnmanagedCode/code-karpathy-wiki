import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/markdown.js';

// Every node in an AST, blocks and inlines alike.
function nodes(blocks) {
  const out = [];
  const visit = (n) => {
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (!n || typeof n !== 'object') return;
    out.push(n);
    for (const k of ['c', 'items', 'head', 'rows']) if (n[k]) visit(n[k]);
  };
  visit(blocks);
  return out;
}
const linkNodes = (blocks) => nodes(blocks).filter((n) => n.t === 'link');
const texts = (blocks) => nodes(blocks).filter((n) => n.t === 'text').map((n) => n.v).join('');

// Invariant: the block shapes the renderer depends on.
test('blocks: headings with unique slug ids, paragraphs, hr', () => {
  const { blocks } = parse('# Hello World\n\ntext here\n\n## Hello World\n\n---\n\n### Trailing ###\n');
  assert.deepEqual(blocks.map((b) => b.t), ['h', 'p', 'h', 'hr', 'h']);
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[0].id, 'hello-world');
  assert.equal(blocks[2].id, 'hello-world-1', 'duplicate headings get distinct ids');
  assert.equal(texts([blocks[4]]), 'Trailing', 'closing #s stripped');
});

// Invariant: list nesting follows indentation.
test('blocks: nested lists and ordered start', () => {
  const { blocks } = parse('- a\n  - a1\n  - a2\n- b\n\n3. x\n4. y\n');
  assert.equal(blocks[0].t, 'ul');
  assert.equal(blocks[0].items.length, 2);
  const inner = blocks[0].items[0].find((b) => b.t === 'ul');
  assert.ok(inner, 'nested list inside first item');
  assert.equal(inner.items.length, 2);
  assert.equal(blocks[1].t, 'ol');
  assert.equal(blocks[1].start, 3);
  assert.equal(blocks[1].items.length, 2);
});

// Invariant: GFM tables parse with alignment, and `\|` stays inside a cell.
test('blocks: table with alignment', () => {
  const { blocks } = parse('| a | b | c |\n|:--|:-:|--:|\n| 1 | `x\\|y` | 3 |\n');
  const t = blocks[0];
  assert.equal(t.t, 'table');
  assert.deepEqual(t.align, ['left', 'center', 'right']);
  assert.equal(t.head.length, 3);
  assert.equal(t.rows.length, 1);
  assert.equal(t.rows[0].length, 3);
  assert.equal(t.rows[0][1][0].t, 'code');
  assert.equal(t.rows[0][1][0].v, 'x|y');
});

// Invariant: both fence styles; a close needs the same char and >= length.
test('blocks: backtick and tilde fences keep content verbatim', () => {
  const { blocks } = parse('```js\nlet a = 1;\n``\n```\n\n~~~~\nx\n~~~\n~~~~\n');
  assert.equal(blocks[0].t, 'pre');
  assert.equal(blocks[0].lang, 'js');
  assert.equal(blocks[0].text, 'let a = 1;\n``');
  assert.equal(blocks[1].t, 'pre');
  assert.equal(blocks[1].text, 'x\n~~~');
});

// Invariant: an unclosed fence runs to EOF, so nothing after it becomes a link.
test('blocks: unclosed fence runs to EOF', () => {
  const { blocks, links } = parse('```\n[[a]]\n\n# not a heading\n');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].t, 'pre');
  assert.equal(links.length, 0);
});

// Invariant: blockquotes nest blocks.
test('blocks: blockquote contains blocks', () => {
  const { blocks } = parse('> para [[x]]\n> - item\n');
  assert.equal(blocks[0].t, 'quote');
  assert.deepEqual(blocks[0].c.map((b) => b.t), ['p', 'ul']);
});

// Invariant: code spans and fences never yield link nodes (the lint
// false-positive guard and the page-syntax-example guard).
test('no link nodes inside code spans or fences', () => {
  const src = [
    'Write `[[name]]` to link, and ``a ` [[x]]`` too.',
    '',
    '```',
    '[[link]] and [x](y.md)',
    '```',
    '',
    '~~~',
    '[[link]]',
    '~~~',
    '',
    '- `[[also]]` in a list',
  ].join('\n');
  const { blocks, links } = parse(src);
  assert.equal(links.length, 0);
  assert.equal(linkNodes(blocks).length, 0);
});

// Invariant: raw HTML is never markup — shown as literal text; comments dropped.
test('raw HTML stays literal text; HTML comments are removed', () => {
  const { blocks } = parse('<script>alert(1)</script>\n\ngit checkout <branch> <!-- c --> done\n\n<!--\nblock comment\n-->\n\n<details>x</details>\n');
  const all = texts(blocks);
  assert.ok(all.includes('<script>alert(1)</script>'));
  assert.ok(all.includes('git checkout <branch>'));
  assert.ok(all.includes('done'));
  assert.ok(all.includes('<details>x</details>'));
  assert.equal(all.includes('block comment'), false);
  assert.equal(all.includes(' c '), false);
  for (const n of nodes(blocks)) assert.ok(['p', 'text'].includes(n.t), `only p/text, got ${n.t}`);
});

// Invariant: front matter is parsed as data and not rendered as body.
test('front matter parsed, not in body', () => {
  const { frontmatter, blocks, title } = parse('---\ndescription: a b\nconfidence: high\nupdated: "2026-09-02"\n---\n\n# Title Here\n\nbody\n');
  assert.deepEqual(frontmatter, { description: 'a b', confidence: 'high', updated: '2026-09-02' });
  assert.equal(blocks[0].t, 'h');
  assert.equal(title, 'Title Here');
  assert.equal(texts(blocks).includes('confidence'), false);
});

// Invariant: title falls back to the supplied basename.
test('title falls back when there is no h1', () => {
  assert.equal(parse('## two\n', 'fallback').title, 'fallback');
});

// Invariant: images become md link nodes (alt as label) — there is no image node.
test('image becomes a link node, never an image node', () => {
  const { blocks, links } = parse('![the alt](x.png)\n');
  assert.equal(links.length, 1);
  assert.equal(links[0].form, 'md');
  assert.equal(links[0].href, 'x.png');
  assert.equal(texts(links[0].c), 'the alt');
  assert.equal(nodes(blocks).some((n) => n.t === 'img' || n.t === 'image'), false);
});

// Invariant: link node fields — wiki ref/label/fragment, md href/title, autolink, line.
test('link forms carry ref, label, href and line', () => {
  const { links } = parse('first line\n\n[[a|label]] and [[b#frag]]\n[t](dir/x.md "tt") <https://e.example/p>\n');
  assert.equal(links.length, 4);
  const [a, b, m, auto] = links;
  assert.equal(a.form, 'wiki');
  assert.equal(a.ref, 'a|label');
  assert.equal(texts(a.c), 'label');
  assert.equal(a.line, 3);
  assert.equal(b.ref, 'b#frag');
  assert.equal(texts(b.c), 'b#frag');
  assert.equal(m.form, 'md');
  assert.equal(m.href, 'dir/x.md');
  assert.equal(m.title, 'tt');
  assert.equal(m.line, 4);
  assert.equal(auto.form, 'auto');
  assert.equal(auto.href, 'https://e.example/p');
  assert.equal(a.raw, '[[a|label]]');
});

// Invariant: link line numbers count front matter and list/table positions.
test('link line numbers are file lines', () => {
  const { links } = parse('---\na: b\n---\n\n- x\n- [[y]]\n\n| h |\n|---|\n| [[z]] |\n');
  assert.deepEqual(links.map((l) => l.line), [6, 10]);
});

// Invariant: inline emphasis kinds; intraword underscores are not emphasis.
test('inlines: strong, em, del, escapes, snake_case untouched', () => {
  const { blocks } = parse('**b** *i* _j_ ~~d~~ \\*lit\\* snake_case_name\n');
  const kinds = nodes(blocks).map((n) => n.t);
  assert.ok(kinds.includes('strong'));
  assert.equal(kinds.filter((k) => k === 'em').length, 2);
  assert.ok(kinds.includes('del'));
  const all = texts(blocks);
  assert.ok(all.includes('*lit*'));
  assert.ok(all.includes('snake_case_name'));
});

// Invariant: link destinations are never entity-decoded.
test('entities are not decoded in link destinations', () => {
  const { links } = parse('[x](&#106;avascript:alert(1))\n');
  assert.equal(links[0].href.startsWith('&#106;'), true);
});
