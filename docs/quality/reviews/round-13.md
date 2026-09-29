# Round 13 reviewer notes (after Mark's first playthrough)

Mark played a partial run on 2026-09-29 and left 25 notes (`docs/mark-playthrough-notes.md`). He asked for them to be
worked through "mostly on your own, with reasonable verification using a similar rubric as the initial build". This
is that verification: ten of the eleven areas re-scored (Audio was untouched by the work, so it wasn't), plus one
extra reviewer who checked each of the 25 notes against the evidence. Each reviewer was a fresh Sonnet agent with
read-only access, the prompt from `scripts/verifier-prompts.py 13` (the notes reviewer's prompt is below), and the
evidence committed in d50db57. The reports are verbatim.

Scores: Engine & code 7.6, Field art 7.0, Battle presentation 7.5, UI / UX 6.5, Combat design 7.7, Progression &
economy 6.8, Narrative & writing 6.0 (capped), Level design 7.0, Feel & polish 7.6, Stability 7.9; Audio carried at
7.8. Average **7.22** (round 12: 7.98).

## Reading the drop

The fall has three causes, and they matter differently:

- **Regressions this work introduced** (fixed after the reports, in de5fff5 and c7c055b): New Game started Rook at
  level 3; saves from before the retune didn't migrate; the new Deck menu row broke the screenshot navigation (so
  the Bestiary, Places and Place Map shots showed the wrong screens) and hid a Bestiary overflow for the finer boss
  art; the damage-symbol column clipped "Incendiary Round"; the acting arrow sat in the enemy row; cut-ins outlived
  the combo name card; the finale's XP ended the chapter at 7; Wire over-explained the pump puzzle; Sable's pronoun
  in the mending beat. These pulled UI / UX (−1.7), Progression (−0.8) and Level design (−0.8) down most.
- **Trade-offs Mark's notes asked for**: creatures painted finer than the rest of the battle (mixed pixel density);
  slower battles (a longer chapter, now estimated at 71 minutes).
- **Findings that predate this work**, some scored more strictly than in round 12: Narrative's cap is for the lift
  scene's motivation, which round 12 scored 8.2 with the same script; Stability's list (async battle errors, story
  beats that can't be retried, a blocked Gamepad API) is all older code (three of its items fixed anyway). GRADING.md
  §6 describes reviewer variance of about ±0.5 on unchanged work.

The fixed state hasn't been re-scored. What was fixed is listed in `docs/quality/playthrough-1.md` ("After the review").

## The notes reviewer's prompt (verbatim)

```
Working directory: C:/Users/markh/home-base/projects/shadow-jog (all paths are relative to it). Read-only review: do not edit any files, do not run the game or install anything. You may read files, list directories, and run read-only git commands (git log, git show, git diff).

You are an independent reviewer. You did not write this work and you owe the writer nothing. Your job is to find what is wrong.

The owner of an indie JRPG alpha called SHADOW JOG played it and wrote 25 notes: docs/mark-playthrough-notes.md. The developer then changed the game and claims, note by note, what was done: docs/quality/playthrough-1.md (it names commits and screenshots in docs/screenshots/).

For EACH of the 25 notes, check the claim against the actual evidence: read the relevant source (use `git show <commit> --stat` and `git show <commit> -- <file>` to see what changed), open the cited screenshots with the Read tool, and read the unit test output in docs/quality/evidence/unit-tests.txt where the claim rests on a test. Judge whether the change does what the OWNER asked, in the spirit he asked it, not just the letter. Be concrete.

Also look for regressions or new problems the changes introduced (a mechanic that now contradicts the story, text that no longer matches the numbers, a UI element that overlaps another, balance that looks off in the printed tables in unit-tests.txt, a stale doc).

Return exactly this format:
NOTE-BY-NOTE:
1. ADDRESSED | PARTIAL | NOT ADDRESSED | MISREAD: <one line of evidence (file:line or screenshot)>; <concern, if any>
2. ...
(all 25)
REGRESSIONS / NEW PROBLEMS (most severe first, max 10, each concrete, citing file:line or screenshot):
1. ...
OVERALL: <two or three sentences: would the owner feel his notes were heard?>
```

---

## 1. Engine & code (7.6)

SCORE: 7.6/10
VERDICT: ITERATE (<8.5)

Build and tests verified by me, so no cap applies: `tsc --noEmit` exit 0, `biome lint` exit 0 (146 files), `vitest run` 21 files / 267 tests passed. The `gh run list` at review time showed HEAD's CI still in progress.

TOP ISSUES (most severe first)
1. **Per-frame allocations remain in the battle and text paths, against the project's own rule (docs/DEVELOPING.md:133) and the claim in `src/engine/font.ts`.** Nothing measures it.
   - In `src/scenes/battlekit/render.ts`, `renderPanel` (:748-752) runs `knownAbilities()` every frame while Rook is in the party. That is a 3-array filter/map/filter chain (`src/game/party.ts:91-96`) plus two `reduce` closures, and it draws Rook's "SKILL 11/11 uses" card in docs/screenshots/11-battle-command.png.
   - Also per frame: a closure at `render.ts:95` (`fx.render` callback), the `put` closure per enemy (:206), `party.forEach` (:699), and `items.reduce` with `measure` (:820).
   - `src/battle/fx.ts:833` calls `mix()` per particle per frame, which builds an array and a hex string (the burst in 13-battle-action.png).
   - `drawParagraph` (`src/engine/font.ts:391`) re-runs `wrap()` every frame (split, flatMap, regex, measure, opts spread). Menu, shop, deck, card and the combo cut-in (`render.ts:692`) all call it from render.
   - The victory panel calls `toLocaleString` twice per frame (`src/scenes/battle.ts:791-792`).
   - `e2e/perf.spec.ts` records only JS milliseconds, so no test would notice any of this.
2. **The battle scene/renderer split is a file split, not a boundary.**
   - `BattleRenderer` takes the whole scene (`battle.ts:123`, `new BattleRenderer(this)`) and reads it about 128 times as `this.s.*`.
   - `render.ts:22` imports the scene type back, and the scene exposes a bag of public mutable fields (`push`, `impactT`, `impactOn`, `bannerStart`, `defeatT`, `layout`, near `battle.ts:830`).
   - `battle.ts` is still 993 lines. `update()` runs about 150 lines, and `victory()` (~90 lines) mixes reward mutation (`state.cred`, inventory, `grantXp`) with inline panel drawing. That reward logic has no unit test.
   - `FxLayer.play()` in `src/battle/fx.ts` is a roughly 390-line, 53-case method. `menuX(_a, _w)` (`battle.ts:990`) is a leftover with unused parameters.
3. **Module boundaries are held by habit, not tooling, and have already drifted.**
   - `docs/ARCHITECTURE.md:49` says "enforced by habit". There is no import-restriction rule and no cycle check (my scan of value imports found none today).
   - `battle/setup.ts:3` imports `game/party`, though the doc says `battle/` imports only `engine/` and `data/`.
   - `battle/fx.ts` (839 lines of canvas drawing) sits inside the "pure battle engine" folder.
   - `field/fieldmap.ts:10` reads `game/state` at bake time, and `audio/engine.ts` imports `game/settings`.
   - `game/systems.ts` and `story/newgame.ts` import scenes upward. The resulting cycles are broken by a mutable global `fieldHooks` whose `?.` calls silently do nothing if a hook is never installed.
4. **Orchestration logic is untested and coverage is unmeasured.**
   - `src/game/systems.ts` holds inn and clinic pricing, the encounter-zone and rate logic, the `runBattle` retry rewind with RNG reseed, the bounty tally and `useSpecial`. All of it is exercised only by 7-minute real-time e2e runs.
   - There is no coverage tooling (`vite.config.ts`), so "logic unit-tested" is unmeasured. `tests/battle.test.ts` has 35 tests for a 926-line engine.
   - `systems.ts:79-84` duplicates `removeItem`, and `void game;` at `systems.ts:323` is a lint dodge for an unused parameter.
5. **Strictness is enforced in two folders only.**
   - The no-`!` rule covers `engine/` and `battle/`, where the count is 0. Elsewhere there are 233 non-null assertions (132 in `scenes/`, 26 in `field/`, 39 in `art/`) and 204 `as` casts.
   - `FieldScene` declares `map!` and `def!` (`field.ts:65-66`) and relies on the constructor calling `load()`.
   - `BattleScene.d(uid)` is `disp.get(uid)!`, so a missing display state throws later, far from the cause.
6. **Dead code with a latent bug.** `invalidateMap(id)` (`field.ts:55-57`) deletes key `id`, but the cache is keyed by `sig`, which is `id:bits...` (`field.ts:40`). It can never match, and nothing calls it. `load()` also writes chest tiles into the cached `FieldMap.solid`, so shared cached state is mutated on every load.
7. **The 60fps evidence is thin and the loop does redundant work.**
   - `main.ts:46-47` renders and presents on every rAF even when no tick ran. That is 2.4x redundant frames at 144 Hz and 4x at 240 Hz, with no interpolation.
   - Gates are loose: 4 ms mean and 6 ms p95 against 1.4 ms and 1.7 ms measured, so a 2.8x regression passes. `max` is never gated (battle max 7.2 ms, `docs/quality/evidence/perf.txt:12`).
   - Only two scenes are measured (the plaza and an annex fight). Menus, shop, map bake or warp hitch, boot time and CPU-throttled runs are not.
8. **CI gate history is noisy.**
   - Of the last 10 completed runs, 4 were red: 3 at the `npm run budget` step and 1 chaos-test timeout. The chaos failure was diagnosed as a test-side random encounter and fixed in the test.
   - `scripts/bundle-budget.mjs` documents the budget being re-set twice on 2026-09-29 (190 to 212 kB) to fit feature work.
   - Production ships sourcemaps (`vite.config.ts` `sourcemap: true`; `dist` holds a 1.2 MB `.map`).

STRENGTHS
- Very strict TS config (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), clean lint, and a value-import graph with no cycles, thanks to lazy chunks and hooks.
- A pure, deterministic battle engine that emits events for a narrow `PlaybackView` (tested with a recording view), plus balance simulation tables and per-scene fault isolation with `FAULT_LIMIT` recovery (`src/engine/game.ts`, `tests/game.test.ts`).
- The field path shows real allocation discipline: pooled draw list, pooled rain and splashes, pooled timers. It holds about 1.4 ms mean while drawing the neon, rain and lit sprites in 04-lantern-row-street.png. The save layer has a migration chain, validation and sanitizing, tested against a real v1 fixture.

WHAT WOULD MOVE THIS +1 POINT
Turn the discipline claims into enforced facts. First, add an allocation and frame-interval gate: CDP heap-sampling or GC counts, frame deltas, and `max` gated, run over the battle command menu, the shop and the menu as well as the plaza. Then fix the battle and text hot paths it exposes: cache wrapped paragraphs and ability counts, drop the per-frame closures, and stop `mix()` and `toLocaleString` running every frame. Second, make boundaries real: add an import-restriction and cycle check to lint or CI, move `battle/fx.ts` out of the logic folder, and give `BattleRenderer` a narrow read-only view interface, as playback already has, in place of `this.s.*`. Third, pull the reward, inn, clinic, encounter and retry logic out of `scenes/battle.ts` and `systems.ts` into pure modules with unit tests, and turn on Vitest coverage. Finally, delete or fix `invalidateMap`, extend the no-`!` rule to `scenes/` and `field/`, and skip `render()` when no tick occurred.

---

## 2. Field art (7.0)

SCORE: 7.0/10
VERDICT: ITERATE
TOP ISSUES (most severe first):
1. Rustyard scrap-heap walls read as a noise texture, not scrap. `junk` (src/field/tiles.ts:308-322) colours random 6x4 blocks from a 7-colour palette, then adds random gold and cyan speckle pixels. In docs/screenshots/20-rustyard.png the bottom third and top corners are this mosaic. In maps/rustyard.png it looks like corrupted granite: no pipes, tyres, plates or silhouettes, and the pixel density does not match the crisp tents, stall and lamps. This is the element closest to the "debug placeholder" cap. I did not apply the cap because it is a deliberate textured heap, but a stricter grader could. Build the heap from authored chunks (tyre stacks, sheet metal, pipe bundles) with a lit top edge.
2. The Sinkline is mostly one undifferentiated dark mass, and it is the longest stretch of the game. In 18-sinkline.png and 18b-sinkline-intakes.png the lower half is void/wall (solid fills at tiles.ts:45 and 804, blotched only by `relief`, tiles.ts:875) against slightly lighter floor. Walkable and solid ground separate only by faint outlines and the odd brick stub. maps/sinkline_1.png shows a huge featureless grey-blob border around a few small rooms. The same dark palette and stub-wall vocabulary repeat all through B1. Compared with the layered walls, pipes and water of Chrono Trigger's Lab 16 or CrossCode dungeons, this reads as unfinished.
3. The world map repeats a small set of rooftop stamps. `wBlock` (tiles.ts:737-782) picks one of 6 rooftop kinds on a 48x32 grid (HVAC, tank, skylights, garden, helipad, dish). 19-world.png and 31-world-radio-lot.png show the same 6x3 skylight grid and the same (H) pad several times per screen. maps/world.png is a wallpaper of near-identical blocks with no landmarks between the few authored buildings. It is legible but generic at the scale Sea of Stars or PSIV would use for an overworld.
4. The toxic canal reads as camouflage foliage, not water. `wToxic` (tiles.ts:711-724) is fbm-blotched green with sparse glow pixels. In 31-world-radio-lot.png the strip across the map looks like a hedge or moss band, so the brick bridge crossing it looks odd. Give it a darker sludge base, a bank edge highlight, and visible flow or sheen so it reads as liquid.
5. The 40-odd crowd NPCs are one body template in different colours. 32-crowd-sprites.png shows the same torso, leg block, stance and 16x24 silhouette, varying only by hair, skin and shirt colour, and a body type in about a third of cases (`randomLook`, src/data/looks.ts:105-150; `HAIR` set, chars.ts:219). The plaza in 05-lantern-row-plaza.png hides this with umbrellas and stalls, but interiors and Rustyard (20-rustyard.png) show the sameness. Bespoke silhouette props (bags, long coats, kids, a wheelchair or mech legs) would fix it.
6. Character animation is thin for the reference bar. `buildChar` (chars.ts:1041-1075) produces 3 frames per direction (stand, stepA, stepB, cycled 0,1,0,2), plus a single crossed-arms idle or a bounce toggle. There is no run, interact or reaction pose and no blink. The personality that exists (katana hilt, antenna, staff, hat in progress-01-cast-sprites.png) comes from silhouette props and static faces of 2-3 pixels, well short of CrossCode or Sea of Stars.
7. The Drowned Saint interior (06-bar-dialog.png, maps/bar.png) is sparse and mirrored. The 22x14 room is a flat repeating diamond carpet with two identical booths, four identical tables and a stool row. Tables have no seating and large carpet areas are empty. The "SAINT" holo (interiors.ts:122) stands as a floating pole sign in the middle of the floor. The room has no distinct light pools apart from one floor lamp, so it lacks the layered mood of the street outside.
8. Rustfang tags and banners read as unexplained round red or orange faces (20-rustyard.png, tag/banner props at rustyard.ts:77-98, props.ts:873, 908). They sit on rock or wall with no gang lettering or drips, so they look like status icons or stray sprites, not graffiti. Separately, the light map (lighting.ts `build`) is pure radial gradients with no wall occlusion, so lights bleed through walls into neighbouring rooms.

STRENGTHS:
- Lantern Row (04, 05, maps/lantern_row.png) is commercial quality. Neon signage, wet-street reflections, string lights, layered rain and lit windows with props all sell "neon noir", with a cohesive purple/magenta/cyan palette.
- The Annex (21, 27, 37/37b) has a readable, coherent sterile-lab language. Cyan cryo pods, red containment ring, coloured pod glow and the cryopod-empty state are clear, and the lighting separates zones.
- Named cast sprites (progress-01-cast-sprites.png) have distinct silhouettes and props (Rook's katana hilt and cybernetic arm, Hex's antenna, Sable's tusks and staff, Dutch's hat). Chests got a lit trim, halo and glint (chests.ts, 47-field-chest-and-marker.png), so they now read.

WHAT WOULD MOVE THIS +1 POINT: Bring the two worst-reading environments up to Lantern Row's standard: the Rustyard scrap heaps and the Sinkline rock and void. Replace the noise-block `junk` fill with authored scrap pieces and a lit top edge. In the Sinkline, add readable pipe, brick, wall-cap and drain detail and clear value separation between floor, wall and void. Then give the world map more than 6 rooftop stamps, make the toxic canal read as liquid, and add a few unique landmarks. After that, widen the NPC body and silhouette variety and add a proper walk cycle of 4 or more frames with a couple of reaction poses for the cast. Those changes would make the whole game as legible and characterful as the town.

---

## 3. Battle presentation (7.5)

SCORE: 7.5/10
VERDICT: ITERATE

The ≤6 cap for missing visual feedback does not apply. Actions have real feedback in code and in the stills: hitstop, directional shake, impact frames, floaters, flinch frames, death dissolve, cut-ins and a timing ring. The score is held down by presentation flaws visible in the stills, and by "FX sell every hit and spell" being asserted rather than shown.

TOP ISSUES (most severe first):
1. **The party is a row of back-of-head blobs.** They cover enemy bodies and give the player no readable action animation.
   - Kit's head hides the crab's legs (11-battle-command.png, 12-battle-techs.png).
   - Rook's head hides a rat (46-battle-round-in-play.png) and Kit and Rook cover the rats in 13-battle-action.png.
   - The Lurker's arms disappear behind Rook and Hex in 17-battle-lurker.png.
   - The melee swing (13b-swing-gather/raise/cut/settle.png) is a sword sprite pasted across the chest. The body only lifts up the screen (src/scenes/battlekit/motion.ts:28-33) and never travels or turns.
   - CT, PSIV and Sea of Stars give the party readable side or 3/4 bodies with wind-up and follow-through. A back-view head reads as a placeholder.
2. **Three pixel densities share one frame.**
   - The party, human enemies and all FX sit on the 240×135 world drawn 2x (src/art/battlers.ts:1-4, src/battle/fx.ts:1-2).
   - Creatures are painted at twice that resolution (src/art/enemies.ts:13-19, scale at :393).
   - The UI is at screen resolution.
   - In 11-battle-command.png the fine crab sits beside the chunky ghoul and Kit's 4px-block hair. FX lines in 15-battle-combo.png are 4px wide over fine sprites.
   - The code comment calls this deliberate, but a commercial pixel-art game would not ship mixed density.
3. **Combo cut-ins bury the actors and the action.**
   - Two big portrait panels sit over Kit, Rook and Sable, and cover the lower-left sentinel, in 15-battle-combo.png.
   - In 15b-battle-triple-combo.png the banner plus three panels hide two of the three acting members and one enemy. The "TURN" strip label is clipped, and the banner sub-line butts into the Hex panel.
   - Cut-ins live 70 frames (src/scenes/battlekit/playback.ts:163) but the banner holds only 56 (:168), so panels still cover the crew as the hit starts.
   - The player sees the portrait, not the combo being performed.
4. **The yellow acting arrow lands on enemy bodies and reads as a target cursor.**
   - It sits at party head height minus 12 (src/scenes/battlekit/render.ts:391-410), which overlaps the enemy row.
   - It is on the crab in 11-battle-command.png and 12-battle-techs.png, on a rat in 13-battle-action.png, and on the rat/Rook overlap in 46-battle-round-in-play.png.
   - The aim colour is cyan, but overlap defeats the colour split.
5. **Basic hit and spell FX are small primitive recipes.**
   - A regular attack is a 12-world-px slash, a 6px star and a few sparks (src/battle/fx.ts:402-415). In 46-battle-round-in-play.png it is a small mark inside the timing ring, tiny against a 100px enemy.
   - Fire is two spark bursts, a rise of dots and a smoke puff (fx.ts:549-566).
   - Heal is rising dots plus a ring (fx.ts:567-586).
   - There are no authored animated sprite FX and no scene relight beyond flash and shake. This is far short of Chrono Trigger or Sea of Stars spell animation.
6. **Human enemies are weakly animated, and the first boss is not scaled up.**
   - In 16b-enemy-poses.png the punk, medic, slinger, sentinel, ghoul and arcanist have three near-identical frames (idle, attack, hurt) that differ by a prop tilt or a few sparks. They are the overworld rig reused (src/art/enemies.ts:1-4, 283-300).
   - Knuckles (src/data/enemies.ts:111-112, fight at :278) is the same `brute` rig, about as tall as the goons in 16b-enemy-poses.png. Bosses only get a different ground lift (src/scenes/battle.ts:53).
   - Warden and Lurker do loom (16-battle-warden.png, 17-battle-lurker.png).
7. **The evidence does not show the claimed FX or backdrop coverage.**
   - Only three stills show a spell or hit FX: the CRITICAL/48 pop in 13-battle-action.png, the lightning in 15-battle-combo.png and the slash in 46-battle-round-in-play.png.
   - No still shows fire, heal, shield, status effects, enemy or boss attack FX, or a Hex program.
   - 41-deck-seat-booted.png is a story scene, not the battle deck cut-in.
   - The barrens, rustyard (Knuckles' arena) and park backdrops are absent, so "backgrounds set place" is proven for only five of eight (src/art/battlebg.ts:278-767).
8. **Backdrop dressing is weaker than the sewer and the lab.**
   - The street neon signs are unmounted flat bars that float over the storefronts and collide with floaters. In 13-battle-action.png the yellow "48" sits beside a yellow bar, and colour dots read as confetti in 13 and 38.
   - The junction (17-battle-lurker.png) is dark columns over dark water with little value range.
   - The rail and cable framing is a shared template with the same geometry and only a rim-colour change (battlebg.ts:807-830). Street and junction look framed by the same railing, and the four other backdrops have no framing.

STRENGTHS:
- Enemy design and identity are strong: 19 creatures and bosses have drawn attack and hurt frames (src/art/enemies.ts:45). Duplicates get per-individual anatomy plus markings (16b-enemy-poses.png, 38-battle-rat-pack.png, 38b-battle-hound-pack.png). Warden and Lurker read instantly (16c-boss-poses.png).
- The impact layer is rich in code: directional shake, hitstop, camera push-in, impact frames, weak/crit/resist callouts, timing rings, dissolve on death and per-combo stings (src/scenes/battlekit/playback.ts:186-215).
- The sewer perspective backdrop (11/12/46) and the lab and core sets (14, 16) set place well, with rim-lighting that ties sprites to each set.

WHAT WOULD MOVE THIS +1 POINT: Fix the party first. Give each member a side or 3/4 battle body that steps toward the target for a strike, and stop the crew head-blobs from occluding enemies. Then unify the pixel density so the crew, enemies and FX share one grid. Add two or three authored, multi-layer spell FX (fire, heal, one Hex program) with a scene light pulse, and enlarge the basic slash and hit flash. Shrink or reposition combo cut-ins so the actors' poses stay visible, and stop the acting arrow overlapping enemies. Finally, capture stills of the missing coverage (spell, enemy-attack and status FX, Knuckles in the rustyard, barrens and park) so the claims are demonstrable.

---

## 4. UI / UX (6.5)

SCORE: 6.5/10
VERDICT: ITERATE (<8.5)

TOP ISSUES (most severe first):
1. **A core battle-menu skill name is cut off with an ellipsis, on two screens.** `docs/screenshots/14-battle-combo-hint.png` shows Rook's "Incendiary Rou…". `docs/screenshots/45-menu-status-rook-wounded.png` shows "× Incendiary Round (lo…".
   - Battle cause: `src/scenes/battlekit/render.ts:820-821` sizes the list as `widest + 30`, where `widest` is label + right column + 12. The row also needs the 9px cursor and the 8px icon, so the window is 1px short and the widest label always truncates.
   - Status cause: `src/scenes/menu.ts:654` and `:648` cap the abilities column at 104px, and "× Incendiary Round (locked)" measures about 120.
   - `tests/layout.test.ts` has no test that measures ability or item labels against these boxes, so the suite passes.
   - Clipped text fails the stated 8.5 bar; I did not apply the ≤6 overflow cap because `fitText` truncates rather than overflows.
2. **Three UI screens have no valid evidence, and the reason is a stale capture script.** `26-menu-bestiary.png` shows the Combo Log. `33-menu-places.png` and `33b-menu-place-map.png` are both the empty Bestiary and are the same size (13,178 bytes).
   - `e2e/shots.spec.ts:361-366` and `:431-440` press ArrowDown 5 or 6 times.
   - The conditional "Deck" entry (`src/scenes/menu.ts:60`) shifted every index below it by one.
   - The populated Bestiary, the Places list and the Place Map (`src/scenes/placemap.ts`) were never seen this round.
   - `placemap.ts:101` turns on `imageSmoothingEnabled = true` for a non-integer downscale, so that screen is probably soft against a nearest-neighbour game.
3. **The empty-state text touches the window frame.** In `33-menu-places.png`, "Nothing logged yet. Win a fight." measures 135px and is drawn at x+4 in a 136px list.
   - `src/ui/list.ts:111` draws `empty` with no fit or wrap.
   - The string ends about 1px from the frame. The right-hand pane (`menu.ts:665`) is a blank void with no placeholder.
4. **The shop popups collide with the list.** In `43-shop-equip-now.png`, the "EQUIP NOW?" popup sits at a fixed `ey = 96` (`src/scenes/shop.ts:356-358`).
   - Its title tab slices through the "Nodachi" row, so that row reads as cut off.
   - Faint list text ghosts through the popup body, which has alpha 0.95.
   - The quantity popup (`shop.ts:350`) and the sell-all popup (`:382`) are also fixed-position and unrelated to the selected row.
5. **The battle tech and skill lists hide enemies while you choose.** In `12-battle-techs.png` and `14-battle-combo-hint.png`, the stacked list plus command window (`render.ts:824-826`) covers a large part of the left-hand enemy, about 40% in shot 14.
   - The layout test only protects the turn strip against the menus, not the enemy sprites.
6. **The equip screen defaults to a destructive action.** In `09-menu-equip.png`, when the bag has no other weapon the only row is "(Remove)" and the cursor starts on it (`src/scenes/menu.ts:386-394`).
   - Equip → Kit → Weapon → Confirm unequips the weapon (ATK 31→22) with no confirmation.
7. **Some key prompts ignore rebinding, though the Controls page lets you rebind.**
   - `src/scenes/dialog.ts:177` hard-codes "Hold X to fast-forward" and draws it with no backing over the world.
   - The tutorial at `src/story/chapter1.ts:58` hard-codes keys.
   - The overwrite and quit confirms print the words "Confirm" and "Cancel" instead of key names (`menu.ts:601`, `saveload.ts:126`, `options.ts:161`). The title, deck and footer chips already read live bindings, so this is inconsistent.
8. **Fractional scaling likely softens the 5×7 font in ordinary windows.** `src/engine/display.ts:43` only snaps to a whole multiple when it fills at least 90% of the fit.
   - A maximised 1080p browser (viewport about 1920×910–950) gives a fit of about 3.4–3.5 and a whole of 3, which is under 90%.
   - A 125%-DPI laptop is similar. Both take the resampled path.
   - Every screenshot is exact 2×, so the "crisp font" claim is not evidenced at real window sizes. This one is inferred from the code, not observed.

STRENGTHS:
- One coherent window system (`drawWindow`, tab titles, key-legend footers that read live bindings) is used across menu, shop, deck, options and dialog, with a clear animated cursor and row highlight.
- Failure and empty states are well covered: disabled rows explain themselves, unaffordable prices show red, damaged saves and storage failures raise notices, and 267 unit tests include measured-fit and glyph-coverage checks.
- The battle HUD is legible and information-rich: per-member cards with reactive faces, a turn-order strip, a target-info box and an in-menu combo hint.

WHAT WOULD MOVE THIS +1 POINT: Fix the fit maths. Add a test that measures every ability and item label, including the locked-skill suffix, against the real room in each list. Drive the screenshot navigation by menu label instead of ArrowDown counts and regenerate 26, 33 and 33b, so the Bestiary, Places and Place Map get reviewed. Anchor the shop popups to the selected row with an opaque body. Keep battle menus off the enemies and start the equip list on a safe row. That gets the area to about 7.5. Reaching 8.5 needs evidence at non-2× scales that the font stays crisp, and no truncated shipped strings anywhere in the captured set.

---

## 5. Combat design (7.7)

SCORE: 7.7/10
VERDICT: ITERATE (<8.5)

The ≤6 cap does not apply. Attack-only (Auto) loses bosses (tests/auto.test.ts:30-35, ≤30% wins), so no single command wins every fight. I read all 11 screenshots, the listed sources and docs/quality/evidence/unit-tests.txt. The evidence file is newer than the last src/ and tests/ edit. I ran nothing, per the read-only rule.

TOP ISSUES (most severe first)
1. **Most fights are two-decision formalities.** Of about 24 fights per chapter, 18.4 are random (unit-tests.txt:6). The competent policy clears them in 2.0-2.5 rounds losing 7-14% HP (unit-tests.txt:54-61). combos/battle is exactly 1.00 on street, barrens and sinkline, so round 1 is the same combo opener and round 2 is mop-up. The targets bake this in: rounds floor 1.5 and HP-loss floors of 5-10% (tests/balance.test.ts:21-26). "Meaningful choices each round" holds for the bosses and not for roughly 75% of combat. Screenshots 38 and 38b show a 3-rat pack and a 3-hound pack against 2 crew members. The scorecard shows the cause was diagnosed before (a raw HP bump was tried and reverted), and nothing has replaced it.
2. **Auto and Repeat are offered on every non-boss fight, and nothing shows how well Attack-mashing does there.** They are enabled at src/scenes/battle.ts:239-241. tests/auto.test.ts:22-29 only requires Auto to win 5 points fewer than the competent policy and to lose 1.8x the HP. On the 100%-win tables that means Auto may win up to 95% of trash fights. unit-tests.txt never prints Auto's numbers, so the strength of the "no spam" claim can't be checked.
3. **Authored enemy behavior barely reaches the player in normal fights.**
   - Only 5 of 21 enemy defs have a telegraphed move: Knuckles, turret, Arcanist, Warden, Warden's spirit (abilities.ts:238, 258, 259, 267, 270).
   - Two of those, the turret and Arcanist, first tell on the enemy's 3rd action (ai.ts:140 `turn % 3 === 2`, ai.ts:175 `turn % 4 === 3`), but random fights last 2.0-2.5 rounds.
   - `every_3` (ai.ts:37-38; used by shade and sentinel, enemies.ts:149 and 174) needs round 3, so the sentinel flashbang drill and shade wail rarely fire. The hp<50% frenzies (enemies.ts:73, 127, 155, 189, 205) rarely fire either.
   - Trash targeting is weighted-random (ai.ts:54-75, "weakest" means lowest absolute HP). No trash enemy reacts to Guard, buffs or Analyze.
4. **The Lurker has nothing to read.** It is the Sinkline boss (1560 HP, 8.9-round target, unit-tests.txt:59). Its script (ai.ts:84-103) is weighted picks plus enrage/desperate messages that arrive after the HP threshold is crossed. Crushing Coil is not `telegraphed` (abilities.ts:253), and Biolume on `turn % 4` (ai.ts:101) is unannounced. The GDD tell list (GDD.md:102-105) omits it. Knuckles, the turret, the Arcanist and the Warden all give a readable tell with its own answer. The Lurker is a stat check with a shock weakness (screenshot 17 shows only the round menu and a bar).
5. **The weakness system is inert early and largely self-solving later.**
   - Through Knuckles, roughly the first 7 fights, the crew has no elemental option. Kit's first mana move is Iron Palm at level 3, and Rook's fire skill and Overload are gated behind Hex's story flags (abilities.ts:304-336, story/chapter1.ts:129-137).
   - After that, the best plays are shock: Thunder Rift and Clean Job (abilities.ts:174, 215). Shock is 1.25x on humans and 1.5x on machines (enemies.ts:41-42), i.e. most enemies, so "read weakness, pick element" mostly matches default play. Only spirits invert it.
   - A 1.25x weakness is about the same size as one perfect timed press (engine.ts:66-75).
6. **Some hints mislead.**
   - The "likely weak to" guess reads only the family table (render.ts:855-858). On the Lurker it says "Beast: likely weak to Fire?" while the Lurker takes 0.6x from fire (enemies.ts:161-162).
   - Ghost Circuit's description says "Ignores all resistance" (abilities.ts:186). `ignoreDef` only skips RES (engine.ts:812), and the element multiplier still applies (engine.ts:817). It is mana, and machines take 0.6x from mana (enemies.ts:42). Its Spike half is the anti-machine tool.
7. **Tells collapse to one answer, and the GDD overstates the options.**
   - Guard (0.25x against a telegraphed blow, engine.ts:824) stacks with a perfect heavy brace (0.5x, engine.ts:71-75), giving 87.5% off. Guard is free and refunds double TP on a read (engine.ts:849-853).
   - The GDD says Knuckles' mark can be answered with "guard or cover them" (GDD.md:102-103). Guardian is locked until Sable joins in the Annex (abilities.ts:321, party.ts:102-103), so Guard is the only Knuckles answer.
   - The varied answers (jam, blind, ward) only appear in the Annex.
   - Assist mode gives a flat "good" on every press (battle.ts:546). Its flat +8% strike and −15% damage taken beats the balance test's mediocre On hands (about +3% strike, whiffs costing extra; balance.test.ts:19). No test covers Assist.
8. **The evidence set doesn't demonstrate the weakness UI, and one label is wrong.**
   - None of the 11 screenshots shows the target-info box, a WEAK chip or a RESISTS tag. The code exists at render.ts:424-501 and 841-898, but nothing verifies it.
   - `26-menu-bestiary.png` is the Combo Log ("1/9 found"), not a bestiary.
   - Screenshot 14's Rook skills list clips "Incendiary Rou…" and hides Stim Rush under a scroll arrow.

STRENGTHS
- Tells with distinct counters (named marks, jam/blind the wind-up, ward the scream), and reading them measurably pays: +15 points of win rate, −10 HP% on the Warden (tests/auto.test.ts:53-59).
- Timed presses with speed profiles, a real whiff penalty, a Guard economy that can't be farmed, and boss win-rate ceilings enforced in tests (engine.ts:66-75; balance.test.ts:18-19, 54).
- Nine combos including a triple, discoverable through a "★ Something resonates…" hint plus a recipe-hint Combo Log (screenshots 14, 15b, 26). A coverage test forces every learnable ability and reachable combo to be used (balance.test.ts:40-50).

WHAT WOULD MOVE THIS +1 POINT: Make the ordinary fight a decision, not a tax, and evidence it. Give each trash pack an interlocking role mix (a healer, a bruiser, a caller) that survives past round 2. Announce the round-3 rhythms and frenzy states instead of hiding them. Print the Auto and Assist numbers, and require Auto to lose clearly on trash. Give the Lurker one readable tell with its own answer, on the model of Knuckles and the Warden. Make weaknesses steer play: an elemental option before Hex joins, or a best single-target move that isn't shock. Fix the two misleading hints: apply per-enemy weakness overrides in the target guess, and correct the Ghost Circuit description. Add screenshots of the target box with WEAK/RESISTS tags and a real bestiary page.

---

## 6. Progression & economy (6.8)

SCORE: 6.8/10
VERDICT: ITERATE (<8.5)

No automatic cap applies. Nothing I found requires grinding on the story path; the simulations say it doesn't, and the shop and cred math holds. The score is held down by a shipped start-state bug, ending evidence that does not match what the systems produce, low-stakes shopping, and a retune that has only been simulated. This was a read-only review. I did not run any code, so the XP and level figures below are my arithmetic from the tests' own printed numbers.

TOP ISSUES (most severe first)
1. **New Game starts Rook at level 3, not the veteran 10.** `src/story/newgame.ts:11` calls `addMember('rook', 3)`, which overrides `startLevel: 10` (`src/data/party.ts:54`, `src/game/party.ts:11`). A real player sees Rook at Lv 3 with 240 XP, not "Level 10 · XP 4,860" as on screenshot 45.
   - Screenshot 24c is the only shot from a real New Game, and it shows Rook at Lv 5 beside Kit at Lv 4, which is impossible under the GDD. Every other shot (09, 45, 24) comes from stage presets that bypass `newGame`.
   - `baseStatsAt` clamps his growth at zero below level 10 (`src/data/party.ts:110`), so his stats are right but every Rook level-up shows a "LEVEL UP" popup with zero gains, plus a free full restore that no balance sim models.
   - No test covers this. `tests/battle.test.ts:90` builds Rook with `createMember('rook')`, and the economy tests hard-code `rook: 10`.
2. **The ending screenshot and its docs do not show what the systems produce.** By my arithmetic from the tests' printed route, Kit has about 1,675 XP before the Warden. That is Lv 6, matching the CP6 row. `warden_spirit` then pays 1,100 XP (`src/data/enemies.ts:217`), about 40% of the whole chapter's XP, so the real ending is roughly Kit 7, Hex 7, Sable 6, Rook 12.
   - The `finale` preset (`src/game/stages.ts:79-101`) claims "post-Warden levels" but reuses the pre-Warden ones (6/11/6/5). `STAGE_PARTY.warden` uses the same numbers.
   - The 0:58:00 on screenshot 24 is a hard-coded constant (`minutes: 58`, `stages.ts:101`), not a measured time.
   - `docs/quality/evidence/ending-results.txt` still says "Monte Carlo levels 8-9". It also calls 24c "level ~6, 0:00:57", but the image shows Kit 4, Rook 5, Hex 4, Sable 5 at 1:07 with 1,848¢.
   - `tests/battle.test.ts:80-85` and the GDD ("only three abilities from levels") stop at level 6. Kit at Lv 7 learns Focus Breath (`src/data/abilities.ts:310`) on the final boss, and nothing tests that.
3. **The "no grinding" proof is loose on levels.** Random fights supply about 55% of pre-Warden XP (about 910 of 1,675), and the fixed fights only about 760. The Monte Carlo (`tests/economy.test.ts:52-80`) asserts cred only; XP variance is never checked.
   - `tests/economy.ts:121-124` fails a checkpoint only if a level is two or more below target, so being one level short passes with a note.
   - The Sinkline margin over Kit's Lv 4 threshold is roughly 155 XP, about one standard deviation of its fight count. I estimate on the order of one run in eight enters the Lurker a level short.
   - Balance is only simulated on-curve loadouts (`tests/stages.ts`). Nothing measures an under-leveled or unspent-gear crew, and the sim's own boss win rates are 78/82/82%.
4. **The whole progression retune has no human validation.** The 2026-09-29 18:01 commit changed the XP curve, growth steps, ability unlocks, Rook's wound and the Sinkline encounter rate. The evidence is dated 18:43.
   - The only chapter-length figure is a model (`tests/pacing.test.ts`: 66 min, of which 34 min is assumed reading). The only "playthrough" is a teleporting bot.
   - So "grinding under 10% of playtime" and "steady curve" are simulator claims. CLAUDE.md itself says Mark's own playthrough is the real gate.
5. **Shopping decisions are low-stakes.**
   - Alternative builds land within about 8 points of the tuned route (`tests/balance.test.ts:110-120` allows -5). The Lurker with alternates wins 74% against 82% on the tuned route.
   - The prescribed purchases (`tests/stages.ts:8-17`) are what the balance assumes, and the wallet never strains: p10 spare cred is 360-441¢ at every checkpoint before the Warden.
   - The top weapons for all four members are free Annex chests (`src/data/maps/annex.ts:147-152`). The median player reaches the Warden with 1,231¢ unspent (`unit-tests.txt`) and ends on 1,150¢, with one real sink left, the 1,200¢ Neural Lace.
   - Inn (about 22¢ a head) and clinic prices are trivial, and there is a single night's rest on the route.
6. **The Mags fork is close to a dominated choice.** The discount is worth about 256¢ on the two route items (760 + 520 at 20% off), against 150¢ taken now. Nobody is cash-constrained at that point (CP3 p10 spare is 400¢), and Hedda's cart extends the discount to town. The test only bounds the saving between 112¢ and 300¢ (`tests/economy.test.ts:106-110`).
7. **The gear the balance assumes includes optional chests.** Ghost Lens, Grounding Coil and Neural Buffer are chest-only finds (`src/data/maps/world.ts:148`, `sinkline.ts:157,159`). `STAGE_PARTY` equips them at the Sinkline and Lurker stages, but the "minimal exploration" Monte Carlo subtracts only chest cred, not their stat value. A straight-line player is weaker than any measured loadout.
8. **Ability cadence is thin for a 60+ minute chapter.** Kit gets Iron Palm at 3 and Hundred Rain at 5. Hex gets Scramble at 4. Sable and Rook learn nothing by level. Rook's growth after 10 is negligible (+5 HP, +1.3 ATK). Levels 4-6 are therefore mostly stat bumps plus a full heal, which is thin next to PSIV's frequent techs or CrossCode's constant unlocks.

STRENGTHS
- Unusually rigorous economy verification for an indie alpha: a Monte Carlo over the route, a chest-skipping variant, affordability and wish-list tests, and a check that every stage's gear can be obtained.
- Well-considered design ideas that read clearly in the UI: level-up as full recovery, the two-step Rook wound with story unlocks, loot at 100% with "Sell all loot" (76¢ for 5 pieces on 10b), same-tier Requisition alternatives, and shop compare rows that account for Rook's wound (43).
- Grinding is optional in the simulations: random fights are a minority of playtime (fights 18.5 min of 66), and the level curve is roughly one level per 8-12 minutes.

WHAT WOULD MOVE THIS +1 POINT
Fix the real start state: use `startLevel` in `newGame`, then add a test that runs New Game through `memberStats` and the results screen. Regenerate screenshot 24 from an actual post-Warden state (or a real driven run) with Kit around 7, and refresh the evidence text and GDD level and ability claims. Extend the Monte Carlo to assert XP and level distributions at each boss, and simulate an under-leveled or unspent-gear crew so the no-grinding claim has a failure case. Give shopping teeth: several real trade-offs per stop, bound to a tighter wallet, and a late sink beyond one 1,200¢ mod. Above all, get a timed human playthrough on the retuned build before scoring "steady curve" and "grinding under 10%".

---

## 7. Narrative & writing (6.0)

SCORE: 6.0/10
VERDICT: ITERATE

TOP ISSUES (most severe first):
1. **Motivation gap at the pivotal beat (the ≤6 cap applies).** The crew rides into Pale's ambush knowingly and never says why.
   - They already have three warnings. Rook says "Pale lied" (chapter1.ts:392). The door log reads "pending resolution" (chapter1.ts:391). The mail says "close out the contractor account" (annex.ts:180-186).
   - After the Warden, Sable reports "people waiting in the rain" (chapter1.ts:559). Rook names it "Pale's pickup. He did say he keeps exact hours" and Hex says "The lift's live" (chapter1.ts:560-561).
   - They have already decided not to hand Sable over: "After that you owe us nothing" (chapter1.ts:509), and the pod logs "don't go to Pale" (chapter1.ts:516).
   - The ladder back to the Sinkline stays open (annex.ts:241), and the lift is a one-way ride behind a confirm prompt (annex.ts:245).
   - Nobody states a reason: to confront him, to get paid, or that it is the only unwatched exit. Rook's pre-pulled flashbang (chapter1.ts:598) implies a plan the script never voices. The betrayal is the chapter's spine, so the player is left asking "why are they doing this?"
2. **The trap is telegraphed and the leads shrug it off.**
   - Hex flags "pending resolution" as "a weird word for a door to use" (chapter1.ts:391). A few rooms later she calls the "close out the account" mail "the most boring email I've ever read" (annex.ts:184).
   - Kit reads it as "us getting paid", and Rook, who said "Pale lied", answers "…Probably" (annex.ts:183-185).
   - This is dramatic irony played as obliviousness. The betrayal (chapter1.ts:571-606) arrives without surprise, and the veteran and the "reads systems for a living" hacker look dim.
3. **Pale's plan does not add up.**
   - The Sentinel says "Four signatures. One flagged for intake, three for disposal" (chapter1.ts:584). Pale has just said S-7 is property to be recovered (chapter1.ts:574) and Kit is the intake (chapter1.ts:581). The ending has him order "the orc, the jockey, and Miss Kit" found (panels.ts:72). So Sable is either intake or disposal, and Sable can't be both. The count doesn't work.
   - K-M Sentinels open fire with "Lethal response authorized" (chapter1.ts:381) on the contractors Pale hired to fetch S-7. The Glass Wolves also died with cauterized wounds (chapter1.ts:257). Why would the client's own security kill his retrieval crews?
   - "I have already sold yours" (chapter1.ts:578) is never explained.
4. **The closing hook has no referent, and the ending's emotional peak is told rather than shown.**
   - Pale says "You have until morning" to his own hunters (panels.ts:72). The finale card flips it to "They have until morning" (panels.ts:73). Nothing says what happens at morning.
   - "Who taught Miss Kit to fight like that" reads as a non-sequitur, since Rook raised her. The Old Runner's Thunder Rift thread (interiors.ts:161-163) that might answer it is never connected.
   - Rook kneeling among rifles is a caption over a generic canal skyline (panels.ts:62). The next caption is cliché: "The rain did the talking" (panels.ts:64).
5. **Contradiction and repetition in the ending panels.**
   - The caption says "Last they saw, he was on his knees" (panels.ts:62), and Kit answers on the same page "He said don't look back. So I didn't" (panels.ts:63). Either they looked back or they didn't.
   - "Don't look back" is delivered three times in about 20 lines: chapter1.ts:597, panels.ts:59, panels.ts:63.
   - Hex and Kit say "we go get him" back-to-back (panels.ts:68-69).
6. **Pronoun error and small text defects.**
   - "When she steps back, the stitches are just a scar" (chapter1.ts:531). Sable is they/them (GDD.md:68, party.ts:67), and this is in the heal beat.
   - `maint_key` (items.ts:134) is never granted, because Hex hacks the gate (chapter1.ts:247-251). GLOSSARY.md:283 still lists it as a key that "open[s] the way down".
   - systems.ts:228 uses a straight apostrophe where the rest of the text uses curly ones.
7. **Puzzle instructions are over-explained.**
   - The Sinkline valve/pump rules are recited at least seven times by four voices: Wire (sinkline.ts:178-183), Rook (sinkline.ts:210), Hex (chapter1.ts:288, 319-320, 333), and the console (chapter1.ts:330).
   - This is an overcorrection to the playtest note that the puzzle wasn't signposted. It bloats the script and removes the puzzle.
   - The same clipped rhythm and "…" reaction lines recur across speakers: chapter1.ts:98, 201, 485, 491, 535 and annex.ts:171, 185. The aphoristic closers ("Stew's on. It isn't good. It's hot." at rustyard.ts:140; "Every blade here is blessed. The guns are merely loaded." at interiors.ts:244) erode the voice separation.
8. **Tutorials leak through NPC and lore text, and Sable's pod dialogue is murky.**
   - The Old Runner tells Kit to "Pick a quick strike… in the same round" (interiors.ts:163).
   - A passer-by presumes the crew's makeup: "If you've got a shaman friend and a deck-jockey friend…" (lantern_row.ts:202).
   - Bestiary lore doubles as tooltips: "jam it, stun it, or brace" (enemies.ts:182) and "blind her, or hit her hard" (enemies.ts:190).
   - "Everyone who opened this glass said something kind… None of them burned" (chapter1.ts:510-512) can't be decoded on a first read.
   - Sable's "After that I will decide" (chapter1.ts:517) is never dramatized, so their staying with the crew is implicit only.

STRENGTHS:
- A strong motif chain: "Who's paying for me?" (panels.ts:51-52), "Nine seconds" (chapter1.ts:104, 488), "exact hours" and the satsuma (chapter1.ts:103, 109, 571, 579), and the "Rook: missing" results card (screenshot 24).
- The six main voices are distinguishable blind: Kit's swagger, Rook's dryness, Hex's anxious sarcasm, Pale's clerk-speak, Dutch's warmth and Sable's crow-logic.
- Foreshadowing is planted well before it pays off: the Glass Wolves slate (chapter1.ts:259), the "Woken kid" and "scholarship" rumours, the Charm Seller (lantern_row.ts:226) and the Vessel logs (annex.ts:163, 191).

WHAT WOULD MOVE THIS +1 POINT: Uncapped, I would put the writing at about 7.5. The cap comes from issue 1, and lifting it is the largest single gain.
- Give the lift a stated reason. Examples: Rook says the ladder is being sealed or watched and the lift is the one exit K-M isn't covering; or Kit and Rook decide they will confront Pale because they want to be paid or want the names.
- Have Rook voice the suspicion that justifies the flashbang in his pocket.
- Remove the "Probably" shrug at the mail (annex.ts:183-185), so the leads walk in with eyes open rather than blind.
- Fix the intake arithmetic (chapter1.ts:584) and say why K-M's own Sentinels shoot the contractors.
- Define the deadline (Rook's intake? K-M's audit?) and make the finale and Pale's line refer to the same "they".
- Show Rook kneeling in a panel and delete the "look back" contradiction.
- Fix "she" to "they" at chapter1.ts:531.
- Cut the puzzle hints to about two mentions.
- Move the tactics out of NPC and lore text into UI.

(The reviewer noted it created one scratch file, cad.py, in the session scratchpad while trying to measure sentence cadence; it failed and was not used. No project files were touched.)

---

## 8. Level design (7.0)

SCORE: 7.0/10
VERDICT: ITERATE (<8.5)

Method note: I read the GDD, opened all 24 screenshots, and read the maps, props, chapter1 puzzles and tests. I also ran read-only inline node checks with no files written; git status is clean. I did not play the game. The 267/267 unit-test result in unit-tests.txt is consistent with the test files I read.

The automatic ≤6 cap does not apply. Signposting is pervasive.

TOP ISSUES (most severe first):
1. **The "sealed closet" secret is unreachable.** The Sinkline's cracked-wall closet holds the cyber_eye case and a 180¢ locker (src/data/maps/sinkline.ts:40, 165-166).
   - The only tile touching the walkable crack tile (13,25) is the pump-room tile (13,26). Intake 3's valve prop sits on it (sinkline.ts:99-100).
   - That prop is not `pass`, so `blockFoot` marks the tile solid (src/field/props.ts:35-37, 1404-1405). Movement is 4-way, one tile at a time (src/scenes/field.ts tryStep/canEnter).
   - A prop- and chest-aware BFS with all flags set makes exactly these two chests unreachable, and nothing else in any map. The prop footprints in that BFS were approximated from the `blockFoot` calls.
   - Screenshot 18b-sinkline-intakes.png shows the closet chests and the valve wheel drawn directly over the crack, so the game invites the player and then refuses.
   - The connectivity tests pass because tests/mapgraph.ts:1-5 deliberately ignores props, NPCs and chests. Nothing in tests or e2e touches "closet" (grep finds none).
   - docs/quality/scorecard.md:101 lists this secret as working. Move the valve, or open the crack from a free tile, and add a prop-aware reachability test.
2. **The objective goes stale at the puzzle payoff.** src/story/chapter1.ts:355 re-sets OBJ.flood ("Find a way across the flooded junction.", :26) right after the junction drains.
   - 18c-sinkline-lure.png shows this line over a drained junction.
   - The real next step is the SE hatch at (44,30). It stays blocked until the Lurker dies (sinkline.ts:221-227), and only an in-world "rusted shut" message hints at that. The objective HUD never says so.
   - That is the wrong text at the dungeon's biggest state change.
3. **There is no valid evidence for the game's main anti-lost tool, the Places list and plan map.**
   - 33-menu-places.png and 33b-menu-place-map.png are byte-identical (same md5) and both show the empty Bestiary ("Nothing logged yet"), not Places or a plan.
   - e2e/shots.spec.ts:432 presses ArrowDown 6 times, but the Deck entry (src/scenes/menu.ts:59) moves Places to index 7. This has been wrong since Deck was added.
   - I could verify the feature only from source (menu.ts:699-715, src/scenes/placemap.ts). I cannot confirm it reads well on screen.
   - The docs/screenshots/maps/*.png files are debug full-map renders, not what the player sees.
4. **Puzzle grammar is thin and one-note.**
   - The pumps ask the player to sort three psi numbers (chapter1.ts:274-276), and a wrong pick costs one step.
   - The lattice has a unique solution, "B alone" (chapter1.ts:402), which pressing B first solves. The loom cables make it deducible, but it is a single XOR of three toggles.
   - Neither mechanic is recombined or escalated, and there is no traversal, timing or spatial puzzle. CrossCode and Sea of Stars chain and recombine mechanics across rooms. This is a PSIV-grade switch puzzle.
5. **Dungeon scale and geometry are small.**
   - It is two maps: Sinkline B1 (48x38) and the Annex (44x34).
   - The Annex is a corridor to one rectangular hall with three spokes (annex.ts:11-33), so its route is essentially linear.
   - The Warden arena is a rectangle with a decal and pylons (annex.ts:30-31). The scorecard row 8 admits "Every room is a rectangle; the Warden arena is a blank box; one dungeon".
   - Chrono Trigger and PSIV dungeons have branching multi-floor structure. Only the crawlspace duct (annex.ts:63) and the west tunnel add loops.
6. **The Rustyard tribute-stash secret is missable, and its loot is weak.**
   - The heap opens only if the Scav Kid's hint flag is set (rustyard.ts:169-173). The kid stops giving the hint once `coprocessor_given` is set (rustyard.ts:153-157), so a player who returns the chip first can never open the heap.
   - Most secret rewards are consumables (detox, omni_patch, trauma_patch, adrenal_stim). Only the drowned locker's flood_charm, the proto_chip and the cyber_eye are gear, and the cyber_eye one is broken (issue 1).
   - So this is a dialogue trigger more than curiosity being rewarded.
7. **The world map is murky in the screenshots.**
   - In 19-world.png and 31-world-radio-lot.png, blocks, roads and curbs sit in one dark value band.
   - The toxic canal in 31 reads as a green hedge or foliage band, not water.
   - The 60x42 map is mostly solid blocks around a thin road network.
   - Rustyard's perimeter junk (20-rustyard.png, lower third) is high-frequency noise that hides the walkable edge. Only lamp pools carry the path.
8. **The mid-story dead-end test cannot see prop-caused strandings, and no test checks puzzle solvability in-game.** tests/maps.test.ts:1-5 and 44-70 claim to catch "a hand-authored grid that silently walls off content", but they model terrain and patches only. In this project sign_posts, banners, valves, lamps and terminals all block tiles. No test asserts VALVE_ORDER is completable or that the objective text matches the state after each flag.

STRENGTHS:
- Signposting is dense and mostly diegetic: state-lit intakes (red to green, sinkline.ts:244-249), a sign at nearly every fork (sinkline.ts:101-109, annex.ts:134-137, rustyard.ts:81-85), the objective HUD line, and the Places plan map in code.
- The puzzles are fair and clue-driven. The loom cables show which relay feeds which emitter (props.ts:317, annex.ts:128-131), a wrong valve costs one step, and the drain and the lattice's death are shown on camera (chapter1.ts:347-353, 452-470).
- The dungeon has a real arc and climax: drain, Lurker gating the hatch, Annex, lattice, Sable's rescue and alarm, armory prep, the Warden arena, a lift with a point-of-no-return prompt (annex.ts:244), then the dock betrayal. It has a 25-stage dead-end test.

WHAT WOULD MOVE THIS +1 POINT: First, fix the broken closet and add a prop-, NPC- and chest-aware reachability test, so shipped secrets are proven reachable. Second, make the objective text follow the story state at each transition (post-drain, post-Lurker, after the badge and panel), and re-capture 33 and 33b so the Places list and plan map are actually evidenced. Third, add structural depth. Give the Annex a real loop or a second level, and give the Warden arena geometry beyond a decal. Add one puzzle that uses a different verb, such as traversal, timing, or an interaction between the pump and lattice systems. Make at least one secret reward something meaningful that is not gated on a single NPC line.

---

## 10. Feel & polish (7.6)

SCORE: 7.6/10
VERDICT: ITERATE (<8.5)

The ≤6 latency cap is not triggered. `docs/quality/evidence/perf.txt` shows median input latency of 11–16 ms from standstill and frame times of 0.6–2.8 ms. The problems below are polish and consistency gaps, not lag. I read the source and the screenshots only. I did not run the game, so the interaction bugs are traced statically.

TOP ISSUES (most severe first)
1. **Field drops presses made mid-step.**
   - `src/scenes/field.ts:224-228`: `handleInput` returns early whenever `leader.moving` is true. `Input.pressed` lasts one tick and the field has no buffer; the only `carry` use is in battle.
   - While a direction key is held the leader is always moving, because `onLeaderArrive` (`field.ts:~303-310`) starts the next step in the same tick. Tapping C, X or Z while walking does nothing, and a tap in the last ~200 ms of a released step is also swallowed.
   - `e2e/perf.spec.ts:82-129` only measures presses after `waitForTimeout(250)` from standstill, so the 11–16 ms figure never covers this case.
   - A 6–8 frame press buffer would fix it.
2. **The big combo flash and shake fire when the effect starts, not when it lands.**
   - `fx.ts:675-677` (`thunder_rift`), `698-700` (`ghost_circuit`) and `765-767` (`clean_job`) set `this.flash` and `this.shake` in `play()`. `battle.ts:404-411` consumes them on the next tick.
   - Their `impact` values are 13, 20 and 17 effect frames. At `FX_PACE` 0.65 (`battle.ts`) that is roughly 20–31 real frames (0.3–0.5 s) before the hit.
   - The damage event then shakes again with a directional kick (`playback.ts:204`). The flash-and-rumble therefore arrives during the windup and the actual hit lands quieter than the cue. `15b-battle-triple-combo.png` is where this matters most.
3. **The default "Gentle" shake is close to invisible.**
   - `settings.ts:34,77` defaults to 0.45×. `shake.ts` then rounds each offset to whole 480×270 pixels.
   - Both shakes authored at magnitude 1 come out as exactly zero: the deck-chip seating click (`deck.ts:128`) and the lattice-off beat (`chapter1.ts:464`).
   - My hand calculation gives a 1 px offset on a single frame for tier-1 and tier-2 hits. A crit at magnitude 5 works out to roughly 2, 1, −1, −1, 0, 1 px.
   - The springy "kick and settle" design in `shake.ts` only shows at "Full", and `tests/motion.test.ts` only tests magnitude 5 at full strength.
4. **Comic-panel shake ignores the Screen shake setting and is random noise.**
   - `panels.ts:227` adds `Math.round((hash2(t,1)-0.5)*8)` to the panel's x for 20 frames, with no `shakeScale` and no Off check.
   - A player who set Screen shake to Off still gets ±4 px per-frame buzz on the ending's flashbang panel. This is the per-frame noise that `shake.ts`'s own header says it avoids.
5. **The most-used surfaces have no transitions.**
   - Menu, options, shop and save open and close as instant hard cuts onto a 98.5% opaque curtain (`ui/draw.ts:10`). `menu.ts`'s `enter` only plays a sound.
   - Every `say` creates a new `DialogScene` (`fieldkit/api.ts:22-26`). For every line the box vanishes instantly, then regrows over 6 frames with typing held (`dialog.ts:84-90`).
   - `02-intro-panels.png` and the finale show that the authored transitions are good. The everyday UI does not match them.
6. **The results panel closes on the first confirm.**
   - `battle.ts:469` closes any waiting panel on `pressed('confirm')`. There is no "first press completes the tally" rule and no grace time.
   - The tally and bar fill take about 54 frames and are skippable by one stray press. This is the same key the player has just been hitting for timed presses.
   - `dialog.ts` and `panels.ts` both do finish-first, so this is inconsistent inside the game.
7. **Unpressed hits land late, and timed presses have no latency offset.**
   - `settleTiming` (`battle.ts:582`) plus `timing.ts:78` hold the hit 4–9 frames (67–150 ms) after the ring and effect reach impact when the player does not press. The game's own tutorial line recommends "better no press than a guess", so the sparks fire, there is a pause, and only then the number and sound arrive.
   - The windows are also asymmetric, for example quick profile `perfect: 3, late: 4` in `timing.ts`. There is no audio/video offset setting in `options.ts`, only On/Assist/Off. A wireless or TV-latency setup will read as "LATE".
8. **The death-to-retry loop is unskippable.**
   - Defeat waits 55+80 frames and a 40-frame fade (`battle.ts` `defeat()`), then `gameover.ts:48` locks input for 70 frames. Retry then replays the 12-frame flash, 18-frame wait, 52-frame shatter and 58-frame message (`systems.ts:339-342`).
   - That is roughly 6 s from last hit to control, on every attempt at a boss with tells.

STRENGTHS
- The comfort and accessibility surface is thorough. It has separate shake, flash, hit-pause, text-speed, battle-speed and timing-assist options. Text has press-to-complete and hold-to-fast-forward. Presses are buffered through the dialog open animation and carried through hitstop (`input.ts:188`, `battle.ts:395-398`).
- The battle hit feedback is well layered: hitstop, directional kick, camera push, impact-frame cut, damage-ghost bars and stacked floaters. Frame cost and latency on the tested paths are comfortably inside budget (`perf.txt`).
- The big story beats are authored: shatter intro, defeat drain-to-red into fade, panel slide-in and finale stamp, surface-specific footsteps, dash dust and parallax rain.

WHAT WOULD MOVE THIS +1 POINT
Make the moments the game already builds up actually land. Buffer field presses for 6–8 frames. Move the flash and shake in `fx.ts` to the impact frame, and apply the shake in screen pixels or with a floor so "Gentle" survives rounding. Route the panel jitter through `shakeScale`. Add a short open and close animation for the menus. Keep the dialog box up between lines from the same speaker. Give the results panel a finish-first press, resolve unpressed hits at the visual impact, and add an audio/video offset setting. Let the defeat and retry sequence be skipped. Smaller follow-ups: the camera push zooms non-integer (`render.ts:137`), so pixels vary in size for ~20 frames, and the fixed 60 Hz loop has no interpolation (`main.ts:34-41`), which may judder on 144 Hz displays (unverified).

---

## 11. Stability (7.9)

SCORE: 7.9/10
VERDICT: ITERATE (<8.5)

Read-only review from code and test output. I found no reproducible softlock, so the cap of 5 is not applied. The problems below are real gaps in what is proven and contained.

TOP ISSUES (most severe first):
1. **An exception inside a battle hangs it for good, and nothing detects that.** `BattleScene` runs its whole turn as detached async chains: `void this.intro()` (src/scenes/battle.ts:175) and `void this.executeRound()` (:263, :464, :484-490). There is no try/catch or `.catch` anywhere in battle.ts or battlekit. A throw in `playEvent` (for example `d(uid)` returns `disp.get(uid)!` at :169-171, or the `!` lookups in battlekit/playback.ts) kills the chain. The only handler is `unhandledrejection` → `reportError`, a 6-second banner (src/main.ts:95). The scene stays on the stack in `mode='play'`, its `update()` never throws, and `FAULT_LIMIT` counts only sync tick/render throws (src/engine/game.ts:300-304). So `onFault` never fires and the player is stuck in battle until reload. That covers roughly half of play time. The E2E suite never plays a fight to a natural end: every run uses the debug driver, which forces the win after 3 rounds or at party HP<35% (src/game/debug.ts:35; economy.spec.ts:64, chaos.spec.ts:130, perf.spec.ts:69, playtest.spec.ts). The Warden's phase change (playback.ts:312, engine.ts:885-900) is reached only if the boss transforms within those 3 rounds. Only 5 playback unit tests use a recording view.
2. **The fault isolation has a hole at the top of the loop.** `this.input.update()` (src/engine/game.ts:244) is outside every try/catch, and it calls `navigator.getGamepads()` unguarded (src/engine/input.ts:143). That call can throw SecurityError under a blocking permissions policy, for example in an iframe embed. The throw escapes `tick()`, and the loop's catch skips `game.render()` (src/main.ts:40-49). The result is a permanent silent black canvas, and the error overlay is drawn in `render()`, so even that never shows. `onFault` can't help because no scene is ticking. `tests/game.test.ts:11` stubs `input.update` to a no-op, so this path is untested. The "loop never dies" comment at game.ts:7-10 is not true here.
3. **Story beats are not atomic, and a half-run beat is savable.** `fireEvent` sets the `once` flag before the script runs (src/scenes/field.ts:328-331). `runScript` swallows any exception and clears `busy` (field.ts:543-552). Three progression beats have no re-trigger fallback: the Warden (annex.ts:234, and the lift stays "dead" without the `warden` flag, annex.ts:243-247), the Lurker (sinkline.ts:214, gates the Annex hatch at :225) and the Rustyard gate (rustyard.ts:183). Any abort leaves the chapter permanently unfinishable, and Menu > Save will write that state. Realistic aborts include a failed lazy import. `battleModule ??= import(...)` caches a rejected promise for the whole session (src/game/systems.ts:42-45, awaited at :341), and the `deck` chunk import (:132) can fail the same way. No test injects a failure into a story script.
4. **"E2E happy path passes" is a teleport-driven, auto-resolved, Chromium-only run.** `playChapter1` uses `sj.tp()` to jump beside every trigger (e2e/route.ts:107-111, 121-197). Dialogs, shops, cards and the deck mini-game are auto-resolved with choice 0 (playthrough.spec.ts:15; debug.ts:6-8; dialog.ts:70-73, 96-100). Side branches such as `betrayal` choice 1 and Mags' "Leave it" never run. Only Chromium runs the story: WebKit and Firefox get only prod and gameover (playwright.config.ts:223-225). The connectivity unit tests are blind to props, NPCs, chests and structures by their own header (tests/mapgraph.ts:1-5). They are also blind to the lattice, because the all-flags grid treats `lattice_off` as already set. The "no mid-story dead ends" test only asks whether some exit is reachable (tests/maps.test.ts:44-70). So a prop or static NPC sealing a corridor, or relay terminals sitting behind the lattice, would pass everything.
5. **Save round-trips are proven on synthetic states, not on played ones.** gameover.spec.ts saves through `sj.save()` on `sj.stage()` presets. prod.spec.ts:57-68 uses the real menu, but it stops in the opening flat and after Continue asserts only that the frame image differs. No test checks that the roughly 20 autosaves written during the playthrough load (`slotStatus('auto')==='ok'`), and none saves mid-story, reloads and finishes the chapter.
6. **The evidence is not from the tested tree.** Both e2e-playthrough.txt and ci-engines.txt list the chaos tests at lines 58/70/92/108. HEAD has them at 67/79/101/117, because the evidence commit d50db57 itself rewrote `settle()` (a mash test could wander into a fight). The CI evidence is from fc4a651, not HEAD. The changed suite was never re-recorded, and the near-flake shows the mash tests are non-deterministic.
7. **A failure after the title fade leaves a dead black screen.** `startTitle` fades out and then calls `loadSave`, `loadIntoGame` and `newGame` with no try/catch (src/boot.ts:170-182). `toField` and `newGame` do `void game.reset(new FieldScene(...))` (boot.ts:82, src/story/newgame.ts:18). A throw there leaves an empty stack at fadeLevel 1 with no scene to fault, so recovery never triggers. It is unlikely on valid saves, but the recovery net doesn't cover it.
8. **A New Game can silently erase the only autosave.** New Game keeps the old saves (boot.ts:171-173), but the first door autosave overwrites the `auto` slot with no warning (systems.ts:268-290). For anyone relying on autosave, that destroys the previous run and makes Continue point at the new one. There is also no in-game Load, only Title > Load. Known gaps that I did not count against the score: no gamepad/touch E2E and no long-session soak (status.md).

STRENGTHS:
- The save layer is defensive: validation, sanitising, a version chain, a v1 fixture, slot-level "damaged" handling, and blocked storage all covered (src/game/save.ts, tests/save.test.ts).
- Sync fault containment and recovery to the title, multi-tab autosave handover, Game Over Retry/Load/Title, the pre-start error screen and the shipped build are each E2E-tested, with WebKit and Firefox in CI.
- Story scripts are largely idempotent (`take` results ignored, flag-gated), and the mid-story dead-end unit test runs at every story flag.

WHAT WOULD MOVE THIS +1 POINT: Contain the async battle flows. Wrap `intro`/`executeRound` so a throw aborts to a safe outcome or trips `onFault`, and add a watchdog for a scene that stops making progress. Guard `Input.update`/`pollPad` and add a stub-throws test. Make story beats atomic: set `once` flags only when the beat completes, give the Warden, Lurker and Rustyard gate re-trigger fallbacks, and make `loadBattle` retry after a failed import. Then add one CI run that plays Chapter 1 with real key input and real (unforced) fights, with no teleporting, on all three engines. Assert that every autosave it writes loads, save and reload mid-chapter, and finish from there. Finally, regenerate the evidence from HEAD's own CI run.

---

## Playthrough notes, one by one (no score)

All paths below are relative to C:/Users/markh/home-base/projects/shadow-jog. Read-only review; nothing edited, run or created. I viewed screenshots 04, 11, 12, 14, 16, 17, 18, 19, 26, 33b, 38, 38b, 39-47. I checked the diffs of 7688a34, e559a08, 7b84e16, f6a7bd5, 0b777bb, efb8ee9 and a986d53. I read the round-13 unit-tests.txt and compared it with the round-12 copy (ef982ab).

NOTE-BY-NOTE:
1. ADDRESSED: src/data/shops.ts:22, lantern_row.ts:46, and 04-lantern-row-street.png shows a "LAST RITES" sign beside "THE DROWNED SAINT". A grep finds no leftover "Iron Saint" outside the notes and changelog lines; the bartender "Saint" and the drink keep the name, as promised. No concern.
2. ADDRESSED: src/scenes/battle.ts FX_PACE 0.65 via animRate(); src/battle/fx.ts update() integrates on fx.rate; poses, cut-ins and floaters share that clock. Pacing can't be shown in a still, so it rests on the code. It is a constant, so easy to tune.
3. ADDRESSED: intro.ts INTRO_T 30 to 52, systems.ts wait 10 to 18, combo hold 40 to 56 (playback.ts). The doc's "1.3 s (was 0.8)" doesn't match the code: about 70 frames vs 40, roughly 1.17 s vs 0.67 s. The change is real and about 1.7x.
4. ADDRESSED: orders.ts damageElement() and ELEMENT_ICON; 12-battle-techs.png and 14-battle-combo-hint.png show coloured symbols beside Attack, techs and skills. The 5x7 blade and spark silhouettes are close and differ mainly by colour. The new column truncates a label: "Incendiary Rou…" in 14. The target box and Analyze pair symbol with word, which suits learning.
5. ADDRESSED: render.ts ACTIVE '#fff04a', a 9x5 outlined chevron, a 2px breathing card frame raised 5px, and a turn-strip entry that steps out (11, 12, 14). In 11 the yellow chevron sits over the crab sprite and reads as pointing at the enemy. During the round only the arrow and strip are highlighted, not the card.
6. ADDRESSED: tiles.ts wRoad lightened to #46465a against roofs at #2a2c3c, plus curbs and lit south facades; 19-world.png reads street versus block. Contrast is still modest, and the Barrens rubble at bottom right is one dark mass. Only an after-shot is given.
7. ADDRESSED: party.ts:74 WOUND, chapter1.ts (opening beats, tutorial card, Hex re-tune, Sable mend); 45-menu-status-rook-wounded.png shows "WOUNDED HP -30% ATK -28% AGI -15%" and four locked skills. The percentages match the code. Two problems: the Status page clips "Incendiary Round (lo…" (45), and Rook's Lv10/11 conflicts with note 24.
8. ADDRESSED: src/scenes/deck.ts, src/art/deck.ts, 39-42 (dead deck, pin alignment, boot, Deck page with two empty slots). The hands-on step has no evidence: e2e skips it via autoClose(t,60) and the shots bypass it with go("drop"). The in-battle deck pop-up (render.ts renderDeckCutin) appears in no screenshot.
9. ADDRESSED: shop.ts slot tag; 43-shop-equip-now.png shows "WEAPON  Rook only" above the description. Consumables get no tag, which is fine.
10. ADDRESSED: shop.ts offerEquip()/equipNow(); 43 shows "EQUIP NOW?" with "swap Old Katana", and the e2e test "gear bought in a shop can be put on there and then" passes. The modal covers the middle of the buy list, and it only offers current party members.
11. ADDRESSED: shop.ts confirm handler (`this.qty = ... kind === 'loot' ? this.maxQty(id) : 1`). The e2e "selling loot" test now goes through Sell all, so the quantity default has no test.
12. ADDRESSED: 44-shop-sell-all.png shows "Sell all loot 108¢" and a 7-piece breakdown; the confirm asks once, and the e2e test asserts loot goes to 0 and the medkit stays.
13. PARTIAL: tiles.ts relief(), dwallCap (#101114 to #323641) and edge (#626878), the yellow platform line, and the ambient lift. 18-sinkline.png is better, but the upper-right and lower-right wall masses away from lamps are still near-black and hard to tell from floor or void. 47 reads better.
14. PARTIAL: creatures, the Lurker and the Warden are painted 1.6x finer and drawn 0.8x (enemies.ts, render.ts; 16, 17, 38 show it). Human enemies (Rustfangs, Knuckles, Sentinels, Arcanist) are unchanged: the sentinels in 14 are as chunky and large as before. The owner said "enemies", and the doc discloses the exclusion. It also broke the Bestiary (see regressions).
15. ADDRESSED: timing.ts WINDOWS lead rises 37-44% (24 to 34, etc.), and the doc names the mechanic "timed presses". The ring radius grew too (20 to 22), so ring travel speed per frame is only about 22% slower, not 40%. The perfect window also widened (3 to 4), so crits are a little easier, when the owner asked only for slower.
16. ADDRESSED: render.ts renderTargetInfo puts the box on the far side, away from the target. The cited screenshot 46 contains no target box, so no capture verifies it. The box is 204px of a 480px screen and can still cover other enemies' heads or HP bars on that half.
17. PARTIAL: chests.ts and field.ts (halo, lit trim, glint, brighter bodies; 47 shows a lit chest with a cyan marker). The marker comes from interactTarget() (field.ts:408-414), which only fires for the tile you are already facing. It confirms a target rather than helping you find one. Valves, consoles and NPCs at a distance are unchanged.
18. ADDRESSED: sinkline.ts:62 rate 40 (was 24); unit-tests.txt "218 steps of sinkline (1 in 40)" gives about 5.5 fights against 9.1. Sinkline pay is x1.6. The floor is now nearly free: attrition shows 100% clears and 96% end HP.
19. ADDRESSED: sinkline.ts (Wire's lines, and the objective "Drain the junction: the pump room is south of the platform"), chapter1.ts (Hex's valve line). It leans obvious: the objective and Wire both name the pump room's location, though the order stays hidden. Wire is optional, but the objective fires on the path. No screenshot.
20. ADDRESSED: sprites.ts STENCIL letters, the render.ts strip letters, and label(); 38, 38b, 14 and 46 show A/B/C. The cited 11 has no duplicate enemies. playback.ts:259 still says "Glowrat is down!". On beasts and spirits the on-sprite scar or motes are now 1 screen px (none is visible on the rats in 38), so the letter lives only in names, strip and target box.
21. ADDRESSED: battle.ts afterAction() (effect up to 50 frames, then 22), and the real queue shows in 46. The chapter-length model wasn't updated (see regressions).
22. ADDRESSED: menuX() always returns MENU_X and the strip is always right (11, 12, 14 match). The bottom-left submenu now covers the left enemy even for right-side members (14 hides the Sentinel).
23. ADDRESSED: abilities.ts LEARNSETS; the battle.test.ts "new abilities are rare" test allows exactly three by level. The remaining new abilities arrive as story beats. Spirit Walk is now impossible in Chapter 1, but the UI still counts it (see regressions).
24. PARTIAL: xpFor = 60(L-1)^2 puts Kit and Hex at 6 and Sable at 5 (unit-tests.txt CP6). Rook is Lv10 all chapter and {"rook":11} at the Warden. That is higher than the old table's Rook 9, and he shows "Lv10" on every battle card (11, 16). The doc never mentions this against "not 9 or 10".
25. ADDRESSED: party.ts grantXp() calls fullRestore(m), and there is a test. The LEVEL UP panel (battle.ts ~819) lists gains and new skills but never says HP/TP were restored.

REGRESSIONS / NEW PROBLEMS (most severe first):
1. The Bestiary portrait overflows for the two bosses (found by reading code; no screenshot exists). src/scenes/menu.ts:670-675 draws `art.width*k` with k clamped to 1-2, using the raw canvas. Creature canvases are now 1.6x bigger art pixels (enemies.ts CREATURE_DETAIL/RES). The Lurker becomes 221x155 and the Warden 154x147, in a 120x104 box. They draw at y of about -39 and -31, off the top of the screen, and spill over the list and the text column. Small creatures now draw at k=2, so sizes are inconsistent. menu.ts wasn't touched; only bestiarytest.ts was.
2. Existing saves aren't migrated. The progression change adds story flags and reshapes levels, but save.ts MIGRATIONS/backfill (save.ts:133-160) and SAVE_VERSION=2 are unchanged. A save made past Hex's or Sable's scenes never gets stingray_seated, rook_tuned or rook_mended. Rook then stays wounded with four skills locked for the rest of the game, and Hex has no Overload and no Deck page. Levels and XP are also mixed across the old and new curves. That includes Mark's own partial-playthrough save.
3. The Rook contradiction in note 24. GDD.md:115 ("Chapter 1 ends around level 6") sits next to :117 ("Rook is level 10"), and playthrough-1.md's Judgment calls omit it. The party's highest level went up (9 to 11), the opposite of what the owner asked. It needs his decision, not a silent choice.
4. The evidence screenshots are wrong. The new Deck row in the menu shifted the ArrowDown counts in e2e/shots.spec.ts:356-366 and 429-440. 26-menu-bestiary.png now shows the Combo Log. 33-menu-places.png and 33b-menu-place-map.png are the same empty "BESTIARY 0/17" (identical 13,178 bytes). Places, the place map and the Bestiary have no valid visual evidence, and this hid problem 1.
5. The chapter-length estimate is stale. tests/pacing.test.ts:22-24 keep ROUND_S=11 and FIGHT_OVERHEAD_S=9, yet every action now adds a 22-frame beat (battle.ts, up to 50 frames more on top), effects run 1.54x longer and the intro is 30 frames longer. The printed 66.1 min (unit-tests.txt) is optimistic. My rough arithmetic (about 81 rounds, about 6 actions per round) gives roughly 73-74 min, close to the 75-min gate. This is an estimate, not a measurement.
6. The opening got harder, and the docs don't say so. Barrens attrition went from 100% clears, 89% end HP and 2.5 medkits (round 12) to 93%, 71% and 3.1 (round 13). The lean player at the Lurker went from p10 50¢ and 94% affordable to p10 3¢ and 91%. The owner didn't ask for a harder opening. The wounded Rook plus the scrap_hound buff (HP 49 to 56, ATK 15 to 18) plus slower levels stack up.
7. Truncated labels from the new symbol column: "Incendiary Rou…" in Rook's Skills menu (14-battle-combo-hint.png), and "Incendiary Round (lo…" on the Status page (45-menu-status-rook-wounded.png; menu.ts fitText at 104px).
8. Spirit Walk is unreachable, but the UI still counts it. ending.ts:61-66 and menu.ts:725 print "n / 9", and the Combo Log still shows the hint "When the crow flies, the fists follow". A completionist can never reach 9/9 in Chapter 1, and nothing says it waits for Chapter 2.
9. Stale or dangling docs. playthrough-1.md:71-73 says a reviewer has already checked each note and points to docs/quality/reviews/round-13.md, which doesn't exist (reviews/ ends at round-12.md), and to a scorecard with no round-13 entry. status.md still says "waiting on Mark's playthrough", "CI green through ef982ab" and "unit 263". GRADING.md:307 says no round 13 without Mark asking. ARCHITECTURE.md never mentions deck.ts, the story-unlock flags or FX_PACE.
10. Enemy twin marking is only half done. playback.ts:259 uses the unlettered name ("Glowrat is down!"). The bundle budget was also raised from 200 to 212 kB rather than trimmed (measured 202.2).

OVERALL: Most of the 25 notes were acted on in the direction he asked, and the big ones are real: the rename, the battle pacing and readability pass, damage-type symbols, the deck scene, shop equip and sell-all, and the level and ability retune. He would feel the least heard on three points. Rook is Lv10-11 next to a "max 5-6" chapter, and this is undisclosed. Enemy shrinking skipped every human enemy. The Sinkline and Sprawl contrast fixes are real but still dark in places. He may also hit the Bestiary overflow and a broken old save, and the screenshots that should have caught them are wrong.
