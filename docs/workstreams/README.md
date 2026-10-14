---
type: reference
title: Workstream files (Shadow Jog)
---

# Workstream files

A workstream is one branch, plus everything that joins to it by branch name: its PR and checks, its roadmap item, its live sessions, its worktree and its state file. This folder holds the state files. The Command Center reads them. Design: `docs/command-center/design.md` section 5.9.

The validator is `tools/command-center/src/shared/workstream.ts`. A test (`tools/command-center/tests/workstream-files.test.ts`) runs it over every file here, so CI fails on a bad file.

## The file

```yaml
---
type: workstream
title: M6 flip default
branch: engine-m6-flip
roadmap: M6            # id in docs/roadmap/roadmap.json
state: review          # active | review | blocked | parked | merged
blocked_on: [61]       # decision issue numbers
updated: 2026-10-11
---
```

The text after the frontmatter is free. Keep it short.

| Field | Type | Rule |
|---|---|---|
| `type` | text | Always `workstream`. |
| `title` | text | Not empty. |
| `branch` | text | The branch name. Must equal the file path (below). |
| `roadmap` | text | The id of an item in `docs/roadmap/roadmap.json`. Use the closest item. |
| `state` | text | One of `active`, `review`, `blocked`, `parked`, `merged`. |
| `blocked_on` | list of numbers | Decision issue numbers. May be left out when empty. |
| `updated` | date | `YYYY-MM-DD`. |

Any other key is an error. This file keeps no list of what Mark must do: a list that a session writes and then leaves does not clear itself. A thing that needs Mark is a decision issue, a PR, or the "Your move" box of a live session (`docs/command-center/design.md` section 5.1). The page derives "merged" from the PR: if the PR is merged, the card shows merged, whatever `state` says.

## Path and branch name

| Rule | Detail |
|---|---|
| Path is the branch | The file is `docs/workstreams/<branch>.md`. Slashes become folders: `spike/foo` is `docs/workstreams/spike/foo.md`. |
| One file per branch | Git refuses a branch `spike` together with a branch `spike/foo`, so two files cannot collide. |
| Branch name | Lowercase kebab-case parts joined by `/`: `^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$`. No capitals, dots or empty parts, so no `.md` suffix. |
| A branch outside the rule | With a file: a red row with the reason. Without a file (a bot branch such as `dependabot/...`, or `release-1.0`): skipped, a neutral "no workstream" row. |

## Old files

- The file of a merged branch stays on `main`.
- The page hides it 14 days after the PR merged.
- The validator lists the files whose PR merged more than 14 days ago (`staleWorkstreamPaths`). Any PR can delete the listed files.
- A branch that reuses a name replaces the old file in its first commit.

## Rules for sessions

1. Write only the workstream file of your own branch.
2. Commit it with your work, and push it with your work.
3. `status.md` keeps the overview and the roster. Only a PR to `main` changes it.
4. Update `state`, `blocked_on` and `updated` when they change.
5. A file that fails validation shows as a red row with its path and the error.

Lookup order (the page): the file at the head commit of the PR (open or closed), or at the merge commit of a merged PR. A branch with no PR is read at its branch tip. PR state wins over the file's `state` field.
