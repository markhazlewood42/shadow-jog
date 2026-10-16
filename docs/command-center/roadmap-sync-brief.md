---
type: reference
title: Roadmap sync script (design brief)
project: shadow-jog
---

# Roadmap sync: design brief

Status: **approved by Mark on 2026-10-16, with all six recommended answers in section 10.** Revision 2 passed verifier round 2. Nothing is built yet. Board checked read-only on 2026-10-16 (`gh` auth has the `project` scope).

## 1. Purpose and non-goals

Mark chose the GitHub project board (user project 2, private) as the source of truth for work tracking. `npm run roadmap:sync` reads the board and rewrites `docs/roadmap/roadmap.json`. The Command Center (CC) keeps reading the committed JSON.

Non-goals:
- No live board call from the hosted page. The hosted CC reads only committed files.
- No write to the board. The script is read-only.
- No change to how `gen-roadmap.mjs` draws the chart.
- No CI call to GitHub. Mark or an agent runs the script, then commits the diff.

## 2. What the real files hold

- `roadmap.json` has `updated`, `lanes` (6), `items` (31). Item fields: `id`, `label`, `lane`, `status`, `after`, `notes` (all 31); `kind` (17); `branch` (9); `pr` (8); `tag` (14); `column` (13).
- Statuses: `done active next later optional gated`. Kinds: `milestone task`.
- 16 items are done milestones (Phase 0 to M8d, ET, M1b, M4). Editors is later. The rest are gated or other items.
- The board has 36 items: 4 epics (#102 to #105), 24 decisions, milestones #101 and #134, bugs #93 and #97, task #84. Step is set only on epics and milestones. No done engine milestone is on the board.
- `gh project item-list` returns `content{number,title,url,body}`, `kind`, `status`, `step`, `labels`, `milestone`. It omits the sub-issue parent, linked PRs and issue state (0 of 36 items carry them).
- `validate()` in `gen-roadmap.mjs` rejects: empty `notes`, a label over 2 lines of 12 characters, a tag over 10 characters, a `kind` other than `milestone` or `task`, and two items in one lane and column. `generate()` throws on any of these.
- `tests/roadmap.test.ts` (a) requires the `kind: milestone` items to equal the ids of the table in `docs/engine/migration.md`, no more and no fewer. Rule (b) ties `status.md` `milestone:` to a milestone item.

## 3. Field mapping

| Board | roadmap.json | Note |
|---|---|---|
| Issue number | `issue` (new, number) | The join key. `id` is `#N` for a board-new item. |
| Title | `title` (new, full text) and `label` | `label` is short, made once (rule below). |
| Kind | `boardKind` (new) and `kind: task` | The script never emits `kind: milestone` (G1). |
| Step | `column` | Only if free in the lane. See rule below. |
| Status, issue state | `status` and `state` (new) | One precedence, below. |
| Parent issue | `parent` (new, issue number) | Not `after`. A parent is not an order. |
| Repo milestone | `group` (new) | Stored, not drawn. |
| Issue URL | `url` (new) | Public issue URL only. |
| Linked PRs | `pr` | Source and format below. |
| Labels | none | `epic` and `decision` repeat Kind. |
| Open decisions per epic | `decisions` (new, count) | Set on an epic from its child decisions that are not Done. |
| none | `lane`, `after`, `branch`, `notes`, `tag` | Hand-written or defaulted. |

Status map (the board Status decides):

| Board Status | `status` |
|---|---|
| Backlog | `later` |
| Next | `next` |
| In progress, In review | `active` |
| Waiting on Mark | `gated` |
| Done | `done` |

Precedence: if the issue is closed and Status is not Done, `status` is `done` and the script prints a warning (the board is out of date). `state` holds `open` or `closed` from the issue, so a reader can see the clash.

Rules that keep `validate()` passing:
- `notes` default for a new item: `Board item #N.` Never empty.
- `label` for a new item: the title with the `Epic E1:` or `Decision:` prefix cut, then trimmed to fit 2 lines of 12 characters (word break, no ellipsis if it fits). The full title is in `title`. A hand-set `label` sticks.
- `tag` is never set from the board.
- `column`: use `Step - 1` when that column is free in the lane, as `columnsOf()` in `validate()` derives columns (from `after`, not from an explicit `column` field). Else use the next free column in the lane. An item with no Step gets the next free column in its lane. A hand-set `column` sticks.
- `pr` is a string like `#98 (merged 2026-10-16)`, built from the GraphQL field `closedByPullRequestsReferences` on the issue (closing PRs only). Linked PRs of other kinds are not read. Set once, then hand-owned.

### Gaps

- G1: Epic and Milestone must not become `kind: milestone`. Test (a), test (b), `parseRoadmapDone` (status.ts:261) and the done-set check in `milestone-data.test.ts` all key on it. Board items use `task` plus `boardKind`. Only the 15 hand-written milestones stay `milestone`. Only `gen-roadmap.mjs` and its tests check `kind`. The CC does not validate it.
- G2: `Step` has no value on decisions, bugs and tasks.
- G3: parent, PRs and state need GraphQL.
- G4: lanes, `after`, `branch`, `optional` and prose notes are not on the board.
- G5: 24 decisions would swamp a chart of 31 items. See Q1.

## 4. Ownership and merge

| Field | Rule |
|---|---|
| `issue`, `title`, `boardKind`, `state`, `url`, `parent`, `group`, `decisions`, `status` | Overwrite each run |
| `label`, `lane`, `column`, `pr`, `notes` | Set once for a new item, then never |
| `after`, `branch`, `tag`, `lanes`, `updated` rules below | Never (hand-written) |

Join and order:
1. The join key is `issue`. Adding `issue: N` by hand to an old item (for example `M7`) adopts it: the script then overwrites only the "overwrite" fields on it. Its `id`, `kind` and `lane` stay.
2. Items with no `issue` are copied through unchanged, in their current place.
3. Board-new items append after all existing items, sorted by issue number. The existing order never changes.
4. An item with an `issue` that left the board is reported as stale, not deleted. `--check` exits 1 on it.
5. `updated` is the date of the run, written only when other content changed. `--check` ignores `updated`.

## 5. Auth and failure

- Needs local `gh` with the `project` scope: `gh auth refresh -s project`.
- One GraphQL call through `gh api graphql`, paged at 100 with `pageInfo.endCursor`, for `fieldValues` and `content { ... on Issue { number url title state parent { number } closedByPullRequestsReferences } }`. Fallback: `gh project item-list --limit 100`, which cannot show parent or PRs. Past 100 items the fallback exits with an error, not a partial result.
- If the auth or scope is missing, print one line with the fix command, exit 1, write nothing.
- Build the result in memory, run `validate()` on it, then write once (temp file, then rename). A failed call, bad JSON, or `validate()` problems leave the file unchanged.
- The `gh` runner is an injected function, so tests can fake it.

## 6. Determinism

- Fixed key order, two-space JSON, trailing newline, stable order (rule 3 above).
- A second run with no board change gives a byte-identical file.
- `npm run roadmap:sync` runs `gen-roadmap` after the write, so the SVG and README never drift.

## 7. Tests

- New `tests/roadmap-sync.test.ts` with fixtures in `tests/fixtures/roadmap-sync/` (trimmed GraphQL response, sample `roadmap.json`). No network. Cases: status map and closed-versus-Status precedence; merge keeps hand fields; adoption by `issue`; stale item; idempotent second run; no board item gets `kind: milestone`; empty-notes default; long title gets a fitting label; column clash resolves; item with no Step; missing auth gives the error with no write (fake runner); output passes `validate()` with `[]`.
- `tests/roadmap.test.ts` (a) and (b) do not change, because board items are `task`.
- `milestone-data.test.ts` does not change. The 16 done ids and the not-done `Editors` stay hand-written.
- Workstream files: `roadmap:` takes any non-empty text (`shared/workstream.ts:195`). An unknown id lands in the unplaced lane (`hosted/workstreams.ts:102`). So a `#N` id is accepted and no validator change is needed. A workstream that names `#N` gets a lane card only if the item exists.

## 8. Architectural fit

Fits the current design. The data path (committed JSON, read by the CC from disk or the GitHub contents API) does not change. The change is additive fields in a file with one generator and one reader.

New: `scripts/roadmap-sync.mjs`, `scripts/roadmap-sync.d.mts`, `tests/roadmap-sync.test.ts` and fixtures, a `roadmap:sync` script in `package.json`.

Touched: `scripts/gen-roadmap.mjs` (ignore the new fields), `scripts/gen-roadmap.d.mts` (add the new optional fields to `RoadmapItem`, or typed tests fail to compile), `docs/roadmap/roadmap.json` (new optional fields), `docs/roadmap/README.md` (generated), `CLAUDE.md` "Work tracking", `docs/command-center/design.md` (one line).

Not touched: CC server, hosted functions, GraphQL snapshot query.

## 9. Pass lines

1. `npm run roadmap:sync` with auth rewrites `roadmap.json` and exits 0.
2. A second run changes no byte.
3. `-- --check` exits 0 when current and 1 when not, writes nothing, ignores `updated`.
4. With a fake runner that fails auth, the script prints the fix command, exits 1, file unchanged.
5. With a fake runner that returns bad JSON, the file is unchanged.
6. `validate()` on the written data returns `[]`.
7. `npm run roadmap` regenerates the SVG and README without a throw.
8. No board item has `kind: milestone`.
9. All 31 existing items keep `lane`, `after`, `branch`, `notes`, `label`, `column`.
10. Adding `issue: N` to an old item adopts it and changes only the overwrite fields.
11. Every non-decision board item appears once with the mapped status. Each epic has `decisions`.
12. A closed issue with a non-Done Status gives `done` plus a warning.
13. A board-removed item is reported, not deleted.
14. `npm test` in the root and in the CC passes with no network. The Milestone strip still shows 16 done squares.
15. The hosted CC needs no new env var and makes no board call.
16. No token or private board URL is in the output or the committed files.

## 10. Open questions for Mark

1. Do decisions appear as roadmap items? Recommended: no. Show `decisions: N` on each epic.
2. How does a board item get a lane? Recommended: epic to `engine`, milestone to `side`, bug and task to `other`, Waiting on Mark to `gated`. A hand edit sticks.
3. Short label or full title on the chart? Recommended: short `label`, full `title` in the data (the bar fits 12 characters per line).
4. Move the 16 done milestones onto the board as closed issues? Recommended: no. Keep them hand-written.
5. Should the script commit? Recommended: no. The agent commits the diff with its work.
6. Draw the repo milestone as a group? Recommended: store `group`, do not draw it yet.
