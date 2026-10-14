---
type: workstream
title: Command Center roadmap fixes
branch: cc-roadmap-fixes
roadmap: ET
state: active
updated: 2026-10-14
---

# Command Center roadmap fixes

The hosted Command Center showed the roadmap chart in `docs/roadmap/README.md` as a link, not a picture. The hosted docs proxy (`/api/docs`) allowed only `.md` and `.png`, so the resolver did not treat `roadmap.svg` as a served picture. Fix: the proxy now serves `.svg` under `docs/` as `image/svg+xml` with a sandbox policy and `nosniff`, and the hosted link resolver treats it as a picture.

## Reporter stays up (2026-10-13)

Cause: the `SessionStart` hook saw only the start folder (`home-base`), and the reporter ends after 30 idle minutes, so nothing kept it up. Fix, by Mark's decision: no new Claude hook. A tray app (`tools/command-center/scripts/command-center-tray.ps1`, started by a desktop shortcut) runs the reporter without the idle exit and the local Command Center on port 3009. The session reader also counts worktree session folders (`claude.folderPrefixes`). Setup, shortcut target and manual test list: `tools/command-center/README.md`, step 5. The main session removes the `SessionStart` entry from `~/.claude/settings.json` after Mark's tray test.

## Tray verified (2026-10-13)

| Step | Change | Verdict |
|---|---|---|
| Round 1 on `5447f8f` | Runner, reader, attacker | No Critical. 4 Important: orphans after a tray crash, a false "hook removed" claim, silent errors, a UI freeze on Quit |
| Fix `161a6a8` | Job object (children end with the tray), Quit and Restart always stop, error balloons, timer-driven stop, 8 Minor fixes, static tests with mutants | Round 2 PASS, 2 Minor named |
| Fix `0772d0a` and the next commit | Stop time-out balloon. A dead lock owner frees the lock at once, and an owner that cannot be read still holds it | Unit tests and tsc exit 0, mutants fail |

## Your move rebuilt (2026-10-13)

Built from `docs/command-center/your-move-redesign.md`: one shared rule, three sources that clear themselves (decision issues, PRs that wait for Mark, live asks), and the wider reporter allow-list that Mark approved. `next_for_mark` is retired: the validator ignores it, so older branches do not go red.

| Step | Change | Verdict |
|---|---|---|
| Build `f076014`..`c7f8ca4` | Shared rule, live asks in the reporter, decision-coverage warning, `next_for_mark` removed | Round 1: runner PASS, reader and attacker FAIL. 4 Important: redaction gaps, future times never stale, coverage missed old answered issues, a strict reject of the old key |
| Fix `6954882` | Wider redaction, a 60 s future limit, coverage over every issue read, the old key ignored, 7 Minor fixes | Round 2 PASS. Known limit: a secret after a word that is not a secret word ("pass") is not redacted |

## Tray manual test (2026-10-13, Mark, headed)

| Step | Change | Verdict |
|---|---|---|
| Before the test | The tray from the worktree ran origin/main server code, which rejects `--no-idle-exit`. Fix `0f678b3`: tray `-Branch <name>` passes `--branch` to the launcher, and the README gives the pre-merge command | 1 verifier PASS, 1 Minor (a trailing newline passes the name check; not reachable from the command line) |
| README step 5 test list | Steps 1, 2, 4 to 9 by Mark: gray, amber, green; "already runs" balloon; hosted page and logs open; Restart gives new ids; a killed local server gives amber and a balloon; `reporter:stop` leaves local up; Quit and a killed tray leave no process and free ports; the next start takes over the stale lock at once | PASS. Step 3 (30 idle minutes) deferred: live Shadow Jog sessions kept it from being a real test; a unit test covers `--no-idle-exit` |
| Hook | The `SessionStart` entry for `reporter-hook.mjs` is removed from `~/.claude/settings.json` (Mark) | Done |
| Fix `7a67072` | The launcher "held lock" test used a fake owner pid, so it passed only while a real reporter held port 29417. It now names the test process. The update log line names the branch, not "main" | 1 verifier PASS, 103 tests and tsc exit 0, a forced takeover fails the test |

## PRs out of Your move, spikes hidden (2026-10-13)

Mark asked for two changes. (a) A PR showed twice, in "Your move" and in "Pull requests". It is now only in "Pull requests": the shared rule (`src/shared/your-move.ts`) has no PR input, the local builder reads three panels, and a cut or partial PR fetch no longer marks "Your move" incomplete. `YourMoveSource` lost `'pr'`. (b) The "never merge" spike PRs (open draft PRs from `spike/<topic>` branches: #3, #4, #11) are hidden from the Pull requests panel, and the "Open (n)" count counts only the PRs shown. One shared predicate, `isSpikePr` in `src/shared/spike-pr.ts`, serves the local and the hosted page. The hide is display-only: the snapshot, `/api/github` and the workstream matching by branch still hold the spikes. Tests: `spike-pr.test.tsx` (predicate and list), and the Your move tests no longer expect PR items.

Next: PR #85 is merged, and the desktop shortcut (README step 5) runs the tray. The branch is fast-forwarded to main. Mark picks the next round of Command Center work on this branch (keep the worktree).

Candidates for the next round (seen in the tray test, not built):
- A `home-base` session shows in Running only while its working folder is inside Shadow Jog, so a session that steps out for a moment drops off the list.
- The local page reads `status.md` from the main checkout's working tree, so it shows the checked-out branch (on `engine-et-editor-port` that is `milestone: none`, shown as "Not started" with empty squares), not `main`. Between milestones, "Not started" also hides that the last milestone is done.
