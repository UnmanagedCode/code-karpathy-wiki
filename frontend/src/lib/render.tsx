// AST -> React elements. The security boundary for page content: this page
// runs in an unsandboxed iframe on cc's origin, so a script here could drive
// cc's API. Nothing from a page ever becomes markup: elements come from the
// fixed node-type -> tag map below, content only as text children, attributes
// only from the allowlist, and unknown node types are dropped. No `style`
// attribute and no `<style>` element is ever emitted: the CSP allows inline
// styles (Radix and sonner need them), so content-driven CSS would be live.
import { createElement, Fragment, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { safeHref } from './safeHref';
import { isPlainClick, routeHref, type Route } from './route';

export const ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'pre', 'code', 'ul', 'ol', 'li', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'em', 'strong', 'del', 'a', 'span', 'mark', 'br', 'div',
]);
/** React prop names; in the DOM they are href, id, class, title, target, rel. */
export const ALLOWED_ATTRS = new Set(['href', 'id', 'className', 'title', 'target', 'rel']);
export const DATA_ATTR_RE = /^data-[a-z0-9-]+$/;
export const ALIGN = new Set(['left', 'center', 'right']);
/**
 * How deep the renderer recurses (one level per nested block or inline). Content past it is dropped, so a forged
 * AST cannot exhaust the stack. The parser's own output stays far below it: block and inline nesting are each
 * capped at the backend's MAX_NESTING (src/markdown.js).
 */
export const MAX_RENDER_DEPTH = 256;

// Heading ids are namespaced so page content cannot clobber app element ids.
export const headingId = (slug: string): string => `h-${slug}`;

/** The heading slug an in-page `#fragment` names: decoded when it decodes, lowercased. */
export function anchorSlug(href: unknown): string {
  const frag = String(href ?? '').replace(/^#/, '');
  let id = frag;
  try {
    id = decodeURIComponent(frag);
  } catch {
    // keep raw
  }
  return id.toLowerCase();
}

export type RenderCtx = {
  source: string;
  /** A plain click on a page link. Modified clicks are left to the browser. */
  onNavigate?: (r: Route) => void;
  /** A click on an in-page anchor, with the heading slug it names. */
  onAnchor?: (slug: string) => void;
};

type Attrs = Record<string, string | null | undefined>;
type Handlers = { onClick?: (e: MouseEvent<HTMLElement>) => void };
type Node = Record<string, unknown>;

// Handlers are a separate argument written by this file only: nothing from the
// AST reaches them, nor any prop outside ALLOWED_ATTRS / data-*.
function h(tag: string, attrs: Attrs, children: ReactNode[] = [], handlers?: Handlers): ReactElement {
  if (!ALLOWED_TAGS.has(tag)) throw new Error(`tag not allowed: ${tag}`);
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || !(ALLOWED_ATTRS.has(k) || DATA_ATTR_RE.test(k))) continue;
    props[k] = String(v);
  }
  if (handlers?.onClick) props.onClick = handlers.onClick;
  return createElement(tag, props, ...children);
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isNode = (v: unknown): v is Node => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string => String(v ?? '');

