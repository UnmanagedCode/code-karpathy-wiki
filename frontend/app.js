// Wiki browser shell. Served under the host's /plugins/code-wiki/ prefix, so
// every URL here is relative with no leading slash. Routing lives in the hash
// (#/page/<source>/<path>, #/health/<source>, #/search?q=), which works the
// same standalone and under the prefix. No HTML strings: DOM is built with el().
import { renderBlocks, pageHref, headingId } from './render.js';

const DEFAULT_ROUTE = '#/page/orchestrator/index.md';
const sidebar = document.getElementById('sidebar');
const main = document.getElementById('main');
const state = { sources: [], dirEls: [] };

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

async function api(path) {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { code: body.code, status: res.status });
  return body;
}

const enc = encodeURIComponent;
const labelOf = (id) => state.sources.find((s) => s.id === id)?.label ?? id;
const healthHref = (source) => `#/health/${enc(source)}`;

function showError(e) {
  main.replaceChildren(el('div', { class: 'error' }, [
    el('h1', {}, [e.status === 404 ? 'Not found' : 'Error']),
    el('p', {}, [e.message]),
    e.code ? el('p', { class: 'muted' }, [e.code]) : null,
  ]));
}

// ---- sidebar ----------------------------------------------------------------

function treeDir(source, node, depth) {
  const label = node.index
    ? el('a', { href: pageHref(source, node.index), 'data-page': `${source}|${node.index}` }, [node.name])
    : el('span', { class: 'dir-name' }, [node.name]);
  const children = el('ul', {}, [
    ...node.dirs.map((d) => el('li', {}, [treeDir(source, d, depth + 1)])),
    ...node.pages.map((p) => el('li', {}, [
      el('a', { href: pageHref(source, p.path), title: p.title, 'data-page': `${source}|${p.path}` }, [p.name]),
    ])),
  ]);
  // Archived dirs start collapsed; top-level dirs start open.
  const details = el('details', {
    class: node.archived ? 'archived' : null,
    open: depth === 1 && !node.archived,
    'data-dir': `${source}|${node.path}`,
  }, [
    el('summary', {}, [label, node.archived && !node.path.startsWith('global/archive/')
      ? el('span', { class: 'badge' }, ['archive — not in recall path']) : null]),
    children,
  ]);
  state.dirEls.push(details);
  return details;
}

function sourceSection(source, tree, error) {
  const head = el('div', { class: 'source-head' }, [
    tree?.index ? el('a', { href: pageHref(source.id, tree.index), class: 'source-label', 'data-page': `${source.id}|${tree.index}` }, [source.label])
      : el('span', { class: 'source-label' }, [source.label]),
    el('a', { href: healthHref(source.id), class: 'health-link' }, ['Health']),
  ]);
  let body;
  if (error) body = el('p', { class: 'muted' }, [error.message]);
  else if (!tree.dirs.length && !tree.pages.length) body = el('p', { class: 'muted' }, [tree.index ? '' : 'No pages yet.']);
  else {
    body = el('ul', { class: 'tree' }, [
      ...tree.dirs.map((d) => el('li', {}, [treeDir(source.id, d, 1)])),
      ...tree.pages.map((p) => el('li', {}, [el('a', { href: pageHref(source.id, p.path), 'data-page': `${source.id}|${p.path}` }, [p.name])])),
    ]);
  }
  return el('section', { class: 'source', 'data-kind': source.kind }, [head, body]);
}

function searchBox() {
  const input = el('input', { type: 'search', placeholder: 'Search all wikis…', 'aria-label': 'Search' });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = input.value.trim();
    if (q.length >= 2) location.hash = `#/search?q=${enc(q)}`;
  });
  return input;
}

async function loadSidebar() {
  state.dirEls = [];
  sidebar.replaceChildren(el('p', { class: 'muted' }, ['Loading…']));
  try {
    state.sources = (await api('api/sources')).sources;
  } catch (e) {
    sidebar.replaceChildren(el('p', { class: 'error' }, [e.message]));
    return;
  }
  const trees = await Promise.all(state.sources.map((s) => api(`api/tree?source=${enc(s.id)}`)
    .then((r) => ({ tree: r.tree }), (error) => ({ error }))));
  const refresh = el('button', { type: 'button', class: 'refresh', title: 'Reload the trees' }, ['↻']);
  refresh.addEventListener('click', () => { loadSidebar().then(route); });
  sidebar.replaceChildren(
    el('div', { class: 'side-top' }, [searchBox(), refresh]),
    ...state.sources.map((s, i) => sourceSection(s, trees[i].tree, trees[i].error)),
    el('p', { class: 'muted foot' }, ['Read-only. Pages are re-read on each view; ↻ reloads the trees.']),
  );
}

