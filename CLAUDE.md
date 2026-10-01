# Shadow Jog: instructions for AI sessions

A browser JRPG (cyberpunk-fantasy, Phantasy Star IV loop), Chapter 1 "Milk Run", built to an indie-alpha bar.
Vite + TypeScript strict, Canvas 2D at 480×270, zero runtime dependencies. Art: **drawn picks from the PixelLab art
pass** (`public/art/`, loaded by `src/art/drawn.ts`) over the game's own **code-drawn art**, which stays as the
fallback for everything; audio all generated in code.
Repo: `markhazlewood42/shadow-jog` (**public**). Owner: Mark Hazlewood (he/him).

## Start here, in this order
1. **`status.md`**: where the project stands and what happens next. Read it first, every session.
2. `docs/ARCHITECTURE.md`: how the code fits together.
3. `docs/DEVELOPING.md`: commands, tests, debug tools, conventions, traps, and recipes for common changes.
4. `docs/GDD.md`: the game's design. `docs/GLOSSARY.md`: every name and term. `docs/SETTING.md`: the world.
   `docs/CONCEPTS.md`: the game-dev and JRPG ideas behind it, in plain words (for Mark's learning).
5. `docs/quality/GRADING.md`: how quality was graded over 12 rounds, and why that loop has ended.

## Rules that matter
- **The automated quality loop has ended** (exit set 2026-09-29, after round 12). Don't start new verification
  rounds unless Mark asks. The current gate is **Mark's own end-to-end playthrough**; his notes are the work queue.
- **Don't deploy** (shadowjog.com) without Mark's explicit go-ahead; it's the last alpha step, with a secure email
  sign-up whose requirements are in `status.md`.
- **Branches and PRs (Mark, 2026-10-01):** work goes on a branch per relatively major feature (not per small fix),
  pushed as you go; when the feature is done, open a PR so it can get an independent code review (Copilot), and
  Mark merges. Don't commit to `main` directly.
- Before committing: `git fetch` and `git rev-list --left-right --count HEAD...origin/main`. Commit each meaningful
  piece of work and **push right away** (the branch); check CI with `gh run list -L 3`. **No `Co-Authored-By` lines.**
- Judge `biome lint` and `tsc` by **exit code**, not their last line.
- **Don't edit `src/` while a Playwright run is going** (Vite hot-reload kills the run).
- Ports: 3007 dev, 3008 preview. Never touch 3002–3006 (other projects).
- **Glossary rule:** a new or renamed name, place, faction or term goes into `docs/GLOSSARY.md` in the same change.
- **Concepts rule (Mark, 2026-09-30):** when a game-dev or JRPG concept comes up (in the work or in conversation:
  a technique, a genre convention, a tool idea, like Wang tiles or hitstop), add it to `docs/CONCEPTS.md` in plain
  words with where it shows up in this game. Mark wants to learn the craft from this project.
- No non-null assertions (`!`) in `src/engine/` or `src/battle/`: use a guard or `must(value, 'what')`.
- After combat, item or encounter changes, run `npx vitest run tests/balance.test.ts tests/economy.test.ts`.
- Keep `status.md` current before a session ends.

## Quick commands
`npm run dev` (http://localhost:3007; every dev tool is in the DEV tab there, or press `` ` ``; `?debug` for test hooks) · `npm run check` (lint + types + unit) ·
`npx playwright test e2e/<spec>.spec.ts --reporter=line` · `npm run build && npm run preview` (shipped build on 3008)
