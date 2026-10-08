---
type: plan
title: "Shadow Jog Command Center — Revision 2 plan"
project: shadow-jog
created: 2026-10-07
updated: 2026-10-07
status: draft for Mark's review
tags: [tooling, command-center, plan]
---

# Shadow Jog Command Center — Revision 2 plan

> For agentic workers: use superpowers:subagent-driven-development. Steps use - [ ] checkboxes.

- **Goal:** Build revision 2 of the Command Center: labels and links on every page, a Status summary, Copy and Download on doc pages, and a live Agents diagram.
- **Spec:** [design.md](design.md), sections 2.1, 5.1, 5.2, 5.4, 5.6 to 5.8 and 6 to 10. A builder reads it first.
- **Branch:** `command-center-feedback`, from `main`. One PR at the end. Mark merges.
- **Order:** page by page (Mark, 2026-10-07). Task 14 builds the data that the Running panel and the Agents page need. Tasks 15 to 20 follow the pages.

## Global constraints

The constraints of [plan.md](plan.md) still hold. Revision 2 changes these:
- Every subagent runs on Fable (`model: "fable"`).
- All new text follows section 5.8 and uses American spelling.
- No new runtime dependency.
- The server stays read-only, except for the one answer route. New reads: `~/.claude/sessions/<pid>.json`, one `gh run list` command, and the doc source route. New config keys: `claude.sessionsRoot`, `agents.pollMs` and `agents.lingerSeconds`.
- Builders commit. The controller pushes after a task passes. No `Co-Authored-By` lines. Nobody stages Mark's paths (`docs/mark-playthrough-notes.md` and `docs/references/`).
- Every test run sets `CC_NO_OPEN=1`. The E2E server uses port 3010. Mark's own server may use port 3009: leave it. Never touch ports 3007 and 3008, or `../shadow-jog-engine`.
- Screenshots go to the scratchpad and to Mark at once. They are deleted after the runner judged them.
- Fixtures are synthetic. They never hold real session text.

## Review focus

- **Process file leak:** only `sessionId`, `startedAt` and `status` of a process file reach a response. The pid and every other key stay on the server. Test: Task 14.
- **Bad process files:** a dead pid, a malformed file, an unknown shape and a missing folder never throw. They give the fallback label. Test: Task 14.
- **Unlinked agent:** an agent whose parent call is not found attaches to its session. It is never dropped. Test: Task 14.
- **Home-base session:** a session started in `home-base` that works on Shadow Jog still shows (the working directory rule of version 1). Test: Task 14.
- **Pinned text:** a test that pins old page text changes with its page. No test is deleted without a replacement. Tasks 16 to 20.
- **Long text:** a visible sentence of more than 20 words, a contraction or a British spelling is a finding. Tasks 15 to 20.

## Tasks

### Task 14: Live agents data (server)
- **Files:** create `src/server/agents/` (module, process list reader, tree builder) and `src/server/routes/agents.ts`. Modify `src/shared/types.ts`, `compose.ts`, `app.ts`, the config schema and `command-center.config.json`. Create fixtures and tests.
- **Interfaces:** produces `GET /api/agents` (`Panel<AgentsLive>`, section 5.4) and the live event for the module `agents`. Reuses the parsers of the sessions module.
- [ ] **Tests (write first, unit):** the process list (valid, dead pid through an injected `isAlive`, malformed, missing folder), the active set, the state words, the fallback and `source`, the parent link and the attach fallback, message counts and `approximate`, the linger of finished agents, the busy-session rule, the hidden count, no extra process file key in the response.
- [ ] **Done when:** the unit suite passes. With `CC_REAL_AGENTS=1`, a test reads the real process list and checks the shape only.
- [ ] **Review point:** the JSON of a real call with the titles blanked. No screenshot.

### Task 15: Status summary (Now page)
- **Files:** rewrite `src/web/now/StatusPanel.tsx`. Modify `src/server/status/` (the milestone key and the Next up count), the GitHub module (CI on main), the runner allow-list, `src/shared/types.ts` and `status.md` (frontmatter key `milestone: none`).
- [ ] **Tests (write first):** the milestone key (valid, `none`, unknown id), the CI run parser, the runner allow-list, the rows and the strip (E2E), the links of the strip squares, a failed source shows an error row while the others stay, the "Right now" text is gone.
- [ ] **Done when:** the unit and E2E suites pass. The panel shows five rows and the strip on the real repo.
- [ ] **Review point:** screenshots of the Now page, glass on and off.

