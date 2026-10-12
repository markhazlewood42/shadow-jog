---
type: workstream
title: Command Center step 4, hosted page
branch: hosted-page
roadmap: cc-followups
state: active
next_for_mark:
  - Say go for the verifiers and the PR of hosted-page (the build is done and pushed, no PR yet)
  - After the merge, open the hosted URL and check that Workstreams shows the open branches
updated: 2026-10-12
---

Step 4 of the Command Center revision 3 plan (`docs/command-center/design.md` section 11.3). The page works on Vercel with no local server.

- Data layer: `tools/command-center/src/web/hosted/`. The build flag `VITE_HOSTED=1` selects it (`vercel.json` `buildCommand`).
- Workstreams view: `tools/command-center/src/web/workstreams/`, route `/workstreams`.
- Contract for the local reporter (step 5): `tools/command-center/src/shared/live.ts`.
- Tests: `tests/hosted-*.test.ts(x)` and `e2e/hosted/hosted.spec.ts` (`npm run e2e:hosted`).
- Not done in this step: a file list for the docs navigation (the hosted page lists the files that `nav.json` names, not folders), search, and the `/docs/decisions` change flags (they need git).
