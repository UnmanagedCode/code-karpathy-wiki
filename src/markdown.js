// Zero-dependency markdown subset -> JSON-serialisable AST. Pure; server-side only.
//
// Page bytes are untrusted and the page renders inside a same-origin host
// iframe, so this parser never emits markup: raw HTML becomes literal text,
// HTML comments are dropped, and the only node types are the ones listed in
// docs/architecture.md. Link nodes are created only outside code spans and
// fences, which is what keeps syntax examples out of the lint's dead links.
//
// Deliberately unsupported: indented code blocks, setext headings,
// reference-style links, images (an image becomes a link labelled by its alt).

const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX_RE = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_RE = /^ {0,3}> ?/;
const LIST_RE = /^( *)([-*+]|(\d{1,9})([.)]))(?:( +)(.*))?$/;
const DELIM_RE = /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/;
const AUTO_RE = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/;
const PUNCT_RE = /[!-/:-@[-`{-~]/;
const ENTITY_RE = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos|nbsp));/;
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const WORD_RE = /[\p{L}\p{N}]/u;

export function parse(text, fallbackTitle = '') {
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let frontmatter = {};
  let skip = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      frontmatter = parseFrontmatter(lines.slice(1, end));
      skip = end + 1;
    }
  }
  const recs = lines.slice(skip).map((s, i) => ({ s: expandTabs(s), n: skip + i + 1 }));
  const st = { slugs: new Map(), links: [] };
  const blocks = parseBlocks(recs, st);
  const h1 = blocks.find((b) => b.t === 'h' && b.level === 1);
  const title = (h1 && plainText(h1.c).trim()) || fallbackTitle;
  return { frontmatter, blocks, title, links: st.links };
}

// Flat `key: value` lines only; anything else (nested YAML) is ignored.
function parseFrontmatter(lines) {
  const out = [];
  for (const line of lines) {
    const m = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
    out.push([m[1], v]);
  }
  return Object.fromEntries(out);
}

function expandTabs(s) {
  if (!s.includes('\t')) return s;
  let out = '';
  let col = 0;
  let i = 0;
  for (; i < s.length; i++) {
    if (s[i] === '\t') { const w = 4 - (col % 4); out += ' '.repeat(w); col += w; } else if (s[i] === ' ') { out += ' '; col++; } else break;
  }
  return out + s.slice(i);
}

const isBlank = (s) => /^[ \t]*$/.test(s);
const indentOf = (s) => s.length - s.trimStart().length;

export function plainText(inlines) {
  let s = '';
  for (const n of inlines ?? []) {
    if (n.t === 'text' || n.t === 'code') s += n.v;
    else if (n.c) s += plainText(n.c);
  }
  return s;
}

function listMarker(s) {
  const m = LIST_RE.exec(s);
  if (!m) return null;
  const ordered = m[3] !== undefined;
  const indent = m[1].length;
  const width = m[2].length;
  const spaces = m[5] ?? '';
  const rest = m[6] ?? '';
  const contentIndent = (rest === '' || spaces.length > 4) ? indent + width + 1 : indent + width + spaces.length;
  return {
    ordered,
    kind: ordered ? m[4] : m[2],
    start: ordered ? Number(m[3]) : undefined,
    indent,
    contentIndent,
    content: spaces.length > 4 ? spaces.slice(1) + rest : rest,
  };
}

function commentStart(s) {
  return s.trimStart().startsWith('<!--');
}

function isTableStart(recs, i) {
  if (i + 1 >= recs.length || !recs[i].s.includes('|')) return false;
  const d = recs[i + 1].s;
  if (!d.includes('|') || !DELIM_RE.test(d)) return false;
  return splitCells(recs[i].s).length === splitCells(d).length;
}

// Lines that end a paragraph (and so may not be lazy continuations).
function startsBlock(recs, i) {
  const s = recs[i].s;
  if (ATX_RE.test(s) || FENCE_RE.test(s) || HR_RE.test(s) || QUOTE_RE.test(s) || commentStart(s)) return true;
  const m = listMarker(s);
  if (m && m.content.trim() !== '' && (!m.ordered || m.start === 1)) return true;
  return isTableStart(recs, i);
}

function parseBlocks(recs, st) {
  const out = [];
  let i = 0;
  while (i < recs.length) {
    const { s } = recs[i];
    if (isBlank(s)) { i++; continue; }

    if (commentStart(s)) {
      // An HTML comment block is dropped; text after its close on the same line survives.
      const at = s.indexOf('<!--');
      let k = i;
      let pos = at + 4;
      let close = -1;
      while (k < recs.length) {
        close = recs[k].s.indexOf('-->', k === i ? pos : 0);
        if (close >= 0) break;
        k++;
      }
      if (close < 0) break;
      const rest = recs[k].s.slice(close + 3);
      if (isBlank(rest)) { i = k + 1; } else { recs = [...recs.slice(0, k), { s: rest, n: recs[k].n }, ...recs.slice(k + 1)]; i = k; }
      continue;
    }

    let m = FENCE_RE.exec(s);
    if (m && !(m[2][0] === '`' && m[3].includes('`'))) {
      const indent = m[1].length;
      const fch = m[2][0];
      const flen = m[2].length;
      const closeRe = new RegExp(`^ {0,3}${fch === '`' ? '`' : '~'}{${flen},}[ \\t]*$`);
      const body = [];
      let k = i + 1;
      while (k < recs.length && !closeRe.test(recs[k].s)) {
        const line = recs[k].s;
        body.push(line.slice(Math.min(indent, indentOf(line))));
        k++;
      }
      out.push({ t: 'pre', lang: m[3].trim().split(/\s+/)[0] || '', text: body.join('\n') });
      i = k + 1;
      continue;
    }

    m = ATX_RE.exec(s);
    if (m) {
      let content = m[2].trim().replace(/(?:^|[ \t]+)#+$/, '').trim();
      if (/^#+$/.test(content)) content = '';
      const c = inlines([{ s: content, n: recs[i].n }], st);
      out.push({ t: 'h', level: m[1].length, id: uniqueSlug(plainText(c), st), c });
      i++;
      continue;
    }

    if (HR_RE.test(s)) { out.push({ t: 'hr' }); i++; continue; }

    if (QUOTE_RE.test(s)) {
      const inner = [];
      while (i < recs.length) {
        const r = recs[i];
        if (QUOTE_RE.test(r.s)) inner.push({ s: r.s.replace(QUOTE_RE, ''), n: r.n });
        else if (!isBlank(r.s) && inner.length && !isBlank(inner[inner.length - 1].s) && !startsBlock(recs, i)) inner.push({ s: r.s, n: r.n });
        else break;
        i++;
      }
      out.push({ t: 'quote', c: parseBlocks(inner, st) });
      continue;
    }

    const lm = listMarker(s);
    if (lm) {
      const r = parseList(recs, i, lm, st);
      out.push(r.node);
      i = r.next;
      continue;
    }

    if (isTableStart(recs, i)) {
      const head = splitCells(recs[i].s);
      const align = splitCells(recs[i + 1].s).map((d) => {
        const l = d.startsWith(':');
        const r = d.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
      });
      const cell = (text, n) => inlines([{ s: text, n }], st);
      const node = { t: 'table', align, head: head.map((h) => cell(h, recs[i].n)), rows: [] };
      let k = i + 2;
      const isRow = (r) => !isBlank(r.s) && r.s.includes('|') && (r.s.trimStart().startsWith('|') || !startsBlock(recs, k));
      while (k < recs.length && isRow(recs[k])) {
        const cells = splitCells(recs[k].s);
        const row = [];
        for (let c = 0; c < head.length; c++) row.push(cell(cells[c] ?? '', recs[k].n));
        node.rows.push(row);
        k++;
      }
      out.push(node);
      i = k;
      continue;
    }

    // Paragraph.
    const para = [recs[i]];
    i++;
    while (i < recs.length && !isBlank(recs[i].s) && !startsBlock(recs, i)) { para.push(recs[i]); i++; }
    out.push({ t: 'p', c: inlines(para, st) });
  }
  return out;
}

function parseList(recs, i, first, st) {
  const node = { t: first.ordered ? 'ol' : 'ul', tight: true, items: [] };
  if (first.ordered) node.start = first.start;
  let gapBeforeNext = false;
  while (i < recs.length) {
    const m = listMarker(recs[i].s);
    if (!m || m.ordered !== first.ordered || m.kind !== first.kind) break;
    if (gapBeforeNext) node.tight = false;
    const lines = [{ s: m.content, n: recs[i].n }];
    const ci = m.contentIndent;
    let inFence = FENCE_RE.test(m.content);
    i++;
    while (i < recs.length) {
      const r = recs[i];
      if (isBlank(r.s)) { lines.push({ s: '', n: r.n }); i++; continue; }
      if (indentOf(r.s) >= ci) {
        const line = r.s.slice(ci);
        if (FENCE_RE.test(line)) inFence = !inFence;
        lines.push({ s: line, n: r.n });
        i++;
        continue;
      }
      const prev = lines[lines.length - 1].s;
      if (!inFence && !isBlank(prev) && !startsBlock(recs, i) && !listMarker(r.s)) {
        lines.push({ s: r.s.trimStart(), n: r.n });
        i++;
        continue;
      }
      break;
    }
    let trailing = 0;
    while (lines.length > 1 && isBlank(lines[lines.length - 1].s)) { lines.pop(); trailing++; }
    if (lines.some((l) => isBlank(l.s))) node.tight = false;
    gapBeforeNext = trailing > 0;
    node.items.push(parseBlocks(lines, st));
  }
  return { node, next: i };
}

// Cells of a table row: outer pipes stripped, split on unescaped `|`, `\|` -> `|`.
function splitCells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function uniqueSlug(text, st) {
  const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
  const n = st.slugs.get(base) ?? 0;
  st.slugs.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

// ---- inlines ----------------------------------------------------------------

function inlines(recs, st) {
  const parts = [];
  const starts = [];
  let off = 0;
  recs.forEach((r) => {
    const s = r.s.trim();
    starts.push(off);
    parts.push(s);
    off += s.length + 1;
  });
  const S = parts.join('\n');
  const lineOf = (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return recs[lo].n;
  };
  return inl(S, 0, S.length, { st, lineOf }, false);
}

function runLen(S, i, to, ch) {
  let j = i;
  while (j < to && S[j] === ch) j++;
  return j - i;
}

// Start of the next backtick run of exactly n, or -1.
function backtickClose(S, from, to, n) {
  let j = from;
  while (j < to) {
    if (S[j] === '`') {
      const r = runLen(S, j, to, '`');
      if (r === n) return j;
      j += r;
    } else j++;
  }
  return -1;
}