export function renderBlocks(blocks: unknown, ctx: RenderCtx): ReactNode[] {
  const pageLink = (target: unknown, label: ReactNode[]) => {
    const to: Route = { view: 'page', source: ctx.source, path: text(target) };
    return h('a', { href: routeHref(to), className: 'link-page' }, label, {
      onClick: (e) => {
        if (!isPlainClick(e)) return;
        e.preventDefault();
        ctx.onNavigate?.(to);
      },
    });
  };

  const link = (n: Node, depth: number): ReactNode => {
    const label = inlines(n.c, depth + 1);
    switch (n.kind) {
      case 'page':
        return pageLink(n.target, label);
      case 'external': {
        const href = safeHref(text(n.href));
        if (!href) return h('span', { className: 'link-inert', title: 'link not followed' }, label);
        return h('a', { href, className: 'link-external', target: '_blank', rel: 'noopener noreferrer' }, label);
      }
      case 'dead':
        return h('span', { className: 'link-dead', title: 'dead link' }, label);
      case 'ambiguous': {
        const cands: ReactNode[] = [];
        list(n.candidates).forEach((c, i) => {
          if (i > 0) cands.push(', ');
          cands.push(pageLink(c, [text(c)]));
        });
        return h('span', { className: 'link-ambiguous', title: 'ambiguous link' }, [
          ...label, ' ', h('span', { className: 'link-candidates' }, ['(', ...cands, ')']),
        ]);
      }
      case 'anchor': {
        const slug = anchorSlug(n.href);
        return h('a', { href: `#${encodeURIComponent(headingId(slug))}`, className: 'link-anchor' }, label, {
          onClick: (e) => {
            e.preventDefault();
            ctx.onAnchor?.(slug);
          },
        });
      }
      default:
        return h('span', { className: 'link-inert', title: 'link not followed' }, label);
    }
  };

  function inlines(nodes: unknown, depth: number): ReactNode[] {
    const out: ReactNode[] = [];
    if (depth > MAX_RENDER_DEPTH) return out;
    for (const n of list(nodes)) {
      if (!isNode(n)) continue;
      if (n.t === 'text') out.push(text(n.v));
      else if (n.t === 'code') out.push(h('code', {}, [text(n.v)]));
      else if (n.t === 'em' || n.t === 'strong' || n.t === 'del') out.push(h(n.t, {}, inlines(n.c, depth + 1)));
      else if (n.t === 'link') out.push(link(n, depth));
    }
    return out;
  }

  function block(n: Node, tight: boolean, depth: number): ReactNode | ReactNode[] {
    const inl = (v: unknown) => inlines(v, depth + 1);
    switch (n.t) {
      case 'h': {
        const lv = Number.isInteger(n.level) && (n.level as number) >= 1 && (n.level as number) <= 6 ? (n.level as number) : null;
        return lv ? h(`h${lv}`, { id: headingId(text(n.id)) }, inl(n.c)) : null;
      }
      case 'p':
        return tight ? inl(n.c) : h('p', {}, inl(n.c));
      case 'pre':
        return h('pre', {}, [h('code', { 'data-lang': n.lang ? text(n.lang) : null }, [text(n.text)])]);
      case 'ul':
      case 'ol':
        return h(n.t, {}, list(n.items).map((item) => h('li', {}, blocksOf(item, n.tight === true, depth + 1))));
      case 'quote':
        return h('blockquote', {}, blocksOf(n.c, false, depth + 1));
      case 'table': {
        const align = list(n.align);
        const cls = (i: number) => (ALIGN.has(align[i] as string) ? `align-${align[i]}` : null);
        const row = (cells: unknown, tag: 'th' | 'td') => h('tr', {}, list(cells).map((c, i) => h(tag, { className: cls(i) }, inl(c))));
        // The wrapper scrolls a wide table inside itself, so the page never overflows sideways.
        return h('div', { className: 'table-wrap' }, [
          h('table', {}, [h('thead', {}, [row(n.head, 'th')]), h('tbody', {}, list(n.rows).map((r) => row(r, 'td')))]),
        ]);
      }
      case 'hr':
        return h('hr', {});
      default:
        return null;
    }
  }

  function blocksOf(nodes: unknown, tight: boolean, depth: number): ReactNode[] {
    const out: ReactNode[] = [];
    if (depth > MAX_RENDER_DEPTH) return out;
    for (const n of list(nodes)) {
      if (!isNode(n)) continue;
      const r = block(n, tight, depth);
      if (Array.isArray(r)) out.push(...r);
      else if (r) out.push(r);
    }
    return out;
  }

  return blocksOf(blocks, false, 0);
}

/** A page body. Wrap it in `.wiki-md` for its styles. */
export function WikiContent({ blocks, ctx }: { blocks: unknown; ctx: RenderCtx }) {
  return createElement(Fragment, null, ...renderBlocks(blocks, ctx));
}
