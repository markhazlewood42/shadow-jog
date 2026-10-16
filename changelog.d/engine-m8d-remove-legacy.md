### Changed
- Engine: the old engine is gone. `LegacyScene`, the old `Game`, `Display`, `postfx` and `moments` are deleted, and the `?engine=` flag is gone. The 11 files that stay (canvas, color, errors, perf, shake, input and five more) now live in `src/sje`, and `src/engine/` no longer exists. The game looks and plays the same.
- Engine: flat color plates in the battle windows are drawn as one `Graphics` fill each, not one picture each. The battle scene syncs its windows once a frame, not twice.
- Dev tools: Battle Test is an ordinary tool file. The Battle Stage Editor, Battle Test and the FX lab reach no deleted path, and a test checks it.
- Bundle budget: the caps are set down after the deletion (first play and game total). Numbers are in the Record of `docs/engine/m8-brief.md`.

### Fixed
- Battle Stage Editor: a second Save while one runs does nothing, so Ctrl+S twice no longer posts the same set twice.
- Battle Stage Editor server: a malformed request address gets a 400 answer, and the dev server stays up.
- Battle Stage Editor server: the Save body is read by the shared size-limited reader, so an oversize body gets 413 and a failing handler gets 500 as the other write endpoints do.
- Battle Test: the e2e sampler now sees the state that the last tick left (it ran one tick early).

### Removed
- Test helper `tests/cssscale.ts` and the pins of the old `fit` scale rule (the shipped display has the integer mode only).
