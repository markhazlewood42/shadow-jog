# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- The move to 640x360, step 1 (no pixel changes yet): the battle world's size derives from the screen (`BW = W / WORLD_SCALE`, `BHT = H / WORLD_SCALE`, one `WORLD_SCALE` in `battlekit/geom.ts` that the backdrops, the title skyline, the renderer and the FX lab share); the "Autosaved" badge, the news bar, the error bar, the water animation culls, the aberration center and the FX lab's slider limits read `W` and `H`; a scripted camera pan centers a map smaller than the view, as the field camera does.
- The screenshot set (`npm run shots`) is deterministic: the spec runs the game on Playwright's paused clock with a fixed date, pinned encounter tables and a seeded `Math.random`, so three runs of one build give the same bytes and the same-pixels check of the move is a plain zero. `SJ_BUILD_SHA=<label>` pins the build label the title draws, for a compare across two commits. The run takes about 2 minutes instead of 4.7.
- The version is now 0.2.0-dev: phase 0.2 development has started.
- Hex now uses they/them, and Sable uses he/him (Mark's canon, 2026-10-03).
- CI runs its checks as three jobs at the same time and skips a change that touches only docs, notes or `tools/command-center/`. The real-speed playtest runs on pushes to `main` and from the Actions tab, not on pull requests.
- The move to 640x360, WP2 and WP2b (the flip, then the lean battle re-lay): the screen is 640x360 (`W` and `H` in `src/engine/game.ts`) and the battle world is 320x180 at an exact 2x. The Playwright viewport and the screenshot scripts use 1280x720, an exact 2x, so the review pictures are not resampled. The Fill-mode scale rule is a pure function (`cssScaleFor` in `src/engine/display.ts`, the 90% rule unchanged) with a unit test of the window table, and `e2e/gpufx.spec.ts` checks that Pixel-perfect mode draws exact blocks at 3x (1080p) and 2x (the Steam Deck window). Screen shake strengths are multiplied by 4/3 (`SHAKE_PIXEL_GAIN`), so a shake keeps its size on screen. The frame-time gates of `e2e/perf.spec.ts` are unchanged and hold (numbers in `docs/PIVOT-640.md`). Layouts that were drawn for 480x270 are not re-laid yet: later work packages fix them, and each test they turn red carries an expected-failure marker. The step-1 follow-ups landed first: `WORLD_SCALE`, `BW` and `BHT` are defined once in `src/art/worldsize.ts` (the battle kit re-exports them, so `art` no longer imports `scenes`), the screenshot spec fetches the battle and deck chunks before it starts the clock, a test pins the scripted camera `pan()` to the shared camera rule, and the screenshot tools' captions and exit codes are fixed. At Review 1 (Mark, 2026-10-08) D11 was answered: the three screen-wide shockwave reaches in `src/data/fx.json` were scaled by 4/3 (the intro 320 to 427, the Warden's phase change 260 to 347, a boss going down 240 to 320; the ring widths stay), so each ring still crosses the same share of the screen. WP2b is a lean re-lay: the battle will become a side view later, so it makes today’s battle correct at 640x360 and adds no new paintings. The battle world’s rows follow the 320x180 world (the party stands at `BHT - 8`, the street’s horizon is at row 84, every backdrop’s ground line is the horizon plus a named offset, the enemy row is wider and centered, and the railings, cables, consoles and pylon hang from the bottom and side edges). Each hero stands over the middle of their own status card, and the rain keeps its density per pixel. The battle HUD is placed from one rectangle, `HUD_FRAME` in `battlekit/geom.ts`. At Review 2 (2026-10-08) Mark chose D6 option 1: the HUD hugs the screen edges, so the frame is the whole screen (the centered block hid the party behind the cards, and it is gone). The status cards, the menus, the turn strip, the top line, the target box, the character cut-ins and the action and VICTORY banners derive from it. The end panels (VICTORY and LEVEL UP) do not yet: that is WP6. The right-hand character cut-ins and the target box stop short of the turn strip, which now makes room for a three-member combo, and its "TURN" label clears the entry that is acting. New tests: `tests/battle-geom.test.ts` (the HUD frame, also built as an inset frame, the party over its cards, the enemy row with its named clearance and the bosses’ allowance, the top band, the backdrops, the cut-ins and banners, each with a negative control) and a rewritten turn-strip block in `tests/layout.test.ts`; `scripts/measure-battle-sprites.mjs` writes the measured sprite sizes they read. WP3 (field, maps, cutscenes): the field weather counts scale by the screen's area (`AREA_SCALE` in `src/field/weather.ts`: rain 338, dust 89, drips 25, splash cap 107). The maps smaller than the screen (the Rustyard, Loading Dock 7 and the nine interiors) have one table keyed by map id (`src/scenes/fieldkit/surround.ts`). At Review 3 (2026-10-08) Mark chose "indoor areas blank fill, outdoor areas themed": the nine interiors repeat their edge tiles outward into a dark fade, the Rustyard has a corrugated fence and scrap ground around it, and Loading Dock 7 sits on a hazard-striped quay over moving water. A test pins the rule by map kind, so a new small map must choose its surround. The content that the wider view shows early or cropped has a second table (`fieldkit/popins.ts`, D17), and Mark's picks ship: the Annex's cryo wing stays dark under a curtain until the player nears it (P1) and the lattice under a curtain while relay B or C runs (P2), the lattice shutdown pan holds 40 frames on its target (P3), and the Rustyard's camera may go 40 px past its south edge so that Knuckles' crew is out of the entrance view (P4). The review switches are gone. The shipped bundle alarm went from 236 to 238.5 kB for this art (D20), and the field skips the plain void fill while the map covers the screen. Damage numbers no longer rise into the top text band (`FLOATER_TOP` is 34), the battle list window has one width rule (`listWindowW`), the camera rule takes an optional limit box, and a four-corner camera walk in `e2e/economy.spec.ts` checks every scrolling map. New tests: `tests/popins.test.ts`, the pinned list of small maps in `tests/maps.test.ts`, and blocks in `tests/atmosphere.test.ts`, `tests/battle-geom.test.ts` and `tests/camera.test.ts`, each with a negative control. WP3 round 3: the Rustyard's surround is lifted (its colors and alphas are named in one record, `YARD` in `fieldkit/surround-art.ts`, so the gravel and fence read about as dark as the yard's own shadowed ground, not as a void); the field lights and draws only the parts of an overhead layer that hold anything (`field/overrects.ts`, pixel for pixel the same picture, cheaper on a software canvas); and the frame-budget gate in `e2e/perf.spec.ts` reads the best of 3 timing windows per scene, because a shared CI runner only ever adds time; the software gate was re-set from 8 / 11 to 10 / 12 ms and then put back in WP4 (the round 3 code read 4.33 and 6.70 ms on CI, and a slow runner gets one rerun and a note, not a new gate). The shipped bundle alarm is 239.5 kB (D20, +1.0 kB). WP4 (dialog, menus, shop, modals): the dialog box is capped at 464 px and centered (D8: the text stays 448 px wide, 392 with a portrait, so every authored line wraps as it did at 480x270, proven for every line in the scripts by `tests/dialog-wrap.test.ts`), and its choice box sits at the right end of the box. The field menu's list panes are capped at 364 px (the old pane width), Items and Techs keep the party in compact cards beside the list, the Status screen is re-spaced for the wider window (a 200 px stat block, three ability columns, a 14 px row pitch), the shop list is 240 px wide, and every scrolling list takes its row count from the height of its window (`rowsFor` in `src/ui/layout.ts`: the combo log shows 8 rows). Every layout number of these screens is a named value in `src/ui/layout.ts`. A layout recorder (`tests/recorder.ts`) stands in for the canvas in node and checks the menu panes, the shop, the modals and the dialog (`tests/ui-layout.test.ts`): every rect is on screen, every text is inside its window, and a tall pane's list follows the height, with two controls that stay in the suite (a window at `W - 10` fails, and the same screens at 480x270 pass). The dev-only review switches `?dialogw=full` and `?panes=stretch` show the other options of D8.
- Command Center revision 2 (Mark's live feedback of 2026-10-07): every page shows labels and links in simple technical English, with no sentence over 20 words, and server messages follow the same rule. The Agents page is a live diagram of the sessions that run now, and the Running panel lists those sessions and links to it. The Status panel is five rows with links and a milestone strip. The engine decision table, the decision pages and the doc chrome lose their explanations and link to the docs.
- Command Center follow-ups (Mark, 2026-10-08): the CI row reads only the `ci.yml` workflow, the "+N more" label on the Agents page counts the hidden children of that parent only, and each Running row opens the Agents page at its session.
- Command Center clean-up (Mark, 2026-10-08): the Agents page no longer flips to the file-age fallback for one look. This happened when Claude rewrote a process file as the server read it. The server now reads that file again after 50 ms.

### Added
- The `Command Center` workflow (`.github/workflows/command-center.yml`) runs the Command Center typecheck, Vitest and Playwright tests on a pull request or a push to `main` that changes `tools/command-center/`, a file under `docs/`, a markdown file at the root, or the decision issue template.
- The Command Center (`npm run cc`, http://localhost:3009): a local website with what is going on now, every doc in one place, the sessions and agents, and the design decisions that wait on Mark, who answers them on a page that posts to a GitHub issue. It lives in `tools/command-center/` and does not touch the game.
- Command Center revision 2: a Copy for LLM and Download as markdown split button on every doc page, a live Agents diagram of the active sessions with their agents, workflows and message counts, a CI-on-main row and a milestone strip on the Status panel (the `milestone:` key in `status.md`), the routes `GET /api/agents`, `GET /api/ci` and `GET /api/docs/<slug>/source`, and the config keys `claude.sessionsRoot`, `agents.pollMs`, `agents.lingerSeconds` and `agents.staleSeconds`.
- Saves record the game version that wrote them.
- A slot saved by a newer version says so ("Saved by a newer version") instead of "damaged", and asks before it is replaced.
- The move to 640x360 begins (`docs/PIVOT-640.md`: criteria, rubric and record). Three screenshot tools with no new dependency: `scripts/contact-sheet.mjs` (before-and-after pages), `scripts/pixel-diff.mjs` (the same-pixels check) and `scripts/check-shots.mjs` (the smoke check of the area outside the old frame). A unit test, `tests/screen-literals.test.ts`, fails any new bare screen-size number in the code; its pending list is the work list of the move, and `scripts/derived-literals.mjs` lists the derived layout values for the final reconciliation.

## [0.1.0] - 2026-10-03

First release: Chapter 1, "Milk Run", playable start to finish in the browser. Known gaps at this point: the dungeon is small and linear, and most ordinary fights end in two rounds; the story never says why the crew rides Mr. Pale's lift; there is no colour-blind palette, text-size option or on-screen touch pad; some Rustyard scrap heaps read as noise; the end-to-end tests teleport and auto-resolve, so there is no save-and-reload mid-chapter test.

### Added

#### Chapter 1: "Milk Run"
- A four-place chapter of about 45 to 75 minutes: Lantern Row (the town hub, with interiors), the Sprawl (the world map), the Rustyard (a scavenger outpost) and the Sinkline B1 and K-M Annex 7 (a two-floor dungeon).
- Four party members who join through the story: Kit, Rook, Hex and Sable, each with their own resource (KI, skill charges, RAM, MANA), gear slots and abilities.
- Rook starts as a wounded level-10 veteran with four skills locked; Hex re-tunes his chrome and Sable closes the wound over two story beats.
- Hex's cyberdeck: seat the Stingray coprocessor by hand, see it on a Deck page, and watch a mini deck in battle.
- 21 enemies, with a Bestiary that records the weaknesses you find.
- Three bosses, each with a pinned on-screen tell that asks for a different answer: Knuckles Tran at the tire depot, the Lurker in the flooded junction, and the Warden in the Annex.
- Nine combos (eight reachable in Chapter 1), including the three-member Clean Job, each with a cut-in line and a Combo Log with hints.
- A story told through comic-panel intro and ending pages, with an end-of-chapter results screen and a "Next time" card.
- A cred economy with per-character headpieces and mods, a choice at Old Mags' (take the camp's collection or a lasting discount), Hedda's cart in town, Wire's Stash, and the Annex Requisition terminal.
- Side jobs on the Drowned Saint's board: a lost cat, a stolen med-case and a Rustfang bounty.
- A capsule hotel and a street clinic for resting and reviving, plus Kit's own bed as a free rest.
- Chapter 1 ends around level 6; a level-up is a full restore, and new abilities are rare.

#### Battle
- Round-based battles in the Phantasy Star IV mould, paced so you can read them: one animation clock, a beat between turns, and a Battle speed setting.
- Timed presses on attacks and heals (on, assist or off), with a stronger hit on the beat.
- Damage-type symbols everywhere a type is named, plus Analyze, Guard (with TP back on a blow taken) and non-chainable Stun.
- Enemies lean toward whoever is lowest on HP by percent, rather than picking at random.
- A level-up moment with a fanfare, stats counting up, and any new abilities.

#### Field and exploration
- 3/4 top-down maps with random encounters by zone, chests, warps, locked teasers for later chapters and a valve puzzle and relay lattice in the dungeon.
- A light map with neon and lamp lighting, rain, fog and steam, depth cues, glowing chests and an interact marker.
- Dash, fullscreen, gamepad support and rebindable keys.

#### Audio
- A WebAudio synth and sequencer with 16 songs (places, fights, story cues and jingles) and 72 sound effects, all generated in code.

#### Art
- Code-drawn character art on a bone-based rig (rig v2) traced from picks of PixelLab generations, with PixelLab tiles and props where Mark chose them.
- A battle skeleton with fixed-length bones, a pose per move, and hand-placed arcs, with Kit's and Rook's poses tuned.
- Portraits, a custom bitmap font and framed windows with a cyberpunk trim.

#### Effects
- A WebGL 2 effects layer over the Canvas 2D game: bloom on neon, lamps and spells, shockwaves, a colour split on big impacts, heat haze, glitch and GPU particles.
- A signature look for each spell element, with a cast, a travel and an impact.
- An FX lab for tuning presets and battle moments, saved to `src/data/fx.json`.

#### Saves and options
- Three save slots plus an autosave, with save format v3 and step-by-step migrations for older saves.
- Options for volumes, text and battle speed, timed presses, screen shake, flash, hit pause, display scale, GPU effects and key bindings.
- Tabs coordinate so only the oldest open tab autosaves.
- A version label on the title screen (version and build), so you always know which release you are playing.

#### Developer tools
- A skeleton and animation editor (`/rigedit.html`), an art review page (`/artreview.html`), and a DEV menu that lists every tool.
- URL routes into any map, battle or asset sheet, and `window.__SJ__` test hooks on the dev server (not in the shipped game).

#### Quality process
- Continuous integration on every push to `main` and every pull request: lint, type check, unit tests, a bundle-size budget and end-to-end tests, with the key flows also run on WebKit and Firefox.
- Twelve scored review rounds plus a verification round, and two playthroughs by Mark that shaped the pacing and the art.

[Unreleased]: https://github.com/markhazlewood42/shadow-jog/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/markhazlewood42/shadow-jog/releases/tag/v0.1.0
