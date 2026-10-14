---
type: workstream
title: Command Center milestone strip fix
branch: cc-milestone-tracker
roadmap: ET
state: review
updated: 2026-10-14
---

# Command Center milestone strip fix

Mark saw 15 empty squares and "Not started" in the Status panel although M0 to M7 and ET are merged.

Cause: `milestone: none` in `status.md` (stale), and the ET row sat after M8 in the table of `docs/engine/migration.md`. The strip code is right: it already draws done squares before the current one.

Design (Mark, 2026-10-14): keep the `milestone:` key. Done means rows before the current one. Order the rows by when they started.

Pass lines: ET row above M8. Key is `M8`. A test reads the real `status.md` and table and fails on a bad key or ET after M8. README states the order rule.

## Running panel (Mark, 2026-10-14)

Mark's two sessions did not show in Running. Three causes: transcript cwd in `/c/...` form was outside the roots, the shell reset put the newest cwd on `home-base`, and sibling worktrees were not roots. Fix: MSYS path rule, launch-folder rule (200 recent cwd lines, 256 KB window), worktree roots from `git worktree list`, and the Your move box follows the same rules.

| Step | Verdict |
|---|---|
| Round 1: runner and reader | Runner PASS. Reader: 3 Important (Your move, read cost, stale stint) |
| Round 2: named findings | PASS. 1 Minor: the 4 MB fallback has no direct test |
| Not done | The Sessions page (`sessions.ts`) has no launch folder, so the newest cwd still decides there |