function markActive(source, rel) {
  const key = `${source}|${rel}`;
  for (const a of sidebar.querySelectorAll('a.active')) a.classList.remove('active');
  for (const a of sidebar.querySelectorAll('a[data-page]')) {
    if (a.getAttribute('data-page') === key) a.classList.add('active');
  }
  for (const d of state.dirEls) {
    const [s, p] = d.getAttribute('data-dir').split('|');
    if (s === source && (rel === `${p}/index.md` || rel.startsWith(`${p}/`))) d.open = true;
  }
}

// ---- views ------------------------------------------------------------------

function scrollToAnchor(frag) {
  let id = frag;
  try { id = decodeURIComponent(frag); } catch { /* keep raw */ }
  document.getElementById(headingId(id.toLowerCase()))?.scrollIntoView();
}

async function showPage(source, rel) {
  main.replaceChildren(el('p', { class: 'muted' }, ['Loading…']));
  let d;
  try {
    d = await api(`api/page?source=${enc(source)}&path=${enc(rel)}`);
  } catch (e) {
    showError(e);
    return;
  }
  const segs = rel.split('/');
  const crumbs = [el('a', { href: pageHref(source, 'index.md') }, [labelOf(source)])];
  segs.forEach((s) => crumbs.push(el('span', { class: 'sep' }, [' / ']), s));
  const fm = d.frontmatter ?? {};
  const chips = el('div', { class: 'chips' }, [
    fm.confidence ? el('span', { class: d.lowConfidence ? 'chip warn' : 'chip' }, [`confidence: ${fm.confidence}`]) : null,
    fm.updated ? el('span', { class: 'chip' }, [`updated: ${fm.updated}`]) : null,
    d.stale ? el('span', { class: 'chip warn' }, ['stale']) : null,
  ]);
  main.replaceChildren(
    el('nav', { class: 'crumbs' }, crumbs),
    chips,
    d.archived ? el('div', { class: 'banner archived' }, ['Archived page — retired or superseded, not in the recall path.']) : null,
    d.truncated ? el('div', { class: 'banner' }, ['This page is larger than the display cap and has been cut short.']) : null,
    el('article', { class: 'md' }, renderBlocks(d.blocks, { source, onAnchor: scrollToAnchor })),
    el('section', { class: 'backlinks' }, [
      el('h2', {}, [`Backlinks (${d.backlinks.length})`]),
      d.backlinks.length
        ? el('ul', {}, d.backlinks.map((b) => el('li', {}, [el('a', { href: pageHref(source, b.path) }, [b.title]), ' ', el('span', { class: 'muted' }, [b.path])])))
        : el('p', { class: 'muted' }, ['No page links here.']),
    ]),
  );
  document.title = `${d.title} — Wiki`;
  main.scrollTop = 0;
  markActive(source, rel);
}

const HEALTH_SECTIONS = [
  ['deadLinks', 'Dead links', 'Links that resolve to no page.',
    (source, x) => [el('a', { href: pageHref(source, x.from) }, [x.from]), ` line ${x.line}: `, el('code', {}, [x.raw])]],
  ['ambiguousLinks', 'Ambiguous links', 'Links with more than one candidate page.',
    (source, x) => [el('a', { href: pageHref(source, x.from) }, [x.from]), ` line ${x.line}: `, el('code', {}, [x.raw]), ' → ',
      ...x.candidates.flatMap((c, i) => [i ? ', ' : '', el('a', { href: pageHref(source, c) }, [c])])]],
  ['orphans', 'Orphans', 'Pages not linked from their nearest index.',
    (source, x) => [el('a', { href: pageHref(source, x.path) }, [x.path]), ' ',
      el('span', { class: 'muted' }, [x.index ? `not in ${x.index}` : 'no index above it'])]],
  ['unreachableIndexes', 'Unreachable indexes', 'Indexes not reachable from the root index through index pages.',
    (source, x) => [el('a', { href: pageHref(source, x.path) }, [x.path])]],
  ['lowConfidence', 'Low confidence', 'Front matter confidence starts with "low".',
    (source, x) => [el('a', { href: pageHref(source, x.path) }, [x.path]), ' ', el('span', { class: 'muted' }, [x.confidence])]],
  ['stale', 'Stale', 'Front matter updated is old or unparseable.',
    (source, x) => [el('a', { href: pageHref(source, x.path) }, [x.path]), ' ',
      el('span', { class: 'muted' }, [x.ageDays == null ? `updated "${x.updated}" is not a date` : `${x.updated} (${x.ageDays} days)`])]],
];

