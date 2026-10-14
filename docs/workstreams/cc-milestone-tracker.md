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

Cause: the strip had no way to show a done milestone except by the hand-set `milestone:` key of `status.md`. The key was `none` between milestones, so every square was empty. The ET row also sat after M8 in the table of `docs/engine/migration.md`.

Design (Mark, 2026-10-14): the strip always shows completed milestones, and shows a current one only when a session sets the key because it works on that milestone. This session does not mark M8 active: another session owns M8. A first try (key `M8`, done = rows before the current one) failed the roadmap test and was replaced.

- A square is done when its item in `docs/roadmap/roadmap.json` has status `done`.
- A square is current when the `milestone:` key names it. Current wins over done.
- With the key `none`, the label says `None active`.
- An unreadable `roadmap.json` makes the strip say Unavailable, never a blank strip.
- The ET row is above M8. A test reads the real files.

## Running panel (Mark, 2026-10-14)

Mark's two sessions did not show in Running. Three causes: transcript cwd in `/c/...` form was outside the roots, the shell reset put the newest cwd on `home-base`, and sibling worktrees were not roots. Fix: MSYS path rule, launch-folder rule (200 recent cwd lines, 256 KB window), worktree roots from `git worktree list`, and the Your move box follows the same rules.

| Step | Verdict |
|---|---|
| Round 1: runner and reader | Runner PASS. Reader: 3 Important (Your move, read cost, stale stint) |
| Round 2: named findings | PASS. 1 Minor: the 4 MB fallback has no direct test |
| Not done | The Sessions page (`sessions.ts`) has no launch folder, so the newest cwd still decides there |
