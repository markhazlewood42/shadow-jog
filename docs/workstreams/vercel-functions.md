---
type: workstream
title: Command Center step 3, Vercel functions
branch: vercel-functions
roadmap: cc-followups
state: review
next_for_mark:
  - Add the allow rule Bash(vercel api:*) through /permissions, so the agent can set the game project's ignore command
  - Create the read-only GitHub token (fine-grained, shadow-jog only) when the agent asks for it
updated: 2026-10-12
---

Step 3 of `docs/command-center/design.md` section 11.3. Code for `api/snapshot`, `api/docs`, `api/live`, `vercel.json` and the ignore script. The Vercel project, the Upstash install and Vercel Authentication follow after the merge.
