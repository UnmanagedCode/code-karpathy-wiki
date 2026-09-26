# code-karpathy-wiki

A code-conductor plugin that delivers an "LLM Wiki" as conventions and a seed scaffold, plus a read-only backend for reading the wikis: an MCP tool for the conductor and a **Wiki** browser page for the human.

It registers under the plugin id `code-wiki`, so its tools appear as `code-wiki__*` and its conventions as `code-wiki/<slug>`.

## What it does

It encodes a two-wiki model:

- **Project (worker) wiki** — `<project>/.wiki/`, in-tree, holds durable *codebase* knowledge (overview, architecture, gotchas, decisions, glossary). Written by that project's workers, reviewed/merged like code.
- **Orchestrator wiki** — `.conduct/wiki/`, machine-local and gitignored, holds the *conductor's* knowledge in three scopes, each with its own `index.md`: `global/` (cross-project orchestration/host/worker lessons), `workspaces/<name>/` (facts true of every project in a workspace), and `projects/<name>/` (conducting-only knowledge per project — how to drive it, not the codebase). Conductor-written.

It ships two conventions, one scaffold, one MCP tool and one browser page:

| Slug | Kind | Scope | Purpose |
|---|---|---|---|
| `project-wiki` | convention | project | Appended to a project's `CLAUDE.md`; tells every worker to read/update `.wiki/` as part of its normal reviewed diff. |
| `orchestrator-wiki` | convention | conductor | Composed into `.conduct/CONDUCT.md`; tells the conductor how to read/write `.conduct/wiki/`. |
| `project-wiki` (scaffold) | scaffold | — | One-time setup directive folded into the first worker's brief, to seed `.wiki/` in-tree or out-of-tree. |
| `read_index` | MCP tool | — | Returns the wiki index pages for a scope set — root + `global/`, optionally a project's and/or a workspace's. The entry point for wiki recall. |
| **Wiki** | browser page | — | Read-only browser in the conductor's nav: a tree per wiki (orchestrator + each local project's `.wiki/`), rendered pages with `[[name]]` resolution and backlinks, a Health (lint) view, and full-text search. |

Enable it in **Settings → Plugins**. The scaffold is declared inside the `project-wiki` convention entry, so picking that convention also fires the scaffold at project creation.

The `orchestrator-wiki` convention has `scope: "conductor"`. Conductor-scoped conventions require code-conductor support that is landing separately — until then this convention is authored to spec but cannot be enabled/validated in a running conductor.

Recall goes through `read_index`: the convention and the tool ship together, so the conductor never has one without the other.

See [docs/features.md](docs/features.md) for the scope routing rule, what `read_index` returns and the browser's link rules and health checks, [docs/protocol.md](docs/protocol.md) for the wire contract, and [docs/architecture.md](docs/architecture.md) for internals.

## Quick start

```sh
npm test          # node:test suite, no install step
node server.js    # standalone on :7200 (honours $PORT)
curl localhost:7200/api/health
```

Standalone, open `http://localhost:7200/` for the browser page (orchestrator wiki only: project wikis need `CONDUCTOR_URL`). Under the conductor it is the **Wiki** entry in the app switcher, served at `/plugins/code-wiki/`.

Under the conductor the backend is supervised: `$PORT`, `PROJECTS_ROOT` and `CONDUCTOR_URL` are injected at spawn.

## Technical description

Conventions/scaffolds plus a supervised backend, `pluginApi: 1`. **Zero npm dependencies** — `node:http` and `node:test` only, so a fresh clone works with no install step. Read-only: no write tools and no write routes. The frontend is plain ES modules served as-is — no build step. It's discovered as a plugin because it's a project directory containing `conductor.plugin.json`.

