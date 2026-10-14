---
type: workstream
title: Command Center roadmap fixes
branch: cc-roadmap-fixes
roadmap: ET
state: merged
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

Mark asked for two changes. (a) A PR showed twice, in "Your move" and in "Pull requests". It is now only in "Pull requests": the shared rule (`src/shared/your-move.ts`) has no PR input, the local builder reads three panels, and a cut list of PRs does not mark "Your move" incomplete (a partial GraphQL read does, on the hosted page, because one query also holds the decisions). `YourMoveSource` lost `'pr'`. (b) The "never merge" spike PRs (open draft PRs from `spike/<topic>` branches: #3, #4, #11) are hidden from the Pull requests panel, and the "Open (n)" count counts only the PRs shown. One shared predicate, `isSpikePr` in `src/shared/spike-pr.ts`, serves the local and the hosted page. The hide is display-only: the snapshot, `/api/github` and the workstream matching by branch still hold the spikes. Tests: `spike-pr.test.tsx` (predicate and list), and the Your move tests no longer expect PR items.

Seen in the tray test, not built (the current list is in "Closed" below):
- A `home-base` session shows in Running only while its working folder is inside Shadow Jog, so a session that steps out for a moment drops off the list.
- The local page reads `status.md` from the main checkout's working tree, so it shows the checked-out branch (on `engine-et-editor-port` that is `milestone: none`, shown as "Not started" with empty squares), not `main`. Between milestones, "Not started" also hides that the last milestone is done. Dropped by Mark (2026-10-14): local-only.

## One header on every page (2026-10-14)

Mark asked for a header that does not move: "The nav jumps between pages." Each page built its own header (large title and unmarked nav on Now, nav beside the title and the search on Docs). Now one component, `SiteHeader` (`src/web/SiteHeader.tsx`), is drawn once by `App` above every page, outside the error boundary. It is the compact, sticky style: the small title, the links at the right edge, `Now`, `Roadmap`, `Docs`, `Agents` (and `Workstreams` in the hosted build). The page name is a heading in the page body (the Now page has `Now`). The Docs search box moved to a row at the top of the Docs body, at the right. The page keeps room for its scroll bar (`scrollbar-gutter: stable`), so a short page and a long page put the links at the same x. Measured at 1280 px on Now, Roadmap, Docs and Agents: nav at x 1024.4, width 216.6, header height 49 on all four.

| Step | Change | Verdict |
|---|---|---|
| Build | `SiteHeader`, four page headers removed, `scrollbar-gutter`, search row. `tests/site-header.test.tsx` (every route, local and hosted, a scan that no other file holds the Main nav). `e2e/site-header.spec.ts` (pixel match at 1280, phone fit, search only on Docs) | Unit tests, tsc and biome lint exit 0. Touched Playwright specs pass, headless |

## Header round fixes and Docs title row (2026-10-14)

Fix round for the verifier findings on the PR and spike change and on the shared header. The Docs page now has the title (the h1) and the search box on one row, so the side nav and the text start higher (Mark's ask).

| Step | Change | Verdict |
|---|---|---|
| F1 | Hosted Your move: a `graphql*` snapshot problem (not only `decision*`) marks the decision source incomplete, because one query holds branches, PRs and decisions. Test: `graphql-partial` flags it, PR-only codes do not | Unit tests pass |
| F2 | `your-move-redesign.md` and this file say the same: a cut PR list does not mark it, a partial GraphQL read does | Done |
| F3 | `hosted.spec.ts`, `now.spec.ts`: no PR in Your move, no `Pull request:` line, `Open (4)`, the spike PR is not in the panel | Pass |
| F4 | The header rule is `border-cc-rule` (the panels' line). A text that a scroll leaves half under the header no longer has the bright rule behind it. `e2e/look.ts` skips a text that is wholly under the sticky header (a person cannot see it) | `now.spec.ts` contrast test passes, spec unchanged |
| F5 | The glass canvas is `window.innerWidth` px wide (`WindowCanvas`): `100vw` leaves out the scroll bar room now that `scrollbar-gutter: stable` is on. Steady nav kept | `now.spec.ts` canvas test passes, spec unchanged |
| F6 | `tests/docs-search-row.test.tsx` (real `DocsRoutes`): the search box is on the Docs pages and on no other page | Pass |
| Docs row | `DocTitle` portals the h1 into the row in `DocsRoutes`. `DocView` draws the h1 that opens a doc there, above the details. Specs that looked for the h1 inside the Document region now look on the page | Pass |

## PR #88 merged (2026-10-14)

Mark merged PR #88 (PRs out of Your move, spike PRs hidden, one shared header, Docs title on the search row). CI found one stale e2e locator in `e2e/engine.spec.ts` after the PR opened; fixed in `a8dc02b`. The branch is fast-forwarded to main `cf5fb22`.

## Closed (2026-10-14)

Mark closed this workstream: "That's all for now." This PR carries the workstream record to `main`. Open candidates, not built: a `home-base` session drops off Running when its folder leaves Shadow Jog (`src/server/sessions/discover.ts`); ghost sessions after pid reuse; the reporter re-reads up to 1 MiB per live session every 3 seconds; the `$` branch-name nit in `command-center-tray.ps1`. Mark uses only the hosted page; local-only work is out of scope.
