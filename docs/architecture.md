# Architecture

## Layout

```
server.js          node:http server — routing, body cap, method guard, security headers, listen/retry
src/paths.js       PROJECTS_ROOT -> wikiRoot(), SEGMENT_RE, safeJoin(), relLabel(), validateRelPath(), confinedRealpath()
src/wiki.js        readIndex() — the MCP domain layer; MAX_FILE_BYTES, truncateUtf8()
src/projects.js    workspace resolution + localProjectWikis() via CONDUCTOR_URL; the test seam
src/mcp.js         envelope only: {tool, arguments} -> {status, body}
src/sources.js     listSources(), getSource(id) — orchestrator + local project .wiki/
src/markdown.js    parse(text) -> {frontmatter, blocks, title, links}; pure
src/links.js       buildNameIndex, scopeOf, resolveWiki, resolveHref; pure
src/snapshot.js    loadSnapshot(source): walk + parse cache + resolution + backlinks; MAX_PAGE_BYTES
src/lint.js        lintSnapshot(snap, {now}); STALE_AFTER_DAYS
src/search.js      queryTerms(q), search(snaps, terms); MAX_RESULTS, MAX_SNIPPETS
src/browse.js      handle(pathname, searchParams) -> {status, body} | null
src/static.js      serveAsset(pathname) -> {status, headers, body} | null
frontend/          index.html, app.js (router + views), render.js (AST -> DOM), tree.js (sidebar source status), styles.css
tests/             node:test via tests/run.mjs
```

The layers are split so tests can hit each one without the one below: `wiki.readIndex` for domain behaviour, `mcp.handle` for the envelope, a real socket only for transport. `src/projects.js` exists to isolate the single network call behind a swappable fetcher, which keeps the whole suite offline.

The browser stacks the same way: `sources` → `snapshot` (disk) → `links` → `lint`/`search` → `browse` (HTTP-shaped, no socket) → `server.js`. `markdown`, `links`, `lint` and `search` are pure and tested on in-memory data (`buildSnapshot(source, {rel: text})`); `snapshot`/`sources` on tmp fixture trees; `browse` and `static` as handlers.

## Zero dependencies — a hard constraint

`package.json` has **no `dependencies` key**, and `tests/manifest.test.mjs` asserts it stays that way. This plugin's Plugin Library entry in code-conductor has no `postClone` hook, so a fresh clone never runs `npm install` — a single dependency would break it on arrival. Hence `node:http` rather than express, and `node:test` rather than a test framework.

Two things express was doing for us that `server.js` now does by hand:

- **Drain the request body on every path that doesn't read it** (`req.resume()`); an unread body stalls the keep-alive socket. This is the classic express→`node:http` port bug.
- **Route on `new URL(req.url, …).pathname`**, never on `req.url` — that string carries the query string.

On a body over 256 KiB the request is *not* destroyed: tearing down the socket mid-upload would take the 413 response with it. Accumulation stops, draining continues, the reply goes out.

## Path resolution

`projectsRoot()` reads `process.env.PROJECTS_ROOT` **at call time** — never cached, which is what lets a test flip it between two calls (and is asserted). The conductor injects it at spawn; standalone it falls back to this repo's parent directory, resolved from `import.meta.url`. Never hardcode an absolute path, and never import host modules — this plugin runs out-of-process.

`wikiRoot()` is `<PROJECTS_ROOT>/.conduct/wiki`. `.conduct` is a stable host constant (`CONDUCT_PROJECT_NAME`) with no env override, so that literal segment is safe to embed.

## Name safety — two layers

1. **`SEGMENT_RE = /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/`.** The leading class excludes `.`, so `..`, `.`, `...` and `.hidden` are rejected outright. A validator that admits `..` and leans on containment to catch it is the wrong shape in the one plugin whose whole job is turning these names into directory segments. Failure → `PROJECT_INVALID` / `WORKSPACE_INVALID`.
2. **`safeJoin()` containment assert** — `path.resolve` must land on `wikiRoot` or inside `wikiRoot + path.sep`. Unreachable after layer one, kept as defence in depth. It returns `null` rather than throwing so the caller picks the outcome: an escaping *argument* is a refusal, an escaping *resolved* workspace is a skip.

`path.resolve` does not follow symlinks, so for `read_index` a symlinked directory or index under `.conduct/wiki/` could point outside. Accepted: `.conduct/` is the conductor's own machine-local tree, and a name is validated by both layers above before it ever reaches the filesystem — so reaching such a link requires write access to that tree, not a crafted argument. The containment assert defends against argument-driven traversal, not against a hostile filesystem.

`read_index` deliberately does **not** use the browser's `confinedRealpath` (below): its behaviour is pinned by the test `read_index does not apply the browser realpath check (deliberate, see architecture)`. The recommended follow-up is to adopt it, reporting an escaping index in `meta.missing`; that test changes with that decision.

## Workspace resolution

`GET ${CONDUCTOR_URL}/api/projects` → find the row whose `name` matches → take its `workspace` field. Accepts a bare array or `{projects:[…]}`.

