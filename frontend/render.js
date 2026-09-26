// AST -> DOM. The security boundary for page content: this page runs in an
// unsandboxed iframe on the host's origin, so a script here could drive the
// host API. Nothing from a page ever becomes markup — elements come from the
// fixed tag map below, text only via createTextNode, attributes only from the
// allowlist, and unknown node types are dropped. `doc` is injectable for tests.

export const ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'pre', 'code', 'ul', 'ol', 'li', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'em', 'strong', 'del', 'a', 'span', 'mark', 'br',
]);
const ALLOWED_ATTRS = new Set(['href', 'id', 'class', 'title', 'target', 'rel']);
const DATA_ATTR_RE = /^data-[a-z0-9-]+$/;
const ALIGN = new Set(['left', 'center', 'right']);

// Heading ids are namespaced so page content cannot clobber app element ids.
export const headingId = (slug) => `h-${slug}`;

export function pageHref(source, target) {
  return `#/page/${encodeURIComponent(source)}/${String(target).split('/').map(encodeURIComponent).join('/')}`;
}

function safeExternal(href) {
  try {
    const u = new URL(String(href));
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch {
    return null;
  }
}

export function renderBlocks(blocks, ctx, doc = document) {
  const h = (tag, attrs, children = []) => {
    if (!ALLOWED_TAGS.has(tag)) throw new Error(`tag not allowed: ${tag}`);
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (v == null || !(ALLOWED_ATTRS.has(k) || DATA_ATTR_RE.test(k))) continue;
      el.setAttribute(k, String(v));
    }
    for (const c of children) {
      if (c == null) continue;
      el.append(typeof c === 'string' ? doc.createTextNode(c) : c);
    }
    return el;
  };
  const list = (v) => (Array.isArray(v) ? v : []);
  const text = (v) => doc.createTextNode(String(v ?? ''));

  const link = (n) => {
    const label = inlines(n.c);
    switch (n.kind) {
      case 'page':
        return h('a', { href: pageHref(ctx.source, n.target), class: 'link-page' }, label);
      case 'external': {
        const href = safeExternal(n.href);
        if (!href) return h('span', { class: 'link-inert', title: 'link not followed' }, label);
        return h('a', { href, class: 'link-external', target: '_blank', rel: 'noopener noreferrer' }, label);
      }
      case 'dead':
        return h('span', { class: 'link-dead', title: 'dead link' }, label);
      case 'ambiguous': {
        const cands = [];
        list(n.candidates).forEach((c, i) => {
          if (i > 0) cands.push(', ');
          cands.push(h('a', { href: pageHref(ctx.source, c), class: 'link-page' }, [String(c)]));
        });
        return h('span', { class: 'link-ambiguous', title: 'ambiguous link' }, [
          ...label, ' ', h('span', { class: 'link-candidates' }, ['(', ...cands, ')']),
        ]);
      }
      case 'anchor': {
        const a = h('a', { class: 'link-anchor' }, label);
        const frag = String(n.href ?? '').replace(/^#/, '');
        a.addEventListener('click', (e) => { e.preventDefault(); ctx.onAnchor?.(frag); });
        return a;
      }
      default:
        return h('span', { class: 'link-inert', title: 'link not followed' }, label);
    }
  };

  function inlines(nodes) {
    const out = [];
    for (const n of list(nodes)) {
      if (!n || typeof n !== 'object') continue;
      if (n.t === 'text') out.push(text(n.v));
      else if (n.t === 'code') out.push(h('code', {}, [text(n.v)]));
      else if (n.t === 'em' || n.t === 'strong' || n.t === 'del') out.push(h(n.t, {}, inlines(n.c)));
      else if (n.t === 'link') out.push(link(n));
    }
    return out;
  }

  function block(n, tight) {
    switch (n.t) {
      case 'h': {
        const lv = Number.isInteger(n.level) && n.level >= 1 && n.level <= 6 ? n.level : null;
        return lv ? h(`h${lv}`, { id: headingId(n.id) }, inlines(n.c)) : null;
      }
      case 'p':
        return tight ? inlines(n.c) : h('p', {}, inlines(n.c));
      case 'pre':
        return h('pre', {}, [h('code', { 'data-lang': n.lang || null }, [text(n.text)])]);
      case 'ul':
      case 'ol':
        return h(n.t, {}, list(n.items).map((item) => h('li', {}, blocksOf(item, n.tight === true))));
      case 'quote':
        return h('blockquote', {}, blocksOf(n.c));
      case 'table': {
        const align = list(n.align);
        const cls = (i) => (ALIGN.has(align[i]) ? `align-${align[i]}` : null);
        const row = (cells, tag) => h('tr', {}, list(cells).map((c, i) => h(tag, { class: cls(i) }, inlines(c))));
        return h('table', {}, [h('thead', {}, [row(n.head, 'th')]), h('tbody', {}, list(n.rows).map((r) => row(r, 'td')))]);
      }
      case 'hr':
        return h('hr', {});
      default:
        return null;
    }
  }

  function blocksOf(nodes, tight = false) {
    const out = [];
    for (const n of list(nodes)) {
      if (!n || typeof n !== 'object') continue;
      const r = block(n, tight);
      if (Array.isArray(r)) out.push(...r); else if (r) out.push(r);
    }
    return out;
  }

  return blocksOf(blocks);
}
