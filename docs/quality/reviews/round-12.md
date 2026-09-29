# Round 12 reviewer notes (the closing measurement)

The eleven reviewers' reports, verbatim, as delivered on 2026-09-29. Each reviewer was a fresh Sonnet agent with
read-only access, the prompt from `scripts/verifier-prompts.py 12`, and the evidence committed in 7908ad2. See
`docs/quality/GRADING.md` for how these were produced.

Average **7.98** (round 11: 7.87). Scores: Engine & code 8.2, Field art 7.8, Battle presentation 7.3, UI / UX 8.2, Combat design 8.0, Progression & economy 7.6, Narrative & writing 8.2, Level design 7.8, Audio 7.8, Feel & polish 8.3, Stability 8.6.

## Checked after the reports came in

Reviewers are sometimes wrong, so the claims that would count as bugs or factual errors were checked:

- **Stability #1 is right, and was a real bug.** `src/game/settings.ts` named `localStorage` outside its try, so a
  browser that blocks storage (where even reading the name throws) failed to boot. Fixed the same day, with
  `tests/settings.test.ts` (it fails on the old code).
- **Battle presentation #1 is wrong on the facts.** It says Rook's body "does not shift one pixel" across the four
  swing shots. A pixel diff of `13b-swing-gather.png` against `-raise.png` differs over y 224 to 512 of the 960x540
  shot, and a crop shows Rook crouched on the gather, 15 px higher with the blade overhead on the raise, then lower
  through the cut and settle. What stands: the whole sprite moves and the arms and blade change frame, but the
  torso never leans or steps.
- **Progression #1 reads the test correctly.** `tests/economy.test.ts` only asks that the Neural Lace cost more
  than 0.8 times the median spare at the Warden; at 1,200 vs 1,222 it is affordable for about half of runs. The
  test's name claims more than it checks. A design note, not a bug.
- **Audio #5 is not a mismatch.** The dock is open air whatever room the cue came from, which is what `hall` there
  says; the comment and the code agree.
- **Feel #1 and #2 are by design** (the crit face slides in over 8 frames; cut-ins never stack), recorded as feel
  notes for Mark's playthrough rather than bugs.

---

## 1. Engine & code: 8.2

