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
src/static.js      serveAsset(pathname) -> {status, headers, body} | null, from frontend/dist; ASSET_RE, _setDistDir()
frontend/          the browser page: React + Vite + Tailwind v4 + shadcn/Radix, built into frontend/dist (gitignored)
  index.html       host bridge, host theme, theme-init.js, module entry — in that order
  public/          theme-init.js: standalone, follow the OS theme (copied to dist as-is)
  src/main.tsx     entry: <App/> + sonner's <Toaster/>
  src/App.tsx      route (query string), legacy-hash rewrite, sidebar data + ↻ (latest load wins), expanded-dir
                   state shared by pane and drawer, title, `/` shortcut, drawer open state
  src/lib/         render.tsx (AST -> React), route.ts, api.ts (ApiError), data.ts (loaders, useApiData),
                   tree.ts (sidebar rules), highlight.tsx, safeHref.ts, theme.ts, types.ts;
                   utils.ts, modalFocus.ts, textEntry.ts copied from code-conductor
  src/components/  AppShell (two panes / phone drawer), Sidebar, SourceTree, SearchBox, RouteLink, ErrorState;
                   ui/ = shadcn components copied from code-conductor (owned here, never synced)
  src/views/       PageView, HealthView (HEALTH_SECTIONS), SearchView
  src/index.css    Tailwind, cc's @theme inline mapping, .wiki-md content styles
  src/cc-theme-fallback.css  standalone snapshot of cc's tokens, in @layer base
