---
type: reference
title: Shadow Jog — Playthrough 2 response
project: shadow-jog
created: 2026-09-29
updated: 2026-09-29
tags: [quality, playthrough, triage]
---

# Playthrough 2: what changed for each note

Mark played on from his first save to just past the Lurker and left 14 more notes in `docs/mark-playthrough-notes.md`
(the file now holds this batch; the first batch is in git history and answered in `playthrough-1.md`). One follow-up
came mid-way, on enemy targeting: "weight it a little less. It should be more likely to target the lowest percent
character, but not guaranteed."

## The notes

| # | Note (short) | What changed | See |
|---|---|---|---|
| 1 | Show the damage-type icon wherever a type is written by name | One rule: a damage type written in capitals (FIRE, SHOCK, CYBER, MANA, PHYS) gets its symbol in front, in its colour, wherever descriptions are drawn: battle help line, Items, Techs, Equip, Combo Log, shop (and its "FIRE bites …" line), the deck scene, and the Bestiary's Weak/Resists rows. Four ability descriptions said "Fire damage"; they now say "FIRE damage" like the items. A test fails if a description names a type in lower case. | Bestiary, any FIRE item |
| 2 | Sleep in my own bed | The bed in Rook's flat is a free rest: "Kit's own bed: lumpy, familiar, free. Get some sleep?" Same rules as the inn (the downed still need Doc Yun), then the save prompt. | Rook's flat |
| 3 | Apartment building taller, "high rise" | The APTS block by the canal shows four storeys of windows over its ground floor (was one), under a thin roof; Chrome+Circuit beside it still has one. Same footprint, so nothing about walking changes. | Lantern Row, canal side |
| 4 | Dutch's hat is askew | It was: the hat was placed for a normal body, and Dutch's big body puts his head 3 px to the right. The hat is now centred on the head as drawn, in every facing, for any body. | the Drowned Saint |
| 5 | Inn text "10¢ a head: 30¢ a head" | The "10¢" was the base price leaking into the name. Now: "A capsule for the night: 18¢ a head, 36¢ for the crew. Rest?" | Sleeptube 24H |
| 6 | Swords on the Threads shelves | Kowloon Threads has clothes rails now (a new prop: coats and jackets on hangers, each its own colour); the blade racks stay in the gun shop. | Kowloon Threads |
| 7 | Equipment: show what's available on highlight, with diffs | Highlighting a slot shows every piece in the bag for it, each row with what it would change (the one or two biggest moves: "−12 ATK", "+2 RES −5 DEF"), or "can't use". Confirm moves the cursor into that list; the stats panel then previews the piece under the cursor. Under the stats: what's worn in the slot, or the piece you're on. | Menu → Equip |
| 8 | Random sparkles (especially in the apartment) | They were the "something to examine" twinkles added in round 13: they sat on the tile in front of the object, not on it, and kept twinkling after you'd used the thing (the fridge, the TV, the rent tin). Removed. What's left: the cyan marker when you face something you can use, and the chests' glow. | Rook's flat |
| 9 | Enemies target Hex almost exclusively | They did: 30% of the time an enemy went for the lowest *raw* HP, and Hex's pool is the smallest, so she drew about 53% of single-target blows even unhurt. Now, per the follow-up: whoever is lowest by *percent* of their own max HP counts 1.5× as much as each other member (about 43% of blows in a crew of three, a third in a crew of four); at full health it's an even spread. Tested both ways. | `smellBlood` in `src/battle/ai.ts` |
| 10 | Healing abilities should have a crit interaction | A crew member's healing skill (Mend, Mending Rain, Patch, Second Wind, Focus Breath, Stim Rush, and the Lifeline combo) now offers a **green** ring on the members it heals: on the beat heals 30% more (a brighter number and a chime), a good press 12% more, a guess 10% less. First time, a tutorial line. Items don't ask, as with attacks. | any heal |
| 11 | Stats filling up on level-up; more special; a music sting | The LEVEL UP panel is a moment now: a fanfare (a new jingle: a run over a snare roll into a held chord with a crash), the member's happy portrait in a wheel of light, "Lv 3 → **4**" stamped big, then each stat counts up in turn with a tick, its bar filling from the old value to the new, the gained stretch in amber. Then "Fully restored: HP and RAM, ailments cleared", then anything learned (NEW TECH / NEW SKILL, with a glint). A press while it's counting finishes the count instead of skipping the panel (the victory tally works the same way now). | win a fight that levels someone |
| 12 | Valve sounds, and a bigger one when the puzzle completes | New sounds, all synthesized: a valve is a rusted wheel creaking round in three pulls, a clunk, water hissing into the pipe and a far-off knock. The last valve drums every pipe in the room, low to high, into a low even hum (with a light rumble). Hex starting the pumps: a heavy clank, motors running up under a steam blow-off, water surging down the drains, with a longer rumble. | the Sinkline intakes |
| 13 | Boss tell text needs to stay on screen | A tell ("WARDEN's cannon whines, locking onto Hex…") is now its own event: an amber box pinned at the top with a warning mark and a chime, which stays until the enemy that gave it has acted on it (a charge stays up through the next round's orders) and for at least 2 s plus reading time. The battle waits longer before moving on (40 frames plus about one per character). Every enemy tell uses it; ordinary messages are unchanged. | Warden, Lurker, Knuckles, Arcanist |
| 14 | Equipment lists characters we haven't met | The shop's tag names only crew you've met: "Kit only" for the Spirit Band before Sable joins; "No one in the crew" if nobody you've met can wear it. | Kowloon Threads |

## Judgment calls

- **Sparkles removed, not repaired.** Making them mean something (only unclaimed items, drawn on the object) is
  possible, but it adds a rule to learn and every map's events would need tagging. Say so if you'd rather have that.
- **The heal ring's numbers** (+30% on the beat, +12% good, −10% a guess) mirror a normal strike. Items don't get one.
- **The pinned tell** takes the top line; banners and help text move down under it while it's up.
- **The level-up panel** now takes about 2 s to count out; a press finishes it at once.
- **Hex's den** still has a blade rack (the same prop the Threads had); you didn't mention it, so it stays for now.
- **The Lurker's last quarter** still goes for the smallest HP pool ("crushing the weakest", after "It's desperate
  now!"), which is usually Hex. Switching it to lowest-by-percent made the fight easier than the balance tests allow
  (95% wins against a 93% cap), so it stays a short, announced boss phase unless you want it retuned.
- **Lifeline** (a full-restore combo) keeps its ring: a perfect press can't heal past whole, and a guess heals 90%.
  Taking the ring off made the Warden too easy under skilled timing (99% against 98.5%).

## Verified

- Unit tests: 280 pass (four new: the target spread, the heal ring, damage-type marking, the level-up record).
- Balance and economy suites pass with the new targeting.
- Screens checked by hand in the dev build: the flat's bed prompt, the APTS block, the Threads racks, the inn prompt,
  the equip slots with live gear and diffs, the Bestiary's symbols, a pinned tell over the round menu, the level-up
  panel counting and finished, and the shop's met-only tag.
- New sounds measured offline: valve peaks about −8 dBFS, the last valve about −9, the pumps about −6 (explosion: −8);
  the level-up jingle sits at the victory fanfare's loudness (−20 dB RMS).
- End-to-end (chromium): the full chapter playthrough, economy, chaos-input and game-over specs pass.

## After the code review

A fresh reviewer read the diff. What it found, all fixed:

- **The level-up panel's sounds never played** (the stat ticks, the restore chime, the "learned" flourish): the sound
  loop started before the panel was up, saw no panel and stopped. The victory tally's ticks had the same bug from
  before this round, so they'd never played either. Both now start once their panel is showing.
- **The pump motor's throb wasn't enveloped**, so it ended on a thump; it's now its own stage inside the fade.
- **The equip diff ignored crit and hit** (the Lucky Coin read "same"); both count now, and a piece whose only effect
  is a ward, regen or a damage type says so.
- **A tell could outstay its windup**: a turret or the Arcanist stunned mid-charge left "spins up…" pinned. A tell now
  also ends when the enemy's windup does, and the defeat sequence clears it.
- **Gear anyone can wear read "Kit only"** in the shop (its list names all four, and the met-only filter narrowed it);
  it reads "Anyone" again.
