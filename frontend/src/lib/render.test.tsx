import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ALLOWED_TAGS, WikiContent, type RenderCtx } from './render';

const txt = (v: string) => ({ t: 'text', v });
const p = (...c: unknown[]) => ({ t: 'p', c });
const link = (props: Record<string, unknown>, label = 'L') => ({ t: 'link', form: 'md', raw: '', line: 1, c: [txt(label)], ...props });

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

// Forged nodes carrying every field a style or markup could be smuggled through.
const FORGED = [
  { t: 'script', c: [txt('alert(1)')] },
  { t: 'style', c: [txt('body{display:none}')], v: 'body{display:none}' },
  { t: 'html', v: '<style>*{}</style><img src=x onerror=alert(1)>' },
  { t: 'h', level: 'script', id: 'x', c: [txt('h')] },
  { t: 'h', level: 7, id: 'x', c: [txt('h')] },
  { t: 'p', style: 'color:red', attrs: { style: 'color:red', onclick: 'alert(1)' }, dangerouslySetInnerHTML: { __html: '<img src=x>' }, c: [txt('styled?')] },
  { t: 'pre', lang: '" style="x', text: 'code', style: 'x' },
  { t: 'table', align: ['left;color:red', 'center'], head: [[{ t: 'style', v: 'x' }]], rows: [[[{ t: 'html', v: '<b>' }]]], style: 'x' },
  p(
    { t: 'img', src: 'x' },
    { t: 'text', v: 'ok', style: 'x', dangerouslySetInnerHTML: { __html: '<img src=x>' } },
    { t: 'em', c: [txt('e')], style: 'x', attrs: { style: 'x' } },
    link({ kind: 'external', href: 'javascript:alert(1)' }),
    link({ kind: 'external', href: ' javascript:alert(1)' }),
    link({ kind: 'page', target: '../../x', style: 'x' }),
    link({ kind: 'weird', href: 'javascript:x' }),
    link({ kind: 'anchor', href: '#a" onclick="x', style: 'x' }),
  ),
  { t: 'ul', items: 'not-an-array' },
  { t: 'quote', c: { not: 'array' } },
  null,
  'string',
  7,
];

function renderBlocks(blocks: unknown, ctx: Partial<RenderCtx> = {}) {
  return render(
    <article>
      <WikiContent blocks={blocks} ctx={{ source: 'orchestrator', ...ctx }} />
    </article>,
  ).container.firstElementChild as HTMLElement;
}

const DOM_ATTRS = new Set(['href', 'id', 'class', 'title', 'target', 'rel']);
const SAFE_HREF = /^\?view=page&|^https?:\/\/|^#h-/;

function assertSafe(root: HTMLElement) {
  for (const el of root.querySelectorAll('*')) {
    expect(ALLOWED_TAGS.has(el.tagName.toLowerCase()), `tag ${el.tagName}`).toBe(true);
    for (const { name } of Array.from(el.attributes)) {
      expect(name.toLowerCase().startsWith('on'), `attr ${name}`).toBe(false);
      expect(DOM_ATTRS.has(name) || /^data-[a-z0-9-]+$/.test(name), `attr ${name}`).toBe(true);
    }
    const href = el.getAttribute('href');
    if (href !== null) expect(href, `href ${href}`).toMatch(SAFE_HREF);
  }
}

