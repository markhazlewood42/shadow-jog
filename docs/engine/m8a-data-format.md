---
type: plan
title: "M8a shop and dialogue data format (proposal)"
project: shadow-jog
status: approved by Mark 2026-10-14 (option C, text by id)
created: 2026-10-14
tags: [engine, m8a, data-format, shops, dialogue]
---

# M8a shop and dialogue data format (proposal)

Task 2 of [m8-brief.md](m8-brief.md). Nothing is built until Mark approves. Facts come from `src/data/shops.ts`, `src/data/speakers.ts`, `src/story/chapter1.ts` and `src/game/script.ts`.

## 1. What moves

- **Shops:** `SHOPS` (9 shops) is pure data. It moves to JSON whole. Only `scenes/shop.ts` reads it.
- **Speakers:** `SPEAKERS` (8 entries) is pure data. It moves to JSON whole.
- **Dialogue:** `chapter1.ts` has 179 `s.say`, 41 `s.narrate` and 5 `s.ask`, mixed with 30 `s.set`, 27 `s.flag`, 22 `s.sfx`, 14 `s.wait`, `s.battle`, `s.hack`, `s.move`, `s.give` and more. Most of the file is control flow, not text. A line is text, but whether and when it plays is code (`if (s.flag('camp_kept'))`, `if (r !== 'win') return`). 18 lines also build text with `${...}` from live values.

So a conversation cannot become pure data without turning the script API into a second language. The text can.

### Dialogue options

| | A: text table by id | B: scene graph in data | C: A now, B later (recommended) |
|---|---|---|---|
| Data | Every line and choice list, keyed by id | Whole scenes: nodes, conditions, effects, jumps | A, with ids shaped so B can absorb them |
| Code | Story logic stays. `s.say('mags', 'text')` becomes `s.line('rustyard.mags.fork')` | Chapter script shrinks to scene ids. Needs a node interpreter for 20+ script verbs | Same as A |
| Editor can | Edit text, speaker, face, choice labels | Edit everything, including order and flags | Same as A first |
| Risk | Low. The playthrough runs the same code | High. `battle`, `hack`, `move`, `deck` and the 18 template lines need node types. Seed 7 trace and map tests lean on the scripts | Low |

Architecture fit:
- **A** changes `game/script.ts` (add `line`, `choose`), `story/chapter1.ts` (text out, ids in), `scenes/dialog.ts` and one new loader. No other scene changes.
- **B** rewrites the script layer and the 20 `ScriptFn` exports. It is the right end state for a visual editor, but not an M8 cleanup.
- **C** is A with two rules: ids are dotted by scene (`rustyard.mags.fork`), and a line holds no logic. Then B can grow from the same file.

**Recommendation: C (build A).** The editor gets all the text now, and no story logic moves in a cleanup milestone.

## 2. JSON shapes

Three files in `src/data/`: `shops.json`, `speakers.json`, `dialogue.json`. Values copy the old ones exactly. Markup such as `{y}...{/}` stays inside the text.

`shops.json` (sample: the Rustyard shop, with its code comment kept as `note`):
```json
{ "shops": { "rustyard": {
  "name": "MAGS’ SALVAGE", "keeper": "Old Mags", "accent": "#86f08c",
  "note": "Leave the camp its collection and Mags remembers: a fifth off, for good.",
  "discount": { "flag": "camp_kept", "mult": 0.8 },
  "greeting": "Salvage, scrap, and things that fell off trucks. Don’t ask which trucks.",
  "thanks": "Pleasure. Mostly mine.",
  "items": ["trauma_patch", "medkit", "neurotab", "razor_tekko", "mono_claws", "thorn_rod", "ballistic_vest", "spirit_robe", "dermal_plating", "neural_buffer", "cyber_eye", "reflex_booster", "adrenal_pump"] } } }
```
The shop id is the key, so `id` leaves the record and the loader adds it back. `discount` is optional.

`speakers.json`: `{ "speakers": { "mags": { "name": "Old Mags", "color": "#86f08c", "voice": 1.05, "portrait": "mags" } } }`