```
SCORE: 8.2/10
VERDICT: ITERATE (<8.5)

TOP ISSUES (most severe first, max 8, each one concrete and actionable, citing a screenshot or file:line):
1. The renderer/scene split the codebase advertises isn't actually held to everywhere: `src/scenes/battlekit/render.ts`'s own docblock says "The scene ... owns state and flow ... this owns pixels. It reads the scene, and never changes game state," but `src/scenes/battle.ts:736-763` and `:768-781` (the Victory and Level-Up panels) call `drawWindow`/`drawText`/`drawBar` directly from inside `BattleScene`, stored as a closure in `this.endPanel` rather than living in `BattleRenderer`. Two whole UI panels' pixel logic sit in the "flow" class the boundary is supposed to keep clean of it.
2. Per-frame allocations survive in hot paths despite the codebase's own explicit "no per-frame allocs" discipline elsewhere: `src/field/lighting.ts:60` creates a new `draw` closure on every call to `Lighting.build()`, which `src/scenes/field.ts:556` calls every field-scene frame; `src/scenes/battlekit/render.ts:74` passes a freshly-allocated arrow function to `fx.render()` every battle frame. Both are inconsistent with the surrounding code's own stated standard — `field.ts:572`'s comment literally reads "pooled entries; no per-frame closures or objects," and `weather.ts` comments call out "no allocation per respawn" — making these look like oversights rather than a deliberate tradeoff.
3. "Strict TS" is only half-enforced: `biome.json` turns `noNonNullAssertion` to `error` solely for `src/engine/**` and `src/battle/**`; everywhere else (`src/scenes/battle.ts`: 51 uses of `!`, `src/scenes/field.ts`: 54, `src/game/systems.ts`: 28) bypasses the codebase's own `must()` helper (`src/engine/assert.ts`), whose entire purpose is to fail loudly with a named error instead of V8's generic "Cannot read properties of undefined." A bad assumption in the scene layer gets the worse failure mode the rest of the code was built to avoid.
4. Bundle budget has almost no margin: `docs/quality/evidence/bundle.txt` shows 189.5 of a 200 kB gzip budget (94.8%) and the boot chunk at 456.8 of 480 kB raw (95.2%). `scripts/bundle-budget.mjs`'s own comment says the budget was just re-cut today (2026-09-29) after splitting the battle system into a lazy chunk — that bought one-time headroom, not a durable margin, so the next content pass (more dialogue, another dungeon) is likely to fail CI outright rather than degrade gracefully.
5. `src/scenes/battle.ts` (932 lines) and `src/scenes/battlekit/render.ts` (794 lines) remain large single classes each carrying multiple responsibilities (command state machine, async round orchestration, reward/level-up computation, and layout caching, all inside `BattleScene`). The kit already demonstrates the better pattern next door (`orders.ts`, `tables.ts`, `playback.ts` are each single-purpose) — it just wasn't applied to the reward/victory logic called out in #1.

STRENGTHS (max 3), one line each:
- `src/battle/engine.ts` is a genuinely pure, deterministic, well-cached battle resolver (uid index, signature-cached `alive()` lists) backed by real Monte-Carlo balance/economy simulation tests (`tests/balance.test.ts`, `tests/economy.test.ts`), not just unit tests of mechanics in isolation.
- Hot-path discipline is excellent almost everywhere outside the two spots cited above: reused buffers in the fixed-timestep loop (`engine/game.ts`), the field draw-list pool, and WeakMap-keyed sprite caches (`battlekit/sprites.ts`) keep frame time at ~1.3 ms (field) / ~0.6 ms (battle) on GPU per `docs/quality/evidence/perf.txt`, comfortably inside the 16.7 ms budget.
- Regression coverage goes past unit tests into content-integrity checks (`tests/content.test.ts` catches any dangling id across abilities/enemies/maps/shops) and CI-blocking frame-budget/input-latency e2e gates, not just numbers someone has to remember to eyeball.

WHAT WOULD MOVE THIS +1 POINT: Move the Victory/Level-Up panel drawing out of `BattleScene` and into `BattleRenderer` (or a new `battlekit/reward.ts`) so the module boundary the code already documents is actually true everywhere, not just in the common case; hoist the two per-frame closures in `lighting.ts` and `render.ts` into pre-built, reused callbacks the same way `battle.ts`'s `view` object is already built once instead of per frame; and either raise the bundle budget with real margin or trim the boot chunk so the gate isn't one content pass from red. None of these are structural rewrites — they're the same discipline the codebase already applies to almost everything else, extended to the two or three places it was missed.
```

---

## 2. Field art: 7.8

```
SCORE: 7.8/10
VERDICT: ITERATE (<8.5)

TOP ISSUES (most severe first):
1. Crowd sameness undercuts "personality" at scale. `src/art/chars.ts` and `src/data/looks.ts` build every pedestrian from the same three body rigs (`std`/`short`/`big`, chosen 66%/18%/16% in `randomLook`) with only two extra stances (`crossed`/`phone`) and the same three-frame walk cycle (`walkFrame`). In group shots (docs/screenshots/32-crowd-sprites.png, 05-lantern-row-plaza.png, 19-world.png) this reads as a palette-swapped lineup of identical dolls rather than a lived-in crowd — a step down from CrossCode's or Sea of Stars' more varied civilian silhouettes and gaits.
2. Dialogue portrait art is flat and single-note. In docs/screenshots/06-bar-dialog.png, Dutch's portrait — introduced in the GDD as "gruff, dry, protective" and "load-bearing stain" funny — is a static, mostly neutral bust with minimal linework. Portraits are the game's only close-up on a face, and right now they don't carry the character voice the writing promises the way the field sprites' carried items and idle poses do.
3. World map / Sprawl readability is noisy relative to the rest of the game. `wBarrens`/`dirt`/`rubble` in `src/field/tiles.ts` sit close in value to each other and to the rain layer (`src/field/weather.ts`), so in docs/screenshots/19-world.png and 31-world-radio-lot.png it's harder to separate "path" from "decorative clutter" at a glance than in, say, the K-M Annex, where `WING_STRIPE`/`labWallFace` color-code each wing (cyan halls, amber armory, ice cryo, red containment) for instant legibility. The Sprawl needed the same discipline and doesn't have it yet.
4. Dark dungeon corners can be misread as unfinished/empty. Some far corners in docs/screenshots/18-sinkline.png and 30-sinkline-intake.png fall to near-black `void` (`#07060d` in `tiles.ts`) right up against walkable floor, with no rim light or floor-tone hint the way PSIV/Sea of Stars keep a faint read even in shadow — it can look like the map trails off rather than reads as environmental murk.
5. The Drowned Saint bar interior is under-dressed for its written character. `docs/screenshots/maps/bar.png` and 06-bar-dialog.png show a clean, spacious room with repeated identical stools/booths; the "mind the stain, it's load-bearing" dialogue promises more grime and clutter than the tileset (`floorWood`/`floorCarpet` in `tiles.ts`) currently delivers.

STRENGTHS (max 3):
- The K-M Annex's wing-coded lighting and materials (cyan halls, amber armory, frost-white cryo wing, red containment; `src/field/tiles.ts` `WING_STRIPE`/`labWallFace`, docs/screenshots/21-annex.png, 37-annex-cryopod.png) is genuinely commercial-grade environmental legibility.
- Layered neon-noir lighting — flicker, additive bloom, wet-lip water shading, rain in three parallax layers (`src/field/lighting.ts`, `src/field/weather.ts`) — sells the Saltreach mood convincingly in Lantern Row and the plaza.
- Main cast reads by silhouette alone: Rook's katana hilt, Hex's whip antenna, Sable's staff and tusks, Kit's toe-bounce idle (`src/data/looks.ts`, docs/screenshots/progress-01-cast-sprites.png) — real character design work, not generic recolors.

WHAT WOULD MOVE THIS +1 POINT: Give the crowd real variety beyond palette — a handful of extra silhouettes (different heights, a hunch, a limp, a kid, someone under a cart) so Lantern Row and the Sprawl stop reading as one rig repeated in different colors; put the same "wayfinding through color" discipline used in the Annex onto the Sprawl's terrain palette so path and clutter separate at a glance even under rain; and give the handful of named NPC portraits (Dutch especially) at least two expression states so the dialogue's voice shows on the face, not just in the text box.
```

---

## 3. Battle presentation: 7.3

```
SCORE: 7.3/10
VERDICT: ITERATE (<8.5)
TOP ISSUES (most severe first, max 8, each one concrete and actionable, citing a screenshot or file:line):
1. The party's signature melee swing shows no body motion at all — only a weapon prop rotates while the torso/head stay pixel-identical. Diffing docs/screenshots/13b-swing-gather.png → -raise.png → -cut.png → -settle.png shows the sword sweeping from low, to raised, to a diagonal cut, to resting, but Rook's silhouette (head, shoulders, stance) does not shift one pixel across any of the four frames. This contradicts what src/scenes/battlekit/motion.ts:28 (`swingBeat`) specifies — a lift arc of 0→-2 (gather), 16→9 (raise), 14→12 (cut), 12→0 (settle) battle-pixels that `render.ts`'s `drawPartyMember` (line 310: `const lift = beat ? beat.lift : dd.lunge`) is supposed to apply to the sprite's y-position. Either that lift isn't reading through to what actually gets captured/shown, or the party's attack is read entirely via a rotating prop + smear/glow (src/art/battlers.ts `raise()` only edits arm grid-cells — no torso lean, no forward step). Against Chrono Trigger/Sea of Stars, where every hero attack is a committed full-body animation, this is the single biggest presentation gap.
2. Same-species enemy packs are inconsistently readable. docs/screenshots/38-battle-rat-pack.png: three rats are distinguished only by a hue-shifted palette (src/scenes/battlekit/sprites.ts `VARIANTS`) plus a tiny 6px, low-contrast two-tone scar (sprites.ts:92-94, the `beast` branch of `marked()`) placed off-center on the body — genuinely hard to tell apart at a glance. Compare docs/screenshots/38b-battle-hound-pack.png, where the same `marked()` function stencils bold, high-contrast numerals ("2", "3") straight onto the body (the `machine` branch, sprites.ts:71-80). The GDD's own bar for this area ("enemies are distinct and readable") is met for machine packs and missed for beast packs in the same encounter type.
3. HUD collides with background dressing at the exact moment of a hit. In docs/screenshots/13-battle-action.png, the enemy's HP bar and the "16" damage number sit directly against colorful neon shop-sign bars painted into the street backdrop (pink, gold, green rectangles) — same visual language (a bright rectangle on a dark ground) as the actual HP bar, so the eye has to hunt for which bar is gameplay-relevant right when feedback matters most.
4. Nearly the entire FX catalogue in src/battle/fx.ts (822 lines, ~40 named effects) is built from 1–3px rectangle primitives — `burst`, `ring`, `slash`, `beam`, `bolt` all draw with `ctx.fillRect` at single/double-pixel granularity, no additive glow blending, no curves. It's move-specific and genuinely varied in shape (a real strength — see below), but visually it reads as particle-system programmer art rather than the hand-animated, palette-cycled spell effects of Chrono Trigger/PSIV or the polished modern VFX of Sea of Stars/CrossCode.
5. An enemy's telegraphed "attack" pose only shows its alternate lunge sprite for a narrow slice of its own duration: render.ts:163 gates it to `k >= 6 && k < 18` out of a 30-frame pose (`ENEMY_POSE_T`), so roughly 60% of the wind-up/recovery renders as the plain idle sprite with just a positional offset — undercutting the GDD's own "tells" pillar (section 5), which depends on the player reading the wind-up clearly.
6. The victory screen (docs/screenshots/22-battle-victory.png) is presentationally flat: a single plain list window over the unchanged battle backdrop, party still in their battle-idle busts. No dedicated victory staging, backdrop, or per-character flourish, versus PSIV/CT's distinct victory presentation.
7. The party's own readability suffers in busy streets: in docs/screenshots/38-battle-rat-pack.png and 38b-battle-hound-pack.png, Kit and Rook render as dark, largely featureless busts against a colorful neon backdrop — at a glance the enemies (which get rim-lighting per src/scenes/battlekit/sprites.ts `rimOf`/`RIM`) are easier to read than the crew is.
8. The combo cut-in writing outkicks the animation underneath it: docs/screenshots/15b-battle-triple-combo.png's dialogue ("Like the old days. Clean.") and portrait banner are well produced, but the strike itself is delivered through the same static-body swing described in issue #1, so the payoff promised by the writing/UI isn't matched by what the sprite is actually doing.

STRENGTHS (max 3, one line each):
- src/art/enemies.ts hand-authors 21 distinct enemy bases (punk, brute, arcanist, rat, hound, drone, wisp, crab, eel, turret, lurker, warden, etc.), and docs/screenshots/16b-enemy-poses.png confirms real idle/attack/hurt pose changes per type, not just recolors.
- src/battle/fx.ts gives nearly every ability its own named, shape-distinct effect (crescent, pillar, fissure, circuit, dragon-trail) plus 9 unique combo set-pieces (thunder_rift, clean_job, ghost_circuit…), avoiding the generic-hit-spark trap.
- Hit staging is thoughtful beyond the particles themselves: a camera push-in on big hits, a freeze-frame silhouette cutout for finishers (render.ts `renderImpact`), squash-and-stretch on landed blows, and per-backdrop rim lighting (sprites.ts `RIM`) so enemies never blend into the set.

WHAT WOULD MOVE THIS +1 POINT: Give the party's melee attacks actual full-body commitment — a forward lean or step and a real weight shift on the swing, not just an arm/weapon prop rotating in place over a static torso (verify the coded lift arc in motion.ts is actually reaching the screen); fix the beast-pack duplicate marking to be as legible as the machine numeral system so rat/hound-type trios read as individuals at a glance; and separate HUD elements (HP bars, damage numbers) from background dressing so neon signage never visually competes with them. Together these three fixes address the two things the GDD names directly for this area — "distinct and readable" enemies and FX that "sell every hit" — at the points where the current build most visibly falls short of the Chrono Trigger/Sea of Stars bar.
```

---

## 4. UI / UX: 8.2

```
SCORE: 8.2/10
VERDICT: ITERATE (<8.5)

TOP ISSUES (most severe first, max 8, each one concrete and actionable, citing a screenshot or file:line):
1. Full-screen menus pop open/closed in a single frame with no transition. `src/scenes/menu.ts` (MenuScene.render, ~line 421), `src/scenes/shop.ts` (ShopScene.render, ~line 175), `src/scenes/options.ts` (OptionsScene.render, ~line 131), `src/scenes/controls.ts`, and `src/scenes/saveload.ts` all call `drawWindow` unconditionally with no ease-in state, while `src/scenes/dialog.ts:147-153` (`k = Math.min(1, this.opened / 6)`) and `src/scenes/gameover.ts` fade in over time. Against the stated references (Chrono Trigger's box-open, Sea of Stars' slide-ins), every menu in the game should feel intentional when it appears — right now half the UI animates and half snaps, which reads as unfinished rather than stylistic.
2. Item/ability icons are single ASCII glyphs, not real icons: `kindIcon()` in `src/scenes/menu.ts:739-741` maps item kinds to `+`, `*`, `$`, `#`, and abilities use `•`/`★` (menu.ts:322, 641). Visible in `10-shop.png` and `07-menu.png`'s item rows. CrossCode and Sea of Stars give every item a distinct hand-drawn icon; a bare glyph doesn't scale as inventory grows and reads as a placeholder next to the otherwise-detailed pixel art (portraits, sprites, tiles) everywhere else in the game.
3. The "disabled" text color has weak contrast against the window fill. `UI.disabled = '#5d6080'` (`src/ui/draw.ts:28`) against `fillTop '#1c1a3a'`/`fillBot '#0d0c1f'` (`src/ui/draw.ts:17-18`) computes to roughly 2.75:1 contrast — below even the WCAG AA large-text floor (3:1). This color is load-bearing for exactly the information the game wants players to notice at a glance (locked menu rows, "Empty" save slots, "Sold out," bestiary "not seen yet," unaffordable-item labels) — see `10-shop.png`'s grayed "Nodachi" row and `26-menu-bestiary.png`'s "not seen yet" entries.
4. The game leans on one universal window chrome (`drawWindow`) for absolutely everything — dialogue, shop, status, options, confirms, tooltips. It satisfies "consistent windows" literally, but commercial references vary chrome by context (a system popup reads differently from a dialogue box or a stat sheet) to help players parse what kind of interaction they're in. Here every screen (compare `08-menu-status.png`, `10-shop.png`, `35-options.png`) looks like the same box with a different accent color, which flattens visual hierarchy across very different functions.
5. Save/overwrite and quit confirmations (`src/scenes/saveload.ts:123-127`, `src/scenes/options.ts:158-162`, `src/scenes/menu.ts:598-601`) show plain "Confirm yes · Cancel no" text with no selectable cursor or highlighted default — a departure from the ListMenu cursor convention used everywhere else, so the moment right before a destructive action (overwrite a save, quit unsaved) is the one place the UI's usual focus indicator disappears.

STRENGTHS (max 3, one line each):
- Text-overflow is engineered out, not hoped away: `src/ui/layout.ts` defines exact pixel budgets for every data-driven string, and `tests/layout.test.ts` + `tests/glyphs.test.ts` fail the build if any objective, combo name, item description, or exit label would overflow its box or use a glyph the font can't draw — and it shows: none of the 18 screenshots reviewed have any clipped or truncated text.
- Every locked or blocked action explains itself in the game's voice and gives audible feedback (`ListMenu.why`/`renderWhy` in `src/ui/list.ts:93-103`, used identically in shop, save, title, and gameover menus) — a disabled row is never just grayed out with no explanation.
- Failure and edge-case handling is unusually complete for an alpha: damaged/empty save slots, "browser storage is unavailable" on a failed write, fullscreen refusal, multi-tab autosave arbitration, and a non-fatal in-game error banner (`src/main.ts:56-84`) that keeps the game running instead of freezing.

WHAT WOULD MOVE THIS +1 POINT: Add a shared, reusable open/close ease (even a generic 4-6 frame scale-or-slide wrapped around `drawWindow`) and apply it to every full-screen menu so the whole UI feels like one animated system instead of half-animated, half-instant; replace the single-character item/ability glyphs with small hand-authored pixel icons per item category to match the craft level of the portraits and sprites; and bump `UI.disabled` a few steps lighter (or add a subtle background chip like the status tags already use) so locked/empty/unavailable text clears a real contrast bar instead of relying on players squinting at dim text to find out why something is greyed out.
```

---

## 5. Combat design: 8.0

```
SCORE: 8.0/10
VERDICT: ITERATE (<8.5)
TOP ISSUES (most severe first, max 8, each concrete and actionable, citing a screenshot or file:line):
1. Trash encounters give almost no round-to-round decision-making: street/barrens/sinkline/annex tables all clear in ~2.0–2.6 rounds at 95–100% win (docs/quality/evidence/unit-tests.txt lines 54-61). That's one opening command per member and the fight is over — "meaningful choices each round" mostly applies only to bosses (8-12 rounds) and dungeon attrition, not the majority of combat content a player actually plays.
2. Telegraphed tells (the GDD's headline counterplay mechanic, section 5) exist for only 4 of 18 bestiary enemies — Knuckles (src/battle/ai.ts:146-164), Sentry Turret (:133-145), K-M Arcanist (:165-181), Warden/Warden Spirit (:104-132, 182-194). Everything else (rust_crab, gutter_eel, drowned_shade, hunter_drone, bound_spirit, etc.) picks from a flat weighted table with no wind-up to read, so "visible weaknesses" covers the whole roster but "tells" covers a small slice of it.
3. The competent-player sim policy defaults to the same combo pairing over and over: Kit's Flash Step + Rook's Arc Cut (Thunder Rift) is the fallback both against any non-spirit boss and as the generic "everyday" fusion for any 2+ enemy group (tests/sim.ts:130 and :144). balance.test.ts's combo-coverage check (tests/balance.test.ts:40-46) only proves each of the 9 combos gets used *somewhere* across the whole level range, not that usage is balanced — Ghost Circuit, Spirit Walk, Blackout etc. are provably much rarer in practice. Worth instrumenting per-combo usage frequency, not just presence/absence.
4. The timed-press system (the "as built" addition foregrounded in the GDD, lines 96-99, and in nearly every combat screenshot) moves outcomes only modestly: tests/auto.test.ts:38-50 requires just a 4-point HP-loss improvement out of a ~40-50% baseline, and every balance-test target in tests/balance.test.ts is computed on the *untimed* policy — meaning turning Timing off in Options (src/game/settings.ts:38, default 'on') still clears every published balance target. It reads as an optional skill-expression layer bolted onto the menu rather than something the strategy actually depends on.
5. Crit-bonus tuning looks uneven with no stated rationale: combo_target_lock stacks a +60 critBonus (src/data/abilities.ts:182) on a target it has just guaranteed "exposed" (+25% dmg) on, versus Thunder Rift's +20 (:177) or Moonfall's +15 (:87) — a 3-4x spread between "similar tier" finishers with no test pinning why.
6. Guard stacking with a perfect brace against a telegraphed hit has no documented/tested floor: Guard alone is 0.25x on a telegraphed attack (src/battle/engine.ts:809), and BRACE_MULT.heavy.perfect (0.5, engine.ts:74) is allowed to multiply on top of that (engine.ts:810-811 comment says this is deliberate) — an 87.5% reduction on the Warden's Pulse Cannon, the game's single biggest scripted number, with nothing verifying that's the intended ceiling rather than a compounding oversight.
7. Accuracy is one flat global formula for every player ability (95 + hit − blind − 0.5×agiGap, clamped 25-99: engine.ts:781-786) — Attack and Moonfall miss at the identical rate. There's no fast-but-riskier vs. slow-but-guaranteed trade-off among techs, which flattens an axis of choice PSIV/Chrono Trigger use.
8. The Bestiary (docs/screenshots/26-menu-bestiary.png) logs only Weak/Resist/Immune, not the enemy's tell — a player planning around Knuckles' haymaker or the Arcanist's surge has to remember it from the fight itself rather than consult the codex the game already builds.

STRENGTHS (max 3, one line each):
- Balance is verified, not asserted: per-stage win-rate/round/HP-loss corridors checked by Monte Carlo simulation (tests/balance.test.ts), including a hard, tested proof that spamming Auto/Attack underperforms a competent policy by a wide margin (tests/auto.test.ts) — directly answers the "no dominant spam" bar with evidence.
- The 9-combo fusion system (up to 3 members, discoverable lore hints for the unseen ones, a caller line and cut-in on first use, splash/stun/analyze riders) is a faithful, well-executed take on PSIV/Chrono Trigger's combination techniques rather than a shallow "bigger number" reskin.
- Boss tells give distinct, legible answers rather than one generic response — guard the named target or Guardian-cover it (Warden cannon), jam/stun the spin-up (turret), blind or burst the surge (Arcanist) — matching the GDD's stated design intent.

WHAT WOULD MOVE THIS +1 POINT: Spend the next pass on the two gaps that most separate this from the reference games rather than more content breadth. First, give 4-6 more mid-tier Sinkline/Annex enemies a one-turn tell with a distinct counter (not just the four scripted uniques), so reading a wind-up is the norm rather than the exception. Second, make ordinary trash fights ask for at least one live decision beyond the opener — trim the corridor so a typical win takes 3+ rounds instead of ~2, or add a per-encounter twist (a healer that must be focused, a pair that punishes AoE) — since right now "meaningful choices each round" is true almost entirely for the six scripted boss fights and false for the bulk of combat content a player experiences. Pair that with instrumenting actual per-combo and per-tech usage frequency from the existing sim (not just coverage) to confirm the roster is balanced in practice, and tie the timed-press layer into an outcome the untimed baseline can't already hit, so it stops reading as optional.
```

---

## 6. Progression & economy: 7.6

```
SCORE: 7.6/10
VERDICT: ITERATE (<8.5)

TOP ISSUES (most severe first, max 8, each concrete and actionable):
1. The endgame's own "something worth buying" claim is undercut by its guarding test: CP6 WARDEN median spare cred is 1,222¢ (docs/quality/evidence/unit-tests.txt:38) but the K-M Neural Lace — the item the round-12 notes and tests/economy.test.ts:86-100 frame as the chapter's final sink — costs only 1,200¢ (src/data/items.ts:117). The assertion at tests/economy.test.ts:98-99 (`expect(ITEMS.km_lace!.price).toBeGreaterThan(median * 0.8)`) passes even though price < median. More than half of Monte Carlo runs can buy the single best item in the game outright and still have cred to spare — it isn't actually a stretch for a typical player.
2. Every mandatory checkpoint is trivially affordable: p10 (unlucky-tenth) spare cred after the *required* buys ranges 334–781¢ across all six checkpoints (unit-tests.txt:33-38), and even a player who skips every optional chest still clears 94%+ of runs with cash left over (unit-tests.txt:42-47, gated at only 75% by tests/economy.test.ts:74-76). The story-required kit is never a real budget decision — every genuine trade-off lives entirely in the optional wish-list layer (tests/economy.test.ts:113-121). "Shopping decisions matter" holds for side-grades, never for the gear the game actually gates you on. This is the same gap round 11 flagged (−0.4, "p10 still has 400-700¢ spare"), and round 12's work plan (scorecard.md:58) didn't target it.
3. Loot items (rat_tail, scrap_chip, gang_colors, ghoul_tooth, crab_shell, drone_optic, ecto_vial, km_badge, mana_crystal — src/data/items.ts:140-148) have exactly one function: convert to cred at a vendor (sellPrice() at items.ts:157-162, 100% for loot). No crafting, turn-in, or collection payoff — the GDD says this is deliberate (GDD.md:122, "no use but their value") but it's still thinner than any of the four named reference points (CrossCode's circuit crafting, Sea of Stars' Alchemy/relics), and it means "loot" and "cred" are functionally one resource with an extra menu step between them.
4. No equipment customization/crafting system exists anywhere in the data (no socket, upgrade, or enchant mechanism — confirmed by grep, nothing beyond flat item swaps). Progression is a ladder of buy-the-next-numbered-item. Against CrossCode specifically (a named reference point built around a deep item-upgrade economy), Shadow Jog's economy is a shopping list, not a system.
5. The equip screen drops the elemental-matchup text the shop shows: src/scenes/menu.ts:589 draws only `it.desc`, while src/scenes/shop.ts:205-210 computes and displays "SHOCK bites machines; spirits shrug it off" dynamically at purchase time (seen in docs/screenshots/10-shop.png). A player re-gearing from the field menu — not the shop — loses that guidance exactly when deciding who should carry an elemental weapon.
6. The specific economy claims above are only ever checked arithmetically (tests/economy.test.ts, tests/balance.test.ts run against static tables and a battle simulator) — the three economy E2E tests (e2e/economy.spec.ts) cover one purchase, one sale, and one random-encounter payout, never the checkpoint-affordability or Neural-Lace-pricing claims. The economy has not been exercised as a played system, only modeled.

STRENGTHS (max 3, one line each):
- Mags' discount fork is now reachable in town via Hedda's cart (src/data/maps/lantern_row.ts:208-219) and tested to roughly break even (tests/economy.test.ts:102-111) — the round-11 "no reachable payoff" defect is genuinely fixed.
- Same-tier armory-vs-Requisition alternates for every lead (never the same item — tests/economy.test.ts:86-100) plus per-character head/mod sidegrades give real, simulation-verified tactical choices (tests/balance.test.ts:86-111, "alternative builds" all hold within 5 points of the tuned build).
- The balance/economy verification harness (400-run Monte Carlo per checkpoint, cross-checked against a battle simulator's down-rate model) is more rigorous quantitatively than most indie JRPGs attempt, and correctly confirms zero grinding is required to clear any checkpoint or boss.

WHAT WOULD MOVE THIS +1 POINT: Re-cost or re-gate the mandatory path so at least one checkpoint (CP3 or CP4 is the natural candidate, mid-chapter) leaves an unlucky-tenth, non-grinding player near zero after buying only what's needed — forcing an actual choice between a piece of required gear and a couple of medkits, the way Chrono Trigger's early game does — instead of every checkpoint clearing with 300-800¢ to spare. Simultaneously re-price the K-M Neural Lace (or replace it with something steeper) so it sits clearly above the CP6 median rather than just below it, so the "endgame sink" is still a stretch for a majority of runs, not something half the party can casually afford. Give loot at least one non-cred use (a single barter/turn-in NPC, or one craft recipe) so selling everything isn't the entire loot loop, and surface the shop's elemental bites/shrugs text in the equip screen too, so re-gearing gets the same information buying does.
```

---

## 7. Narrative & writing: 8.2

```
SCORE: 8.2/10
VERDICT: ITERATE (<8.5)
TOP ISSUES (most severe first, each concrete and actionable):
1. Two of the chapter's most important beats are single unbroken dialogue chains that run far longer than the "economical dialogue" bar this reference set (CT, Sea of Stars) holds: `meetDutch` (src/story/chapter1.ts:75-111, ~24 consecutive lines before any player input) and especially `cryopod` (src/story/chapter1.ts:455-509, ~35 lines covering Rook's 20-year-old guilt, Sable's whole backstory, and the S-5/S-6 subplot in one sitting). Split the cryopod reveal across two player-paced beats (e.g., let the party walk to the armory before Rook's confession lands) so the biggest scene in the chapter doesn't also read as its biggest infodump.
2. Mr. Pale's signature "satsuma" beat is echoed almost verbatim at the betrayal: "He splits the satsuma, counts the segments under his breath" (chapter1.ts:101) becomes "He splits the satsuma and counts the segments under his breath. Eleven." (chapter1.ts:543). The repetition is clearly intentional (he "collects numbers"), but reusing the same clause risks reading as recycled prose rather than a sharpened callback — vary the verb/image the second time so the echo lands as a rhyme, not a rerun.
3. Tutorial pop-ups are pasted directly against in-character lines with no tonal cushion, e.g. Rook's terse "Two Rustfangs. Try not to show off." is immediately followed by the system-voiced `s.tutorial('BATTLE BASICS', 'Choose {c}Fight{/}...')` (chapter1.ts:62-63). The bracket-tag UI copy has no character voice at all, so it creates a small but repeated seam right next to some of the tightest noir dialogue in the game.
4. Occasional modern-slang word choices puncture the 2079 neon-noir register the intro panels and Pale's dialogue establish: Hex's "Patent pending" (chapter1.ts:130) and the skewer vendor's "Organic! Very fresh!" (src/data/maps/lantern_row.ts:206) read as contemporary sitcom quips rather than Saltreach vernacular, unlike the otherwise disciplined slang of "corp-locked," "Woken," or "K-M day."
5. Pale's introduction stacks several "quirky menace" tics at once in a single scene — peeling a satsuma in one unbroken spiral, "I bill by the minute," counting segments under his breath, "I collect numbers" (chapter1.ts:80-101). Any one of these would carry the character (compare Magus or Kefka's single defining tic); together they slightly over-signal "this is the villain" before the reveal has earned it.
6. Named speaking enemies with real personality — "Knuckles" Tran (chapter1.ts:175-188), Rustfang Punk, K-M Sentinel/Civic Security — aren't registered in `SPEAKERS` (src/data/speakers.ts:10-19), so they all fall back to the same generic name color and voice pitch (`speakers.ts:23`, `{ color: '#9fd8ff', voice: 1 }`). Voice is otherwise carried hard by color+pitch for the main cast (screenshot 06-bar-dialog.png shows Dutch in his own yellow); the game's own system for "distinct voices" quietly stops at the antagonists.
7. The pod-log thread Hex pulls in the cryopod scene — "S-5. S-6. The pods beside mine went dark... Every name" (chapter1.ts:488-491) — is set up as a loaded piece of leverage against Pale ("it doesn't go to Pale") but never resurfaces before "END OF CHAPTER ONE." As the chapter's own emotional climax it needs at least one line of payoff or acknowledgment before the credits, not just a promise carried into "coming soon."

STRENGTHS (max 3):
- Character voice is sustained with real discipline across dozens of NPCs, item flavor text, and bestiary lore (e.g., src/data/enemies.ts lore lines), not just the four leads — this is unusually deep for an alpha.
- Sharp thematic construction: Pale's number-fixation, the "deniable contractors" line paying off as Chapter 2's title "Deniable Assets" (docs/screenshots/25-ending-next.png), and the Lantern Row memorial motif all show real authorial control.
- The ending sequence executes its gut-punch cleanly: the panel pacing (docs/screenshots/23-ending-panels.png, 23b), the results screen's delayed "Rook: missing" reveal (docs/screenshots/24-ending-results.png), and the cold Pale coda land exactly where a PSIV-style chapter close needs to.

WHAT WOULD MOVE THIS +1 POINT: A dedicated line-editing pass focused on compression and variation rather than new content — trim the two or three densest infodump chains (meetDutch, cryopod) into smaller player-paced beats, give the tutorial strings a half-step of in-character framing instead of dropping bracket-tagged system copy next to noir dialogue, vary the satsuma callback's phrasing so the second occurrence reads as a deliberate rhyme, and extend the SPEAKERS registry to the recurring named antagonists so "distinct voices" is enforced by the game's own systems and not just the prose. None of this requires new story; it's the kind of pass a commercial ship does after the writing (which is already close to the PSIV/Sea of Stars bar) is otherwise locked.

No motivation-clarity failures were found at any story beat (Kit, Rook, Hex, and Sable all have clearly stated, consistently reinforced motivations throughout), so the automatic ≤6 cap for this area does not apply. No typos were found in any of the reviewed source files (chapter1.ts, panels.ts, ending.ts, speakers.ts, items.ts, enemies.ts, or the four maps: lantern_row.ts, rustyard.ts, sinkline.ts, annex.ts, world.ts, interiors.ts).
```

---

## 8. Level design: 7.8

```
SCORE: 7.8/10
VERDICT: ITERATE (<8.5)

TOP ISSUES (most severe first, max 8):
1. Every room in the game is an axis-aligned rectangle stitched from `Grid.rect()` calls — src/data/maps/sinkline.ts:9-43 and src/data/maps/annex.ts:11-33 build every space this way, with no diagonal walls, curved edges, or irregular silhouettes. docs/screenshots/maps/sinkline_1.png and docs/screenshots/maps/annex.png both read as graph-paper layouts (boxes joined by corridors) next to Chrono Trigger's or Sea of Stars' organically-shaped rooms, which vary silhouette room-to-room to make each space memorable on the map screen alone.
2. The Warden boss arena (annex.ts:29-33, `.rect(18,23,22,9,'r')` + a plated deck) is a big blank rectangle broken only by four corner pylons and a center telegraph circle — see the bottom room in docs/screenshots/maps/annex.png. It functions but doesn't read as a designed climax space the way a PSIV/CT final chamber does; there's no asymmetry, no broken machinery silhouette, no forced path through the room that makes the player feel the space before the fight.
3. Only one dungeon in the whole chapter (2 floors, Sinkline B1 + Annex B2), so "dungeon has a shape and a climax" is judged on a single specimen. It's a fine specimen (flood puzzle → mid-boss → lattice puzzle → reveal → final boss → betrayal cutscene is a real escalation), but there's no second dungeon archetype in Chapter 1 to show shape variety, unlike CrossCode's hub-plus-distinct-puzzle-dungeon rhythm even in its opening hours.
4. Elevation is represented only by tile-type swap (`=` catwalk vs `~` water, `t` track) with no visible height/shadow cue — docs/screenshots/18-sinkline.png shows "Platform 2" and the catwalk sitting at the same apparent height as the flooded floor. Chrono Trigger and Sea of Stars both use a visible drop-shadow/parallax step to sell elevation; here a catwalk over deep water looks flat.
5. Rustyard's scrap maze (rustyard.ts:17-23) is a genuinely good secret ("SINKHOLE!" sign is a lie hiding the tribute stash, paid off by Tobin's confession) but it's the only maze-shaped space in the whole chapter — the rest of the level set is corridors-to-rooms. One clever maze doesn't establish a pattern of spatial puzzles, it reads as an isolated set-piece.
6. The two dungeon floors are close in palette (blue-grey lab tiles in annex.ts vs blue-grey flooded concrete in sinkline.ts) — see docs/screenshots/21-annex.png vs docs/screenshots/18-sinkline.png. Neither offers the kind of striking silhouette-level distinction CrossCode gives each of its zones.
7. The full-map "Places" screen (docs/screenshots/33b-menu-place-map.png) is a strong convenience, but it shows raw tile art with no path/route highlight or discovered-secret marker — a player who is lost gets a picture of the whole level, not a hint toward what they haven't found yet, so it aids orientation but not curiosity-driven backtracking.
8. Sign density is high and useful (INTAKE 1-3, JUNCTION 4, CRYO WING, ARMORY, CONTAINMENT), but nearly every one is a plain directional label — compare to the one standout (Rustyard's lying "SINKHOLE!" board): the game has proven it can make signage do double duty as characterization/secret-bait, but does so only once in the whole evidence set.

STRENGTHS (max 3):
- Automated reachability and mid-story dead-end tests (tests/maps.test.ts, tests/mapgraph.ts) check every chest/NPC/event/warp is reachable from every arrival point at every one of 24 story-flag stages, and all 262 tests pass — this is well beyond what most indie teams verify and is the reason the "player can get lost" cap does not apply.
- The Sinkline valve puzzle (src/story/chapter1.ts:254-297, sinkline.ts:78-148) spreads three intakes across the whole map with color-coded lit indicators (red=shut, green=open) so puzzle state reads from across the level, and a fair "one step back, not a full reset" punishment for wrong order.
- The Annex lattice/relay puzzle deliberately plants a wrong in-fiction memo ("Relay A feeds emitters 1 and 2... the refit rewired B and C and nobody updated this memo") against correct color-coded cables the player can actually trace (chapter1.ts:372-393, annex.ts:124-142) — a real "trust what you see, not what you read" puzzle beat, rare in a genre that usually just hands out a lookup table.

WHAT WOULD MOVE THIS +1 POINT: Break the rectangle habit in at least the two or three rooms that matter most narratively — the Warden arena and the cryopod reveal room — by giving them an asymmetric footprint (an off-center support pillar cluster, a diagonal-cut wall, a raised dais reached by a visible short flight of steps with drop-shadow) so the climax rooms are recognizable by shape alone on the map screen, not just by their event triggers. Pair that with one more spatial-puzzle space (a second small maze or a light/shadow line-of-sight room) so the Rustyard maze reads as a technique the game uses, not a one-off, and add a discovered/undiscovered marker to the Places map screen so the existing map view rewards a completionist pass instead of only orienting a lost player.
```

---

## 9. Audio: 7.8

```
SCORE: 7.8/10
VERDICT: ITERATE (<8.5)

TOP ISSUES (most severe first, max 8, each concrete and actionable):
1. Two loop seams sit close to the audible-jump threshold rather than comfortably under it: `title` has +1.2 dB "excess" over its own bar-line median (docs/quality/evidence/audio-loops.txt line 3) and `boss` has +1.0 dB (line 11), against a fail cutoff of 1.5 dB in e2e/audio-evidence.spec.ts. Both pass the automated check but are the two most likely to read as an audible "bump" on loop under headphones — the two to fix first (tighten the wrap bar's dynamics or add an explicit micro-crossfade in `renderSong`/`begin`, src/audio/music.ts).
2. The master music bus applies one fixed brightening chain to every song regardless of genre or mood: highshelf +6 dB @3 kHz and +3 dB @9 kHz plus a global chorus (src/audio/engine.ts:164–182). Per docs/quality/evidence/audio.txt, every one of the 15 tracks — from the "smoky lounge jazz" `bar` cue to the hushed `dungeon`/`sable` ambience — carries a double-digit share of energy above 6 kHz (10.3–21.7%), and the spectrograms for `bar.png`, `dungeon.png` and `sable.png` show almost the same wall-to-wall high-frequency picket-fence transient pattern as `battle.png`/`boss.png`. Reverb space (room/hall/cave/tunnel) differentiates rooms, but timbrally every cue sounds like it's wearing the same "synthwave sheen," undercutting "tracks fit each context" against references like Sea of Stars, where quiet cues are audibly darker/warmer than combat themes.
3. `battle` carries 32.6% of its spectral energy under 120 Hz (docs/quality/evidence/audio.txt line 13) — the highest low-end share of any track, higher even than the dungeon/world themes — likely from the `drive` bass pattern stacking with the kick (src/audio/songs.ts battle.parts, drums:'battle'). On small speakers this risks masking the lead line during the busiest music-and-SFX moments in the game.
4. `victory` is both the flattest track in dynamic range (0.6 dB, docs/quality/evidence/audio.txt line 16) and the brightest (21.7% above 6 kHz, the highest of all 15 songs) — the one moment meant to feel like a triumphant release reads as the thinnest/most brittle cue rather than the most satisfying, unlike the punchy, bass-supported victory fanfares in Chrono Trigger/PSIV.
5. src/data/maps/annex.ts:293 sets `space: 'hall'` for the `dock` map with the comment "open air under the cranes, whatever room the cue came from" — but hardcoding `'hall'` does the opposite of inheriting the prior room; it overrides `tension`'s own `space: 'here'` design (src/audio/songs.ts, tension). It's the only per-map space override in the codebase (grepped all maps), so the mismatch between comment and behavior is worth a second look even though the resulting reverb choice (open hall) is plausible for an outdoor dock.
6. Several SFX needed extreme corrective gain in the LEVEL table (src/audio/sfx.ts:275) — `swing` at 31.62×, `miss` at 30.4×, `step`/`step_soft` at ~26–29× — meaning their raw oscillator/noise synthesis was originally 25–30 dB too quiet. Even after that boost, `swing` (the melee whoosh) still lands at -32.4 dBFS RMS, the second-quietest effect in the game (docs/quality/evidence/audio.txt), so it's worth confirming by ear that weapon swings actually read against a busy battle mix rather than being inaudible filler that only exists to satisfy "SFX on every interaction."

STRENGTHS (max 3):
- Real, automated audio QA: every song and all 69 SFX are rendered offline through the actual mix graph and measured for peak/RMS/clipping/spectral balance, and every loop seam is measured against the song's own bar-line dynamics rather than a fixed threshold (e2e/audio-evidence.spec.ts) — rare rigor for an indie project, and it caught real problems (0/15 loops fail, only 2 near-threshold).
- Four distinct synthesized convolution reverb spaces (room/hall/cave/tunnel) that crossfade smoothly on transition (src/audio/engine.ts setSpace) and are enforced by unit tests that every place "sounds like somewhere" and that battle/jingle/story cues keep the room they're triggered in (tests/music.test.ts, `acoustic spaces` describe block).
- Comprehensive, well-considered interaction coverage: 69 hand-synthesized SFX with a calibrated per-effect loudness table against the music floor, dialogue ducking (src/scenes/dialog.ts) and a rate-limited hit-duck (src/audio/engine.ts duckForHit) that explicitly guards against pumping during combo chains, plus a fallback status-effect sound so no state change ever goes silent (src/scenes/battlekit/playback.ts:231).

WHAT WOULD MOVE THIS +1 POINT: Give each acoustic context its own tonal identity instead of one shared brightening/chorus chain on the whole music bus — darken and de-chorus the quiet/intimate cues (bar, dungeon, sable, tension) relative to the synthwave battle/boss tracks so the spectral-balance table shows real separation in high-frequency share by mood, not 10–22% across the board — and specifically re-craft the `title` and `boss` loop wraps (the two closest to the audible-seam threshold) with an explicit bar-aligned crossfade so every loop is clean by ear, not just under a numeric cutoff; that combination would bring "fits each context" and "loop cleanly" up to the Sea of Stars/CrossCode bar this area is being held to.
```

---

## 10. Feel & polish: 8.3

```
SCORE: 8.3/10
VERDICT: ITERATE (<8.5)
TOP ISSUES (most severe first, max 8, each one concrete and actionable, citing a screenshot or file:line):
1. The boss-critical "striker's face" cut-in slides in from fully off-screen and is illegible for several of its early frames — visible live in docs/screenshots/15-battle-combo.png, where the name-tag box is clipped by the left edge and only "he" is readable. Code: src/scenes/battlekit/playback.ts:185-187 always spawns this single-portrait cut-in with `fromLeft: true`, and src/scenes/battlekit/render.ts:588 tweens it in from `x = -w` over 8 frames (`inK = min(1, c.t/8)`), i.e. it deliberately travels the full off-screen distance every time instead of starting already on-frame. A reward beat that a QA/marketing screenshot can catch mid-transition in an unreadable state is a beat that's landing wrong for some fraction of real playthroughs too.
2. That same boss-crit face-reveal (src/scenes/battlekit/playback.ts:185: `if (e.crit && u.boss && v.lastActor?.side === 'party' && !v.cutinCount())`) is silently skipped whenever any other cut-in is still active (combo cut-ins live up to 70 frames). There's no queueing — the player just doesn't get the payoff for a critical hit on a boss if it happens to land while a prior combo cut-in is still fading, with nothing on screen to explain why the beat didn't happen. Commercial reference points (Chrono Trigger's tech flash, PSIV's ATB alerts) never let a scripted "big moment" silently no-op based on unrelated recent state.
3. (Lower confidence, worth a look) src/scenes/battlekit/motion.ts:28-33 — `swingBeat()` allocates its speed-smear entirely to the `raise` phase (wind-up, k 6-7: `smear: 8-k+1`) and gives the `cut` phase (the actual connect frame, k 8-11) `smear: 0`. The frame the player's eye is on when the hit lands is the one beat of the four-beat swing with no motion-trail budget; top-tier 2D combat (Chrono Trigger, Sea of Stars) puts the smear on the strike, not the backswing. Screenshots 13b-swing-raise.png vs 13b-swing-cut.png show the raise frame with the blade mid-motion near the hip and the cut frame as a clean static silhouette — worth confirming in motion whether the payoff frame reads as fast as the wind-up does.

STRENGTHS (max 3, one line each):
- The per-move FX catalogue (src/battle/fx.ts) gives almost every named ability its own bespoke silhouette (falling crescent, winding ki-dragon, converging circuit traces) rather than a recolored generic burst — real per-move identity, not a shared VFX template.
- Feel is layered and measured, not just asserted: camera zoom-punch on big hits (render.ts:107-115), hitstop with input carry-over so a press during a freeze isn't lost (battle.ts:362-371), squash/stretch, and tunable Options (Hit pause / Screen shake / Screen flash) — backed by passing 2-frame input-latency and 60fps frame-budget gates in docs/quality/evidence/perf.txt.
- The comic-panel system (src/scenes/panels.ts) nails the PSIV reference: cubic-eased panel slides, a "press advances but never eats a queued input" dialogue contract, and a bespoke finale title card — docs/screenshots/02-intro-panels.png and 23b-ending-finale.png read as genuinely cinematic, not placeholder.

WHAT WOULD MOVE THIS +1 POINT: Treat the cut-in system as a small, finishable unit rather than "done": start the single-portrait crit cut-in already inside the frame (or shorten its travel) so no frame of its life is unreadable, replace the `!cutinCount()` guard with a short queue so a critical hit on a boss always gets its face beat instead of silently losing it to timing, and do a pass confirming the strike frame of every weapon swing actually carries visible trailing motion rather than the wind-up alone. None of this touches the substantial systems (FX catalogue, camera work, input latency, panel transitions) that are already at or near the standard of the named reference points — it's specifically the handful of places where a scripted "big moment" can be silently dropped or caught mid-transition that need to be swept for the same bug class and fixed everywhere it appears, not just where I happened to find it in this pass.
```

---

## 11. Stability: 8.6

```
SCORE: 8.6/10
VERDICT: PASS (>=8.5)
TOP ISSUES (most severe first, max 8, each one concrete and actionable, citing a screenshot or file:line):
1. `src/game/settings.ts:59` — `export const settings: Settings = typeof localStorage === 'undefined' ? { ...DEFAULT_SETTINGS } : load();` runs unguarded at module-import time. `typeof` does not suppress an exception thrown by a getter, and in a real (if rare) browser configuration (privacy/enterprise policy, sandboxed context) merely referencing `localStorage` throws `SecurityError` before any method call. The codebase already knows how to guard this exact pattern — `src/game/save.ts:45-51`'s `storage()` wraps the identical `typeof localStorage === 'undefined' ? null : localStorage` check inside `try {} catch {}` — but `settings.ts` reintroduces the unguarded version. In that scenario the game fails to boot entirely (index.html's pre-start error listener catches it, so it's a visible failure message rather than a silent freeze, but still a needless total-failure mode where the rest of the engine's philosophy is graceful degradation).
2. No long-session soak test exists anywhere in the suite (unit or E2E). A 45–75 minute chapter accumulates WebAudio graph churn (per-note oscillators/filters, chorus LFOs, `airBed` sources, convolver crossfades), scene-stack push/pop, and RAF-driven timers; nothing runs anywhere near that duration to catch a leak-driven slowdown or eventual instability that short chaos tests can't surface. The team's own scorecard already names this gap.
3. Gamepad and touch are first-class controls in `docs/GDD.md` section 9 (and a `settings.touch`/keybinding data model exists), but zero E2E or unit coverage exercises either input path. A stuck state reachable only via gamepad/touch is invisible to the entire suite, which is keyboard-only throughout (`e2e/chaos.spec.ts` etc.).
4. `e2e/chaos.spec.ts:113-120` — the loop backing a mashed battle out to `'round'` mode has no assertion that it actually reached `'round'` (or `'done'`) before the test unconditionally sets `debug.playtest = true` and waits up to 90s. A future regression that left the scene stuck in a non-round submenu could still pass by luck of the debug driver intervening, rather than failing loudly on the real defect.
5. `playwright.config.ts` sets `workers: 1` and no retries (good — the green run isn't retry-masked), but that also means CI evidence (`docs/quality/evidence/ci-engines.txt`) is a single sample for timing-dependent scenarios (the two-tab `BroadcastChannel` handover in `gameover.spec.ts:195`, the 30s/32s unsaved-progress prompt in `prod.spec.ts:73`). One green run establishes correctness once, not a flake rate.
6. `src/audio/engine.ts:397-401` — `gone()` treats only a `DOMException` named `InvalidStateError` as "the page is going away" and swallows it; any other engine's equivalently-benign teardown exception falls through to `reportError`, surfacing a "Something glitched" notice to a player already leaving the page.

STRENGTHS (max 3, one line each):
- Fault isolation is real engineering: separate update/render fault counters with `FAULT_LIMIT`, tested for one-off vs. persistent faults, throwing `exit()`, and curtain/opaque render skipping (`src/engine/game.ts`, `tests/game.test.ts`).
- The save system is defense-in-depth and proven against a real artifact: structural validation, unknown-id sanitization, non-finite/off-map tampering rejection, and versioned migration all exercised in `tests/save.test.ts` (17 cases) against a kept version-1 save fixture from an actual shipped build.
- Stability evidence is unusually credible for an indie alpha: 51 E2E tests across Chromium, WebKit and Firefox from a real linked CI run, covering input chaos, tab handover, boot failure and the actual production `vite build` bundle, not just the dev server.

WHAT WOULD MOVE THIS +1 POINT: Wrap `settings.ts`'s module-level `localStorage` bootstrap in the same try/catch `storage()` already uses in `save.ts`; add a minimal gamepad-driven E2E smoke test since gamepad is a named control surface with zero coverage; add one long-session soak run on a slower cadence than per-PR CI, asserting stable audio-node counts and frame time over an extended duration; and tighten `chaos.spec.ts`'s battle-mashing test to assert it actually reached `'round'` mode before handing off to the debug driver.
```
