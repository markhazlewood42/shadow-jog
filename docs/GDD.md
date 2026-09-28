---
type: design
title: Shadow Jog — Game Design Document
project: shadow-jog
created: 2026-09-27
updated: 2026-09-27
tags: [gdd, design]
---

# SHADOW JOG — Game Design Document

> **Pitch.** A 16-bit-style cyberpunk-fantasy JRPG for the browser. A mentor, an apprentice, a decker and a
> shaman take a simple "jog" (street slang for a small, low-risk job) that turns out to be anything but.
> Gameplay follows the *Phantasy Star IV* loop: town → world map → dungeon → boss, with a small squad,
> round-based combat, techniques + limited-use skills, **combination attacks**, and a simple economy. The setting
> borrows the *feel* of the magic-meets-megacorp genre (street samurai, deckers, shamans, metahumans), but
> every name, place and term is original. The city is **Saltreach** (2079), a drowned coastal megacity; Chapter 1
> stays in its Lower Wards.

## 1. Pillars

1. **Crew over lone hero.** Four distinct characters whose abilities interlock (combos) and whose banter carries the story.
2. **Neon noir you can feel.** Rain, light maps, neon, synthwave chiptune. Mood is a feature.
3. **Classic loop, modern manners.** PSIV structure with conveniences: save anywhere on the field, autosave, retry-battle, dash, fast text, clear UI hints.
4. **Small but complete.** One chapter, polished end to end, rather than a large unfinished world.

## 2. Scope — Chapter 1: "Milk Run" (target 45–75 min)

| Location | Type | Purpose |
|---|---|---|
| Lantern Row | Town hub (exterior + interiors) | Story hub, shops, inn, clinic, fixer bar, side jobs |
| The Sprawl | World map | Travel, random encounters, locked teasers for future chapters |
| Rustyard | Small outpost | Hex recruitment errand, tier-2 shop, first mini-boss |
| The Sinkline | Dungeon, 2 floors | Flooded metro → hidden corporate annex; puzzles, mid-boss, final boss |

### Story beats
1. **Cold open (comic panels).** Rain over the city. Rook and Kit on a rooftop. "One last easy job, then we eat."
2. **Lantern Row.** Fixer **Dutch** at the *Drowned Saint* bar introduces **Mr. Pale** (a Johnson). The job: retrieve a
   "data core" from a derelict Kessler-Mori research annex under the flooded Sinkline. Doors are corp-locked → need a decker.
3. **Hex.** Dwarf decker, holed up in her den, deck fried. She'll come if the crew fetch a replacement
   coprocessor from **Old Mags** in Rustyard.
4. **Rustyard.** Scav camp under siege from a Rustfang gang pack. Clear them → Mags hands over the part. Hex joins.
5. **The Sinkline B1.** Flooded platforms, maintenance catwalks, a dead rival crew (foreshadowing). Hex hacks the
   floodgate; mid-boss **The Lurker** (awakened eel) guards the junction.
6. **K-M Annex B2.** Sterile labs. Terminals with lore. The "data core" is a cryopod: **Sable**, an orc shaman being
   drained of their magic. Kit's latent power flares in resonance. Sable joins. Alarm.
7. **Boss: WARDEN.** Security mech with a bound spirit for a core; phase 2 when the spirit tears loose.
8. **Betrayal.** Mr. Pale waits at Loading Dock 7 with a K-M strike team. It was never a job — it was a retrieval of
   stolen property (Sable is "Asset S-7"), and the crew are now loose ends. Rook's flashbang buys eleven seconds; he
   stays behind and is taken.
9. **Ending (comic panels).** Kit, Hex and Sable surface three wards over. Sable's crow followed the vans up the
   arcology: Rook is hurt, alive. The crew decides to go get him. Pale orders them found, and Rook kept breathing
   ("I want to know who taught Miss Kit to fight like that"). *END OF CHAPTER ONE — They have until morning.*
   Results screen (time, battles, level, combos found, bestiary), then a "Next time" card.

## 3. The crew

| | Kit | Rook | Hex | Sable |
|---|---|---|---|---|
| Pronouns | she/her | he/him | she/her | they/them |
| Metatype / age | Human, 19 | Human, 41 | Dwarf, 34 | Orc, 24 |
| Role | Physical adept (magic-fuelled martial artist) | Street samurai (heavily chromed, no magic) | Decker (programs vs machines, debuffs) | Shaman (healing, spirits, fire) |
| Resource | TP (Ki) | Skills only (TP 0) | TP (RAM) | TP (Mana) |
| Weapons | Knuckles | Blades, Guns | Pistols | Staves, Fetishes |
| Joins | Start | Start | Lantern Row (after Rustyard) | Sinkline B2 |
| Personality | Reckless, loyal, funny | Gruff, dry, protective | Anxious, sarcastic, brilliant | Serene, blunt, haunted |

