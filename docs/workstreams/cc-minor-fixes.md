---
type: workstream
title: Command Center Minor fixes from PR 138 and PR 139
branch: cc-minor-fixes
roadmap: cc-followups
state: review
updated: 2026-10-17
---

Seven named Minor fixes in the Command Center. From PR #139: a question of only zero-width characters is rejected, and "Flag again" on a hand-written `Question:` over 2000 characters no longer ends in a raw 422. From PR #138: a monotonic deadline clock, a structured `AdapterError` field, a helper for the first call, a partial snapshot when the deadline hits, and CSP and `frame-ancestors` headers on the hosted page. Lean loop: runner, reader and attacker in round 1, one fix round, round 2 PASS; the named Minors are fixed. PR open. The Claude review (10 findings) is triaged: 1, 2, 4, 6 and 7 fixed in b7fe51a (fix round verifier PASS, 8.6), 3, 5, 8, 9 and 10 recorded in the PR as false or no change. CI green; Mark merges.
