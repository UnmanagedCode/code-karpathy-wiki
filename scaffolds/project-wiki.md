# Set up the project wiki

Set up this project's `.wiki/` of durable codebase knowledge (gotchas, decisions, glossary, architecture shape). The conductor has relayed the human's choice of in-tree vs out-of-tree below — follow whichever branch applies.

## In-tree (recommended)

Create `.wiki/` with:
- `index.md` — pointers to the pages below
- `overview.md` — what this project is and how it's structured
- a few starter `gotchas/` and `architecture/` pages seeded from what you find in the codebase

Commit these normally. They'll be present in every worktree and reviewed/merged like code.

## Out-of-tree

- Create `.wiki/` as a real directory (not committed).
- Add `.wiki` to `.git/info/exclude` — not `.gitignore` — so the repo itself stays pristine.
- Create, or if it already exists **append to** (never overwrite), `.code-conductor/post-worktree-create.sh`, adding logic that symlinks each new worktree's `.wiki` to the main checkout's `.wiki`. This hook runs from the parent/main checkout, so it doesn't need to be committed for the symlinking to work.

## Either way

Keep the seeded wiki lean and weighted toward gotchas, decisions, and glossary entries — not architecture prose.
