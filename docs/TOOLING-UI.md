# Shadow Jog tooling UI guide

How every Shadow Jog design tool should look and behave: the shared layout, keys, save model and test button, then a screen-by-screen spec for the Battle Stage Editor and a map for the tools after it. Written 2026-10-02 during step 1 of the Phaser tooling spike (`docs/spikes/phaser-stage.md`); section 3 is the spec for that spike's steps 2 to 4.

Mark's direction (2026-10-02): "As far as UI design for our tooling, take as much inspiration as you can from engines like rpg maker. Whenever functionality overlaps and it makes sense." RPG Maker's editors have been through many versions doing the same jobs our tools do, so this guide starts from their patterns and says plainly where we go our own way.

**How to read the sources.** RPG Maker facts come from the official MZ help, abbreviated as links like [MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html). The research was done through a page-summarising fetcher, so wording is paraphrased and no screenshots were taken. Anything marked (inferred) is a reading of the sources or a recommendation, not a documented fact. Claims about our own tools come from the source files named beside them.

---

## 1. Principles

1. **Borrow RPG Maker where the job overlaps.** Its Database (tabs, a list on the left, a form on the right), its Troops tab (a placement view plus a Battle Test button) and its animation timing lists are the starting point for our equivalents ([MZ Database](https://rpgmakerofficial.com/product/MZ_help-en/01_08.html), [MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html)). Use RPG Maker's names for the same ideas (troop, battleback, battle test, playtest, database, align) so anything Mark reads about RPG Maker transfers directly.
2. **Where RPG Maker is weak, borrow from the tool that does that job best.** Tiled for placing objects and typed properties, Aseprite for the animation timeline, Godot for the inspector and snapping (section 4 and the research links there).
3. **Differ on purpose, and write the reason down.** The deliberate differences so far:

| RPG Maker does | We do | Why |
|---|---|---|
| Actor battle positions are a code constant; plugins expose them as numbers or a formula ([VisuStella Battle Core](https://www.yanfly.moe/wiki/Battle_Core_VisuStella_MZ)) | Heroes, enemies, horizon, floor, depth rows and HUD regions are all dragged on the real stage | Mark is making taste calls; direct manipulation is the whole point of the spike |
| Entries are numbered slots with a fixed list size and a Change Maximum button ([MZ Database](https://rpgmakerofficial.com/product/MZ_help-en/01_08.html)) | Entries have named ids (`street`, `glowrat`) and lists grow with New and shrink with Delete | Readable references and small, clear diffs in the JSON files (inferred; Mark's call if he wants numbers) |
| Enemy positions live on the troop | Positions live on the stage (slot sets per enemy count); a troop picks who stands there and may override a slot | One stage serves many fights, and the stage editor can be finished before the troop editor exists |
| Undo goes back 20 steps ([MZ menus](https://rpgmakerofficial.com/product/MZ_help-en/01_04.html)) | Undo goes back 100 steps, with redo | Matches the animation editor's existing 100-step stack (`src/dev/rigedit.ts`); memory is cheap |
| Battle test needs the project saved before plugin settings apply ([MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html)) | Battle test runs on the unsaved edits in the page | The spike's target is save-to-test in under a minute; testing before saving is faster still |
| A desktop app with F-keys for windows and Ctrl+R for playtest | Web pages served by `npm run dev` | The browser owns F5, Ctrl+R and F12, so our keys avoid them (section 2.6) |

4. **Stay consistent with our own tools first.** The DEV menu entry, the "Dev tools ›" breadcrumb, dark panels with orange and yellow accents, sliders paired with number boxes, plain-language labels and a "Note for Claude" field are already shared by the animation editor, FX lab and art review (`src/dev/tools.ts`, `src/dev/rigedit.ts`, `src/dev/fxlab.ts`, `src/dev/artreview.ts`). A new tool follows those before it follows RPG Maker.
5. **Everything saves to a data file the game reads.** No tool keeps its own copy of game data. Saving writes plain JSON into the repo (`src/data/stages.json`, `src/data/fx.json`), validated by the same module the game loads it with, and committing the file ships the change.
6. **Every editor has a test button.** Battle Test, Play, Try in game: whatever the tool edits, one click shows it working for real. RPG Maker puts Battle Test on the Troops tab for the same reason.
7. **Dev-only and invisible to shipping.** Tools sit behind `import.meta.env.DEV` or a Vite `apply: 'serve'` plugin, as all of today's do (`vite.config.ts`).

---

## 2. The standard tool layout

### 2.1 The screen

Every editor is its own DEV page (like `/rigedit.html` and `/stagelab.html`) with the real game scene in the middle and HTML panels around it. That settles the open question from the tools survey (standalone page or in-game scene) as "both": the page is standalone, and its centre view is the game's own scene, so what you drag is what the game draws.

```
+------------------------------------------------------------------------------+
| Dev tools > Battle Stage Editor   [toolbar: mode, snap, show, undo, save, test]|
+----------------+--------------------------------------------+----------------+
| LIST           | CENTRE VIEW                                | INSPECTOR      |
| search box     | the real game scene, whole-number zoom     | properties of  |
| entries (id,   | handles and overlays drawn on top          | the selection, |
| name)          |                                            | or of the      |
| New Dup Del    |                                            | entry when     |
|----------------|                                            | nothing is     |
| PALETTE        |                                            | selected       |
| things to add  |                                            | Note for Claude|
+----------------+--------------------------------------------+----------------+
| status: x,y  row 2  1 selected   Saved 21:44 to src/data/stages.json         |
+------------------------------------------------------------------------------+
```

| Region | What it holds | RPG Maker counterpart |
|---|---|---|
| Header and toolbar | Breadcrumb back to `/?devmenu`, tool name, then mode toggle, snap toggles, show/hide toggles, Undo, Redo, Save, Revert and the test button, always in that order | Toolbar plus menus ([MZ main window](https://rpgmakerofficial.com/product/MZ_help-en/01_03.html)) |
| List (left, about 220 px) | Every entry of the kind this tool edits, with search, New, Duplicate, Rename, Delete and a right-click menu | Database list panel, Map List ([MZ Database](https://rpgmakerofficial.com/product/MZ_help-en/01_08.html)) |
| Palette (left, under the list) | Things you can add to the view: enemies, heroes, HUD parts, frames | Tile Palette; the Troops tab's enemy list beside the placement view |
| Centre view | The game scene at a whole-number zoom, with handles, guides and overlays | Map View; Troops placement view |
| Inspector (right, about 300 px) | A form for the selection; for the entry when nothing is selected | Database form panel |
| Status line (bottom) | Cursor position in game pixels, what is under it, selection count, save state and the last save message | Status bar |

Below 1100 px wide the three columns stack into one, as the animation editor already does (`rigedit.html`). The centre canvas keeps a whole-number zoom and `touch-action: none`; panel key presses never reach the game.

### 2.2 Naming

- Tool names are "<thing> editor" or a plain verb phrase: Battle Stage Editor, Troop Editor, Animation Composer, Database. The DEV menu line under each says what it is for in one sentence and which file Save writes.
- Labels say what the value does in the game, in Mark's words ("How far back the floor starts", "Shadow width"), with the data field name in small monospace beside it so a builder can find it.
- Buttons are verbs: Save, Revert, Battle Test, Align, Add, Duplicate. RPG Maker's words win when the idea is the same ("Align", "Battle Test", "Appear Mid-Battle").
- Ids are lowercase words (`street`, `sinkline-gate`). The display name is separate and can change freely; renaming an id updates every reference in the same save, as FX lab's preset Rename already updates its moments (`src/dev/fxlab.ts`).

### 2.3 Selecting and moving things in the view

- **Click** selects; **Shift+click** adds to or removes from the selection; **Ctrl+A** selects everything of the selected kind; **Esc** clears the selection. MZ uses Shift+click to select several Database entries for copying ([MZ Database](https://rpgmakerofficial.com/product/MZ_help-en/01_08.html)) and Tiled does the same on the map ([Tiled objects](https://doc.mapeditor.org/en/stable/manual/objects/)).
- **Drag** moves the selection. The inspector updates live, and the drag is one undo step when the mouse is released.
- **Arrow keys** nudge by 1 game pixel and **Shift+arrow** by 8 (the 1 px nudge matches `rigedit.ts`; the 8 px step is inferred). Things that live on depth rows move one row up or down with the up and down arrows instead.
- **Snapping** has separate toggles, as in Godot ([Godot 2D](https://docs.godotengine.org/en/stable/tutorials/2d/introduction_to_2d.html)): snap to rows, snap to grid (8 px, **G** toggles), and whole-pixel snap, which is always on because this is pixel art. Holding **Ctrl** while dragging turns snapping the other way for that drag (Tiled uses Ctrl for grid snap, [Tiled objects](https://doc.mapeditor.org/en/stable/manual/objects/)).
- **Lock** (**Ctrl+L**, as in Godot) stops a layer or object from being picked, so the backdrop or the HUD can't be grabbed by accident while placing fighters.
- **Multi-select editing.** With several things selected, the inspector shows only shared fields; a field whose values differ shows "mixed" until you type one value for all of them ([Tiled custom properties](https://doc.mapeditor.org/en/stable/manual/custom-properties/)).

### 2.4 Lists: entries, copy and paste, list size

- The list shows id and name, filters as you type in the search box (**Ctrl+F** focuses it, as in MZ's Plugin Manager, [MZ aid tools](https://rpgmakerofficial.com/product/MZ_help-en/01_05.html)), and steps with **PageUp / PageDown** to the previous or next entry. MZ steps entries with F-keys; ours avoid them because F5 reloads the browser.
- Right-click an entry for **Copy**, **Paste** (replaces every field of the target, as MZ's does), **Duplicate**, **Rename**, **Clear** and **Delete**. Double-click opens the entry, and in a palette double-click adds the item to the view, as the Troops tab does ([MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html)).
- Copy also puts the entry's JSON on the clipboard, so it can be pasted into another tool or a chat with Claude (FX lab's Export already does this through a textarea).
- **Instead of Change Maximum**: there is no list size. New adds, Delete removes, and Delete is refused while something uses the entry, naming the user ("glowrat is used by troop sinkline-rats"). FX lab already refuses to delete a preset a moment uses (`src/dev/fxlab.ts`).

### 2.5 Undo, save, revert and unsaved changes

- **One shared undo module** for every tool (proposed path `src/tools/undo.ts`): snapshots of the tool's whole data object, up to 100, one per gesture (a drag, a slider release, a list action), with redo. This is `rigedit.ts`'s stack plus redo, lifted out so FX lab and art review can use it too.
- **Explicit save for game data.** Save (**Ctrl+S**) writes the file; nothing touching game data autosaves. Art review's 500 ms autosave stays, because its file is a review log rather than game data, and its status line already says when it saved (`src/dev/artreview.ts`).
- **One unsaved-changes signal**: a dot before the page title ("• Battle Stage Editor"), "Unsaved changes" in the status line, the Save button lit, and a `beforeunload` warning. Undoing back to the last saved state clears it.
- **Revert** reloads the file from disk after a confirmation that says what will be lost ("Throw away 6 changes to street?").
- **The save endpoint contract** (all existing ones follow most of it, `vite.config.ts`): `GET` and `POST` at `/__<tool>/<thing>`, same-origin writes only, a 1 MB body cap, validation with the module the game uses, and a reply of `{ ok, problems: [] }`. New endpoints use `problems` (a list); the older `problem` (one string) in the animation editor and art review moves to the list when those files are next touched.
- **Messages name the file and the fix**, in plain words: "Saved to src/data/stages.json at 21:44 — commit it to ship it", "Not saved: row 3 is above the horizon", "Not saved: is npm run dev running?". A failed save never clears the unsaved-changes signal.
- **Formatting stays stable** so diffs stay small: every save writes the file with the same formatter, one field or one short array per line (FX lab's rule for `fx.json`).

### 2.6 Keyboard shortcuts

Keys are ignored while focus is in a text field, as in the animation editor today. RPG Maker's editor shortcuts are not listed in the official MZ or MV menu pages ([MZ menus](https://rpgmakerofficial.com/product/MZ_help-en/01_04.html), [MV menus](https://rpgmakerofficial.com/product/MV_Help/page/01_04.html)); the RPG Maker column below comes from community sources and may vary by version.

| Action | Shadow Jog key | RPG Maker | Notes |
|---|---|---|---|
| Save | Ctrl+S | File > Save | New in our tools; the browser's own Save Page is suppressed on tool pages |
| Undo / Redo | Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z | Edit > Undo, 20 steps ([MZ menus](https://rpgmakerofficial.com/product/MZ_help-en/01_04.html)) | Ctrl+Z exists in `rigedit.ts`; redo is new |
| Cut / Copy / Paste / Delete | Ctrl+X / Ctrl+C / Ctrl+V / Del | Edit menu, and right-click in database lists | Works on list entries and on objects in the view |
| Duplicate | Ctrl+D | none found | (inferred) common editor convention |
| Find in list | Ctrl+F | Ctrl+F in Plugin Manager ([MZ aid tools](https://rpgmakerofficial.com/product/MZ_help-en/01_05.html)) | |
| Previous / next entry | PageUp / PageDown | F4 / F5 in the Database (as summarised from [MZ Database](https://rpgmakerofficial.com/product/MZ_help-en/01_08.html)) | Deliberate difference: F5 reloads the page |
| Test (Battle Test, Play) | Ctrl+Enter | The official MZ and MV help gives no playtest shortcut ([MZ help](https://rpgmakerofficial.com/product/MZ_help-en/01_04.html)); community pages say Ctrl+R in MV ([Steam thread](https://steamcommunity.com/app/363890/discussions/0/1728701877504371988)) and F12 in older versions ([TutorialTactic list](https://tutorialtactic.com/?p=7510)) (unverified) | Deliberate difference: Ctrl+R and F5 reload, F12 opens DevTools |
| Debug panel during a test | F9 | F9 opens the Debug screen during playtest ([MZ aid tools](https://rpgmakerofficial.com/product/MZ_help-en/01_05.html)) | Same key, same idea: set battle values while the test runs |
| Leave the test, back to editing | Esc | Close the battle window ([MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html)) | Returns with the selection intact |
| Edit / play toggle | E | Map / Event mode buttons; F5 and F6 in older versions per a community list ([TutorialTactic list](https://tutorialtactic.com/?p=7510)) (unverified) | |
| Deselect, close a dialog | Esc | | |
| Nudge | Arrows; Shift+arrows for 8 px | | 1 px arrows match `rigedit.ts` |
| Grid snap on/off | G | | Hold Ctrl while dragging to flip snapping for that drag |
| Lock selection | Ctrl+L | | Godot's lock key |
| Show HUD regions | H | | Overlay only; never changes data. Other overlays are toolbar toggles |
| Open the DEV menu | ` (backtick) | | On the game page only (`src/dev/devmenu.ts`) |
| Turn the character | [ and ] | | Animation editor only (`rigedit.ts`) |
| Database (when it exists) | F9 is taken by the debug panel, so the Database opens from the DEV menu | In MZ, F9 opens the Debug Screen during playtest ([MZ help](https://rpgmakerofficial.com/product/MZ_help-en/01_05.html)); the Database opens from the toolbar or Tools > Database ([MZ Database](https://rpgmakerofficial.com/product/MZ_help-en/01_08.html)) | (inferred) avoid one key meaning two things |

Every tool shows its keys on a "Keys" button in the toolbar, and the same table drives both the handler and that list (proposed `src/tools/keys.ts`).

---

## 3. Battle Stage Editor

What it edits: one entry of `src/data/stages.json` per stage (today only `street`, with a horizon, a floor band, four depth rows with tints, four party slots, enemy slot sets for 1 to 4 enemies and a shadow setting). Where it runs: the stage lab page (`/stagelab.html`, `src/stage/`) with edit mode switched on. Its RPG Maker counterpart is the Troops tab's placement view plus Battle Test ([MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html)), which only lets you drag enemies.

### 3.1 What we can do that RPG Maker can't

- **Drag the heroes.** MZ places side-view actors by a formula in the core script, roughly (600 + 32i, 280 + 48i) for actor i (inferred: recalled from the core script, not confirmed online), and changing it takes a plugin such as [Reposition Sideview Actors](https://neirn.itch.io/mz-reposition-sideview-actors) or VisuStella's `ActorHomePosJS` formula ([VisuStella Battle Core](https://www.yanfly.moe/wiki/Battle_Core_VisuStella_MZ)).
- **Depth rows.** MZ's placement view is free drag on a flat picture; ours snaps fighters to rows, and overlap order and floor shadows follow automatically (`depthFor` in `src/stage/stagescene.ts`).
- **Horizon and floor handles.** MZ crops a fixed 1000×740 battleback, the upper part in front view and the lower part in side view ([MZ battlebacks](https://rpgmakerofficial.com/product/MZ_help-en/01_11_01.html)); ours lets Mark move the horizon and floor lines and see where people can stand.
- **Drag the HUD.** VisuStella exposes window offsets and sizes as numbers ([Sideview Battle UI](https://www.yanfly.moe/wiki/Sideview_Battle_UI_VisuStella_MZ)); ours drags them on the stage.
- **Test the unsaved stage.** See the table under principle 3.

### 3.2 Toolbar

In order: stage name (read-only, the list chooses), **Edit / Play** toggle, **Enemies: 1 2 3 4** (which formation is shown and edited), snap toggles (**Rows**, **Grid**), show toggles (**HUD**, **Guides**, **Safe zones**, **Foreground**), **Undo**, **Redo**, **Save**, **Revert**, **Battle Test**, **Keys**.

### 3.3 Left: stage list and palette

- **Stage list**: every stage in `stages.json` by id and name, with New (from a blank template with the default rows), Duplicate, Rename, Delete and the right-click menu from 2.4. Delete is refused while a troop or map uses the stage (once troops exist).
- **Palette, "Who's standing here"**: the four heroes and the enemy list from `src/data/enemies.ts`. These choose who fills the slots *for the preview only*; the stage stores places, not people. Double-click or drag an enemy onto a slot to preview it there. This mirrors the Troops tab's enemy list, whose background picker is likewise editor-only and shared across the database ([MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html)); our preview choice is remembered per browser in `localStorage` and shared with the troop editor later.

### 3.4 Centre: the stage view

The real `StageScene`, drawn exactly as in battle, with these handles drawn over it in edit mode only:

| Handle | Looks like | Drag does | Data |
|---|---|---|---|
| Horizon | Cyan dashed line across the stage, labelled "Horizon 124" | Moves up and down; rows can't go above it | `horizon` |
| Floor top and bottom | Green lines with a grip at the left end | Moves the band people may stand in | `floor.top`, `floor.bottom` |
| Depth rows | Thin white lines numbered 1 (back) to 4 (front), with the row tint as a swatch | Moves a row's foot height; fighters on it move with it | `rows[].y`, `rows[].tint` |
| Party slots | The hero sprite itself, with an orange badge "P1" to "P4" at the feet | Left and right moves x; up and down jumps between rows | `party[]` (`row`, `x`) |
| Enemy slots | The preview enemy, with a pink badge "E1" to "En" | As above, for the formation chosen in the toolbar | `enemies["n"][]` |
| HUD regions | Yellow outlined boxes with their name, shown with **H** | Moves the box; corner grips resize it if the region allows | HUD layout (3.6) |

- **Safe zones overlay** tints the HUD's regions red where a fighter overlaps one, because menus cover whatever is under them (see "Safe zones for battle windows" in `docs/CONCEPTS.md`).
- **Guides**: the 480×270 frame, the centre line and the line where the party and the enemies meet. Dragged guides (Godot's rulers) can come later.
- **Live feedback**: overlap order and shadows update during the drag, not on drop. Idle animations keep playing so the figures read as they will in battle.

### 3.5 Battleback layers

RPG Maker builds a battle background from two pictures, a floor (battleback 1) and a wall (battleback 2), mixed freely ([MZ battlebacks](https://rpgmakerofficial.com/product/MZ_help-en/01_11_01.html)). We use the same split plus two layers of our own:

| Layer | RPG Maker | Ours today | Proposed field |
|---|---|---|---|
| Wall (sky, buildings) | Battleback 2 | The whole `battleBg('street')` picture | `backdrop.wall` |
| Floor | Battleback 1 | Part of the same picture | `backdrop.floor` (optional; empty means the wall picture includes it) |
| Foreground framing | none | The street's rails, drawn over everyone (`src/stage/textures.ts`) | `backdrop.front` |
| Ambient animation (rain, neon flicker) | none | Not drawn yet (step 1 notes) | `backdrop.anim` |

Today's `"backdrop": "street"` keeps working as shorthand for a wall picture that includes its floor (inferred migration; the validator in `src/stage/config.ts` would accept both shapes). Each layer gets a picker in the inspector and a show toggle, and the foreground can be locked so it is never grabbed.

### 3.6 HUD layout presets and regions

VisuStella offers named battle layouts (default, list, xp, portrait, border) that a troop can switch with a note tag ([VisuStella Battle Core](https://www.yanfly.moe/wiki/Battle_Core_VisuStella_MZ)), and RPG Developer Bakin keeps several screen layouts per scene that events switch between ([Bakin](https://rpgbakin.com/en/about/)). We do the same with direct manipulation:

- A **HUD layout** is a named entry (its own small list, proposed `src/data/hudlayouts.json`) of regions: turn order, commands, party status, target info, and whatever the side-view HUD design adds. Each region has x, y, width, height and an anchor.
- A stage picks a layout in its inspector. Dragging a region on that stage records a **per-stage override** of just that region; the inspector shows overridden values in white and inherited ones in grey (our own convention (inferred); Tiled only tracks overrides internally), with a revert arrow to go back to the layout's value. That is Tiled's template model ([Tiled templates](https://doc.mapeditor.org/en/stable/manual/using-templates/)) plus the per-field revert Tiled lacks (it is a planned feature there) and Godot has ([Godot inspector](https://docs.godotengine.org/en/stable/tutorials/editor/inspector_dock.html)).
- "Save as new layout" turns the current stage's overrides into a new named layout.

### 3.7 Inspector

With nothing selected, the inspector shows the stage:

| Section | Fields |
|---|---|
| Basics | Name; id (read-only, change it with Rename); Note for Claude |
| Battleback | Wall, Floor, Foreground and Ambient pickers, each with a thumbnail |
| Ground | Horizon; Floor top; Floor bottom |
| Depth rows | One line per row: foot height, tint swatch; Add row, Remove row (refused while a slot uses it) |
| Shadows | Width, ratio (how flat), alpha |
| HUD | Layout picker; list of overridden regions with revert arrows |
| Formation | Party layout: Free or Diagonal (3.8); Enemies shown: 1 to 4 |

With a slot selected: which slot ("Party 2", "Enemy 3 of 3"), row (a dropdown of rows), x (slider plus number box), and the resulting foot y (read-only, from the row). With a HUD region selected: its name, x, y, width, height, anchor and visibility.

Every field follows the house pattern: a slider paired with a number box for numbers, a plain-language label with the data name beside it in monospace, and a revert arrow when the value differs from the default or the inherited one ([Godot inspector](https://docs.godotengine.org/en/stable/tutorials/editor/inspector_dock.html)). The spike plan mentions Tweakpane for number fields (`docs/spikes/phaser-stage.md`); it is fine for step 2 if wrapped so the revert arrow, override colours and notes field still appear (inferred).

### 3.8 Formations: slot sets by enemy count

`stages.json` already keeps a slot set for each enemy count (`"1"` to `"4"`), so a fight with three enemies looks composed rather than squeezed. The toolbar's **Enemies: 1 2 3 4** picks which set is shown and edited.

- **Align** re-lays the shown set evenly: enemies spread across the rows from front to back and across the right half of the stage, like MZ's Align button, which re-lays a troop left to right in entry order ([MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html)). Align is one undo step, so it is safe to try.
- **Copy from n−1** starts a new set from the one with one fewer enemy, then adds the extra slot.
- **Party layout** is either **Free** (four dragged slots, today's data) or **Diagonal**: a front slot, a step across and a row step, which is RPG Maker's diagonal written as three numbers (see "RPG Maker's diagonal" in `docs/CONCEPTS.md`; the formula approach is VisuStella's `ActorHomePosJS`). Dragging a hero while Diagonal is on switches to Free and says so in the status line (inferred).
- **The cap** is the battle engine's, currently 4 slots in the data; RPG Maker allows 8 enemies per troop ([MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html)).

### 3.9 Battle Test

MZ's Battle Test is a dialog with one tab per party slot ([1] to [4]) for actor, level and equipment, a Status readout of the resulting numbers, and OK to start a battle window ([MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html)). Ours keeps that shape:

| Part | Contents |
|---|---|
| Party tabs [1] to [4] | Member (or empty), level, equipment per slot, from `src/data/party.ts` and `src/data/items.ts` |
| Status | HP, resource (KI, RAM, MANA) and the main numbers for each member, computed by the game's own rules |
| Troop | A troop picker once troops exist; until then, the enemies currently previewed on the stage |
| Options | Start at full resources; speed 1× or 2×; a fixed random seed so a fight can be replayed (inferred, ours) |
| Buttons | **Start** (Ctrl+Enter) and Cancel |

- Start runs a real fight driven by `src/battle` on the stage as it is in the page, saved or not; the status line says "Testing unsaved changes" when that is the case. **F9** opens a small debug panel (set HP, end the fight), and **Esc** or the fight ending returns to the editor with the selection, zoom and undo history intact.
- The last choices are remembered per browser so the second test is one keypress.
- Exit criterion this serves: save-to-battle-test in under a minute (`docs/spikes/phaser-stage.md`).

### 3.10 Saving

A Vite dev plugin at `/__stage/stages` (proposed name) following 2.5: `GET` returns the file, `POST` validates the whole file with `src/stage/config.ts` and writes `src/data/stages.json`, replying `{ ok, problems: [] }`. The running page reloads the saved stage through the same loader the game uses, which is the spike's "load the saved stage back" check. The DEV menu entry in `src/dev/tools.ts` changes from "Stage lab (Phaser spike)" to "Battle Stage Editor" with a one-line purpose and the file it writes.

---

## 4. Future tools

Each tool gets the standard layout from section 2. The table maps it to its RPG Maker counterpart and the best outside pattern; the notes below say what to take from each.

| Tool | RPG Maker counterpart | Best outside pattern |
|---|---|---|
| Troop and encounter editor | Troops tab and battle event pages; map encounter list ([MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html), [MZ maps](https://rpgmakerofficial.com/product/MZ_help-en/01_07.html)) | Tiled templates and object references ([templates](https://doc.mapeditor.org/en/stable/manual/using-templates/), [objects](https://doc.mapeditor.org/en/stable/manual/objects/)) |
| Animation Composer | Animations tab timing rows; MV cell animation; the official 2D Animation Editor ([MZ Animations](https://rpgmakerofficial.com/product/MZ_help-en/01_08_09.html), [MV Animations](https://rpgmakerofficial.com/product/MV_Help/page/01_08_09.html), [2D Animation Editor](https://store.rpgmakerofficial.com/products/2d-animation-editor-mz)) | Aseprite timeline, tags, onion skin and slices; Godot call tracks ([Aseprite timeline](https://www.aseprite.org/docs/timeline/), [Godot track types](https://docs.godotengine.org/en/stable/tutorials/animation/animation_track_types.html)) |
| Database (enemies, skills, items) | Database window ([MZ Database](https://rpgmakerofficial.com/product/MZ_help-en/01_08.html)) | Godot inspector; Tiled typed classes ([custom properties](https://doc.mapeditor.org/en/stable/manual/custom-properties/)) |
| Maps | Map editor, layers, regions, tileset settings ([MZ map editor](https://rpgmakerofficial.com/product/MZ_help-en/01_07.html)) | Tiled itself ([tile layers](https://doc.mapeditor.org/en/stable/manual/editing-tile-layers/)) |

### 4.1 Troop and encounter editor

- **List**: troops by id and name. **Auto-name** builds a name from the enemies ("Glowrat ×2"), as MZ's button does.
- **Centre**: the chosen stage with its slot set for the troop's size; drag enemies from the palette onto slots (Add, Delete, Clear, Align as in MZ). Moving an enemy off its stage slot records a per-troop override, shown and reverted like the HUD overrides in 3.6.
- **Appear Mid-Battle**: right-click an enemy to hide it until an event summons it, as in MZ ([MZ event commands](https://rpgmakerofficial.com/product/MZ_help-en/01_10_15.html)).
- **Battle event pages**: tabs of pages, each with Conditions (turn end, turn number and interval, enemy HP %, member HP %, switch; at least one required) and Span (once per battle, once per turn, every moment), and the lowest-numbered matching page runs, all as in MZ. The page contents are a command list edited by double-click with a right-click menu ([MZ event editor](https://rpgmakerofficial.com/product/MZ_help-en/01_09_03.html)).
- **Encounters**: per map, a list of troops with a weight each and optional regions, as in MZ's Map Properties. A Tiled-style reference line from an encounter to its troop and stage shows the links on screen.
- **Battle Test** is the same dialog as 3.9 with this troop filled in.

### 4.2 Animation Composer (Sprite Fusion frames)

- **Timeline**: rows are layers (body, weapon, effect) and columns are frames, each cell holding a Sprite Fusion frame reference and an offset, as in Aseprite's cels ([Aseprite cels](https://www.aseprite.org/docs/cel/)). Below the frame rows sit fixed lanes for **Sound**, **Flash** and **Events**. RPG Maker's official 2D Animation Editor add-on uses a four-track timeline of frames, cells, sound effects and flashes ([2D Animation Editor](https://store.rpgmakerofficial.com/products/2d-animation-editor-mz)), and MZ's own Animations tab lists sound and flash timings around an Effekseer effect ([MZ Animations](https://rpgmakerofficial.com/product/MZ_help-en/01_08_09.html)); the **Events** lane is ours, for hit timing.
- **Holds**: each frame has a duration, shown as cell width, exported per frame the way Aseprite's sheet JSON carries a duration per frame (inferred from its exports; the [Aseprite CLI](https://www.aseprite.org/docs/cli/) page documents a `{duration}` filename variable).
- **Tags**: named frame ranges (idle, wind-up, strike, recover) with a direction: forward, reverse or ping-pong ([Aseprite tags](https://www.aseprite.org/docs/tags/)). MZ's sheet convention fits inside this: three frames per motion, looping 1-2-3-2 (ping-pong) or once 1-2-3 (forward) ([MZ sprite sheets](https://rpgmakerofficial.com/product/MZ_help-en/01_11_02.html)).
- **Anchors and hit points**: per-frame points drawn on the art, like Aseprite slices with pivots ([Aseprite slices](https://www.aseprite.org/docs/slices/)): the foot anchor (see "Anchoring by the planted foot" in `docs/CONCEPTS.md`) and the impact point.
- **Onion skin**: previous and next frames tinted under the current one, toggled with F3 as in Aseprite ([Aseprite onion skinning](https://www.aseprite.org/docs/onion-skinning/)), so a planted foot can be checked.
- **Events lane**: markers for `hit`, `sfx`, `shake` and `flash`, each a name plus a single parameter (like Unity animation events, which take one parameter: a float, int, string or object, [Unity animation events](https://docs.unity3d.com/Manual/script-AnimationWindowEvent.html)). Godot does not fire call-track events in editor preview ([Godot track types](https://docs.godotengine.org/en/stable/tutorials/animation/animation_track_types.html)); ours previews the visuals (flash, shake, hitstop, sound) but never applies damage, and Battle Test fires them for real.
- **Bulk tools** from MV's editor: copy cells between frames, shift a range, tween between two frames ([MV Animations](https://rpgmakerofficial.com/product/MV_Help/page/01_08_09.html)).
- **Test button**: "Play in battle" runs the move in the stage view against a target.

### 4.3 Database (enemies, skills, items)

- RPG Maker's shell: one tab per kind down the side, the list on the left, the form on the right, copy/paste/clear on right-click, a Note field on every entry ([MZ Database](https://rpgmakerofficial.com/product/MZ_help-en/01_08.html)). Our Note field is the "Note for Claude".
- Forms are generated from a typed schema per kind (number, text, colour, file, reference, choice), the way Tiled's custom classes pick the editor widget from the type ([Tiled custom properties](https://doc.mapeditor.org/en/stable/manual/custom-properties/)).
- References (a troop's enemies, an enemy's skills) are pickers with a "go to" arrow that opens the referenced entry in its tab.
- The inspector extras from Godot: revert arrows, a property search box, and "Expand Non-Default", which opens only the sections holding changed values ([Godot inspector](https://docs.godotengine.org/en/stable/tutorials/editor/inspector_dock.html)).
- Test buttons per kind: Battle Test with this enemy, Try this skill (plays it in the stage view), Give this item (opens the game with it in the bag).
- The data is TypeScript today (`src/data/enemies.ts`, `abilities.ts`, `items.ts`); a database editor needs it moved to JSON first, a separate decision for Mark (inferred).

### 4.4 Maps

- Tiled stays the map editor; we don't build a tile painter. Its stamps, object layers, typed properties and templates already beat RPG Maker's map editor for our needs ([Tiled tile layers](https://doc.mapeditor.org/en/stable/manual/editing-tile-layers/), [Tiled objects](https://doc.mapeditor.org/en/stable/manual/objects/)).
- RPG Maker's map ideas map onto Tiled layers: tile layers 1 to 4 become Tiled tile layers, regions (inferred) become an object or tile layer of encounter regions, and events (inferred) become objects with typed properties ([MZ modes and layers](https://rpgmakerofficial.com/product/MZ_help-en/01_07_01.html) confirms the four tile layers and Auto mode).
- Our part is a small DEV page: pick a map, validate it, and "Try in game" at a chosen spot, plus the encounter list from 4.1.

### 4.5 Bringing the existing tools into line (later, not now)

Don't rewrite these for the guide's sake; apply the relevant part whenever one is next opened for real work.

| Tool | Already matches | Changes when next touched |
|---|---|---|
| Animation editor (`rigedit.ts`) | Three columns, colour-coded handles, Ctrl+Z, unsaved-changes guard, Note for Claude | Shared undo with redo; Ctrl+S; the shared unsaved-changes signal; `problems` list in replies; Keys button |
| FX lab (`fxlab.ts`) | Slider plus number box, click-to-fire test, refused delete, stable JSON formatting | Move from an in-game scene to its own page with the preset list on the left; add undo and Ctrl+S; add a Note for Claude field |
| Art review (`artreview.ts`) | Clear autosave status and failure message | Undo for verdict clicks; keys for Best, Good and No (inferred: 1, 2, 3); `problems` list in replies |
| DEV menu (`devmenu.ts`) | One registry in `tools.ts`, a breadcrumb back from every tool | Group editors under "Shadow Jog Engine" once there are three or more |

---

## 5. Checklist before calling a tool done

1. It has an entry in `src/dev/tools.ts` with a one-line purpose and the file it writes, and a "Dev tools ›" breadcrumb back.
2. The layout follows 2.1: list left, the real game scene in the centre, inspector right, toolbar on top, status line at the bottom; it stacks below 1100 px.
3. What you edit is drawn by the game's own code, not a look-alike preview.
4. Labels are plain language with the data field name beside them, and RPG Maker's word is used where the idea is the same.
5. Click, Shift+click, drag, arrow nudges, Esc and the snap toggles behave as in 2.3.
6. Undo and redo cover every change, one step per gesture, through the shared module.
7. Save is explicit (Ctrl+S), validated by the game's own module, and writes stable, diff-friendly JSON through a `/__<tool>/<thing>` endpoint replying `{ ok, problems: [] }`.
8. Unsaved changes show in the title, status line and Save button, and leaving the page warns; Revert asks first.
9. Every save and failure message names the file and says what to do, and a failure never pretends to have saved.
10. There is a test button (Battle Test, Play, Try in game) that runs the real thing, and Esc comes back to the editor with nothing lost.
11. The shortcut table in 2.6 is honoured, nothing uses F5, Ctrl+R or F12, keys are ignored in text fields, and a Keys button lists them.
12. Every entry has a Note for Claude field saved with the data.
13. The tool is dev-only: absent from the production build, not mounted under Playwright where it would get in the way, with a dry-run flag (like FX lab's `?dry=1`) for tests.
14. Unit tests cover the validator and the save round trip, and an e2e test drags something, saves, reloads and finds it where it was left.
15. Any place the tool deliberately differs from RPG Maker is written in section 1's table of this guide.
