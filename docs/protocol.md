# Protocol

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`/`HEAD` | `/api/health` | readiness/liveness probe → `200 {"ok":true}` |
| `POST` | `/api/mcp` | the single MCP tool endpoint |
| `GET`/`HEAD` | `/api/sources`, `/api/tree`, `/api/page`, `/api/lint`, `/api/search` | the browser API — see [Browser API](#browser-api) |
| `GET`/`HEAD` | `/`, `/<name>.(html\|js\|css)` | the browser page's static assets |

Manifest: `backend {start:"node server.js", healthPath:"/api/health"}`, `mcp {endpoint:"/api/mcp"}`, `frontend {path:"/", navLabel:"Wiki"}`. `mcp` and `frontend` each require `backend`. `frontend` accepts only `path` (must start with `/`) and `navLabel` (non-empty); any other key marks the plugin `invalid`.

The MCP wire contract below covers `/api/mcp` only. The browser routes have their own error shape.

## Wire contract

The conductor POSTs `{tool, arguments, caller:{sessionId, project}}`. `caller` is accepted and ignored — `read_index` is not session-scoped.

**HTTP 200 for every well-formed invocation.** Non-200 means a transport failure only:

| Status | Body | When |
|---|---|---|
| 200 | `{text, meta}` | success (opts into the raw-text channel) |
| 200 | `{result: …}` | every domain refusal |
| 200 | `{error: "unknown tool: <name>"}` | tool name not in the manifest |
| 400 | `{error}` | `tool` missing/empty, or a body that isn't valid JSON |
| 405 | `{error}` | wrong method (`Allow` header set) |
| 413 | `{error}` | request body over 256 KiB |
| 404 | `{error}` | any other path |

`{error}` is thrown at the model by the host bridge (`code-conductor/src/plugins/mcpBridge.js` throws whenever `body.error != null`). A refusal must therefore never use it — see below.

## `read_index`

`inputSchema` is **flat** — nested `properties`, `$ref`, `oneOf`/`anyOf`/`allOf`/`not` are rejected at manifest load and would mark the plugin `invalid`.

```jsonc
{ "type": "object", "properties": {
  "project":   { "type":"string", "minLength":1, "pattern":"^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$", "description":"…" },
  "workspace": { "type":"string", "minLength":1, "pattern":"^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$", "description":"…" }
} }
```

No `required` array — both arguments are optional and may be combined. The declared `pattern` string-equals `SEGMENT_RE.source` in `src/paths.js`; `tests/manifest.test.mjs` asserts that equality so the manifest and runtime layers cannot drift.

### Success — the `{text, meta}` raw-text channel

A success opts into the host's raw-text channel: `text` and `meta` ride at the **top level** of the body, not nested under `result`. The conductor bridge (`code-conductor/src/plugins/mcpBridge.js`) emits `meta` as one compact-JSON block and each entry of `text` as its own raw, unescaped content block — far cheaper and more legible than escaping the bodies into a single JSON string. Only the success path opts in; refusals still ride in `{result}` (see Refusals below).

```jsonc
{
  "meta": { "wikiRoot": "/…/.conduct/wiki", "resolvedWorkspace": "CC-Dev", "missing": [], "truncated": [] },
  "text": [ "<!-- .conduct/wiki/index.md -->\n\n# Orchestrator wiki\n…", "…" ]
}
```

- `text` is a list of bodies (the host also accepts a single string). Each is led by a one-line self-labelling HTML comment `<!-- .conduct/wiki/<relpath> -->` followed by a blank line, so a body stays identifiable when blocks are flattened. Everything after that prefix is the file byte-for-byte.
- Emission order is broad → narrow — root, `global/`, workspace, project — deduped by resolved absolute path.
- `meta` stays minimal: exactly `wikiRoot`, `resolvedWorkspace`, `missing`, `truncated`. The bodies carry what exists; `meta` names only what is absent, plus the resolved workspace. There is no `ok:true` on success.
- `missing` / `truncated` hold bare relative paths (`global/index.md`) — the same `<relpath>` that appears inside the header comment. They are disjoint by construction: a file must be read to be truncated.
- `resolvedWorkspace` is the raw host value, or `null` when it could not be resolved (no `project` argument, no `CONDUCTOR_URL`, conductor unreachable, project absent from the host list, or project unassigned).

Per-file cap: `MAX_FILE_BYTES` in `src/wiki.js` (64 KiB), a module constant — not a tool argument. An over-cap body is cut on a UTF-8 codepoint boundary, gains a trailing `<!-- truncated at 65536 bytes -->` marker, and its path is listed in `meta.truncated`.

### Refusals

Compact JSON at HTTP 200, **never** `{error}` — a refusal is a normal result the model should reason about, not a thrown tool error:

```jsonc
{ "result": { "ok": false, "code": "PROJECT_INVALID", "reason": "project must be a single path segment matching …" } }
```

| Code | Fires when |
|---|---|
| `PROJECT_INVALID` | `project` is not a string, or fails `^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$` |
| `WORKSPACE_INVALID` | same, for `workspace` |

That is the whole set. In particular these are **not** refusals:

- a scope with no `index.md` yet, or an absent wiki root → `meta.missing`;
- a project the host doesn't list, or a host that can't be reached → `resolvedWorkspace: null`;
- a **resolved** workspace name that isn't addressable as a path segment → skipped, listed in `meta.missing`, `resolvedWorkspace` still reports the raw value. The host's workspace rule (`/^[\w][\w \-./]{0,39}$/`) permits spaces and `/`, so this is reachable with a legal upstream name such as `CC Dev`. The caller did nothing wrong, and refusing would deny them every other scope too. An explicit `workspace` **argument** in that shape is still refused — the asymmetry is deliberate.

## Browser API

### Mounting

The host mounts the plugin at `/plugins/code-wiki/` and proxies **every** path and method to this backend with the prefix stripped (`/plugins/code-wiki/api/tree?source=x` arrives as `/api/tree?source=x`); a bare `/plugins/code-wiki` is redirected to the trailing-slash form. The nav entry opens the backend root in a full-page iframe, so `frontend.path` is `/`. **Every URL in `frontend/` must be relative with no leading `/`** (`app.js`, `api/tree?…`) — a leading `/` would hit the host itself. `tests/frontend.test.mjs` scans for violations.

### Routes

All are `GET`/`HEAD`, JSON, and read-only. `source` is a source id from `/api/sources`.

| Path | Params | 200 body |
|---|---|---|
| `/api/sources` | — | `{sources:[{id, kind, label}], conductor}` — `kind` is `orchestrator` or `project`; `conductor` is whether `CONDUCTOR_URL` is set. Filesystem roots are never sent. |
| `/api/tree` | `source` | `{source, tree}`; `tree` is a dir node `{name, path, index, archived, dirs:[node], pages:[{path, name, title}]}` — root has `name:''`, `path:''`; `index` is the dir's `index.md` rel path or `null` and is not repeated in `pages`; dirs and pages are sorted by name. |
| `/api/page` | `source`, `path` | `{source, path, title, frontmatter, blocks, backlinks:[{path, title}], archived, truncated, stale, lowConfidence}` |
| `/api/lint` | `source` | `{source, now, staleAfterDays, rootIndex, counts, deadLinks, ambiguousLinks, orphans, unreachableIndexes, lowConfidence, stale}` |
| `/api/search` | `q`, optional `source` | `{q, results:[{source, sourceLabel, path, title, archived, hits, snippets:[{line, text}]}], truncated}` |

- `path` is posix, relative to the source root, every segment non-empty and not starting with `.`, no `\` or NUL, ending in `.md` (`validateRelPath` in `src/paths.js`).
- `title` is the first `# ` heading, else the file's basename without `.md`.
- `frontmatter` is the flat `key: value` map from a leading `---` block (values unquoted), `{}` if none.
- `stale`/`lowConfidence` on a page apply the Health definitions in `docs/features.md`; `truncated` means the file exceeded `MAX_PAGE_BYTES` (`src/snapshot.js`) and was cut on a codepoint boundary.
- Lint items: `deadLinks` `{from, raw, line, archived}`; `ambiguousLinks` `{from, raw, line, candidates, archived}`; `orphans` `{path, index, archived}` (`index` null when no index is above the page); `unreachableIndexes` `{path, archived}`; `lowConfidence` `{path, confidence, archived}`; `stale` `{path, updated, ageDays, archived}` (`ageDays` null when `updated` is not a real date). `counts` holds each list's length. `rootIndex` is `"index.md"` or `null`.
- Search: at most `MAX_RESULTS` results (`truncated:true` when more matched), each with at most `MAX_SNIPPETS` snippet lines (`src/search.js`), each at most 200 characters.