describe('WikiContent', () => {
  // Invariant: only allowlisted tags and attributes, never on*, and only internal, http(s) or #h- hrefs.
  it('emits allowlisted tags, safe attributes and safe hrefs', () => {
    const root = renderBlocks(SAMPLE);
    expect(root.querySelectorAll('*').length).toBeGreaterThan(20);
    assertSafe(root);
  });

  // Invariant: each link kind maps to its element, class and href.
  it('renders each link kind', () => {
    const para = renderBlocks([SAMPLE[7]]).querySelector('p')!;
    const kids = para.children;
    expect(kids[0].tagName).toBe('A');
    expect(kids[0].getAttribute('href')).toBe('?view=page&source=orchestrator&path=global%2Fa+b.md');
    expect(kids[0].className).toBe('link-page');
    expect(kids[1].getAttribute('href')).toBe('https://e.example/x');
    expect(kids[1].getAttribute('target')).toBe('_blank');
    expect(kids[1].getAttribute('rel')).toBe('noopener noreferrer');
    expect(kids[2].tagName).toBe('SPAN');
    expect(kids[2].className).toBe('link-dead');
    expect(kids[3].className).toBe('link-ambiguous');
    expect(Array.from(kids[3].querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([
      '?view=page&source=orchestrator&path=global%2Fx.md',
      '?view=page&source=orchestrator&path=projects%2Fp%2Fx.md',
    ]);
    expect(kids[4].className).toBe('link-inert');
    expect(kids[5].className).toBe('link-inert');
    expect(kids[5].getAttribute('href')).toBeNull();
    expect(kids[6].tagName).toBe('A');
    expect(kids[6].getAttribute('href')).toBe('#h-sec');
  });

  // Invariant: a forged AST yields no script, style, img or iframe element, no style attribute, and no unsafe href.
  it('drops or neutralises forged nodes, and never emits a style attribute or element', () => {
    for (const blocks of [SAMPLE, FORGED]) {
      const root = renderBlocks(blocks);
      assertSafe(root);
      expect(root.querySelector('style, script, img, iframe')).toBeNull();
      expect(root.querySelector('[style]')).toBeNull();
    }
    const root = renderBlocks(FORGED);
    expect(root.querySelector('h7')).toBeNull();
    expect(root.textContent).toContain('styled?');
    expect(root.textContent).not.toContain('body{display:none}');
    const para = Array.from(root.querySelectorAll('p')).at(-1)!;
    expect(para.querySelector('a.link-external')).toBeNull();
    expect(para.querySelectorAll('span.link-inert').length).toBe(3);
    expect(para.querySelector('a.link-page')!.getAttribute('href')).toBe('?view=page&source=orchestrator&path=..%2F..%2Fx');
    expect(para.querySelector('a.link-anchor')!.getAttribute('href')).toBe(`#${encodeURIComponent('h-a" onclick="x')}`);
  });

  // Invariant: markup-looking text stays one text node.
  it('keeps HTML in text as text', () => {
    const para = renderBlocks([p(txt('<img src=x onerror=alert(1)>'))]).querySelector('p')!;
    expect(para.childNodes.length).toBe(1);
    expect(para.childNodes[0].nodeType).toBe(3);
    expect(para.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  // Invariant: heading ids are prefixed so page content cannot clobber app element ids.
  it('namespaces heading ids', () => {
    const h = renderBlocks([{ t: 'h', level: 2, id: 'sidebar', c: [txt('x')] }]).querySelector('h2')!;
    expect(h.id).toBe('h-sidebar');
  });

  // Invariant: a table scrolls inside its own wrapper, so the page never overflows sideways.
  it('wraps tables in a scroll container', () => {
    const root = renderBlocks([SAMPLE[5]]);
    expect(root.querySelector('div.table-wrap > table')).not.toBeNull();
    expect(root.querySelector('th')!.className).toBe('align-left');
    expect(root.querySelectorAll('th')[1].hasAttribute('class')).toBe(false);
  });

  // Invariant: an anchor scrolls in place: the hash never changes, onAnchor gets the decoded, lowercased slug.
  it('handles an anchor click without touching the hash', () => {
    const onAnchor = vi.fn();
    const before = location.hash;
    const a = renderBlocks([p(link({ kind: 'anchor', href: '#S%65c' }))], { onAnchor }).querySelector('a')!;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onAnchor).toHaveBeenCalledWith('sec');
    expect(location.hash).toBe(before);
  });

  // Invariant: a plain click on a page link navigates in-app; a modified click is left to the browser.
  it('intercepts only a plain primary click on a page link', () => {
    const onNavigate = vi.fn();
    const a = renderBlocks([p(link({ kind: 'page', target: 'global/a.md' }))], { onNavigate }).querySelector('a')!;
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(onNavigate).toHaveBeenCalledWith({ view: 'page', source: 'orchestrator', path: 'global/a.md' });
    onNavigate.mockClear();
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...mod });
      fireEvent(a, ev);
      expect(ev.defaultPrevented, JSON.stringify(mod)).toBe(false);
    }
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
