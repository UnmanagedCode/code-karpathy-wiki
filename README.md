# code-karpathy-wiki

A code-conductor plugin that delivers an "LLM Wiki" as conventions and a seed scaffold, plus a read-only MCP backend for reading the conductor's wiki.

## What it does

It encodes a two-wiki model:

- **Project (worker) wiki** — `<project>/.wiki/`, in-tree, holds durable *codebase* knowledge (overview, architecture, gotchas, decisions, glossary). Written by that project's workers, reviewed/merged like code.
- **Orchestrator wiki** — `.conduct/wiki/`, machine-local and gitignored, holds the *conductor's* knowledge in three scopes, each with its own `index.md`: `global/` (cross-project orchestration/host/worker lessons), `workspaces/<name>/` (facts true of every project in a workspace), and `projects/<name>/` (conducting-only knowledge per project — how to drive it, not the codebase). Conductor-written.

It ships two conventions, one scaffold, and one MCP tool:

| Slug | Kind | Scope | Purpose |
|---|---|---|---|
| `project-wiki` | convention | project | Appended to a project's `CLAUDE.md`; tells every worker to read/update `.wiki/` as part of its normal reviewed diff. |
| `orchestrator-wiki` | convention | conductor | Composed into `.conduct/CONDUCT.md`; tells the conductor how to read/write `.conduct/wiki/`. |
| `project-wiki` (scaffold) | scaffold | — | One-time setup directive folded into the first worker's brief, to seed `.wiki/` in-tree or out-of-tree. |
| `read_index` | MCP tool | — | Returns the wiki index pages for a scope set — root + `global/`, optionally a project's and/or a workspace's. The entry point for wiki recall. |

Enable it in **Settings → Plugins**. The scaffold is declared inside the `project-wiki` convention entry, so picking that convention also fires the scaffold at project creation.

The `orchestrator-wiki` convention has `scope: "conductor"`. Conductor-scoped conventions require code-conductor support that is landing separately — until then this convention is authored to spec but cannot be enabled/validated in a running conductor.

Recall is tool-first but degrades: if the plugin is disabled or its backend is down, the convention tells the conductor to read the `index.md` files directly.

See [docs/features.md](docs/features.md) for the scope routing rule and what `read_index` returns, [docs/protocol.md](docs/protocol.md) for the wire contract, and [docs/architecture.md](docs/architecture.md) for internals.

## Quick start

```sh
npm test          # node:test suite, no install step
node server.js    # standalone on :7200 (honours $PORT)
curl localhost:7200/api/health
```

Under the conductor the backend is supervised: `$PORT`, `PROJECTS_ROOT` and `CONDUCTOR_URL` are injected at spawn.

## Technical description

Conventions/scaffolds plus a supervised backend, `pluginApi: 1`. **Zero npm dependencies** — `node:http` and `node:test` only, so a fresh clone works with no install step. Read-only: no write tools, and no frontend. It's discovered as a plugin because it's a project directory containing `conductor.plugin.json`.

```
code-karpathy-wiki/
├── conductor.plugin.json       # manifest: 2 conventions + 1 scaffold + backend + mcp
├── server.js                   # node:http — /api/health, /api/mcp
├── src/
│   ├── paths.js                # PROJECTS_ROOT -> wikiRoot(), name safety
│   ├── wiki.js                 # readIndex() — the domain layer
│   ├── projects.js             # workspace resolution via CONDUCTOR_URL
│   └── mcp.js                  # tool dispatch + envelope
├── conventions/
│   ├── project-wiki.md         # scope: project
│   └── orchestrator-wiki.md    # scope: conductor
├── scaffolds/
│   └── project-wiki.md         # declared by the project-wiki convention
├── docs/                       # features / protocol / architecture
└── tests/                      # node:test via tests/run.mjs
```

`conductor.plugin.json` fields: `id`, `name`, `version`, `pluginApi` at the top level; `conventions[]` as `{ slug, name, description, file, scope }` with `scope` one of `project`/`conductor`, each entry optionally carrying a nested `scaffold: { file }`; `backend` as `{ start, healthPath }`; `mcp` as `{ endpoint, tools[] }`. All `file` paths are relative `.md` paths and must exist, and `version` must match `package.json`.

## Key defaults

| Thing | Default |
|---|---|
| Port | `$PORT`, else `7200`, bound to `127.0.0.1` |
| Wiki root | `$PROJECTS_ROOT/.conduct/wiki` (else this repo's parent dir) |
| Per-file cap | 64 KiB, reported via `meta.truncated` |
| Request body cap | 256 KiB |
| Conductor lookup timeout | 2 s |

## Known limitations

- `scope: "conductor"` conventions aren't yet enabled by any released code-conductor version.
- Read-only by design — pages are written with ordinary file edits, not through this plugin.
- Workspace names are addressable only as single path segments. The host permits spaces and `/` in a workspace name; such a workspace gets no wiki directory, and `read_index` reports its scope in `meta.missing`.
- Workspace resolution needs `CONDUCTOR_URL`. Standalone, `read_index` still serves every explicitly named scope but reports `resolvedWorkspace: null`.
- The containment assert guards against argument-driven traversal, not against symlinks placed inside `.conduct/wiki/`.

## License

This project is licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0+). Copyright © 2026 UnmanagedCode. See the [LICENSE](LICENSE) file for details.
