---
type: workstream
title: Hosted Command Center follow-ups
branch: cc-hosted-followups
roadmap: cc-followups
state: review
updated: 2026-10-16
---

Fixes after the hosted answer work. First: Mark once saw a 502 "bad-response" on the hosted page. GitHub had answered the heavy snapshot query in part (an error plus a null field), and the strict parser took that for an unknown shape. Now call 1 is tried once more (also after a 502, 503 or 504), and every call shares one 25 s deadline. A second partial answer gives a retryable 503 "graphql-incomplete" error. A true unknown shape stays bad-response. The snapshot function also logs one line on failure (code and field only). Also holds two review fixes from PR #137. No PR yet.
