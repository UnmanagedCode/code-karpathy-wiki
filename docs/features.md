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

Read-only by design: there is no write tool. Pages are written by the conductor with ordinary file edits.

## Wiki browser (page)

A read-only page for the human, opened from the **Wiki** entry in the conductor's app switcher (`frontend.navLabel`). Standalone it is served at `http://localhost:7200/`. Nothing in it writes: the backend has no write route, and every non-GET/HEAD request to a browser path is `405`.

### Sources

| Source | Id | Listed when |
|---|---|---|
| Orchestrator wiki `.conduct/wiki/` | `orchestrator` | always (an absent dir is an empty tree) |
| A project's in-tree `<project>/.wiki/` | `p:<name>` | `CONDUCTOR_URL` is set, the host row's `system` is `local` (or absent), its `path` is absolute, and `<path>/.wiki` is a directory (a symlinked `.wiki` counts) |

Remote-system projects, degraded rows (`path: ''`) and worktrees are never listed. A failing conductor lookup leaves the orchestrator only.

Entries whose name starts with `.` (e.g. `.prune-progress.md`) are hidden everywhere: tree, pages, search, health.

A page that exists but cannot be read or parsed is still listed and opens with a banner saying so (its body, links and search text are empty); an unreadable directory is badged "unreadable", and an unreadable wiki root shows an error banner instead of "No pages yet". A source whose walk hits `MAX_WALK_ENTRIES` (`src/snapshot.js`) — only possible through symlinked directories multiplying paths — shows "Tree truncated" in the sidebar and a notice on its Health view.

### Layout

- **Sidebar** — a search box, then one tree per source (orchestrator first). Trees follow the directory structure; a directory's `index.md` is its landing page (click the directory name), not a child entry. Top-level directories start open. `global/archive/` is dimmed, italic, badged "archive — not in recall path", and starts collapsed. Each source has a **Health** link. ↻ reloads the trees.
- **Page** — breadcrumb, front-matter chips (`confidence`, `updated`, a `stale` badge), an archived banner for `global/archive/**`, a truncation notice past `MAX_PAGE_BYTES`, the rendered body, and **Backlinks**: every page with a resolved link (either form) to this one, excluding itself.
- Routes are hash-based: `#/page/<sourceId>/<path>`, `#/health/<sourceId>`, `#/search?q=`. The default is the orchestrator's `index.md`.

### Link rules

`[[target]]`, `[[target|label]]` and `[[target#fragment]]` (label and fragment ignored for resolution; a trailing `.md` is stripped). Links inside code spans and fenced blocks are never links.

**Scope** of the page doing the linking: in the orchestrator wiki, `global/…` → `global`, `workspaces/<w>/…` → `workspaces/<w>`, `projects/<p>/…` → `projects/<p>`, anything else (the root `index.md`) → the whole wiki. A project wiki is a single scope.

**Name index**: each non-index page `…/name.md` is keyed `name`; each directory (not the root) holding an `index.md` is keyed by its directory name, targeting that index. `index.md` is never keyed `index`, so `[[index]]` never resolves.

1. **Bare name** `[[name]]` — candidates from the name index. Exactly one in the page's scope → that page. More than one in scope → **ambiguous**. None in scope → exactly one anywhere → that page; several → ambiguous; none → **dead**. No other tiebreak. `[[worker-trust]]` resolves to `global/worker-trust/index.md`; `foo.md` next to `foo/index.md` is ambiguous.
2. **Page-relative path** `[[./x]]`, `[[../fam/x]]` — relative to the linking page's directory.
3. **Other paths** `[[a/b]]` — relative to the scope root, then the wiki root. At each base, `a/b.md` and `a/b/index.md` are tried: one hit resolves, two are ambiguous.
4. A path climbing out of the wiki root is dead.

**Markdown links** `[text](dest)` and autolinks `<https://…>`:

| Destination | Result |
|---|---|
| `http:` / `https:` | external, opens in a new tab |
| any other scheme (`javascript:`, `data:`, `file:`, `mailto:`, …), `//host` | blocked, rendered inert |
| no path — empty, or only `?query`/`?query#fragment` (e.g. `[x]()`, `[x](?q)`, `[x](?#f)`) | outside, rendered inert (not a health item) |
| `#fragment` | scrolls to that heading on the same page |
| leading `/`, or a relative path outside the wiki root | outside, rendered inert (not a health item) |
| relative, ending `/` or naming a directory | that directory's `index.md` (dead if absent) |
| relative `.md` | the page, or dead if absent (`?query`/`#fragment` stripped, `%xx` decoded) |
| relative, any other extension | outside, rendered inert |

Dead links render struck through; ambiguous links list their candidates as links.

### Health

Per source, from `#/health/<sourceId>`. Archive pages are checked too; their items are dimmed.

| Check | Definition |
|---|---|
| Dead links | every link whose resolution is dead, with page and line |
| Ambiguous links | every link with several candidates, listing them |
| Orphans | every page but the root `index.md` that its **nearest index** does not link to. The nearest index is the first `index.md` walking up from the page's directory (from the parent directory for an `index.md` itself), other than the page. No index above → orphan with `index: null`. |
| Unreachable indexes | every `index.md` not reached from the root `index.md` by following links **out of index pages only**. No root index → all unreachable. |
| Low confidence | front-matter `confidence` matching `/^low\b/i` |
| Stale | front-matter `updated` a real `YYYY-MM-DD` more than `STALE_AFTER_DAYS` (`src/lint.js`) days old, or present but not such a date |

### Search

The sidebar box searches every source (the API also takes a single `source`). The query is trimmed, 2–200 characters; whitespace-separated terms are matched **case-insensitively as substrings, all required**, over the raw page text including front matter. Results show source, title, path and up to `MAX_SNIPPETS` matching lines with the terms highlighted; title matches sort first, then hit count. At most `MAX_RESULTS` (`src/search.js`) results.

### Rendering

A markdown subset: ATX headings, paragraphs, emphasis/strong/strikethrough, code spans, fenced code (```` ``` ```` or `~~~`), block quotes, nested lists, GFM tables with alignment, thematic breaks, links. Not supported: indented code blocks, setext headings, reference-style links, images (shown as a link labelled by the alt text). Raw HTML is shown as literal text; HTML comments are dropped. A `<!--` with no closing `-->` is shown as literal text and the rest of the page parses normally.

- Leading tabs expand to the next multiple of 4 columns before parsing, inside fenced code too.
- Ordered lists always number from 1 on screen; the source's starting number is not shown.
- Quotes/lists nested deeper than `MAX_NESTING` (`src/markdown.js`) levels, and emphasis nested deeper than that, are shown as plain text from that depth on (no links are recognised there).

See `docs/protocol.md` for the wire contract and refusal codes, `docs/architecture.md` for how paths and workspaces are resolved and how the browser is confined.
