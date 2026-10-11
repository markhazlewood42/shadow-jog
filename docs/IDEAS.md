---
type: project-doc
title: Shadow Jog — Idea backlog
project: shadow-jog
created: 2026-10-05
updated: 2026-10-11
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

## 2026-10-11

### 6. A new name for the game and the setting (big TODO)

Mark: "I won't be calling this game "Shadow Jog" forever. It's mostly a code name and way too similar to "Shadow Run", its inspiration."

Today:
- "Shadow Jog" is a code name. It shows in 18 files under `src/`, `public/`, `index.html` and `package.json`, and in the repo name, the Vercel project and the planned domain shadowjog.com.
- A first brainstorm (2026-10-11), not decided: from the world, Saltreach, Lantern Row, The Blue Hour, Sinkline, Drowned Saint. Puns on water and wire: Wet Work, Floodlight, Saltwire, Tidewire, Neon Undertow, Ghostwater. The gap between the two cities: Below the Wall, Unreclaimed, The Lower Wards, Spark & Salt. Top three in that session: Saltreach, Wet Work, Lantern Row.
- Mark, 2026-10-11, leaning to the blue night theme (the Blue Hour): "Blue Flame", "Blue Smoke" (pun on electronics lingo), "Blue Spark", "The Blue" (too generic?), "Bluestreet", "Net Blue", "Blue Edge", "Blueware", "Bluejack", "Blue Tide" (reference to flooding and the blue night), "Torrent Blue", "Blue Flux". Added in the same session: Blue Current (the setting calls magic "a second current alongside electricity"), Bluewake (a boat's wake, the Woken, a funeral wake).
- Mark, 2026-10-11, on a word for the magic: ""influx" as a term for the magic (flux, fluxer ... hmm)". Today the magic is **spark** and the people with it are **Woken** (entry 8). A "flux" word could replace either one.
- Known clashes: "SaltWire" is a Canadian news group, and "The Blue Hour" is a common title. No full check of games, trademarks or domains is done yet.
- The planned domain and the email sign-up both use the current name.

### 7. "Deck jockey" becomes "hacker"

Mark: "deck jocky -> simply 'hacker' is fine"

Today:
- `docs/GLOSSARY.md` section 1 lists **deck jockey** (or **jockey**) as a [review] coinage that replaced the Shadowrun word "decker" in round 11.
- "Jockey" shows in 7 files in `src/`: `data/abilities.ts`, `data/items.ts`, `data/maps/lantern_row.json`, `data/maps/world.ts`, `data/party.ts`, `scenes/panels.ts` and `story/chapter1.ts`. It is also Hex's role label and shows in the glossary, the GDD and the setting bible.
- "Deck" and "cyberdeck" stay: the glossary keeps them as older than any one game.

### 8. "Woken" becomes "metahuman" or "meta"

Mark: "woken -> metahuman or just meta. 'woken' is an awkward word"

Today:
- `docs/GLOSSARY.md` section 1 lists **Woken** (adjective) and **Woke** (verb) as the [review] coinage for "Awakened". The same section lists "metahuman" under "Deliberately not used", because it is a Shadowrun word. Entry 6 moves away from Shadowrun, and this rename moves toward a Shadowrun word.
- "Woken" or "Woke" shows in 6 files in `src/` (`data/enemies.json`, `data/maps/annex.ts`, `data/maps/bar.json`, `data/maps/interiors.ts`, `data/maps/world.ts`, `field/props.ts`), and in the GDD and the setting bible. Setting terms built on it include the **Woken Registration Act**.
- Glossary open question 1 already asks whether to keep the four coinages (Woken, spark, deck jockey, ki brawler).