tests/             node:test via tests/run.mjs; frontend/src/**/*.test.ts(x) via vitest
```

The layers are split so tests can hit each one without the one below: `wiki.readIndex` for domain behaviour, `mcp.handle` for the envelope, a real socket only for transport. `src/projects.js` exists to isolate the single network call behind a swappable fetcher, which keeps the whole suite offline.

The browser stacks the same way: `sources` → `snapshot` (disk) → `links` → `lint`/`search` → `browse` (HTTP-shaped, no socket) → `server.js`. `markdown`, `links`, `lint` and `search` are pure and tested on in-memory data (`buildSnapshot(source, {rel: text})`); `snapshot`/`sources` on tmp fixture trees; `browse` and `static` as handlers.

## No runtime dependencies

`package.json` has **no `dependencies` key**, and `tests/manifest.test.mjs` asserts it: the backend is `node:http` and its suite `node:test`. Everything the UI needs is a `devDependency`, bundled into `frontend/dist` at build time, so nothing of it loads at runtime: the build and UI set listed in code-conductor's `docs/plugin-ui.md` (Part 3, "Dependencies"), installed from the ranges cc's own `package.json` declares, plus this repo's test tools (`vitest`, `happy-dom`, `@testing-library/react`, `@testing-library/user-event`).

- **Built on install.** `npm install` with no arguments installs the devDependencies, then runs `prepare` (`vite build --config frontend/vite.config.ts`). cc's Library entry for this plugin (`DEFAULT_ENTRIES` in code-conductor's `src/plugins/library.ts`) sets `postClone` and `postPull` to `npm install`, so Install builds the UI and Update rebuilds it.
- **cc runs the hook verbatim** (`runHookCommand`): plain `npm install`, no `--omit=dev` or `--ignore-scripts`, with cc's own `process.env`. `NODE_ENV=production` or `npm_config_omit=dev` in that environment skips the devDependencies and the build fails; nothing in the plugin can detect it before then.
- **A clean checkout after install.** Vite writes only `frontend/dist` and `node_modules/.vite`; `package-lock.json` (which `npm install` may rewrite) is untracked. `.gitignore` covers all three, so cc's Update (`git pull --ff-only`) never meets a dirty tree.
- **Unbuilt still runs.** Without `frontend/dist/index.html` the backend starts, logs `UI not built`, answers the page with 503, and serves the API and MCP endpoints normally.
- `engines.node` is `>=22.12.0`, the floor of Vite 8 and Vitest 5.

Two things express would do that `server.js` does by hand:

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

`loadSnapshot(source)` walks the source on **every** request — no watchers, always fresh. A module-level cache keyed by realpath holds `{mtimeMs|size, parsed entry}`, so an unchanged file is neither re-read nor re-parsed, and the cache is bounded by the number of files. A cache entry holds only what the file's bytes determine: the h1 `title` or `''`, never anything derived from a path, because one file can be reached by several logical paths; `buildSnapshot` applies the basename fallback per logical path. Cached entries are shared across snapshots and never mutated: each snapshot resolves links into its own `page.res[]`, indexed by the link node's `i`, and `annotatedBlocks(page)` deep-copies the blocks merging each resolution into its link node for `/api/page`. Backlinks are the sorted, deduped set of pages with a resolved `page` link to the target, excluding self. After a complete (non-truncated) walk, cache entries owned by that source (each entry records the root of the walk that set it) that the walk did not visit are evicted — by ownership, not path prefix, so a source nested under another's root behind a dot-dir keeps its entries; entries of any other owner whose root no longer resolves to a directory are reclaimed in the same sweep (each owner checked once), so deleted files stop pinning memory; `_parseCached(realpath)` exposes membership to tests.

Reads are bounded before they happen: `stat` first, then `readBounded` reads at most `MAX_PAGE_BYTES + 1` bytes through `fs.open`/`read` (the extra byte lets `truncateUtf8`, shared with `read_index`, see whether the cut splits a codepoint), so file size never drives memory. Over the cap the page is cut and flagged `truncated`.

Failures are never presented as absence. Only `ENOENT` (the entry vanished mid-walk) drops an entry. A page that fails to read becomes an error entry `READ_FAILED`; a parse that throws becomes `PARSE_FAILED`; both are listed and served (empty body, basename title) and are not cached, so a transient failure clears on the next walk. A directory whose `readdir` fails is recorded in `snap.dirErrors` and shows as `error: "READ_FAILED"` on its tree node.

The walk visits at most `MAX_WALK_ENTRIES` directory entries per source. The cycle check covers only the current path (so a contained symlink to a sibling directory is still followed), which lets a diamond of symlinked directories multiply logical paths without a cycle; the cap bounds that. Hitting it sets `snap.truncated`, reported by `/api/tree` and `/api/lint`. Entries are processed in name order per directory, but which ones survive a truncated walk is unspecified.

## Parser complexity and nesting

The inline parser (`src/markdown.js`) is amortized linear in its input. Every delimiter search is answered from tables built once per inline run (`cx`): backtick runs grouped by length (binary search for a closer), bracket pairs from one stack pass, and for link destinations a paren prefix-sum with a next-smaller-element table plus next-whitespace/next-quote arrays, so a rejected `[…](…` costs O(1). `findSeq` (e.g. `]]`) and emphasis closer searches go through `memoScan`, which records each query's answer on every position it walked, so no position is re-walked per delimiter. Only an accepted construct pays for slicing its content. `<!--` closers share one cached `indexOf`. Every global table and memoised scan (bracket pairs, `findSeq`, emphasis closers) skips escapes, code spans and `<!--…-->` comments exactly as `inl()` walks them, so a backtick or bracket inside a comment never pairs with one outside it. Code-span closers (`backtickRuns`) stay raw: a span that opens first wins over a comment inside it. Second declared exception: link destinations, titles and `[[…]]` targets are sliced from the raw text, not from `inl()`'s walk, so a comment inside a link construct is not transparent (`[[a<!--x-->b]]` keeps the comment bytes in its target; `[t](a<!--x-->b.md)` keeps them in its destination or is not recognised). Accepted: contrived, no security impact, since the bytes only reach link resolution and text nodes. A block-level `<!--` with no `-->` is literal text; once one opener finds no close, later ones skip the rescan. Block comments that leave trailing text rewrite the line in place rather than copying the line array.

The block-level matchers are linear in the line length too. A regex whose quantifier precedes `(.*)$` (`FENCE_RE`, `LIST_RE`, `FRONTMATTER_RE`) closes that quantifier with a negative lookahead: `.` stops at U+2028/U+2029, so on such a line `$` fails, and without the lookahead the quantifier would give back one character at a time, each retry rescanning the rest of the line. The table delimiter row (`isDelimRow`) and an ATX heading's closing `#` run (`stripClosingHashes`) are plain loops, since a single regex over either backtracks quadratically on runs of spaces. `tests/markdown.test.mjs` times each shape as a whole page at `MAX_PAGE_BYTES`.

Block quotes and list items recurse once per level, and emphasis recurses once per level; both stop at `MAX_NESTING`. Past it, a block's remaining lines become one plain-text paragraph and emphasis delimiters stay literal, so no page can exhaust the stack.

## Why the renderer is AST -> DOM

The host opens the page in a full-page iframe with **no sandbox, same-origin with the host**, and the host has no auth. A script injected through a wiki page could therefore call the host's own `/api/*` — spawn sessions, run bash. So:

- The server parses markdown into a JSON AST; raw HTML is never markup (literal text; comments dropped), and link destinations are never entity-decoded.
- `frontend/src/lib/render.tsx` builds React elements through one internal `h(tag, attrs, children, handlers?)` from a fixed node-type → tag map. Its exported constants are the single source of truth, imported by the tests: `ALLOWED_TAGS` (`h` throws on any other tag), `ALLOWED_ATTRS` (React prop names `href`/`id`/`className`/`title`/`target`/`rel`) plus `DATA_ATTR_RE` (`data-*`), and `ALIGN` (table cell alignment classes). Content is only ever a text child (`String(v ?? '')`). Unknown node types are dropped; a non-array `items`/`c`/`rows`/`candidates` counts as empty. The AST types in `lib/types.ts` are advisory: every node is re-checked at runtime, because a forged AST must stay safe.
- **No style from content.** `style` and `dangerouslySetInnerHTML` are outside the allowlist, so `h` can never pass them, and no node type maps to `<style>`. This matters because the CSP allows inline styles (`'unsafe-inline'`, for Radix and sonner): a content-driven `style` would be live CSS, an exfiltration surface. `render.test.tsx` feeds forged nodes carrying `style`, `attrs.style`, `dangerouslySetInnerHTML`, `{t:'style'}` and `{t:'html'}` and asserts no `[style]`, `style`, `script`, `img` or `iframe` comes out.
- **Bounded depth.** `renderBlocks` recurses once per nested block or inline and stops at `MAX_RENDER_DEPTH`, dropping anything deeper, so a forged AST cannot exhaust the stack. The parser's own output stays far below it (block and inline nesting are each capped at `MAX_NESTING`).
- The only event handlers are `onClick`s the renderer attaches itself (page links, ambiguous candidates, anchors), passed as `h`'s separate trusted argument, never read from the AST.
- Hrefs: `external` goes through `safeHref` (`lib/safeHref.ts`), which parses with **no base** so only an absolute `http:`/`https:` URL passes (a relative or `//host` string is refused) and a refused link renders as an inert `<span>`. `page` and candidate hrefs are `routeHref(...)` (`?view=page&…`, built with `URLSearchParams`). Anchors are `#h-<slug>` and scroll on click without changing the hash. Heading ids are prefixed `h-` so page content cannot clobber app element ids.
- No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `Function`, `dangerouslySetInnerHTML`, `location.hash` assignment, `window.parent` or `code-conductor:` key anywhere in the UI source (asserted by `tests/frontend.test.mjs`).
- The CSP on every browser response is the second layer: no inline script, nothing from another origin (see `docs/protocol.md` → Headers).

## Test patterns

`tests/run.mjs` drives `node:test` through its **programmatic API** — some node wrappers hoist leading `--flags` into `NODE_OPTIONS`, which rejects `--test`. Files run at `concurrency: 1`: `PROJECTS_ROOT`, `CONDUCTOR_URL` and the module-global fetcher are process globals set per test, and concurrency would race them.

`tests/_helpers.mjs` gives each test a `mkdtemp` fixture wiki via `PROJECTS_ROOT` and a `resetEnv()` that runs in `finally`, so any file order passes. `useProjects(rows)` stubs the host list through `_setProjectFetcher` and returns a call counter — that counter is how the "no `CONDUCTOR_URL` → no work" contract is asserted. Tests never touch the real `.conduct/` tree.

Browser test patterns:

- **UI tests run in vitest + happy-dom** (`npm run test:web`, config `frontend/vitest.config.ts`), colocated as `frontend/src/**/*.test.ts(x)`. The network is mocked at `fetch` (`stubFetch` in `frontend/src/test/fixtures.ts`, which routes canned responses by URL); no unit test starts a server. `npm test` runs the node suite, then `tsc -p frontend`, then vitest.
- `render.test.tsx` renders `<WikiContent>` and asserts the tag, attribute and href allowlists over everything emitted, including from forged ASTs. `public/theme-init.js` is tested by `vi.resetModules()` plus a dynamic import with `matchMedia` stubbed (`test/globals.d.ts` declares the module for `tsc`).
- `_setDistDir(dir)` (`src/static.js`) serves a fixture dist (`fixtureDist(root)` in `tests/_helpers.mjs`); `resetEnv()` restores the real one. `tests/dist.test.mjs` checks the real build that `npm install` produced, and serves it through `createServer()` on port 0.
- `tests/frontend.test.mjs` and `tests/frontend-theme.test.mjs` scan the UI source as text (`tests/_frontendFiles.mjs`; test files excluded, as they carry hostile strings on purpose): sinks and root-relative URLs, `index.html`'s head order, the fallback tokens covering `@theme inline` in both modes, no literal colours in the plugin's own code (`components/ui/` copies exempt), and no theme control outside `theme-init.js`.
- `treeDigest(dir)` (`tests/_helpers.mjs`) — sorted lstat + sha256 fingerprint of a tree. The no-write test sweeps every browser route and static path with GET and every write method and requires identical digests before and after.
- `freshProjectWiki(root, name, files)` builds `<root>/<name>/.wiki/` and returns the host row to feed `useProjects`.
- `tests/lint.test.mjs` has a **live-shaped fixture** (root → `global/` → families + `archive/`, `workspaces/W/`, `projects/P/`, page-relative `[[../fam/x]]`, backticked syntax examples) that must lint clean — the false-positive tripwire.
- `_setParse(fn)` and `_setMaxWalkEntries(n)` (`src/snapshot.js`) are seams in the `_setProjectFetcher` style — pass `null` to restore; `resetEnv()` resets both. They let a test observe what the parser receives, force a parse failure, or trip the walk cap on a small symlink diamond.
- Parser availability tests time hostile 100k-character delimiter runs against a generous bound, so a quadratic regression fails the suite rather than slowing it.
- Tests never touch the real `.conduct/` tree.
