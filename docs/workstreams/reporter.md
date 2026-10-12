---
type: workstream
title: Command Center step 5, local reporter
branch: reporter
roadmap: cc-followups
state: review
next_for_mark:
  - Say go for the verifiers (runner, reader and attacker) and the PR of reporter (the build is done and pushed, no PR yet)
  - After the merge, make ~/.shadow-jog-cc/upstash.env (3 lines, see tools/command-center/README.md, section "The local reporter (step 5)")
  - After the merge, start the reporter once (npm run reporter in tools/command-center), then add the SessionStart hook to ~/.claude/settings.json (the exact entry is in the same README section)
updated: 2026-10-12
---

Step 5 of the Command Center revision 3 plan (`docs/command-center/design.md` sections 11.1 and 11.3). The local server, run headless, writes the allow-listed live state to the Upstash key `live`.

- Code: `tools/command-center/src/server/publish/` (mapper, worktrees, Upstash writer, protection check, loop), `scripts/reporter-launch.mjs` (pinned copy, lock, fetch every 2 minutes), `scripts/reporter-hook.mjs` (`SessionStart` hook). `main.ts --reporter` turns it on, on port 3011.
- Contract: `tools/command-center/src/shared/live.ts` (`parseLive` runs before every write; what it returns is what is sent).
- Runner: one new exact entry, `git status --porcelain=v1 --untracked-files=normal` (`GIT_STATUS`), for the dirty count.
- Tests: `tests/publish-*.test.ts`, `tests/reporter-launch.test.ts`, `tests/reporter-main.test.ts`, plus the runner table.
- Verifier fixes (2026-10-12): after 3 "no answer" checks in a row the reporter fails closed (key deleted, writes stop, checks every minute); titles and agent names are redacted for secret-shaped text; `--stop` kills only a process whose start time and command line match the lock; git runs asynchronously; a ready marker and a needs-install marker guard the pinned copy; no settings file means no fetch; smaller fixes to the supervise loop, the idle exit with a broken `collect`, the hook import and `git clone --`.
- Known limit: the worktree `path` in `live` is the full path (design 11.1 allows it). It shows the folder layout on a page that is behind the login.
- Not done: the real Upstash was never called (no token in this session). The workstream file frontmatter is not in `live` (the contract has no field). The reporter was not yet run from the pinned copy of `main` (it needs the merge first, or `--branch reporter`).
