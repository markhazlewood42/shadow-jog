---
type: project-doc
title: Shadow Jog — Idea backlog
project: shadow-jog
created: 2026-10-05
updated: 2026-10-05
tags: [ideas, backlog, design, future]
---

# Shadow Jog idea backlog

Mark's ideas for later. Nothing here is decided, and nothing here is canon. Each entry keeps Mark's own words and the date. A short "Today" note under each entry says what already exists, so a later session can start from the facts. The notes do not answer Mark's questions: those answers are design work for later, with Mark.

When an idea becomes a decision, it moves to its home (`docs/GDD.md`, `docs/SETTING.md`, `docs/TOOLING-UI.md` or `docs/engine/`), and its entry here gets a link to that place.

One entry is different: entry 1 is a standing rule for the engine work now, not only an idea for later.

---

## 2026-10-05

### 1. Visual editors for the game and the engine (a standing rule)

Mark: "I WILL want visual UI editors for this game + engine at some point. I'm thinking pretty ambitiously - level editor, encounter editor, game system config UI, conversation editor, etc. etc. We'll build these up incrementally but don't make any decisions that would make that more difficult in the future."

Today:
- Now a design principle: `docs/engine/README.md` section 1. The check of every decision is in `docs/engine/decisions.md`, section "Editor rule check".
- Every engine decision must keep game content editable by a visual tool. The engine design update records this as a design principle.
- `docs/TOOLING-UI.md` section 3 specifies the Battle Stage Editor, which the Phaser spike built. Section 4 lists the next tools: the troop and encounter editor, the Animation Composer, the database (enemies, skills, items) and maps. A conversation editor and a game system config UI are not on that list yet.
- Much of the content is TypeScript code, not data: the maps (`src/data/maps/*.ts`), enemies, items, abilities, shops and dialogue. An editor can only open and save data, so this content must move to data files over time. The stage and HUD data (`stages.json`, `hud.json`) are data on the Phaser spike branch only. Neither file exists on this branch, and the engine plans them for milestone M3.

### 2. Hacking gameplay

Mark: "Gameplay for hacking: Combine turn-based elements with real-time faster paced elements. Example: the selected skill can be enhanced or modified with a certain sequence of key presses happening in time (think guitar hero style mini-game for attacks or skills)."

Mark: "Player is a cyberspace avatar moving through a network, encountering hackable obstacles and enemies to achieve a certain objective."

Today:
- The engine build has a 3D hacking mode only as a minimal technical test scene. Its design and gameplay come later, in their own iteration (Mark, 2026-10-05). This entry is the first input for that iteration.
- The battle already has **timed presses** (`docs/GDD.md`, `docs/GLOSSARY.md`): a ring closes on the target, and a press on the beat strikes harder or braces against a hit. A key sequence in time is the next step from this system.

### 3. Cybernetic enhancement system

Mark: "Cybernetic enhancement system. Elements of Cyberpunk 2077."

Today:
- **Chrome** is cyberware (`docs/SETTING.md` section 7). Cheap chrome is common in the Lower Wards. Good chrome is K-M or Halden surplus.
- Rook is the chromed street samurai with no magic. Hex re-tunes Rook's chrome in chapter 1.
- The equipment slot **Mod** holds cyberware or a fetish accessory (`docs/GDD.md`).

### 4. Three crafting and customization systems

Mark: "Crafting / customization systems for magic, physical, and cyber/deck. Three systems. Each should be equally fleshed out. Corresponds to three "classes" .. ? Maybe maybe not."

Mark's open questions:
- "What's the matching "enhanced battle" experience for the magical realm? Does it need one? Or does magic bleed into cyberspace? How?"
- "Are deck jockey's *really* the only character type that can get into cyberspace? If so, should our main character be a deck jockey? That would be a full chapter 1 rewrite and rebalancing."

Today:
- The party has four roles (`docs/GDD.md`). Kit is a ki brawler (magic through the body). Rook is a street samurai (chrome, no magic). Hex is a deck jockey (programs against machines). Sable is a shaman (spirits, healing, fire).
- Kit is the main character. Hex is the only deck jockey.
- Decks are "rigs for riding into systems", and coprocessors decide how fast a jockey thinks inside one (`docs/SETTING.md` section 7).

### 5. Why magic and near-magic technology exist

Mark: "Flesh out how and why magic and near-magic technology exists in this world"

Mark: "Is magic just manipulating nanites? How is it different from cybernetics?"

Today:
- `docs/SETTING.md` sections 1 and 6: magic came back worldwide in one night in 2049 (**the Return**, remembered in Saltreach as **the Blue Hour**). It is "a second current alongside electricity". **Spark** is the measurable reserve of magic in a Woken body, and Kessler-Mori extracts it as a **mana substrate**.
- Ki, shamanism and thaumaturgy are the three ways of using magic today.
- A nanite explanation would change this canon. Several lines are tagged [canon] because the game already says them. Decide it with care, and record any change in `docs/SETTING.md`.
