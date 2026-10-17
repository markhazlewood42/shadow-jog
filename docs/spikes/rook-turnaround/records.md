# Rook turnaround: step records

One table per step (the lean loop). Spike doc: `../rook-turnaround.md`.

## Steps 0 and 1: target, kit, checker, contact sheet (2026-10-17)

| Round | What changed | Numbers | Verdict | Named fixes |
|---|---|---|---|---|
| Build | `target.json`; `scripts/art/pixkit/`, `metrics.mjs`, `measure-target.mjs`, `pixlint.mjs`, `contact-sheet.mjs`; tests; `pngjs` dev dependency (2d859f5) | Given frame 4: height 31, head width 19, outline 96.81 percent, 32 orphans, 66 small regions. Walk: 22 colors, 7 near-black; frames 94.44 to 100 percent outline, 22 to 35 orphans, 60 to 72 small regions. Idle: 22 colors, none shared | | |
| 1 | Runner (pixel artist, characters) and reader (engineer) | pixlint: 8 walk frames pass, idle passes, warden and a half-transparent image fail (exit 1) | Runner PASS, reader FAIL (2 Important: a test passed by construction, hard lines had no fail-path tests) | Revert the package.json description change; one-line errors for bad args; PA-04 lists every orphan; PA-08 reports its skipped half |
| 2 | Fix commits fd105eb, 984f756: target.json palette for the idle test, pinned numbers, a fail-path test per hard line, diffGrids test | Mutations of 93 percent, head width, 1.25x and palette subset each fail a test | FAIL (1 Important: `--frame` past the last frame printed a FAIL report, exit 1) | |
| 3 | `--frame` past the last frame: one line, exit 2 | | | |

Notes:
- "1-2 px regions" uses pack item PA-09 (4 luminance steps, then 4-connected components of 1 or 2 px). That definition gives the doc's 60 to 72. Same-color components give 108 to 132 and stay in `target.json` as `smallRegionsSameColor`.
- PA-10 planted foot stays a manual check: the pack names no way to find the planted-foot pixel on one frame.
- Named for step 3: PA-08 across facings against a reference facing.