### Page AST

`blocks` is the renderer's input. Block nodes: `{t:'h', level, id, c}`, `{t:'p', c}`, `{t:'pre', lang, text}`, `{t:'ul'|'ol', tight, start?, items:[[block]]}`, `{t:'quote', c:[block]}`, `{t:'table', align:[left|center|right|null], head:[cell], rows:[[cell]]}` (a cell is an inline list), `{t:'hr'}`. Inline nodes: `{t:'text', v}`, `{t:'code', v}`, `{t:'em'|'strong'|'del', c}`, and links:

```jsonc
{ "t": "link", "form": "wiki|md|auto", "raw": "[[x]]", "line": 12, "c": [/* label inlines */],
  "ref": "x",               // wiki form: the text inside [[ ]]
  "href": "dir/x.md",       // md/auto form: the destination (never entity-decoded)
  "kind": "page|ambiguous|dead|external|anchor|outside|blocked",
  "target": "global/x.md",  // kind page
  "candidates": ["…"] }     // kind ambiguous
```

### Errors

Real HTTP statuses with `{error, code}` (these are not MCP routes, so the `{result}` rule does not apply):

| Status | `code` | When |
|---|---|---|
| 400 | `SOURCE_REQUIRED` | `source` missing on `tree`/`page`/`lint` |
| 400 | `PATH_INVALID` | `path` missing or fails `validateRelPath` |
| 400 | `QUERY_INVALID` | `q` missing, or under 2 / over 200 characters after trimming |
| 404 | `SOURCE_UNKNOWN` | no listed source has that id |
| 404 | `NOT_FOUND` | no such page |
| 403 | `PATH_ESCAPES` | `path` resolves (through a symlink) outside the source root |

Any method other than `GET`/`HEAD` on any path except `/api/mcp` is `405` with `allow: GET, HEAD`. Unknown paths are `404 {error}`.

### Headers

Every browser response (API, static, 404, 405) carries:

- `x-content-type-options: nosniff`
- `content-security-policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`

So `frontend/` may contain no inline `<script>`, `<style>` or `style=` attribute. Static assets add `content-type` (`text/html`, `text/javascript`, `text/css`, each `; charset=utf-8`) and `cache-control: no-cache`. Only `/` (→ `index.html`) and flat names matching `^/[a-z0-9-]+\.(html|js|css)$` that exist in `frontend/` are served.