```
code-karpathy-wiki/
├── conductor.plugin.json       # manifest: conventions, scaffold, backend, mcp, frontend
├── server.js                   # node:http — /api/health, /api/mcp, browser API + static
├── src/
│   ├── paths.js                # PROJECTS_ROOT -> wikiRoot(), name safety
│   ├── wiki.js                 # readIndex() — the domain layer
│   ├── projects.js             # workspace resolution + local project wikis via CONDUCTOR_URL
│   ├── mcp.js                  # tool dispatch + envelope
│   ├── sources.js              # browsable wikis: orchestrator + local project .wiki/
│   ├── markdown.js             # zero-dep markdown subset -> AST
│   ├── links.js                # [[name]] / md link resolution
│   ├── snapshot.js             # walk + parse cache + backlinks
│   ├── lint.js                 # health checks
│   ├── search.js               # full-text search
│   ├── browse.js               # browser API handlers
│   └── static.js               # frontend asset serving
├── frontend/                   # index.html, app.js, render.js, tree.js, styles.css
├── conventions/
│   ├── project-wiki.md         # scope: project
│   └── orchestrator-wiki.md    # scope: conductor
├── scaffolds/
│   └── project-wiki.md         # declared by the project-wiki convention
├── docs/                       # features / protocol / architecture
└── tests/                      # node:test via tests/run.mjs
```

`conductor.plugin.json` fields: `id`, `name`, `version`, `pluginApi` at the top level; `conventions[]` as `{ slug, name, description, file, scope }` with `scope` one of `project`/`conductor`, each entry optionally carrying a nested `scaffold: { file }`; `backend` as `{ start, healthPath }`; `mcp` as `{ endpoint, tools[] }`; `frontend` as `{ path, navLabel }` (only those keys; it requires `backend`). All `file` paths are relative `.md` paths and must exist, and `version` must match `package.json`.

## Key defaults

| Thing | Default |
|---|---|
| Port | `$PORT`, else `7200`, bound to `127.0.0.1` |
| Wiki root | `$PROJECTS_ROOT/.conduct/wiki` (else this repo's parent dir) |
| Per-file cap | 64 KiB, reported via `meta.truncated` |
| Request body cap | 256 KiB |
| Conductor lookup timeout | 2 s |
| Browser page cap | `MAX_PAGE_BYTES` 1 MiB, flagged `truncated` |
| Stale after | `STALE_AFTER_DAYS` 90 days since front-matter `updated` |
| Search results cap | `MAX_RESULTS` 100, flagged `truncated` |
| Walk cap | `MAX_WALK_ENTRIES` 20000 entries per source, flagged `truncated` on tree and lint |
| Markdown nesting | `MAX_NESTING` 32 levels; deeper content is plain text |
| Browser mount | `/plugins/code-wiki/` under the conductor; every frontend URL is relative |

## Known limitations

- `scope: "conductor"` conventions aren't yet enabled by any released code-conductor version.
- Read-only by design — pages are written with ordinary file edits, not through this plugin.
- Workspace names are addressable only as single path segments. The host permits spaces and `/` in a workspace name; such a workspace gets no wiki directory, and `read_index` reports its scope in `meta.missing`.
- Workspace resolution needs `CONDUCTOR_URL`. Standalone, `read_index` still serves every explicitly named scope but reports `resolvedWorkspace: null`.
- The browser confines every walk entry and read by realpath (a symlink resolving outside a wiki root is omitted, or `403 PATH_ESCAPES`); `read_index` still does not — its containment assert guards against argument-driven traversal only. A swap between the realpath check and the read (TOCTOU) is accepted: exploiting either needs write access to the wiki tree.
- Project wikis are listed only for projects on the `local` system, and only when `CONDUCTOR_URL` is set.
- No live reload: pages are re-read on each view, the sidebar trees on ↻ or page reload.
- The markdown renderer is a subset: no indented code blocks, setext headings, reference-style links or images (an image shows as a link to its source). Raw HTML is shown as literal text. Leading tabs become 4-column stops (code blocks included), ordered lists always number from 1, and nesting past `MAX_NESTING` is plain text. An HTML comment inside a link construct is not transparent: in `[[a<!--x-->b]]`, `[t](a<!--x-->b.md)` or a link title, the comment's bytes stay in the target or label, or the link is not recognised.
- The page runs in an unsandboxed iframe on the host's origin, and the host has no auth, so the AST-only renderer plus the page's CSP are the XSS boundary.
- Search is AND-of-substrings over raw page text, sorted by title match then hit count — not ranked by relevance.

## License

This project is licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0+). Copyright © 2026 UnmanagedCode. See the [LICENSE](LICENSE) file for details.