### Task 16: Now page text and the Running panel
- **Files:** modify `NowPage.tsx`, `YourMovePanel.tsx`, `RunningPanel.tsx` (sessions only, from `/api/agents`), `PullRequestsPanel.tsx`, `LinksPanel.tsx`, `PanelFrame.tsx` and the error boundary in `App.tsx`.
- [ ] **Tests:** the Running rows link to `/agents`, the hidden-runs label, the empty states, the error boundary text. Tests that pin old text change (the brief lists them).
- [ ] **Done when:** no sentence on the page has more than 20 words. The unit and E2E suites pass.
- [ ] **Review point:** screenshots of the Now page and of one panel in its error state.

### Task 17: Agents page (diagram)
- **Files:** replace `src/web/agents/AgentsPage.tsx` and `SessionCard.tsx`. Create the layout functions, the box and line components and the hidden list. Rewrite `e2e/agents.spec.ts`. Remove code that nothing uses.
- [ ] **Tests (write first):** the layout functions (0, 1, 12 and 13 children, depth 2, line paths, stable order). The E2E page with fixtures: live and closed sessions, a dimmed finished agent, a workflow chip, a message line with a count and an "N+" count, the empty state, the fallback label, the Copy buttons. A new agent appears within 5 seconds through the live event. Reduced motion.
- [ ] **Done when:** the suites pass. `/agents` on Mark's machine shows the live sessions.
- [ ] **Review point:** screenshots of three sessions with a workflow and a message line, of the empty state, and a before and after pair for a new agent.

### Task 18: Doc pages (Copy, Download and text)
- **Files:** create the source route and `src/web/docs/DocToolbar.tsx`. Modify `DocView.tsx`, `DocsRoutes.tsx`, `Overview.tsx`, `Gone.tsx`, `SearchBox.tsx`, `Outline.tsx`, `Backlinks.tsx`, `PrevNext.tsx`, `FrontmatterHeader.tsx`, `DiagramZoom.tsx` and `decisions/DecisionBanner.tsx`.
- [ ] **Tests (write first):** the source route (markdown, `nosniff`, 404, no path), the copy text builder (header, frontmatter kept), the split button (copy ok and failed, download name, keyboard on the menu), no toolbar on the overview, the Gone page and `/docs/decisions`.
- [ ] **Done when:** the suites pass. A copy from a real doc page pastes the header and the file.
- [ ] **Review point:** screenshots of a doc page with the menu open, of the Gone page and of the overview.

### Task 19: Decision pages text
- **Files:** modify `DecisionCard.tsx`, `AnswerForm.tsx`, `DecisionPage.tsx` and the chips in `src/web/decisions/`.
- [ ] **Tests:** the answer flow does not change, so its tests stay. Notices are one line and a link. Tests that pin old text change.
- [ ] **Done when:** the suites pass. The text follows section 5.8.
- [ ] **Review point:** screenshots of a decision page: open, answered, and an error.

### Task 20: Engine table text and finish
- **Files:** modify `src/web/docs/Decisions.tsx`, `tools/command-center/README.md` (the new routes and config keys), `CHANGELOG.md`, `status.md` and the status line of `docs/command-center/design.md`.
- [ ] **Tests:** the engine E2E spec follows the new text. All `CC_REAL_*` checks pass again.
- [ ] **Done when:** the full Vitest and Playwright suites pass. `npm run check` at the root passes. `git status` shows no stray file. The PR is open.
- [ ] **Review point:** the PR link and one screenshot of each page.

## Verification

- Each task has a builder and two fresh verifiers, a runner and a reader. All run on Fable.
- A task passes when every criterion scores 7 or more and the average is 8 or more. A task has up to 3 fix rounds. Fix rounds cover Critical and Important findings only. Minor findings go in the PR text.
- After Task 20, one fresh reviewer checks the whole branch. Then Mark's Copilot loop runs on the PR.
- The controller keeps the ledger (`.superpowers/sdd/plan/progress.md`, rulings from R30).

## Open points for Mark

- **status.md key.** Task 15 adds `milestone: none` to the frontmatter of `status.md`. Agents set it to `M0` when M0 starts.
- **Decision table.** `/docs/decisions` has no Copy and Download, because it draws three docs.
- **No screenshot before Task 15.** Task 14 has no page.
