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

Cause: the `SessionStart` hook saw only the start folder (`home-base`), and the reporter ends after 30 idle minutes, so nothing kept it up. Fix, by Mark's decision: no new Claude hook. A tray app (`tools/command-center/scripts/command-center-tray.ps1`, started by a desktop shortcut) runs the reporter without the idle exit and the local Command Center on port 3009. The session reader also counts worktree session folders (`claude.folderPrefixes`). Setup, shortcut target and manual test list: `tools/command-center/README.md`, step 5. The main session removes the `SessionStart` entry from `~/.claude/settings.json`.
