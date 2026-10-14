---
type: workstream
title: Command Center roadmap fixes
branch: cc-roadmap-fixes
roadmap: ET
state: active
updated: 2026-10-13
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

Next: Mark runs the manual tray test in README step 5 (headed, needs his go-ahead). Then the Your move build.