async function showHealth(source) {
  main.replaceChildren(el('p', { class: 'muted' }, ['Checking…']));
  let d;
  try {
    d = await api(`api/lint?source=${enc(source)}`);
  } catch (e) {
    showError(e);
    return;
  }
  const counts = el('ul', { class: 'counts' }, HEALTH_SECTIONS.map(([k, title]) => el('li', { class: d.counts[k] ? 'bad' : 'good' }, [
    el('a', { href: `#${k}` }, [`${title}: ${d.counts[k]}`]),
  ])));
  for (const a of counts.querySelectorAll('a')) {
    a.addEventListener('click', (e) => { e.preventDefault(); document.getElementById(`sec-${a.getAttribute('href').slice(1)}`)?.scrollIntoView(); });
  }
  main.replaceChildren(
    el('h1', {}, [`Health — ${labelOf(source)}`]),
    el('p', { class: 'muted' }, [d.rootIndex ? `Root index: ${d.rootIndex}. ` : 'No root index.md. ', `Stale after ${d.staleAfterDays} days.`]),
    counts,
    ...HEALTH_SECTIONS.map(([k, title, blurb, item]) => el('section', { id: `sec-${k}`, class: 'health' }, [
      el('h2', {}, [`${title} (${d[k].length})`]),
      el('p', { class: 'muted' }, [blurb]),
      d[k].length ? el('ul', {}, d[k].map((x) => el('li', { class: x.archived ? 'archived' : null }, item(source, x)))) : el('p', { class: 'muted' }, ['None.']),
    ])),
  );
  document.title = `Health — ${labelOf(source)} — Wiki`;
  main.scrollTop = 0;
  markActive(source, '');
}

function highlight(text, terms) {
  const lower = text.toLowerCase();
  const out = [];
  let i = 0;
  while (i < text.length) {
    let at = -1;
    let len = 0;
    for (const t of terms) {
      const j = lower.indexOf(t, i);
      if (j >= 0 && (at < 0 || j < at)) { at = j; len = t.length; }
    }
    if (at < 0) { out.push(text.slice(i)); break; }
    if (at > i) out.push(text.slice(i, at));
    out.push(el('mark', {}, [text.slice(at, at + len)]));
    i = at + len;
  }
  return out;
}

async function showSearch(q) {
  const input = sidebar.querySelector('input[type=search]');
  if (input) input.value = q;
  main.replaceChildren(el('p', { class: 'muted' }, ['Searching…']));
  let d;
  try {
    d = await api(`api/search?q=${enc(q)}`);
  } catch (e) {
    showError(e);
    return;
  }
  const terms = [...new Set(q.trim().toLowerCase().split(/\s+/))];
  const groups = new Map();
  for (const r of d.results) {
    if (!groups.has(r.source)) groups.set(r.source, { label: r.sourceLabel, items: [] });
    groups.get(r.source).items.push(r);
  }
  main.replaceChildren(
    el('h1', {}, [`Search: ${d.q}`]),
    el('p', { class: 'muted' }, [`${d.results.length}${d.truncated ? '+' : ''} result${d.results.length === 1 ? '' : 's'}`]),
    ...[...groups.entries()].map(([source, g]) => el('section', { class: 'results' }, [
      el('h2', {}, [g.label]),
      el('ul', {}, g.items.map((r) => el('li', { class: r.archived ? 'archived' : null }, [
        el('a', { href: pageHref(source, r.path) }, highlight(r.title, terms)), ' ',
        el('span', { class: 'muted' }, [r.path]),
        el('ul', { class: 'snippets' }, r.snippets.map((s) => el('li', {}, [el('span', { class: 'lineno' }, [`${s.line}`]), ' ', ...highlight(s.text, terms)]))),
      ]))),
    ])),
  );
  document.title = `Search: ${d.q} — Wiki`;
  main.scrollTop = 0;
}

// ---- router -----------------------------------------------------------------

function decodeSeg(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function route() {
  const h = location.hash || DEFAULT_ROUTE;
  if (h.startsWith('#/page/')) {
    const segs = h.slice('#/page/'.length).split('/').map(decodeSeg);
    return showPage(segs[0], segs.slice(1).join('/') || 'index.md');
  }
  if (h.startsWith('#/health/')) return showHealth(decodeSeg(h.slice('#/health/'.length)));
  if (h.startsWith('#/search')) {
    const q = new URLSearchParams(h.split('?')[1] ?? '').get('q') ?? '';
    return showSearch(q);
  }
  location.replace(DEFAULT_ROUTE);
  return undefined;
}

window.addEventListener('hashchange', route);
loadSidebar().then(route);
