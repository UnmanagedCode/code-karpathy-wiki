# code-karpathy-wiki

A [code-conductor](https://github.com/) plugin that delivers an "LLM Wiki" as conventions and a seed scaffold — no backend, frontend, or MCP tools.

## What it does

It encodes a two-wiki model:

- **Project (worker) wiki** — `<project>/.wiki/`, in-tree, holds durable *codebase* knowledge (overview, architecture, gotchas, decisions, glossary). Written by that project's workers, reviewed/merged like code.
- **Orchestrator wiki** — `.conduct/wiki/`, machine-local and gitignored, holds the *conductor's* knowledge: `global/` (cross-project orchestration/host/worker lessons) plus `projects/<name>/` (conducting-only knowledge per project — how to drive it, not the codebase), each with its own `index.md`. Conductor-written.

It ships two conventions and one scaffold:

| Slug | Kind | Scope | Purpose |
|---|---|---|---|
| `project-wiki` | convention | project | Appended to a project's `CLAUDE.md`; tells every worker to read/update `.wiki/` as part of its normal reviewed diff. |
| `orchestrator-wiki` | convention | conductor | Composed into `.conduct/CONDUCT.md`; tells the conductor how to read/write `.conduct/wiki/`. |
| `project-wiki` (scaffold) | scaffold | — | One-time setup directive folded into the first worker's brief, to seed `.wiki/` in-tree or out-of-tree. |

Enable it in **Settings → Plugins**. The scaffold shares its slug with the project convention, so picking that convention also fires the scaffold at project creation.

The `orchestrator-wiki` convention has `scope: "conductor"`. Conductor-scoped conventions require code-conductor support that is landing separately — until then this convention is authored to spec but cannot be enabled/validated in a running conductor.

## Technical description

Conventions/scaffolds-only plugin, `pluginApi: 1`. No backend, frontend, or MCP server — the whole plugin is a manifest plus markdown fragments. It's discovered as a plugin because it's a project directory containing `conductor.plugin.json`.

```
code-karpathy-wiki/
├── conductor.plugin.json       # manifest: 2 conventions + 1 scaffold
├── conventions/
│   ├── project-wiki.md         # scope: project
│   └── orchestrator-wiki.md    # scope: conductor
└── scaffolds/
    └── project-wiki.md         # slug matches the project-wiki convention
```

`conductor.plugin.json` fields: `id`, `name`, `version`, `pluginApi` at the top level; `conventions[]` as `{ slug, name, description, file, scope }` with `scope` one of `project`/`conductor`; `scaffolds[]` as `{ slug, name, description, file }` (a scaffold declares exactly one of `text` or `file` — this plugin uses `file` for its one scaffold). All `file` paths are relative `.md` paths and must exist.

## Known limitations

- `scope: "conductor"` conventions aren't yet enabled by any released code-conductor version.
- No automated validation is bundled here; correctness is by manual inspection against the manifest schema.

## License

This project is licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0+). Copyright © 2026 UnmanagedCode. See the [LICENSE](LICENSE) file for details.
