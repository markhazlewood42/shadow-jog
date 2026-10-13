---
type: workstream
title: M7 review fixes (issue 81)
branch: m7-review-fixes
roadmap: M7
state: active
next_for_mark:
  - Try the longer glitch tear in npm run dev with ?scene=hack&fx=full&jack=glitch
updated: 2026-10-13
---

Triage and fixes for the fourth and fifth review findings on issue #81, left over from PR #80. Of the 14 findings, 11 are fixed or got a test, and 3 are not real or already flagged (verdicts in the triage comment on #81). The Claude review of PR #82 found that the door could wait forever for the way back; a bounded wait (5 s) fixes it. That fix is in verification.