`dialogue.json` (sample: Mags' fork, `chapter1.ts` lines 225 to 232, and two intro lines):
```json
{ "lines": {
  "rustyard.mags.fork": { "who": "mags", "text": "And this. The camp took up a collection for whoever ran Knuckles off: {y}150¢{/}. Don’t argue with me, I’m old.",
    "choices": ["Take it", "Leave it with the camp"], "cancel": 0 },
  "rustyard.mags.kept_kit": { "who": "kit", "text": "Keep it. The little ones need it more than our rent does." },
  "rustyard.mags.kept_reply": { "who": "mags", "face": "happy", "text": "Hmph. Then here’s what it buys you: anything on my lot, a fifth off. For as long as I’m breathing." },
  "intro.rook.1": { "who": "rook", "text": "Up. Dutch called." },
  "intro.narrate.1": { "who": null, "text": "Rook takes his coat from the hook the slow way, keeping his left side still." } } }
```
Fields: `who` (speaker id, `null` for narration, or a free name like "Rustfang Punk"), `text`, optional `face`, `top`, `auto`, and for a choice `choices` and `cancel`. Text with a live value uses a named slot, such as `"Rook’s chrome is re-tuned: {y}{unlocked}{/} are back."`, filled by `s.line(id, { unlocked })`.

The code after the move:
```ts
const keep = await s.choose('rustyard.mags.fork');
if (keep === 0) await s.cred(150);
else { s.set('camp_kept'); await s.line('rustyard.mags.kept_kit'); await s.line('rustyard.mags.kept_reply'); }
```
`s.say(who, text)` stays in the API for tools and tests, but the story file stops calling it with literals.

## 3. Loader and checker

Same pattern as `enemies.ts` (`checkEnemies`, `loadEnemies`) and `hack3d/data.ts`.
- **Files:** `src/data/shops.json`, `speakers.json`, `dialogue.json`. They import with `import x from './x.json' with { type: 'json' }`. `src/data/shops.ts` and `speakers.ts` stay as thin typed loaders, so `SHOPS`, `SPEAKERS` and `speaker()` keep their names and users. New `src/data/dialogue.ts` exports `LINES`, `checkDialogue`, `loadDialogue`.
- **Checker:** `checkShops`, `checkSpeakers`, `checkDialogue` return a list of problems in plain words. `loadX` throws `dialogue.json is not valid:` plus one line per problem, each with file, id and field (for example `dialogue.json: rustyard.mags.fork.cancel is 5, but there are 2 choices`).
- **Checks:** unknown field, wrong type, bad `#rrggbb` color, `mult` outside 0 to 1, shop item id not in `items.ts`, `who` not a known speaker (free names only if listed in a `names` array), empty choices, `cancel` out of range, a `{slot}` that no call fills, `{y}` markup left open.
- **Cross-file test:** every id that `chapter1.ts` passes to `line` or `choose` exists, and every id in the file is used (no orphan lines).

## 4. Tests

- **Values identical:** a frozen snapshot of the old values (`tests/fixtures/dialogue/old-shops.json`, taken before the move, like `old-enemies.json`). `SHOPS` and `SPEAKERS` deep-equal it. For dialogue, a fake `ScriptApi` records each line's `who`, text and face. The old and new script runs must match, branch by branch.
- **Round trip:** load, save, load gives equal data. Save keeps key order, so a diff shows only real edits.
- **Rejects bad input:** one test per check above, plus a control that changes one field and must fail the comparison.
- `tests/balance.test.ts` and `tests/economy.test.ts` stay green. They read `SHOPS` prices, so this also proves the shape did not change.

## 5. Editor contract (migration.md principle 11)

- **(a) Tunables in one documented object:** the three JSON files. This doc is the shape reference. Old values are the defaults.
- **(b) Load and save JSON:** `loadX` and `saveX` for each file, covered by the round-trip test.
- **(c) Hot reload:** `loadDialogue(json)` and `loadShops(json)` replace the live tables. A line is read when it plays, so the next line shows the edit. A running box does not swap.
- **(d) `snapshot()` and `restore()`:** shop scene state (stock, cursor, scroll). Dialog scene state (line id, characters shown, choice cursor).
- **(e) Deterministic `step(n)`:** the dialog text reveal advances by frames, not time. Blip sound is skipped in `step`.

## 6. Not included

- A shop editor or a conversation editor. M8 only makes the data editable.
- Localization. Ids make it possible later (one file per language), but no second language, plural rules or font work is in scope.
- Story logic as data (option B): flags, battles, hacks, movement and branching stay in TypeScript.
- Map data and the other `src/data` files. No `src/data/*.json` that exists on `main` changes.

## 7. Built (M8a task 5, 2026-10-14)

Files: `src/data/shops.json` (9 shops), `speakers.json` (8), `dialogue.json` (226 lines, 3 free names), the loaders `shops.ts`, `speakers.ts`, `dialogue.ts`, and the shared `contentjson.ts`. `s.line(id, slots?)` and `s.choose(id, slots?)` are on `ScriptApi`. `chapter1.ts` keeps only the text in the "Not moved" list below. Test: `tests/dialogue-data.test.ts`.

Where the build differs from sections 1 to 6:

| Doc said | Built | Why |
|---|---|---|
| `loadX(json)` checks and replaces the live table | `parseX(json)` checks and returns data (pure). `loadX(json)` calls `parseX`, then replaces the live table in place | Tests and tools need a load that changes nothing. A bad file throws before anything changes |
| `note` is a shop field | The loader moves `note` out to `SHOP_NOTES`. `ShopDef` has no `note` | `SHOPS` must deep-equal the old objects. Same split as `ENEMY_NOTES` |
| Check: a `{slot}` that no call fills | Two checks. At play time `resolveLine` throws on a missing slot and on a slot the text does not have. The cross-file test compares the slots of every `s.line` call in `chapter1.ts` with the slots of its line | `checkDialogue` sees only the file, not the calls |
| Check list | Added: line id is dotted lower-case words; `face` must be a known face and the speaker must be in `speakers.json` (a face has no effect on a narrator or a free name); `auto` with `choices`; `cancel` without `choices`; an unknown text code such as `{q}`; a `names` entry that is a speaker id or is listed twice | A typo that would silently do nothing |
| `names` array | A top-level `"names"` in `dialogue.json`: `Rustfang Punk`, `“Knuckles” Tran`, `K-M Sentinel` | |
| Ids dotted by scene | `scene.who.n` from a script, with names by hand for the Mags fork and its two replies, `rustyard.mags.menu`, `betrayal.act`, and the 15 lines with a slot or a branch (`pump.open`, `relay.cycle`, ...). Scenes: `intro`, `plaza`, `saint`, `hexden`, `gate`, `knuckles`, `rustyard`, `sinkline`, `crew`, `pump`, `floodgate`, `lurker`, `annexdoor`, `guards`, `lattice`, `relay`, `cryopod`, `warden`, `betrayal` | 226 hand-picked names were not worth the cost. A writer can rename an id in one search and replace |
| `s.say` stays for tools and tests | `say`, `narrate` and `ask` stay: the map files (about 90 calls), `game/systems.ts`, `scenes/field.ts` and `boot.ts` call them | Moving the maps' talk is out of M8 (section 6) |
| (c) hot reload | Done for all three files: `loadX` plus the `import.meta.hot` hook that `fx.ts` uses. The hook is not tested in a browser | |
| (d) `snapshot()` and `restore()`, (e) `step(n)` | **Deferred to M8b.** They are on the shop and dialog scenes, which M8b ports to native scenes (tasks 6). Adding them to the old scenes now would be thrown away | `scenes/dialog.ts` and `scenes/shop.ts` are unchanged: they read the live tables |

Not moved (still in `chapter1.ts`): the tutorial cards (`s.tutorial`), `OBJ`, and `annexLog` (the log text is in the map files). Tests changed for the move: `tests/dialog-wrap.test.ts` now also reads the lines of `dialogue.json`, and `tests/pacing.test.ts` counts the prose of the file (story prose 18,896 characters before, 18,468 after).

Deferred to M8b (Mark approved, 2026-10-14): data-layer items (d) `snapshot()` and `restore()`, and (e) `step(n)`. They need the dialog and shop scenes, which M8b ports.

## 8. Built in M8b phase 2 (items d and e)

Both items are on the native scenes. Test: `tests/sje-ui-scenes-2.test.ts`.

| Scene | `snapshot()` holds | `restore(snap)` does | `step(n)` does |
|---|---|---|---|
| `DialogScene` | The line (`opts`: speaker, text, choices, cancel, top, face, auto), the page, the characters shown, the pause, the choice cursor, and the box clock (`frame`, `opened`, `autoT`, `blipAcc`, `bufferedPress`). Plain JSON. | Sets the line from the snapshot, rebuilds the objects, and sets the fields. A box built for another line becomes this one. | Runs n ticks with no keys and no sound: the open animation, then the typewriter. It stops at the end of the page. It never pages, never picks a choice, never closes the box. |
| `ShopScene` | The shop id, the mode, the keeper line, the quantity, the item ids on the open list, the cursor and scroll of each list, and the tick count. Plain JSON. | Rebuilds the lists from the shop data and the player bag, then sets the cursors. An unknown shop id throws. | Runs n ticks of animation with no keys (the highlight eases, the cursor nudges). It changes no game state and no mode. |

The dialog snapshot has no line id, because `DialogScene` is given the resolved record (`resolveLine`), not the id. The text identifies the line. A tool maps the text back to its id in `dialogue.json`.
