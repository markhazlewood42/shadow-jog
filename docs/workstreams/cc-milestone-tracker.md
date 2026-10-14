---
type: workstream
title: Command Center milestone strip fix
branch: cc-milestone-tracker
roadmap: ET
state: active
updated: 2026-10-14
---

# Command Center milestone strip fix

Mark saw 15 empty squares and "Not started" in the Status panel although M0 to M7 and ET are merged.

Cause: `milestone: none` in `status.md` (stale), and the ET row sat after M8 in the table of `docs/engine/migration.md`. The strip code is right: it already draws done squares before the current one.

Design (Mark, 2026-10-14): keep the `milestone:` key. Done means rows before the current one. Order the rows by when they started.

Pass lines: ET row above M8. Key is `M8`. A test reads the real `status.md` and table and fails on a bad key or ET after M8. README states the order rule.
