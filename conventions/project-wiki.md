# Project wiki

This project keeps a `.wiki/` of durable codebase knowledge: gotchas, non-obvious decisions, glossary, architecture shape.

- Before planning: read `.wiki/index.md`, then the 1–3 pages it points to that are relevant to your task.
- When you learn something durable (a gotcha, a non-obvious decision or distinction, a subsystem's shape), add or update the relevant page and refresh `index.md` in the same reviewed diff — not a separate commit.
- One topic per page. Cite `path:line` instead of pasting code.
- If a page is marked `reviewed: true`, don't overwrite it — merge your update into it.
- Weight content toward gotchas, decisions, and glossary (things a reader can't quickly re-derive from the code), not architecture prose.
