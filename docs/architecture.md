# Architecture

## Layout

```
server.js          node:http server — routing, body cap, listen/retry
src/paths.js       PROJECTS_ROOT -> wikiRoot(), SEGMENT_RE, safeJoin(), relLabel()
src/wiki.js        readIndex() — the domain layer; MAX_FILE_BYTES
src/projects.js    workspace resolution via CONDUCTOR_URL; the test seam
src/mcp.js         envelope only: {tool, arguments} -> {status, body}
tests/             node:test via tests/run.mjs
```

The layers are split so tests can hit each one without the one below: `wiki.readIndex` for domain behaviour, `mcp.handle` for the envelope, a real socket only for transport. `src/projects.js` exists to isolate the single network call behind a swappable fetcher, which keeps the whole suite offline.

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

`path.resolve` does not follow symlinks, so a symlinked directory under `.conduct/wiki/` could point outside. Accepted: `.conduct/` is the conductor's own tree, and this plugin's `scaffolds/project-wiki.md` explicitly endorses symlinked wiki directories for the out-of-tree layout. The containment assert defends against argument-driven traversal, not against a hostile filesystem.

## Workspace resolution

`GET ${CONDUCTOR_URL}/api/projects` → find the row whose `name` matches → take its `workspace` field. Accepts a bare array or `{projects:[…]}`.

**No filesystem fallback.** Workspace membership is host state with no on-disk representation we may read, so the `CONDUCTOR_URL` guard sits ahead of the fetcher: with no conductor context the function does no work at all — no network *and* no disk — and returns `null`.

`workspaceForProject()` never throws and never refuses. Timeout, non-200, non-JSON, project absent, project unassigned — every path collapses to `null`, surfacing as `meta.resolvedWorkspace: null`. Fetch timeout is 2 s: the conductor is on loopback, and blocking the host's 30 s MCP budget to fetch one optional extra index is a bad trade when every other scope resolves without it.

## Truncation

`MAX_FILE_BYTES = 64 * 1024`, a module constant. Files are read as a `Buffer` — you cannot cap bytes on a decoded string. `truncateUtf8` walks back from the cut point over UTF-8 continuation bytes (`0b10xxxxxx`) and drops the straddling sequence whole. Deliberately not `TextDecoder` in non-fatal mode, which would substitute a `U+FFFD` the source file never contained.

Sizing: live index pages run ~6 KiB and the largest wiki page ~36 KiB, so the cap never bites in practice while bounding a worst case of 5 scopes × 64 KiB ≈ 320 KiB per call. There is no total cap.

## Test patterns

`tests/run.mjs` drives `node:test` through its **programmatic API** — some node wrappers hoist leading `--flags` into `NODE_OPTIONS`, which rejects `--test`. Files run at `concurrency: 1`: `PROJECTS_ROOT`, `CONDUCTOR_URL` and the module-global fetcher are process globals set per test, and concurrency would race them.

`tests/_helpers.mjs` gives each test a `mkdtemp` fixture wiki via `PROJECTS_ROOT` and a `resetEnv()` that runs in `finally`, so any file order passes. `useProjects(rows)` stubs the host list through `_setProjectFetcher` and returns a call counter — that counter is how the "no `CONDUCTOR_URL` → no work" contract is asserted. Tests never touch the real `.conduct/` tree.
