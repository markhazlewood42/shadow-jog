---
type: design
title: "Command Center — Your move redesign"
project: shadow-jog
created: 2026-10-13
updated: 2026-10-13
status: draft, questions A and B answered 2026-10-13, waits for Mark's go to build. No code changed.
tags: [tooling, command-center, design]
---

# Your move redesign: facts plus live asks

## 1. Problem

On 2026-10-13 the hosted Now page showed 16 items in "Your move". None was real. The hosted list (`tools/command-center/src/web/hosted/your-move.ts`) takes the `next_for_mark` lines of the workstream file on every remote branch. A session writes those lines and then stops. Nothing clears them after a merge or at the end of the session. Most real session boxes say "Your move: nothing".

## 2. The model

"Your move" shows only items that clear themselves. Today the local page also shows the `status.md` "Next up for Mark" list and the open decisions of the engine docs. Section 5 removes both. After the change, the hosted page and the local page use the same three sources and one shared rule in `tools/command-center/src/shared/`.

| Source | Shows when | Clears when |
|---|---|---|
| Decision issues | An issue is open, has the label `decision`, and `markhazlewood42` made it | The issue is closed |
| Pull requests that wait for Mark | The `attentionOf` rule: open, not draft, author Mark. Action is `merge` when checks pass and `fix` when checks fail or changes are requested | The PR is merged or closed |
| Live asks | The newest "Your move" box of a live session. One item per box line | Any one of the four rules below |

The text of a PR item comes from GitHub (number and title). It never comes from session text.

**Action rule (Mark, 2026-10-13).** Every item links to a place where Mark can act: a decision page, a PR, or a live session. An item that links only to document text is not allowed.

A live ask hides when any one of these holds:

1. The session is not live. The reporter must see its process, and the `live` key must be fresh. After 150 s the hosted page shows "Reporter offline" and hides all live asks.
2. Mark sent a message to the session after the box (`answered` in `src/server/sessions/parse.ts`).
3. The box says "Your move: nothing" (`SAYS_NOTHING`), or a newer box replaced it.
4. The box is more than 12 hours old.

A newer reply without a box leaves the box as it is. This matches the home-base reply rule. Each item shows the session title and the age of the box.

## 3. Diagram

![Sources feed one shared rule. The rule feeds the local page and the hosted page. Live asks travel through the reporter and the live key.](your-move-redesign.svg)

## 4. Trust rule change

Today the reporter allow-list sends no message text (`tools/command-center/README.md`, "What leaves this machine", and `src/server/publish/map.ts`). Live asks need the lines of the newest open box.

The new rule:

- Per live session, send at most 6 box lines.
- Cut each line to 160 characters.
- Run each line through the same secret redaction as titles.
- Send the lines only when the box passes the four rules above.
- Send nothing else of the message.

The hosted page stays behind Vercel Authentication. The fail-closed protection check of the reporter stays as it is. The build gets an attacker verifier for this path.

### Dependency

Live asks depend on a working reporter. Mark reports open problems in the local services, the reporter included. They need their own debug session. Until the reporter works, the hosted page shows only decision issues and PRs. It shows "Reporter offline" in place of the live asks. A failed reporter must never show old asks. The order is: debug the reporter first, then build live asks.

## 5. What goes away

- `next_for_mark` leaves the workstream files, the validator (`src/shared/workstream.ts`), `tools/command-center/tests/workstream-files.test.ts`, the Workstreams cards, and "Your move". Existing files lose the field.
- `docs/workstreams/README.md` changes to match.
- The "Workstream file" bullet in the repo `CLAUDE.md` no longer says a session makes `next_for_mark` true.
- On the local page, the `status.md` "Next up for Mark" list leaves "Your move". It links only to text and does not clear itself. A line that needs Mark becomes a decision issue, a PR, or a live ask.
- The open decisions of the engine docs leave "Your move". A decision that needs Mark is raised as a GitHub decision issue. It then shows through source 1 with the decision page.
- Add a check that flags an open engine-doc decision that has no decision issue. Proposal: a test in `tools/command-center/tests/` that fails on such a decision, plus a warning on the docs page.

## 6. Tests to add or change

- Add `yourMove.test.ts` (the shared rule, one case for each clear rule).
- Change the `hosted-*` tests.
- Change `publish-map.test.ts` (the wider allow-list, the caps, the redaction).
- Change `sessions-parse.test.ts`.
- Change the `workstream*.test.ts` files.
- Add a check that flags an open engine-doc decision that has no decision issue (section 5).
- Change `e2e/hosted/hosted.spec.ts` and `e2e/now.spec.ts`.

## 7. Open questions for Mark

- **A. Answered 2026-10-13.** Mark: "It's OK to keep them IF they're actually actionable. For example, one of the decision items just links to a wall of text document segment. It doesn't link to an actual decision UI. If there's an open decision, it needs to use the GH issue decision framework + dedicated UI." Result: the action rule in section 2, and the two removals in section 5.
- **B. Answered 2026-10-13.** Mark approved the wider reporter allow-list in section 4. The build gets an attacker verifier for that path.

## 8. Not built yet

No code changed. This note is a draft. It proposes to replace section 5.1 of `design.md` (the "Your move" part) after Mark approves it.
