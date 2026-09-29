---
type: reference
title: Shadow Jog — Playthrough 1 response
project: shadow-jog
created: 2026-09-29
updated: 2026-09-29
tags: [quality, playthrough, triage]
---

# Playthrough 1: what changed for each note

Mark's notes from his first (partial) playthrough are in `docs/mark-playthrough-notes.md`. This file answers each one:
what changed, where to see it, and the commit. Decisions Mark made before the work started (2026-09-29):

- **Rook:** a wounded veteran whom the story heals (option 1 of 3).
- **Hex's deck:** show it, seat the chip by hand, a Deck page (not a loot-parts system yet).
- **Saints:** the gun shop is renamed Last Rites Arms.
- **Abilities:** keep the combo core rather than cut strictly by level.

## The notes

| # | Note (short) | What changed | See | Commit |
|---|---|---|---|---|
| 1 | Drowned Saint / Iron Saint too similar | The gun shop is **Last Rites Arms**; its order is the Order of Last Rites. The bar, its drink and the bartender keep "Saint". | shop header in `43-shop-equip-now.png` | 7688a34 |
| 2 | Attack and skill animations go by too fast | One animation clock for effects, poses, cut-ins and damage numbers, at 0.65× (about 54% longer). Each action also lets its effect finish before the next starts. | `46-battle-round-in-play.png` | e559a08 |
| 3 | Battle transition longer; linger on effects | The field holds on the flash, cracks spread slowly, and the shards fall in slow motion: about 1.3 s (was 0.8). Combo names hold 56 frames (was 40). | play it | e559a08 |
| 4 | Show damage type in the battle menu, as symbols | Five symbols: a blade, a flame, a bolt, a chip, a spark. They sit beside Attack (the weapon's type), every tech, skill and damaging item, and in the weakness chips. Analyze and the target box pair each symbol with its word, so it's learnable. | `12-battle-techs.png`, `46-…` | e559a08 |
| 5 | Character highlight more prominent | One acting colour (bright yellow) across three places: a bigger outlined chevron, a breathing 2px frame on the acting member's card (raised 5px), and that member's turn-order entry, which steps out with a frame. Aiming uses the cursor's cyan instead. | `11-battle-command.png` | e559a08 |
| 6 | Sprawl: elements blend; walkable vs blocked unclear | City blocks get a south facade with lit windows and cast shadows. Streets get pale curbs where they meet a block and sit lighter than the rooftops. Ambient light is lifted. | `19-world.png` | f6a7bd5 |
| 7 | Rook is a veteran; brainstorm (injured?) | Level 10, wounded: −30% HP, −28% ATK, −15% AGI, a charge short on each skill, four skills locked (his Status page lists them greyed). Hex re-tunes his chrome when the Stingray boots: half the penalty goes, and Suppression and Incendiary Round come back. Sable closes the wound when she joins: whole again, with Guardian and Stim Rush. Moonfall waits for a later chapter. The opening and the first fight set it up, with a tutorial card. | `45-menu-status-rook-wounded.png` | 7b84e16 |
| 8 | Show Hex's deck; a mini-interaction to insert the part | The deck is drawn in code (sticker-bombed, whip antenna, co-processor bay). You see it dead when Hex first shows it off. Seating the Stingray is hands-on: line the pins up (a timed press that gets kinder with misses), snap both clips, watch it boot, and it unlocks Overload. The menu gains a **Deck** page with two empty expansion slots for later chapters' parts. A mini deck pops over Hex's card when she runs a program in battle. | `39`–`42-deck-*.png` | 7b84e16 |
| 9 | Show an item's slot in the store | A slot tag (WEAPON / BODY / HEAD / MOD) and who can use it, at the top of the description. | `43-shop-equip-now.png` | 7688a34 |
| 10 | Equip straight from the store | After buying gear, an **Equip now?** picker lists whoever can wear it, and what they'd swap out. It stays up while copies remain and someone else could use one. It doesn't appear when nobody could newly wear it. | `43-shop-equip-now.png` | 7688a34, a986d53 |
| 11 | Sell junk at full quantity by default | Loot's quantity starts at the whole stack; gear and supplies still start at one. | play it | 7688a34 |
| 12 | Sell all junk | **Sell all loot** is the first row of Sell. It lists what goes and what it fetches, and asks once. | `44-shop-sell-all.png` | 7688a34 |
| 13 | Sinkline: surface vs structure blends | A relief pass (in every map): walls shade the floor at their foot and to their right. Sinkline wall caps are a mottled slate with a lit rim, where they used to read as holes. Platforms get a yellow safety line over a visible drop to the tracks. Ambient light is lifted. | `18-sinkline.png`, `47-…` | f6a7bd5 |
| 14 | Enemies smaller and higher resolution, a bit | Creatures, including the Lurker and the Warden, are painted at 1.6× the detail and drawn on a screen-resolution layer: 0.8 of their old size. Human enemies keep the party's pixel scale, so people match people. | `16-battle-warden.png`, `17-battle-lurker.png`, `38*` | efb8ee9 |
| 15 | Slow the "tap for crit" (what's it called?) | It's called **timed presses**: *strike* on your blows, *brace* on theirs. Rings close about 40% slower, and each window is a little wider. | play it | e559a08 |
| 16 | Enemy description covers the selection arrow | The target box moves to the far side of the screen from its target. | `46-…` | e559a08 |
| 17 | Chests and interactive things more prominent | Chests: brighter bodies (hazard-yellow crates, teal lockers, magenta cases), trim and lock lit through the dark, a slow halo and the odd glint. Opened chests fade back. A small cyan marker bobs over whatever Confirm would reach: an NPC, a closed chest, something to examine. | `47-field-chest-and-marker.png` | f6a7bd5 |
| 18 | Sinkline random battles too frequent | One in 40 steps (was 24): about 5.5 random fights on the floor instead of 9. Its enemies pay 1.6× so the Lurker's gear is still affordable. | `economy.test.ts` output | 7b84e16 |
| 19 | A hint about the Sinkline puzzle | Wire (the concourse fence) says there are three intakes and a pump room, and that the order matters. Seeing the junction sets the objective to drain it. A valve touched before the console points you at the console. The answer is still the console's. | play it | 0b777bb |
| 20 | What's the "2" on some enemies? | It was a squad number for two of a kind. Now they're lettered (**K-M Sentinel A / B**) in names, banners, the turn strip and machine stencils. | `11-battle-command.png` | e559a08 |
| 21 | Longer delay between turns | After each action: its effect finishes (up to 50 frames), then a 22-frame beat. The turn strip also shows during the round: the entry acting now steps out, and the finished ones fade. | `46-battle-round-in-play.png` | e559a08 |
| 22 | Turn bar and command menu in the same place | The command menu always sits bottom-left and the turn strip always right, whoever is acting. | `11-…`, `12-…` | e559a08 |
| 23 | New abilities too frequent; halve them | Chapter 1 teaches three abilities by level (it was about ten): Kit gets Iron Palm at 3 and Hundred Rain at 5, Hex gets Scramble at 4. The rest arrive through the story (Overload; Rook's four). Eight of nine combos are reachable; Spirit Walk waits. | `battle.test.ts` | 7b84e16 |
| 24 | Level too fast; max 5–6 in Chapter 1 | XP to reach level L is 60 × (L−1)². A player who doesn't grind reaches 2 on the way to the Rustyard, 3 after Knuckles, 4 in the Sinkline, 5 after the Lurker and 6 in Annex 7. Each level carries more growth so every fight keeps its tuned difficulty. | `economy.test.ts` output | 7b84e16 |
| 25 | Restore full stats on level-up | A level-up restores HP, TP and charges, and shakes off ailments. | `battle.test.ts` | 7b84e16 |

## Judgment calls to review

- **Battle pace.** The slower pace is the new *Normal*; *Fast* and *Faster* still exist in Options, and holding Confirm
  still speeds animations up. If it's now too slow, that's one constant (`FX_PACE` in `src/scenes/battle.ts`).
- **Rook's wound also costs stats**, not only skills and charges. Without it he carried the opening fights so easily
  that mashing Attack won (`auto.test.ts`). With it he's about as strong early as the old level-3 Rook, and the
  mend is a visible payoff.
- **Combos: 8 of 9 survive**, more than the "about 6" first estimated. Hex joins with Patch (the crew's only heal
  until Sable) and learns Scramble; Sable joins at 5 with four spirits and learns nothing more in Chapter 1.
- **Rebalance, all to the existing targets** (balance, attrition, Auto, economy tests):
  - Knuckles: HP 560 → 460, ATK 40 → 38, bounty 300 → 380.
  - The Lurker: HP 1720 → 1560, ATK 46 → 43.
  - Bound Spirit (HP 200 → 170) and Scrap Hound (HP 49 → 56, ATK 15 → 18). Smog Wisp is sturdier (HP 44 → 48); Drowned Shade is unchanged.
  - Sewer Ghoul: ATK 35 → 36. Annex machines: attack down 1–2 each (Sentinel 49 → 47, Turret 53 → 52, Hunter Drone 51 → 50).
  - The Sinkline attrition run models five fights, not six: that's the floor's new count.
- **Human enemies keep their scale.** Only creatures and the two bosses got the finer, smaller treatment. The rig that
  draws people is shared with the party.
- **The bundle budget** was re-set (gzip 200 → 212 kB, measured 202). The deck scene now loads on demand.

## Verification

Round 13 of the rubric (`docs/quality/rubric.md`) re-scored the areas this work touched, and a separate reviewer
checked each note above against the evidence. Results: `docs/quality/scorecard.md` and
`docs/quality/reviews/round-13.md`.
