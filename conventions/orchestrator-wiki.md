# Orchestrator wiki

You (the conductor) keep a machine-local wiki at `.conduct/wiki/` (gitignored — never commit). It splits into `global/` (cross-project orchestration/host/worker lessons) and `projects/<name>/` (conducting-only knowledge for a project — how to *drive* it, not its code), each with its own `index.md`; those `index.md` files, not any hardcoded list, are the source of truth for which scopes/projects exist.

Distinct from a project's in-tree `<project>/.wiki/` — that is worker-written, reviewed as code, and holds codebase knowledge; this orchestrator wiki is conductor-written and holds conducting knowledge.

- **Recall:** read `.conduct/wiki/index.md` → the relevant scope's `index.md` → the page. (`MEMORY.md`, auto-loaded each session, is only a pointer to this wiki.)
- **Capture — route by kind:** a cross-project or conducting lesson → write a page under `global/` or `projects/<name>/` yourself (it's `.conduct/`, your own tree); a project *codebase* lesson → it goes in that project's in-tree `<project>/.wiki/`, which a spawned worker writes, not you (the hard boundary). When the harness prompts you to "save a memory," write the wiki page instead. Link the page from its scope's `index.md` and cross-link related pages `[[name]]`.
- **Page shape:** one page = one topic; optional frontmatter (`confidence:`, `updated:`); short body (for a lesson: What / Why / How to apply); cite code `path:line`, don't paste source.
- **Maintain, don't just append:** group facts into a page rather than piling entries; on contradiction supersede in place (fix, or add a `Superseded:` note — don't leave duplicates); tag confidence (`high`/`stated`/`low`); treat time-sensitive claims (`fix in progress`, `confirmed bug`, cited `path:line`) as stale until re-verified; opportunistically lint dead `[[links]]`/orphans and retire/merge/trim decayed or overlapping pages.
