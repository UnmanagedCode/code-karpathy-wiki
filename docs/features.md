# Features

## The three-scope orchestrator wiki

`.conduct/wiki/` (machine-local, gitignored) splits into three scopes, each with its own `index.md`:

| Scope | Holds | Written by |
|---|---|---|
| `global/` | cross-project orchestration / host / worker lessons | conductor |
| `workspaces/<name>/` | facts true of **every** project in that workspace | conductor |
| `projects/<name>/` | conducting-only knowledge for one project — how to *drive* it, not its code | conductor |

Routing rule (`conventions/orchestrator-wiki.md`): write at the **narrowest scope the fact is true of**. A workspace-wide fact lives once under `workspaces/<name>/` and is cross-linked from each member's `projects/<name>/index.md` — never copied into them. This is the duplication the scope exists to prevent: before it, such facts were either repeated across every member project's pages or over-promoted to `global/`.

Workspace membership is mutable — projects move between workspaces, and deleting a workspace clears its members' `workspace` field — so a `workspaces/<name>/` page can outlive its group. The convention's "Maintain, don't just append" bullet covers re-homing or retiring an orphaned one.

Project codebase knowledge is **not** in this wiki: it belongs in that project's in-tree `<project>/.wiki/`, written by a worker under the `project-wiki` convention.

## `read_index` (MCP tool)

Entry point for wiki recall. One call returns the index pages for a scope set, so the conductor doesn't hand-walk the tree.

| Arguments | Reads |
|---|---|
| *(none)* | `index.md` + `global/index.md` |
| `workspace` | adds `workspaces/<name>/index.md` |
| `project` | adds `projects/<name>/index.md` **and** resolves that project's workspace from the host, adding its index too |

Both arguments may be given; the scopes are a **union deduped by path**, emitted broad → narrow (root, global, workspace, project). Bodies come back verbatim, each led by a one-line HTML comment naming its path so a body stays identifiable once blocks are flattened.

A scope with no page yet is listed in `meta.missing` with no body — **"no workspace wiki yet" is a normal answer, not an error.** Only a malformed `project`/`workspace` name is refused.

Nothing about capture depends on the tool.

Read-only by design: there is no write tool and no frontend. Pages are written by the conductor with ordinary file edits.

See `docs/protocol.md` for the wire contract and refusal codes, `docs/architecture.md` for how paths and workspaces are resolved.
