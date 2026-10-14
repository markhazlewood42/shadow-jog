# M8a verifier rubric (written before verification, 2026-10-14)

Score each of 4 items /10. Gate: every verifier's score >= 8.5, no Critical/Important finding.
1. Correctness: pass lines 1, 8, 9, 10, 13, 16 of `docs/engine/m8-brief.md` section 4 hold for M8a.
2. Tests that can fail: new tests have a control that goes red when the code is broken; no test deleted or loosened.
3. Fit with the engine design: kit lives in `src/sje/ui/`, holds no game state, takes plain data, no import of `engine/game`; data files match `docs/engine/m8a-data-format.md`.
4. Docs and records: no false claim about behavior; Minor items are named.
Severity: Critical = hard line fails, crash, data loss. Important = wrong behavior a player/Mark would see, a test that cannot fail, a false claim. Minor = wording, name, nit.
