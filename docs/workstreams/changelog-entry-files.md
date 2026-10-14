---
type: workstream
title: Changelog entry files
branch: changelog-entry-files
roadmap: cc-followups
state: active
updated: 2026-10-14
---

Parallel PRs conflicted in `CHANGELOG.md` under `Unreleased`. Fix: each PR adds `changelog.d/<branch-slug>.md` and never edits `CHANGELOG.md`; a release folds the files in with `npm run changelog:fold -- <version>` (`scripts/changelog-fold.mjs`). `npm run changelog:check` and `tests/changelog-fold.test.ts` validate the files (the test also runs on a docs-only PR in CI). `.gitattributes` adds `CHANGELOG.md merge=union` as a second guard. Rule: `CLAUDE.md` "Versions and spikes", `changelog.d/README.md`, `docs/DEVELOPING.md` section 9. The Command Center docs list is unchanged (the folder is not listed). Pushed, no PR yet.
