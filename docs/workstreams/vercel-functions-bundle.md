---
type: workstream
title: Command Center step 3, committed function bundles
branch: vercel-functions-bundle
roadmap: cc-followups
state: review
next_for_mark:
  - Run the cache check (README check 2) and revoke the Vercel bypass secret, or approve the agent doing it
  - Merge the PR when the review is triaged, then say go for step 4 (hosted page)
updated: 2026-10-12
---

Fixes the first deploy of step 3. Handlers live in `functions/*.ts` and esbuild bundles them into the committed `api/*.js`. A test fails on drift. Verification round 1 passed (runner, reader, attacker).
