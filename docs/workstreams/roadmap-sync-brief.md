---
type: workstream
title: Roadmap sync
branch: roadmap-sync-brief
roadmap: cc-followups
state: review
updated: 2026-10-16
---

# Roadmap sync

This branch builds `npm run roadmap:sync`: the GitHub project board is the source of truth, and the script writes `docs/roadmap/roadmap.json` for the Command Center. Brief: `docs/command-center/roadmap-sync-brief.md`.

- The brief passed the lean loop in two rounds. Mark approved it and its six recommended answers on 2026-10-16.
- The script, its tests and a first real run are on the branch. Lean loop round 1: runner and reader each found one Important finding (status-map tests that cannot fail, an open PR frozen in `pr`). Both were fixed with tests; fix round 2 passed.
- The PR is open and waits on Mark's merge.
