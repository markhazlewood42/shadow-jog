Small fixtures for tests/art-v2-grade.test.ts, so no test depends on a file outside the repo.

- `round8/`: the four round 8 facings (down, right, up, up-right), 32 px PNGs. Older-round Rook art that the calibration must fail (PA-CM-01). Not a Sprite Fusion reference.
- `t0a/s-template.json`: a proxy template for facing s (proxy output, layout only).
- `pathb/`: the two files of path B (`sheet.mjs.fixture` is `scripts/art/v2/pathb/sheet.mjs`), copied from `origin/spike/rook-path-b`. The test builds a throwaway git repo from them and reads them with `git show`.

No Sprite Fusion reference image or label file belongs here.
