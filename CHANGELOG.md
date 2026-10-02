# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-02

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
