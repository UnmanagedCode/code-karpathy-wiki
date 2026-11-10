# Project wiki

This project keeps a `.wiki/` of durable codebase knowledge a reader can't quickly re-derive from the code or docs: gotchas, non-obvious decisions, glossary.

- **Before planning:** read `.wiki/index.md`, then the category index it routes you to, if any, then the 1–3 pages relevant to your task.
- **When you learn something durable, record it.** Where depends on what `.wiki` is in your checkout:
  - **A symlink** — an out-of-tree wiki seen from a worktree. Don't write to it, through the link or by any other path. Put the exact page edits in your hand-off under a `Deferred .wiki edits` heading, to be applied in the main checkout after merge.
  - **Missing** — don't create it unless your brief is setting the wiki up; defer your edits as for a symlink.
  - **A directory** — edit the pages in the same diff as the change that taught you, not a separate commit. If `git check-ignore -q .wiki` succeeds (an out-of-tree main checkout), edit it in place and leave it uncommitted.
- **Before writing a page or a deferred edit, invoke the `cc-project-code-wiki:project-wiki` skill.**

<!-- cc:skill Use when writing or editing a project wiki page or a deferred wiki edit. -->

# Writing project wiki pages

## What a page holds

- One topic per page, under a category directory: `gotchas/`, `decisions/`, `glossary/`, or a new one when none fits.
- Architecture earns a page only as the non-obvious reason behind a shape (a decision) or the trap in it (a gotcha). A structure a reader can re-derive from the tree belongs in `docs/` or nowhere.
- Keep the body short; a lesson reads What / Why / How to apply.
- Cite code by symbol, constant, test title or bare file path, never a line number; don't paste source.
- The workspace rules under "Content that outlives its author", such as no development history and no machine-specific content, bind every page, tracked or not.
- Cross-link related pages with `[[name]]`; it resolves by page name, so it survives a move. Keep page names unique across the wiki.

## Index shape

- After its header, an `index.md` holds pointers only: one line per page, `[name](path) — hook`.
- The hook is the lesson itself: rule-shaped, short enough that the index scans as a rulebook.
- A fact too small for its own page still gets one, never an index-only entry.
- When a flat index stops scanning, give each category directory its own `index.md` holding its pages' lines, and make the root `index.md` route: one line per category, `[category](category/index.md) — what it covers`.

## Upkeep

- Before starting a page, look for an existing one on the topic and add the fact there.
- When the truth changes, edit the page; never append a correction. On a contradiction, rewrite the claim in place.
- A page marked `reviewed: true` is never overwritten: merge your change into it.
- When a page moves or is renamed, update every index line and link that points to it.

## Deferred edits

Give each as the page path plus the text to apply: the whole page when it is new, the replaced and replacing text when it exists. Include the index lines the edit adds or changes.
