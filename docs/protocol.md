# Protocol

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`/`HEAD` | `/api/health` | readiness/liveness probe → `200 {"ok":true}` |
| `POST` | `/api/mcp` | the single MCP tool endpoint |

Manifest: `backend {start:"node server.js", healthPath:"/api/health"}`, `mcp {endpoint:"/api/mcp"}`. `mcp` requires `backend`. No `frontend` block.

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