// Index of `seq` at or after `from`, skipping escapes and whole code spans.
function findSeq(S, from, to, seq) {
  let j = from;
  while (j < to) {
    const c = S[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') {
      const n = runLen(S, j, to, '`');
      const cl = backtickClose(S, j + n, to, n);
      j = cl >= 0 ? cl + n : j + n;
      continue;
    }
    if (j + seq.length <= to && S.startsWith(seq, j)) return j;
    j++;
  }
  return -1;
}

function pushText(out, v) {
  const last = out[out.length - 1];
  if (last && last.t === 'text') last.v += v;
  else out.push({ t: 'text', v });
}

function addLink(cx, node, pos) {
  node.line = cx.lineOf(pos);
  node.i = cx.st.links.length;
  cx.st.links.push(node);
  return node;
}

function inl(S, from, to, cx, noLinks) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { pushText(out, buf); buf = ''; } };
  let i = from;
  while (i < to) {
    const ch = S[i];

    if (ch === '\\' && i + 1 < to && PUNCT_RE.test(S[i + 1])) { buf += S[i + 1]; i += 2; continue; }
    if (ch === '\n') { buf += ' '; i++; continue; }

    if (ch === '`') {
      const n = runLen(S, i, to, '`');
      const cl = backtickClose(S, i + n, to, n);
      if (cl >= 0) {
        flush();
        let v = S.slice(i + n, cl).replace(/\n/g, ' ');
        if (v.length >= 2 && v[0] === ' ' && v[v.length - 1] === ' ' && v.trim() !== '') v = v.slice(1, -1);
        out.push({ t: 'code', v });
        i = cl + n;
      } else {
        buf += S.slice(i, i + n);
        i += n;
      }
      continue;
    }

    if (ch === '<') {
      if (S.startsWith('<!--', i)) {
        const e = S.indexOf('-->', i + 4);
        if (e >= 0 && e + 3 <= to) { i = e + 3; continue; }
      }
      const m = noLinks ? null : AUTO_RE.exec(S.slice(i, Math.min(to, i + 4096)));
      if (m) {
        flush();
        out.push(addLink(cx, { t: 'link', form: 'auto', raw: m[0], href: m[1], c: [{ t: 'text', v: m[1] }] }, i));
        i += m[0].length;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    if (!noLinks && ch === '[' && S[i + 1] === '[') {
      const cl = findSeq(S, i + 2, to, ']]');
      const inner = cl >= 0 ? S.slice(i + 2, cl) : '';
      if (cl >= 0 && inner.trim() !== '' && !/[[\]\n`]/.test(inner)) {
        flush();
        const bar = inner.indexOf('|');
        const label = bar >= 0 ? inner.slice(bar + 1).trim() : inner.trim();
        out.push(addLink(cx, { t: 'link', form: 'wiki', raw: S.slice(i, cl + 2), ref: inner, c: [{ t: 'text', v: label || inner.trim() }] }, i));
        i = cl + 2;
        continue;
      }
    }

    if (!noLinks && (ch === '[' || (ch === '!' && S[i + 1] === '['))) {
      const img = ch === '!';
      const r = mdLink(S, img ? i + 1 : i, to);
      if (r) {
        flush();
        const label = inl(S, r.labelFrom, r.labelTo, cx, true);
        const node = { t: 'link', form: 'md', raw: S.slice(i, r.end), href: r.href, c: img ? [{ t: 'text', v: plainText(label) }] : label };
        if (r.title !== undefined) node.title = r.title;
        out.push(addLink(cx, node, i));
        i = r.end;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    if (ch === '*' || ch === '_' || ch === '~') {
      const r = emphasis(S, i, to, cx, noLinks);
      if (r) { flush(); out.push(r.node); i = r.end; continue; }
      const n = runLen(S, i, to, ch);
      buf += S.slice(i, i + n);
      i += n;
      continue;
    }

    if (ch === '&') {
      const m = ENTITY_RE.exec(S.slice(i, i + 12));
      if (m) {
        let v;
        if (m[3]) v = NAMED[m[3]];
        else {
          const cp = m[1] ? Number(m[1]) : parseInt(m[2], 16);
          v = (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) ? '\ufffd' : String.fromCodePoint(cp);
        }
        buf += v;
        i += m[0].length;
        continue;
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

// [label](dest "title") starting at S[i] === '['. Destinations are never entity-decoded.
function mdLink(S, i, to) {
  let depth = 0;
  let j = i;
  for (; j < to; j++) {
    const c = S[j];
    if (c === '\\') { j++; continue; }
    if (c === '`') {
      const n = runLen(S, j, to, '`');
      const cl = backtickClose(S, j + n, to, n);
      j = (cl >= 0 ? cl + n : j + n) - 1;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) break;
  }
  if (j >= to || S[j + 1] !== '(') return null;
  const labelTo = j;
  let k = j + 2;
  const skipWs = () => { while (k < to && (S[k] === ' ' || S[k] === '\n')) k++; };
  skipWs();
  let href = '';
  if (S[k] === '<') {
    k++;
    while (k < to && S[k] !== '>' && S[k] !== '<' && S[k] !== '\n') {
      if (S[k] === '\\' && PUNCT_RE.test(S[k + 1] ?? '')) { href += S[k + 1]; k += 2; continue; }
      href += S[k++];
    }
    if (S[k] !== '>') return null;
    k++;
  } else {
    let par = 0;
    while (k < to) {
      const c = S[k];
      if (c === '\\' && PUNCT_RE.test(S[k + 1] ?? '')) { href += S[k + 1]; k += 2; continue; }
      if (c === ' ' || c === '\n' || c < ' ') break;
      if (c === '(') par++;
      if (c === ')') { if (par === 0) break; par--; }
      href += c;
      k++;
    }
    if (par !== 0) return null;
  }
  const beforeTitle = k;
  skipWs();
  let title;
  const q = S[k];
  if (k > beforeTitle && (q === '"' || q === "'" || q === '(')) {
    const qc = q === '(' ? ')' : q;
    let t = '';
    k++;
    while (k < to && S[k] !== qc) {
      if (S[k] === '\\' && PUNCT_RE.test(S[k + 1] ?? '')) { t += S[k + 1]; k += 2; continue; }
      t += S[k++];
    }
    if (S[k] !== qc) return null;
    k++;
    title = t;
    skipWs();
  }
  if (S[k] !== ')') return null;
  return { labelFrom: i + 1, labelTo, href, title, end: k + 1 };
}

function emphasis(S, i, to, cx, noLinks) {
  const c = S[i];
  let len;
  let kind;
  if (c === '~') {
    if (S[i + 1] !== '~') return null;
    len = 2;
    kind = 'del';
  } else {
    len = S[i + 1] === c ? 2 : 1;
    kind = len === 2 ? 'strong' : 'em';
  }
  const open = i + len;
  if (open >= to || /\s/.test(S[open])) return null;
  if (c === '_' && i > 0 && WORD_RE.test(S[i - 1])) return null;
  const delim = c.repeat(len);
  let j = open;
  for (;;) {
    const k = findSeq(S, j, to, delim);
    if (k < 0) return null;
    if (len === 1 && S[k + 1] === c) { j = k + runLen(S, k, to, c); continue; }
    const after = S[k + len];
    const okPrev = !/\s/.test(S[k - 1]);
    const okAfter = c !== '_' || !(after && WORD_RE.test(after));
    if (k > open && okPrev && okAfter) return { node: { t: kind, c: inl(S, open, k, cx, noLinks) }, end: k + len };
    j = k + 1;
  }
}
