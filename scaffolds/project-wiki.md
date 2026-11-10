# Set up the project wiki

Set up this project's `.wiki/`: durable codebase knowledge a reader can't quickly re-derive from the code or docs — gotchas, non-obvious decisions, glossary.

## 1. Ask where it lives

Ask the user with `AskUserQuestion`; don't choose for them. Put the tradeoff in the options:

- **In-tree (Recommended)** — `.wiki/` is committed: reviewed and merged like code, and present in every worktree. A wiki edit lands in the same diff as the change that taught it.
- **Out-of-tree** — `.wiki/` is untracked, excluded through `.git/info/exclude`, and lives in the main checkout. Every worktree sees that one live copy through a symlink. The repo carries no wiki, and an edit made in a worktree is deferred to the hand-off and applied in the main checkout after merge, never reviewed in a diff.

## 2a. In-tree

Create `.wiki/` in your checkout, seed it (step 3) and commit it.

## 2b. Out-of-tree

The main checkout is the first path `git worktree list` prints. Setting the wiki up is exempt from the convention's symlink rule: write the wiki there directly, even from a worktree.

1. Add `/.wiki` to the exclude file `git rev-parse --git-path info/exclude` names, unless it is already there. Every worktree shares that one file. The entry has no trailing slash, so it matches a worktree's symlink as well as the main checkout's directory.
2. Create `<main checkout>/.wiki/` as a real directory and seed it (step 3). Never `git add` it.
3. In your checkout, create `.code-conductor/post-worktree-create.sh` — or, if it exists, append to it; never overwrite it — with the block below, placed where an early `exit` can't skip it. cc runs the hook in each new worktree with `CC_WORKTREE_PATH` set to the worktree and `CC_PARENT_PATH` to the main checkout. The block adds the exclude entry once and links `${CC_PARENT_PATH}/.wiki` into the worktree, unless a `.wiki` is already there.
4. Commit the hook. cc reads it from the main checkout's working tree when it creates a worktree, tracked or not (it reports the hook's `source` as `in-tree`), so a hook written in a worktree takes effect once merged.
5. The hook runs only when a worktree is created: a worktree that existed before `.wiki` did, yours included, has no link. Make one where needed with `ln -s <main checkout>/.wiki .wiki` at the worktree root.

```bash
# Project wiki (out-of-tree): exclude it, then link the main checkout's copy.
# --git-path finds the exclude file every worktree shares; '/.wiki' has no
# trailing slash so it also matches the symlink.
(
    cd "${CC_WORKTREE_PATH:?CC_WORKTREE_PATH is unset}" || exit 1
    WIKI_EXCLUDE="$(git rev-parse --git-path info/exclude)"
    if ! grep -qxF '/.wiki' "$WIKI_EXCLUDE" 2>/dev/null; then
        mkdir -p "$(dirname "$WIKI_EXCLUDE")"
        if [ -s "$WIKI_EXCLUDE" ] && [ -n "$(tail -c1 "$WIKI_EXCLUDE")" ]; then echo >> "$WIKI_EXCLUDE"; fi
        echo '/.wiki' >> "$WIKI_EXCLUDE"
    fi
    WIKI_PARENT="${CC_PARENT_PATH:?CC_PARENT_PATH is unset}/.wiki"
    if [ ! -e .wiki ] && [ ! -L .wiki ]; then
        if [ -d "$WIKI_PARENT" ]; then
            ln -s "$WIKI_PARENT" .wiki
        else
            echo "[post-worktree-create] WARNING: ${WIKI_PARENT} not found; no .wiki symlink." >&2
        fi
    fi
)
```

## 3. Seed

- `index.md`, pointing at every page below.
- `overview.md`: where this project's facts already live (`README.md`, `docs/`, entry points), so the wiki doesn't restate them.
- A page for each real gotcha, decision or term you found reading the codebase — a few at most.
