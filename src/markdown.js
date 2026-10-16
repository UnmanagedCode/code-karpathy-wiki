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
// Leading tabs expand to the next multiple of 4 columns, fenced code included.

// Every quantifier that precedes a `(.*)$` is closed off by a lookahead: `.`
// stops at U+2028/U+2029, so on such a line `$` fails, and without the
// lookahead the quantifier would give back one character at a time, each
// retry rescanning the rest of the line (quadratic in the line length).
const FENCE_RE = /^( {0,3})(`{3,}(?!`)|~{3,}(?!~))(.*)$/;
const ATX_RE = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_RE = /^ {0,3}> ?/;
const LIST_RE = /^( *)([-*+]|(\d{1,9})([.)]))(?:( +)(?! )(.*))?$/;
const FRONTMATTER_RE = /^([A-Za-z0-9_-]+):[ \t]*(?![ \t])(.*)$/;
const DELIM_CELL_RE = /^ *:?-+:? *$/;
const AUTO_RE = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/;
const PUNCT_RE = /[!-/:-@[-`{-~]/;
const ENTITY_RE = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos|nbsp));/;
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const WORD_RE = /[\p{L}\p{N}]/u;

// Deepest block (quote/list) or inline (emphasis) nesting parsed as structure.
// Past it the remaining content is plain text, so no page can exhaust the stack.
export const MAX_NESTING = 32;

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
  const blocks = parseBlocks(recs, st, 0);
  const h1 = blocks.find((b) => b.t === 'h' && b.level === 1);
  const title = (h1 && plainText(h1.c).trim()) || fallbackTitle;
  return { frontmatter, blocks, title, links: st.links };
}

// Flat `key: value` lines only; anything else (nested YAML) is ignored.
function parseFrontmatter(lines) {
  const out = [];
  for (const line of lines) {
    const m = FRONTMATTER_RE.exec(line);
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

// An ATX heading's closing sequence: trailing `#`s preceded by spaces/tabs (or
// making up the whole string) are dropped with that whitespace. A loop, not an
// unanchored regex, which would rescan each whitespace run from every start.
function stripClosingHashes(s) {
  let j = s.length;
  while (j > 0 && s[j - 1] === '#') j--;
  if (j === s.length) return s;
  if (j === 0) return '';
  if (s[j - 1] !== ' ' && s[j - 1] !== '\t') return s;
  while (j > 0 && (s[j - 1] === ' ' || s[j - 1] === '\t')) j--;
  return s.slice(0, j);
}

function commentStart(s) {
  return s.trimStart().startsWith('<!--');
}

// A table delimiter row: optional outer pipes, then `|`-separated cells each
// `:?-+:?` padded with spaces (U+0020 only). Checked cell by cell, so it is
// linear: a single regex over the whole row backtracks quadratically on runs
// of spaces around a pipe.
function isDelimRow(line) {
  let i = 0;
  let j = line.length;
  while (i < j && line[i] === ' ') i++;
  if (line[i] === '|') i++;
  while (j > i && line[j - 1] === ' ') j--;
  if (j > i && line[j - 1] === '|') {
    j--;
    while (j > i && line[j - 1] === ' ') j--;
  }
  if (i >= j) return false;
  for (const cell of line.slice(i, j).split('|')) if (!DELIM_CELL_RE.test(cell)) return false;
  return true;
}

function isTableStart(recs, i) {
  if (i + 1 >= recs.length || !recs[i].s.includes('|')) return false;
  const d = recs[i + 1].s;
  if (!d.includes('|') || !isDelimRow(d)) return false;
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

function parseBlocks(recs, st, depth) {
  if (depth > MAX_NESTING) {
    const v = recs.map((r) => r.s.trim()).filter(Boolean).join(' ');
    return v ? [{ t: 'p', c: [{ t: 'text', v }] }] : [];
  }
  const out = [];
  let i = 0;
  // Once one opener finds no `-->`, none after it can: skip the rescan.
  let unclosed = false;
  while (i < recs.length) {
    const { s } = recs[i];
    if (isBlank(s)) { i++; continue; }

    if (!unclosed && commentStart(s)) {
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
      if (close >= 0) {
        const rest = recs[k].s.slice(close + 3);
        // In place: recs is always this call's own array.
        if (isBlank(rest)) { i = k + 1; } else { recs[k] = { s: rest, n: recs[k].n }; i = k; }
        continue;
      }
      // Unterminated: the `<!--` is literal text; fall through to the paragraph.
      unclosed = true;
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
      let content = stripClosingHashes(m[2].trim()).trim();
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
      out.push({ t: 'quote', c: parseBlocks(inner, st, depth + 1) });
      continue;
    }

    const lm = listMarker(s);
    if (lm) {
      const r = parseList(recs, i, lm, st, depth);
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

function parseList(recs, i, first, st, depth) {
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
    node.items.push(parseBlocks(lines, st, depth + 1));
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
//
// Every delimiter search is answered from tables built at most once per inline
// run (cx.S) — backtick runs by length, bracket pairs, destination/title
// scanners — or memoised along the path it walked, so no unmatched delimiter
// rescans the rest of the input: parsing stays amortized linear in its length.

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
  return inl(0, S.length, { S, st, lineOf, memo: new Map() }, false, 0);
}

function runLen(S, i, to, ch) {
  let j = i;
  while (j < to && S[j] === ch) j++;
  return j - i;
}

// Maximal backtick runs grouped by length: len -> ascending start positions.
function backtickRuns(cx) {
  if (cx.runs) return cx.runs;
  const { S } = cx;
  const runs = new Map();
  for (let i = S.indexOf('`'); i >= 0; i = S.indexOf('`', i)) {
    const n = runLen(S, i, S.length, '`');
    if (!runs.has(n)) runs.set(n, []);
    runs.get(n).push(i);
    i += n;
  }
  cx.runs = runs;
  return runs;
}

// Start of the first backtick run of exactly n starting at or after `from`
// and ending by `to`, or -1.
function backtickClose(cx, from, to, n) {
  const list = backtickRuns(cx).get(n);
  if (!list) return -1;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < from) lo = mid + 1; else hi = mid;
  }
  return lo < list.length && list[lo] + n <= to ? list[lo] : -1;
}

// End of the HTML comment starting at j, exactly as inl() skips it, or -1.
// Global scans must skip it too, or a backtick or bracket inside a comment
// would pair with one outside it that inl() sees.
function skipComment(cx, j) {
  if (!cx.S.startsWith('<!--', j)) return -1;
  const e = commentClose(cx, j + 4);
  return e >= 0 ? e + 3 : -1;
}

// Skip a whole code span (or an unmatched run) starting at j.
function skipCode(cx, j) {
  const n = runLen(cx.S, j, cx.S.length, '`');
  const cl = backtickClose(cx, j + n, cx.S.length, n);
  return cl >= 0 ? cl + n : j + n;
}

// Memoised forward scan: every position visited while answering one query
// records that query's answer, so later queries starting on the same path
// return in O(1). `step(j)` returns the answer at j, or the next j to visit.
function memoScan(cx, key, from, step) {
  let memo = cx.memo.get(key);
  if (!memo) { memo = new Int32Array(cx.S.length + 1).fill(-2); cx.memo.set(key, memo); }
  const path = [];
  let j = from;
  let res;
  for (;;) {
    if (j >= cx.S.length) { res = -1; break; }
    if (memo[j] !== -2) { res = memo[j]; break; }
    path.push(j);
    const r = step(j);
    if (r.hit !== undefined) { res = r.hit; break; }
    j = r.next;
  }
  for (const p of path) memo[p] = res;
  return res;
}

// Index of `seq` at or after `from` (ending by `to`), skipping escapes and whole code spans.
function findSeq(cx, from, to, seq) {
  const { S } = cx;
  const k = memoScan(cx, `seq:${seq}`, from, (j) => {
    const c = S[j];
    if (c === '\\') return { next: j + 2 };
    if (c === '`') return { next: skipCode(cx, j) };
    if (c === '<') { const e = skipComment(cx, j); if (e >= 0) return { next: e }; }
    if (S.startsWith(seq, j)) return { hit: j };
    return { next: j + 1 };
  });
  return k >= 0 && k + seq.length <= to ? k : -1;
}

// Tables for link parsing, built once per inline run on first use.
function linkTables(cx) {
  if (cx.T) return cx.T;
  const { S } = cx;
  const n = S.length;
  // Bracket pairs, skipping escapes, code spans and comments as inl() does.
  const match = new Int32Array(n).fill(-1);
  const stack = [];
  for (let j = 0; j < n;) {
    const c = S[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') { j = skipCode(cx, j); continue; }
    if (c === '<') { const e = skipComment(cx, j); if (e >= 0) { j = e; continue; } }
    if (c === '[') stack.push(j);
    else if (c === ']' && stack.length) match[stack.pop()] = j;
    j++;
  }
  // Destination/title scanning: `\` + punctuation escapes one char.
  const escaped = new Uint8Array(n + 1);
  for (let j = 0; j < n; j++) {
    if (S[j] === '\\' && j + 1 < n && PUNCT_RE.test(S[j + 1])) { escaped[j + 1] = 1; j++; }
  }
  // P[j] = unescaped '(' minus ')' before j; a destination starting at k ends
  // at the first ')' taking P below P[k] (nextDrop), or at whitespace/control.
  const P = new Int32Array(n + 1);
  for (let j = 0; j < n; j++) {
    const v = escaped[j] ? 0 : S[j] === '(' ? 1 : S[j] === ')' ? -1 : 0;
    P[j + 1] = P[j] + v;
  }
  const nextDrop = new Int32Array(n + 1).fill(-1);
  const mono = [];
  for (let j = n; j >= 0; j--) {
    while (mono.length && P[mono[mono.length - 1]] >= P[j]) mono.pop();
    nextDrop[j] = mono.length ? mono[mono.length - 1] : -1;
    mono.push(j);
  }
  const nextStop = new Int32Array(n + 1);
  const nextNonWs = new Int32Array(n + 1);
  const nextBad = new Int32Array(n + 1);
  const nextQ = { '"': new Int32Array(n + 1), "'": new Int32Array(n + 1), ')': new Int32Array(n + 1) };
  nextStop[n] = n; nextNonWs[n] = n; nextBad[n] = n;
  for (const q of Object.values(nextQ)) q[n] = n;
  for (let j = n - 1; j >= 0; j--) {
    const c = S[j];
    nextStop[j] = c <= ' ' ? j : nextStop[j + 1];
    nextNonWs[j] = (c === ' ' || c === '\n') ? nextNonWs[j + 1] : j;
    nextBad[j] = (c === '[' || c === ']' || c === '\n' || c === '`') ? j : nextBad[j + 1];
    for (const [qc, arr] of Object.entries(nextQ)) arr[j] = (c === qc && !escaped[j]) ? j : arr[j + 1];
  }
  cx.T = { match, P, nextDrop, nextStop, nextNonWs, nextBad, nextQ };
  return cx.T;
}

const unescapePunct = (s) => s.replace(/\\([!-/:-@[-`{-~])/g, '$1');

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

// Next `-->` at or after `from`; one cached answer serves every later query.
function commentClose(cx, from) {
  const c = cx.comment;
  if (c && c.from <= from && (c.at === -1 || c.at >= from)) return c.at;
  const at = cx.S.indexOf('-->', from);
  cx.comment = { from, at };
  return at;
}

const AUTO_STICKY = new RegExp(AUTO_RE.source.slice(1), 'y');

function inl(from, to, cx, noLinks, depth) {
  const { S } = cx;
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
      const cl = backtickClose(cx, i + n, to, n);
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
        const e = commentClose(cx, i + 4);
        if (e >= 0 && e + 3 <= to) { i = e + 3; continue; }
      }
      let m = null;
      if (!noLinks) {
        AUTO_STICKY.lastIndex = i;
        m = AUTO_STICKY.exec(S);
        if (m && i + m[0].length > to) m = null;
      }
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
      const cl = findSeq(cx, i + 2, to, ']]');
      if (cl >= 0 && linkTables(cx).nextBad[i + 2] >= cl) {
        const inner = S.slice(i + 2, cl);
        if (inner.trim() !== '') {
          flush();
          const bar = inner.indexOf('|');
          const label = bar >= 0 ? inner.slice(bar + 1).trim() : inner.trim();
          out.push(addLink(cx, { t: 'link', form: 'wiki', raw: S.slice(i, cl + 2), ref: inner, c: [{ t: 'text', v: label || inner.trim() }] }, i));
          i = cl + 2;
          continue;
        }
      }
    }

    if (!noLinks && (ch === '[' || (ch === '!' && S[i + 1] === '['))) {
      const img = ch === '!';
      const r = mdLink(cx, img ? i + 1 : i, to);
      if (r) {
        flush();
        const label = inl(r.labelFrom, r.labelTo, cx, true, depth);
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
      const r = depth < MAX_NESTING ? emphasis(cx, i, to, noLinks, depth) : null;
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

// [label](dest "title") starting at S[i] === '['. O(1) to reject, via linkTables;
// only an accepted link pays for slicing its destination and title.
// Destinations are never entity-decoded.
function mdLink(cx, i, to) {
  const { S } = cx;
  const T = linkTables(cx);
  const labelTo = T.match[i];
  if (labelTo < 0 || labelTo + 1 >= to || S[labelTo + 1] !== '(') return null;
  let k = T.nextNonWs[labelTo + 2];
  if (k >= to) return null;
  let href;
  let e;
  if (S[k] === '<') {
    let j = k + 1;
    while (j < to && S[j] !== '>' && S[j] !== '<' && S[j] !== '\n') j += (S[j] === '\\' && PUNCT_RE.test(S[j + 1] ?? '')) ? 2 : 1;
    if (j >= to || S[j] !== '>') return null;
    href = unescapePunct(S.slice(k + 1, j));
    e = j + 1;
  } else {
    const drop = T.nextDrop[k];
    const close = drop >= 0 ? drop - 1 : Infinity;
    e = Math.min(T.nextStop[k], close, to);
    if (e !== close && T.P[e] !== T.P[k]) return null;
    href = unescapePunct(S.slice(k, e));
  }
  k = T.nextNonWs[e];
  let title;
  const q = S[k];
  if (k > e && k < to && (q === '"' || q === "'" || q === '(')) {
    const close = T.nextQ[q === '(' ? ')' : q][k + 1];
    if (close >= to) return null;
    const after = T.nextNonWs[close + 1];
    if (after >= to || S[after] !== ')') return null;
    title = unescapePunct(S.slice(k + 1, close));
    k = after;
  }
  if (k >= to || S[k] !== ')') return null;
  return { labelFrom: i + 1, labelTo, href, title, end: k + 1 };
}

// First acceptable closer for delimiter c×len at or after j: memoised per
// candidate, so rejected candidates are never re-examined by a later opener.
function closerFrom(cx, j, c, len) {
  const { S } = cx;
  const delim = c.repeat(len);
  return memoScan(cx, `emph:${delim}`, j, (p) => {
    const k = findSeq(cx, p, S.length, delim);
    if (k < 0) return { hit: -1 };
    if (k !== p) return { next: k };
    if (len === 1 && S[k + 1] === c) return { next: k + runLen(S, k, S.length, c) };
    const after = S[k + len];
    const okPrev = !/\s/.test(S[k - 1]);
    const okAfter = c !== '_' || !(after && WORD_RE.test(after));
    return okPrev && okAfter ? { hit: k } : { next: k + 1 };
  });
}

function emphasis(cx, i, to, noLinks, depth) {
  const { S } = cx;
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
  let k = closerFrom(cx, open, c, len);
  if (k === open) k = closerFrom(cx, open + 1, c, len);
  if (k < 0 || k + len > to) return null;
  return { node: { t: kind, c: inl(open, k, cx, noLinks, depth + 1) }, end: k + len };
}
