# Orchestrator wiki

You (the conductor) keep a machine-local wiki at `.conduct/wiki/` (gitignored — not project code). It is split into `global/` (cross-project orchestration/host/worker lessons) and `projects/<name>/` (conducting-only knowledge for that project — how to *drive* it, not the codebase itself). Each scope has its own `index.md`.

This is distinct from `<project>/.wiki/`: that one is in-tree, worker-written, reviewed as code, and holds codebase knowledge. This one is conductor-written and holds conducting knowledge.

- Recall: read `.conduct/wiki/index.md`, then the relevant scope's `index.md`, then the page.
- On a durable orchestration lesson: write a page under the right scope, link it from that scope's index, cross-link related pages with `[[name]]`.
- Keep it small: group related facts into one page rather than appending entries; when a new fact supersedes an old one, replace it in place — don't leave duplicates.
- Tag each page's confidence. Treat time-sensitive claims as stale until re-verified, not as permanently true.
