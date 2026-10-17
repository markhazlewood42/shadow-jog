---
type: workstream
title: Claude review reads the PR diff, not the restored CLAUDE.md
branch: review-action-pr-diff
roadmap: cc-followups
state: review
updated: 2026-10-17
---

The Claude Code Review Action restores `CLAUDE.md`, `.claude/` and a few more paths from the base branch before each review, so on PR #139 three of four runs reviewed only that restore. The review prompt now says that the restore is an artifact and points the review at `gh pr diff`. Tested locally on a copy of the PR #139 checkout with the restore applied: 10 code findings, no finding on `CLAUDE.md`. A workflow change cannot be tested on its own PR. Also closes the `cc-needs-info` workstream, records PR #139 in `status.md`, and adds three pictures for the `Info:` answer on decision #109 (`docs/screenshots/decisions/`). PR open; Mark merges.