Kit is the protagonist. Rook is the mentor (PSIV's Alys analog). Hex is the brains, and Sable is the mystery.

## 4. Core loop

`Town (story, shop, rest, save)` → `World map (travel, encounters, XP/cred)` → `Dungeon (explore, loot, puzzles, boss)` → `Town (upgrade, story)`.

## 5. Combat (round-based, PSIV-style)

* **Round start:** a party menu offers *Orders* (enter commands per member), *Repeat* (last round's orders), *Auto* (all attack) and *Run*.
* **Per-member commands:** Attack · Tech (costs TP) · Skill (limited uses, restored by resting) · Item · Guard.
* **Resolution:** everyone acts in Agility order, with jitter. Actions produce a stream of battle events that the
  presentation layer animates. The logic is pure and unit-tested.
* **Combos:** specific ability pairs chosen in the same round fuse into a named combo, e.g. Kit *Flash Step* + Rook
  *Arc Cut* → **Thunder Rift**. A "COMBO" hint lights up during command entry, and discovered combos are logged.
* **Damage types:** Physical, Fire, Shock, Mana (astral), Cyber (only affects machines). Enemy families:
  Human, Machine, Beast, Spirit, Ghoul. Each family has clear weaknesses.
* **Status:** Poison, Stun, Burn, Blind, Jammed (machines skip turn), Guard, buffs (ATK/DEF/AGI up), Regen, Down (KO).
* **Defeat:** Game Over screen with *Retry Battle*, *Load Save* and *Title*.

## 6. Progression

* Levels 1–30 (`MAX_LEVEL`; chapter 1 ends around Lv 9–11, leaving room for later chapters). Per-character stat growth curves; techs and skills unlock at set levels.
* Equipment slots: Weapon, Body, Head, Mod (cyberware/fetish accessory). Class restrictions apply.
* XP goes in full to every conscious member. Downed members get none.

## 7. Economy

* Currency: **cred (¢)**. Sources: battles, chests, side jobs, selling loot. Sinks: gear, consumables, rest, revives.
* Shops: weapons, armor, items (per town tier). Sell price = 50% for gear and consumables; **loot** (gang colours, rat tails, drone optics: things with no use but their value) sells at 100%, since selling it is its only purpose.
* The Annex's Requisition terminal sells a same-tier alternative to each armory find, never the find itself: a crew that skipped a case can still arm up, and one that found it has a real choice.
* **Capsule hotel** (inn): pay per head to rest, which restores HP, TP and skill uses. **Street clinic**: revive and cure, for a fee.
* Utility consumables mirror PSIV's pipes: **Smoke Pellet** (escape a battle), **Getaway Chit** (exit dungeon), **Cab Voucher** (return to last town).

## 8. Presentation

* Internal resolution **480×270**, 16px tiles, integer/fit scaling, nearest-neighbour.
* All art is generated in code: procedural tiles and structures, part-based character sprites with auto-outline, and
  vector-to-pixel enemies. The world map, towns and dungeons use a 3/4 top-down view.
* Light map: ambient darkness × additive coloured lights (neon, lamps). Rain, fog and steam particles.
* Custom bitmap font. Framed windows with a cyberpunk trim.
* Audio: WebAudio chiptune/synthwave sequencer with ~9 tracks and synthesized SFX.
* Comic-panel cutscenes (PSIV signature).

## 9. Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Move | Arrows / WASD | D-pad / left stick |
| Confirm / talk | Z · Enter · Space | A / Cross |
| Cancel (opens the menu in the field) | X · Esc · Backspace | B / Circle |
| Menu | C · Tab | Y / Triangle · Start |
| Dash (hold) | Shift | X / Square · RB |
| Fullscreen | F | — |

Every keyboard action can be rebound in Options → Controls (the in-game Controls page is the reference; this table
mirrors its defaults).

## 10. Tech

Vite + TypeScript (strict), zero runtime dependencies, Canvas 2D. Vitest for logic and Playwright for E2E and screenshots.
Save data lives in localStorage: 3 slots plus an autosave.