**No filesystem fallback.** Workspace membership is host state with no on-disk representation we may read, so the `CONDUCTOR_URL` guard sits ahead of the fetcher: with no conductor context the function does no work at all — no network *and* no disk — and returns `null`.

`workspaceForProject()` never throws and never refuses. Timeout, non-200, non-JSON, project absent, project unassigned — every path collapses to `null`, surfacing as `meta.resolvedWorkspace: null`. Fetch timeout is 2 s: the conductor is on loopback, and blocking the host's 30 s MCP budget to fetch one optional extra index is a bad trade when every other scope resolves without it.

## Truncation

`MAX_FILE_BYTES = 64 * 1024`, a module constant. Files are read as a `Buffer` — you cannot cap bytes on a decoded string. `truncateUtf8` walks back from the cut point over UTF-8 continuation bytes (`0b10xxxxxx`) and drops the straddling sequence whole. Deliberately not `TextDecoder` in non-fatal mode, which would substitute a `U+FFFD` the source file never contained.

Sizing: live index pages run ~6 KiB and the largest wiki page ~36 KiB, so the cap never bites in practice while bounding a worst case of 5 scopes × 64 KiB ≈ 320 KiB per call. There is no total cap.

## Browser confinement

The browser serves page bytes from two kinds of root (the orchestrator wiki, each project's `.wiki/`), so it confines by **realpath**, not by string:

1. **`validateRelPath(rel)`** — the request's `path` must be posix-relative, with no `\` or NUL, no empty segment, no segment starting with `.` (which covers `.`, `..` and conductor scratch files like `.prune-progress.md`), and end in `.md`. Failure → `400 PATH_INVALID`, before any filesystem access.
2. **`confinedRealpath(rootReal, rel)`** — `fs.realpath(join(rootReal, rel))` must equal `rootReal` or start with `rootReal + path.sep`; otherwise it returns `ESCAPES`. Unresolvable (ENOENT, ELOOP, …) → `null`. `rootReal` is the realpath of the source root, so a symlinked root is fine; everything below it is confined to it.

A page read runs 1 → realpath the root → 2 (`ESCAPES` → `403 PATH_ESCAPES`, `null` → `404`) → must be a regular file → served from the snapshot. The walk applies 2 to every entry: an escaping symlink (file or dir) is omitted, so it never appears in the tree, search, lint or backlinks. Contained symlinked dirs are followed; a dir whose realpath is already on the current walk path (a cycle) is not re-entered. Page keys are logical rel paths. A swap between the realpath check and the read (TOCTOU) is accepted — it needs write access to the tree.

Project roots come from the host's `/api/projects` row `path` (`localProjectWikis`), never from the project name, so the name needs no `SEGMENT_RE` check; it is only the `p:<name>` id and the label. Rows are kept only when `(system ?? 'local') === 'local'`, `path` is absolute, and `<path>/.wiki` stats as a directory.

## Snapshot and parse cache

`loadSnapshot(source)` walks the source on **every** request — no watchers, always fresh. A module-level cache keyed by realpath holds `{mtimeMs|size, parsed entry}`, so an unchanged file is neither re-read nor re-parsed, and the cache is bounded by the number of files. A cache entry holds only what the file's bytes determine: the h1 `title` or `''`, never anything derived from a path, because one file can be reached by several logical paths; `buildSnapshot` applies the basename fallback per logical path. Cached entries are shared across snapshots and never mutated: each snapshot resolves links into its own `page.res[]`, indexed by the link node's `i`, and `annotatedBlocks(page)` deep-copies the blocks merging each resolution into its link node for `/api/page`. Backlinks are the sorted, deduped set of pages with a resolved `page` link to the target, excluding self. After a complete (non-truncated) walk, cache entries owned by that source (each entry records the root of the walk that set it) that the walk did not visit are evicted — by ownership, not path prefix, so a source nested under another's root behind a dot-dir keeps its entries, so deleted files stop pinning memory; `_parseCached(realpath)` exposes membership to tests.

Reads are bounded before they happen: `stat` first, then `readBounded` reads at most `MAX_PAGE_BYTES + 1` bytes through `fs.open`/`read` (the extra byte lets `truncateUtf8`, shared with `read_index`, see whether the cut splits a codepoint), so file size never drives memory. Over the cap the page is cut and flagged `truncated`.

Failures are never presented as absence. Only `ENOENT` (the entry vanished mid-walk) drops an entry. A page that fails to read becomes an error entry `READ_FAILED`; a parse that throws becomes `PARSE_FAILED`; both are listed and served (empty body, basename title) and are not cached, so a transient failure clears on the next walk. A directory whose `readdir` fails is recorded in `snap.dirErrors` and shows as `error: "READ_FAILED"` on its tree node.

The walk visits at most `MAX_WALK_ENTRIES` directory entries per source. The cycle check covers only the current path (so a contained symlink to a sibling directory is still followed), which lets a diamond of symlinked directories multiply logical paths without a cycle; the cap bounds that. Hitting it sets `snap.truncated`, reported by `/api/tree` and `/api/lint`. Entries are processed in name order per directory, but which ones survive a truncated walk is unspecified.

## Parser complexity and nesting

The inline parser (`src/markdown.js`) is amortized linear in its input. Every delimiter search is answered from tables built once per inline run (`cx`): backtick runs grouped by length (binary search for a closer), bracket pairs from one stack pass, and for link destinations a paren prefix-sum with a next-smaller-element table plus next-whitespace/next-quote arrays, so a rejected `[…](…` costs O(1). `findSeq` (e.g. `]]`) and emphasis closer searches go through `memoScan`, which records each query's answer on every position it walked, so no position is re-walked per delimiter. Only an accepted construct pays for slicing its content. `<!--` closers share one cached `indexOf`. Every global table and memoised scan (bracket pairs, `findSeq`, emphasis closers) skips escapes, code spans and `<!--…-->` comments exactly as `inl()` walks them, so a backtick or bracket inside a comment never pairs with one outside it. Code-span closers (`backtickRuns`) stay raw: a span that opens first wins over a comment inside it. Second declared exception: link destinations, titles and `[[…]]` targets are sliced from the raw text, not from `inl()`'s walk, so a comment inside a link construct is not transparent (`[[a<!--x-->b]]` keeps the comment bytes in its target; `[t](a<!--x-->b.md)` keeps them in its destination or is not recognised). Accepted: contrived, no security impact, since the bytes only reach link resolution and text nodes. A block-level `<!--` with no `-->` is literal text; once one opener finds no close, later ones skip the rescan. Block comments that leave trailing text rewrite the line in place rather than copying the line array.

Block quotes and list items recurse once per level, and emphasis recurses once per level; both stop at `MAX_NESTING`. Past it, a block's remaining lines become one plain-text paragraph and emphasis delimiters stay literal, so no page can exhaust the stack.

## Why the renderer is AST -> DOM

The host opens the page in a full-page iframe with **no sandbox, same-origin with the host**, and the host has no auth. A script injected through a wiki page could therefore call the host's own `/api/*` — spawn sessions, run bash. So:

- The server parses markdown into a JSON AST; raw HTML is never markup (literal text; comments dropped), and link destinations are never entity-decoded.
- `frontend/render.js` builds DOM from a fixed node-type → tag map (`ALLOWED_TAGS`), text only via `createTextNode`, attributes only `href`/`id`/`class`/`title`/`target`/`rel`/`data-*`. Unknown node types are dropped. An `external` href is re-validated with `new URL()` to `http:`/`https:`; `page` hrefs are `#/page/…` built with `encodeURIComponent`. Heading ids are prefixed `h-` so page content cannot clobber app element ids.
- No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `Function` anywhere in `frontend/` (asserted by `tests/frontend.test.mjs`).
- The CSP on every browser response is the second layer: no inline script or style, nothing from another origin.

## Test patterns

`tests/run.mjs` drives `node:test` through its **programmatic API** — some node wrappers hoist leading `--flags` into `NODE_OPTIONS`, which rejects `--test`. Files run at `concurrency: 1`: `PROJECTS_ROOT`, `CONDUCTOR_URL` and the module-global fetcher are process globals set per test, and concurrency would race them.

`tests/_helpers.mjs` gives each test a `mkdtemp` fixture wiki via `PROJECTS_ROOT` and a `resetEnv()` that runs in `finally`, so any file order passes. `useProjects(rows)` stubs the host list through `_setProjectFetcher` and returns a call counter — that counter is how the "no `CONDUCTOR_URL` → no work" contract is asserted. Tests never touch the real `.conduct/` tree.

Browser test patterns:

- `tests/_fakedom.mjs` — a minimal `createElement`/`createTextNode`/`setAttribute`/`append`/`addEventListener` stand-in, injected as `render.js`'s `doc`. Render tests assert the tag and attribute allowlists over everything emitted, including from forged ASTs.
- `treeDigest(dir)` (`tests/_helpers.mjs`) — sorted lstat + sha256 fingerprint of a tree. The no-write test sweeps every browser route and static path with GET and every write method and requires identical digests before and after.
- `freshProjectWiki(root, name, files)` builds `<root>/<name>/.wiki/` and returns the host row to feed `useProjects`.
- `tests/lint.test.mjs` has a **live-shaped fixture** (root → `global/` → families + `archive/`, `workspaces/W/`, `projects/P/`, page-relative `[[../fam/x]]`, backticked syntax examples) that must lint clean — the false-positive tripwire.
- `_setParse(fn)` and `_setMaxWalkEntries(n)` (`src/snapshot.js`) are seams in the `_setProjectFetcher` style — pass `null` to restore; `resetEnv()` resets both. They let a test observe what the parser receives, force a parse failure, or trip the walk cap on a small symlink diamond.
- Parser availability tests time hostile 100k-character delimiter runs against a generous bound, so a quadratic regression fails the suite rather than slowing it.
- Tests never touch the real `.conduct/` tree.
