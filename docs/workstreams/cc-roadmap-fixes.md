---
type: workstream
title: Command Center roadmap fixes
branch: cc-roadmap-fixes
roadmap: M7
state: active
updated: 2026-10-13
---

# Command Center roadmap fixes

The hosted Command Center showed the roadmap chart in `docs/roadmap/README.md` as a link, not a picture. The hosted docs proxy (`/api/docs`) allowed only `.md` and `.png`, so the resolver did not treat `roadmap.svg` as a served picture. Fix: the proxy now serves `.svg` under `docs/` as `image/svg+xml` with a sandbox policy and `nosniff`, and the hosted link resolver treats it as a picture.
