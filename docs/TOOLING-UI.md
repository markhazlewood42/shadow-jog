# Shadow Jog tooling UI guide

How every Shadow Jog design tool should look and behave: the shared layout, keys, save model and test button, then a screen-by-screen spec for the Battle Stage Editor and a map for the tools after it. Written 2026-10-02 during step 1 of the Phaser tooling spike (`docs/spikes/phaser-stage.md`); section 3 is the spec for that spike's steps 2 to 4. Section 6, added the same day, covers the two jobs RPG Maker has no tool for (battle stages with depth, moves built frame by frame) and what we take from the brawler and fighting-game engines that did build them.

Mark's direction (2026-10-02): "As far as UI design for our tooling, take as much inspiration as you can from engines like rpg maker. Whenever functionality overlaps and it makes sense." RPG Maker's editors have been through many versions doing the same jobs our tools do, so this guide starts from their patterns and says plainly where we go our own way.

**How to read the sources.** RPG Maker facts come from the official MZ help, abbreviated as links like [MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html). The research was done through a page-summarising fetcher, so wording is paraphrased and no screenshots were taken. Anything marked (inferred) is a reading of the sources or a recommendation, not a documented fact. Claims about our own tools come from the source files named beside them.

---

## 1. Principles

1. **Borrow RPG Maker where the job overlaps.** Its Database (tabs, a list on the left, a form on the right), its Troops tab (a placement view plus a Battle Test button) and its animation timing lists are the starting point for our equivalents ([MZ Database](https://rpgmakerofficial.com/product/MZ_help-en/01_08.html), [MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html)). Use RPG Maker's names for the same ideas (troop, battleback, battle test, playtest, database, align) so anything Mark reads about RPG Maker transfers directly.
2. **Where RPG Maker is weak, borrow from the tool that does that job best.** Tiled for placing objects and typed properties, Aseprite for the animation timeline, Godot for the inspector and snapping (section 4 and the research links there). For the two jobs RPG Maker doesn't do at all, depth on a battle floor and moves assembled from single frames, the models come from OpenBOR, MUGEN and their descendants (section 6).
3. **Differ on purpose, and write the reason down.** The deliberate differences so far:

| RPG Maker does | We do | Why |
|---|---|---|
| Actor battle positions are a code constant; plugins expose them as numbers or a formula ([VisuStella Battle Core](https://www.yanfly.moe/wiki/Battle_Core_VisuStella_MZ)) | Heroes, enemies, horizon, floor, depth rows and HUD regions are all dragged on the real stage | Mark is making taste calls; direct manipulation is the whole point of the spike |
| Entries are numbered slots with a fixed list size and a Change Maximum button ([MZ Database](https://rpgmakerofficial.com/product/MZ_help-en/01_08.html)) | Entries have named ids (`street`, `glowrat`) and lists grow with New and shrink with Delete | Readable references and small, clear diffs in the JSON files (inferred; Mark's call if he wants numbers) |
| Enemy positions live on the troop | Positions live on the stage (slot sets per enemy count); a troop picks who stands there and may override a slot | One stage serves many fights, and the stage editor can be finished before the troop editor exists |
| Undo goes back 20 steps ([MZ menus](https://rpgmakerofficial.com/product/MZ_help-en/01_04.html)) | Undo goes back 100 steps, with redo | Matches the animation editor's existing 100-step stack (`src/dev/rigedit.ts`); memory is cheap |
| Battle test needs the project saved before plugin settings apply ([MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html)) | Battle test runs on the unsaved edits in the page | The spike's target is save-to-test in under a minute; testing before saving is faster still |
| Actor and troop positions are free numbers or drags on a flat picture | The Battle Stage Editor puts the party and the enemy groups on depth rows, with a Rows snap that can be turned off (then a small `dy` nudge up to 8 px) and a per-slot forward / back draw-order override | Depth is the point of the stage; the nudge and the override keep the exceptions possible without free z values |
| Plugin layouts switch wholesale, per troop through a note tag | The HUD is ONE global layout for every battle (`src/data/hud.json`); a stage may override single boxes, and only the fields that differ are stored in `stages.json` (3.6). Inside the global layout, which boxes were moved by hand is worked out by comparing with the preset (`src/stage/hudpresets.ts`), and switching the preset keeps the moved boxes (the status line says which) | Mark's call (2026-10-03): one HUD everywhere, because a battle's menu should not change from place to place; the override exists for the odd stage (a big boss covers a box). No second data structure to keep in step, and hand work is never thrown away silently; "Clear all moved values" discards it on purpose |
| The enemy list beside the placement view is saved with the troop | The palette's "who is standing here" is a browser-only preview (`localStorage`), never written to `stages.json` | The stage stores places, not people (3.3) |
| One toolbar | Two rows: the file and test buttons (Undo, Redo, Save, Revert, Battle Test, Keys, Help, in that order) on the right of the title row, and the VIEW controls (mode, enemy count, moment of the turn, snaps, overlays, JSON) on the second. Properties of the stage, the HUD or the selection are never in the toolbar, only in the inspector (3.2) | There are too many controls for one row at 1100 px, the file buttons stay in the same corner in every tool, and Mark found the same control in two places confusing (2026-10-03) |
| Align re-lays a troop evenly in entry order (RPG Maker) | **Align** is the design-tool kind: line the selection up, left / centre / right and back / middle / front; the troop-style re-lay is the button **Lay out evenly** (3.8) | Mark asked for one-click alignment as in Figma; two buttons called Align would be a trap |
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
- **Drag** moves the selection. The inspector updates live, and the drag is one undo step when the mouse is released. **Hold Shift while dragging** to lock the move to sideways or up and down, whichever way the pointer has travelled further (Figma's rule; for fighters, slots, handles and HUD boxes). Press Shift before the drag and a press on something not yet selected also adds it to the selection, as Shift+click does.
- **Sliders in the inspector** update the stage while the thumb is dragged, and letting go is the one undo step (the stage is the real scene, so the change is visible as it happens).
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
| Lock a drag to one direction | Hold Shift while dragging | | Figma's rule (3 in 2.3) |
| Align the selection | Alt+A left, Alt+H centre, Alt+D right; Alt+W back (HUD box: top), Alt+V middle, Alt+S front (HUD box: bottom); Alt+Shift+H and Alt+Shift+V spread three or more evenly | none found | Figma's letters, on Alt so they avoid F5, Ctrl+R, F12 and every key above |
| Help | ? | | Opens "what is a stage?" (3.0) |
| Grid snap on/off | G | | Hold Ctrl while dragging to flip snapping for that drag |
| Lock selection | Ctrl+L | | Godot's lock key |
| Bring forward / send back | Ctrl+] / Ctrl+[ | | Stage editor, within a row only (3.4); Tiled raises and lowers objects in manual draw order with Page Up and Page Down ([Tiled draw order](https://discourse.mapeditor.org/t/objectgroup-rendering-order/1586)), but those keys step the list here, so (inferred) the common design-tool brackets |
| Show HUD regions | H | | Overlay only; never changes data. Other overlays are toolbar toggles |
| Open the DEV menu | ` (backtick) | | On the game page only (`src/dev/devmenu.ts`) |
| Turn the character | [ and ] | | Animation editor only (`rigedit.ts`) |
| Database (when it exists) | F9 is taken by the debug panel, so the Database opens from the DEV menu | In MZ, F9 opens the Debug Screen during playtest ([MZ help](https://rpgmakerofficial.com/product/MZ_help-en/01_05.html)); the Database opens from the toolbar or Tools > Database ([MZ Database](https://rpgmakerofficial.com/product/MZ_help-en/01_08.html)) | (inferred) avoid one key meaning two things |

Every tool shows its keys on a "Keys" button in the toolbar, and the same table drives both the handler and that list (proposed `src/tools/keys.ts`).

---

## 3. Battle Stage Editor

What it edits: one entry of `src/data/stages.json` per stage (today `street` and `sewer`, in the final side-view design: a backdrop with its horizon, a painted floor, five depth rows, four party slots, enemy slot sets for 1 to 6 enemies and for a boss with 0 to 2 helpers, shadow, depth haze, sort rule and the HUD regions; the schema is `StageConfig` in `src/stage/config.ts`, the design is `docs/spikes/side-battle-stage.md` section 4). The rows no longer carry tints (the haze is one `depthTint` block), and enemy size is not stage data (it belongs to the enemy's art). Where it runs: the stage lab page (`/stagelab.html`, `src/stage/`) with edit mode switched on. Its RPG Maker counterpart is the Troops tab's placement view plus Battle Test ([MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html)), which only lets you drag enemies. RPG Maker has no model for depth on the floor at all, so the depth rules in 3.4 come from brawler engines and general 2D sorting instead (section 6.1).

### 3.0 What a stage is (orientation)

Mark asked (2026-10-03) whether the settings here are for all battles or one, and what a stage is for. The editor says it in the tool (a "?" button in the top bar, a link under the stage list, and the `?` key all open the same short panel); this is the same text:

- **A stage is one battleground**: the street, the sewer. It holds the backdrop picture, the horizon and the floor, the depth rows, where the heroes stand, and where the enemies stand for each enemy count from 1 to 6 and for a boss. RPG Maker calls the picture a battleback and the list of enemies a troop.
- **Every fight at that place uses the stage.** A map names the battleground for each area with `bg` (the Sinkline's fights use `sewer`). So a setting on a stage applies to every fight there, not to one fight.
- **Who fights is not part of a stage.** That is the encounter (RPG Maker: a troop), and a troop editor will come later (4.1). The **Enemies** buttons in the top bar only pick which enemy count to look at; it is a preview.
- **The HUD is global.** One layout for every battle on every stage (`src/data/hud.json`). A stage can override single boxes (3.6).
- **What is live today:** only this editor and Battle Test read stages. The shipped game will read them after a go-ahead.

### 3.1 What we can do that RPG Maker can't

- **Drag the heroes.** MZ places side-view actors by a formula in the core script, roughly (600 + 32i, 280 + 48i) for actor i (inferred: recalled from the core script, not confirmed online), and changing it takes a plugin such as [Reposition Sideview Actors](https://neirn.itch.io/mz-reposition-sideview-actors) or VisuStella's `ActorHomePosJS` formula ([VisuStella Battle Core](https://www.yanfly.moe/wiki/Battle_Core_VisuStella_MZ)).
- **Depth rows.** MZ's placement view is free drag on a flat picture; ours snaps fighters to rows, and overlap order and floor shadows follow automatically (`depthFor` in `src/stage/stagescene.ts`).
- **Horizon and floor handles.** MZ crops a fixed 1000×740 battleback, the upper part in front view and the lower part in side view ([MZ battlebacks](https://rpgmakerofficial.com/product/MZ_help-en/01_11_01.html)); ours lets Mark move the horizon and floor lines and see where people can stand.
- **Drag the HUD.** VisuStella exposes window offsets and sizes as numbers ([Sideview Battle UI](https://www.yanfly.moe/wiki/Sideview_Battle_UI_VisuStella_MZ)); ours drags them on the stage.
- **Test the unsaved stage.** See the table under principle 3.

### 3.2 Toolbar

**The rule (Mark, 2026-10-03): the top bar holds VIEW choices; the inspector holds PROPERTIES.** A view choice changes what you look at and is never saved with the data: the enemy count to preview, the moment of the turn, the snaps, the overlays, Battle Test, Save. A property is a value of the thing you selected, or of the stage and the HUD when nothing is: it is saved. A control lives in one of the two, never both.

In order: stage name (read-only, the list chooses), **Edit / Play** toggle, **Enemies: 1 2 3 4 5 6 B B+1 B+2** (which enemy count is shown and edited; the only place this is chosen), **Moment** (Choose, Aim, Act), snap toggles (**Rows**, **Grid**), show toggles (**HUD**, **Guides**, **Safe zones**, **Anchors**), **JSON** (the text view, 3.4), **Undo**, **Redo**, **Save**, **Revert**, **Battle Test**, **Keys**, **?** (help, 3.0).

Taken out in round 1 of Mark's notes (2026-10-03): the **HUD preset** picker (it is the inspector's, 3.7), the **Enemies shown** picker in the inspector (it is the top bar's), the **Camera** toggle (3.4), the dead **Foreground** toggle (no stage has a foreground layer to show; it returns with one, and the inspector's Battleback group already says "none"), and the read-only **Floor top** line (it is always the horizon). Every toolbar button whose effect is not obvious carries a hover tip (a `data-tip`, the same bubble as the inspector's "?").

### 3.3 Left: stage list and palette

- **Stage list**: every stage in `stages.json` by id and name, with New (from a blank template with the default rows), Duplicate, Rename, Delete and the right-click menu from 2.4. Delete is refused while a troop or map uses the stage (once troops exist).
- **Explorer panel, "Who's standing here"** (the palette): it takes the rest of the left panel's height under the stage list and scrolls inside itself, as Figma's layers panel does. The four heroes and the enemy list from `src/data/enemies.ts`. These choose who fills the slots *for the preview only*; the stage stores places, not people. Double-click or drag an enemy onto a slot to preview it there. This mirrors the Troops tab's enemy list, whose background picker is likewise editor-only and shared across the database ([MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html)); our preview choice is remembered per browser in `localStorage` and shared with the troop editor later.

### 3.4 Centre: the stage view

**The depth model the handles edit.** The floor is a band of screen rows, not a 3D space. OpenBOR, the long-running open-source brawler engine, stores it the same way, and it is the closest working precedent for Mark's "different Z-axis values" (section 6.1):

- **Three ground numbers, kept apart.** The floor band (`floor.y0`, `floor.y1`) is OpenBOR's walkable `z zmin zmax`, two pixel distances from the top of the stage image; the horizon (`backdrop.horizonY`) is where the backdrop's wall meets its floor, which OpenBOR handles with an optional third number for where the background bottoms out ([Z vs. Panel Interaction](https://chronocrash.com/forum/threads/z-vs-panel-interaction.8250/latest)). In the final design the floor is painted by the stage, so its top IS the horizon (`floor.y0` equals `backdrop.horizonY`; the handle moves both, and for a reprojected backdrop `shiftY` follows), while the bottom `floor.y1` stays a separate number. The validator refuses a floor that does not start on the horizon and a row outside the floor (`src/stage/config.ts`), and `checkLayout` warns about a horizon outside 92 to 112.
- **Depth is the row.** A slot is a row and an x, with no free z value of its own. Rows run back to front with rising foot y, and a fighter's feet always land on its row's line, clamped into the band (`slotPoint` in `src/stage/config.ts`).
- **One sort key, taken at the feet.** Draw order is `depthFor(y, x)` in `src/stage/config.ts`: the nearer foot y draws on top and ties go to the right. Godot, Unity and Tiled all sort by y this way, and the Godot and Unity sources both stress that the sort point must be the feet, not the picture's centre, or the order comes out wrong ([KidsCanCode Y-sort](https://kidscancode.org/godot_recipes/4.x/2d/using_ysort/index.html), [Unity 2D sorting](https://docs.unity3d.com/2023.1/Documentation/Manual/2DSorting.html)). Our feet come from each sprite's foot anchor (`src/stage/feet.ts`). No fighter gets a separate z-index, so nothing can fight the sort; a Godot pitfall is exactly a z-index overriding y-sort ([bugnet.io](https://bugnet.io/blog/how-to-fix-godot-ysort-feet-sorting-with-wrong-origin)).
- **A forward and back override (proposed `order` on a slot: -1, 0 or 1).** Two fighters on one row occasionally overlap the wrong way round. Bring forward or send back fixes that pair, like Tiled's manual draw order ([Tiled draw order](https://discourse.mapeditor.org/t/objectgroup-rendering-order/1586)). It folds into `depthFor` as less than one row's worth, so it can never lift a back-row fighter over a front-row one (inferred design).
- **A figure sorts as one unit.** Body, weapon, smear and shadow share the figure's key, offset by fractions (the shadow already sits at `depth - 0.5`), the way a Unity Sorting Group keeps a multi-part figure together ([Unity 2D sorting](https://docs.unity3d.com/2023.1/Documentation/Manual/2DSorting.html)).
- **Shadow rules.** The contact shadow is a flat ellipse centred on the foot anchor, sized by the stage's `shadow` setting. Proposed: an optional per-row `shadow` override (scale and alpha) next to the existing per-row tint, so rear rows can carry smaller, lighter shadows. When a figure leaves the floor (a lunge hop, a knockback), its shadow stays at floor height and follows only x and depth, as OpenBOR's grounded shadow kinds do ([OpenBOR shadows](https://chronocrash.com/obor/wiki/shadows/)); it doesn't shrink with height for now (inferred, keep it simple).

The real `StageScene`, drawn exactly as in battle, carries these handles over it in edit mode only:

| Handle | Looks like | Drag does | Data |
|---|---|---|---|
| Horizon | Cyan dashed line across the stage, labelled "Horizon 100" | Moves up and down, repainting the floor; rows can't go above it | `backdrop.horizonY`, `floor.y0`, `backdrop.shiftY` |
| Floor bottom | Green line with a grip at the left end | Moves the lowest row people may stand on | `floor.y1` |
| Depth rows | Thin white lines numbered 1 (back) to 4 (front), with the row tint as a swatch | Moves a row's foot height; fighters on it move with it | `rows[].y`, `rows[].tint` |
| Party slots | The hero sprite itself, with an orange badge "P1" to "P4" at the feet | Left and right moves x; up and down jumps between rows | `party[]` (`row`, `x`) |
| Enemy slots | The preview enemy, with a pink badge "E1" to "En" | As above, for the formation chosen in the toolbar | `enemies["n"][]` |
| HUD regions | Yellow outlined boxes with their name, shown with **H** | Moves the box; corner grips resize it if the region allows | HUD layout (3.6) |
| Foot anchor | A small crosshair at the selected figure's feet, shown with **Anchors** | Moves the point this sprite stands on; the figure shifts so the new point lands on its row | Per-sprite axis (proposed `src/data/axes.json`), the same record the Animation Composer edits (4.2) |
| Draw order | A "+1" or "-1" mark beside the slot badge, only when overridden | **Ctrl+]** brings forward, **Ctrl+[** sends back, within the row | `party[].order`, `enemies["n"][].order` (proposed) |

- **Safe zones overlay** tints the HUD's regions red where a fighter overlaps one, because menus cover whatever is under them (see "Safe zones for battle windows" in `docs/CONCEPTS.md`).
- **Guides**: the 480×270 frame, the centre line and the line where the party and the enemies meet. Dragged guides (Godot's rulers) can come later.
- **Camera overlay: removed (2026-10-03).** It outlined the 480×270 area the battle camera shows. The battle camera never moves, so the outline only repeated the edge of the screen (the Guides overlay already draws that frame), and Mark could not tell what it was for. It can come back, as the OpenBOR community editor's red camera box ([Chronocrash Modders Tools](https://www.chronocrash.com/forum/resources/chronocrash-modders-tools.139/)), if a move ever pans or pushes the camera.
- **Foot anchors matter most for Sprite Fusion art.** The crew's stills come in different canvas sizes, and a measured foot that is a pixel off puts the whole figure a pixel off its row. With **Anchors** on, every figure shows its crosshair; an overridden anchor is drawn in white and a measured one in grey, matching the inspector's override colours (3.6).
- **Align and spread** (3.7 has the bar). **One thing selected** lines up with the stage: a hero or an enemy with the edge, centre or other edge of its own half (heroes cannot cross the middle line, enemies cannot either), or with the back row, the row nearest the middle of the floor band, or the front row (a depth row is the only place to stand, so a vertical align always lands on a valid row and clears the small `dy` nudge); a HUD box with the screen. **Two or more selected** line up with each other, by their drawn edges for fighters and by their boxes for the HUD; with three or more they can also be spread with equal gaps. Back means the higher rows on the screen (row 1), front the lower ones. One click is one undo step.
- **Snapping on the stage.** Fighters always sit on a row, so up and down move them a whole row. Horizon, floor and row lines move in whole pixels and snap to the 8 px grid when **Grid** is on. The handles refuse to make a stage the validator would reject: a row stops at its neighbours and at the floor band's edges, and the floor bottom stops under the last row. Foot anchors ignore the grid and move 1 px at a time, since they are a fine correction.
- **Text view.** **JSON** opens a read-only pane beside the stage showing the entry as it will be saved, with the lines the last gesture changed highlighted, so Mark can see exactly what a drag did. OpenBOR's community editor switches between a text view and a visual view of the same level for the same reason ([Chronocrash Modders Tools](https://www.chronocrash.com/forum/resources/chronocrash-modders-tools.139/)).
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

Each layer also carries a parallax ratio (proposed `parallax`, default 1), after OpenBOR's background and foreground layers, which take separate x and z ratios ([fglayer syntax thread](https://www.chronocrash.com/forum/threads/fglayer.1803/latest)). With today's fixed camera every ratio behaves the same and nothing changes on screen. It starts to matter when a move pans or pushes the camera: the wall should drift less than the floor, and the foreground rails more (inferred).

### 3.6 HUD layout presets and regions

VisuStella offers named battle layouts (default, list, xp, portrait, border) that a troop can switch with a note tag ([VisuStella Battle Core](https://www.yanfly.moe/wiki/Battle_Core_VisuStella_MZ)), and RPG Developer Bakin keeps several screen layouts per scene that events switch between ([Bakin](https://rpgbakin.com/en/about/)). We chose the simplest shape that still lets one stage differ (Mark, 2026-10-03):

- **One HUD layout for every battle.** `src/data/hud.json` is `{ "version": 1, "layout": { ... } }`: a preset (`timeline-bottom3`, `ff-strip`, `action-left`, `ps4-panels`) plus the regions (turn order, commands, party status, enemy info, skill banner, combo counter), each with x, y, width, height, when it shows and its opacity, and the finer settings (chip sizes, row heights, limits). Nothing here depends on the stage. With nothing selected the inspector's **HUD layout** group edits it, and dragging a HUD box on any stage moves that box in this file, so the move shows in every battle (the status line says "for every battle"). The checker is `checkHudFile` and the loader `loadHud` (`src/stage/config.ts`); the dev server saves the file through its own endpoint, `/__stage/hud` (3.10), so stage saves and HUD saves never share a request.
- **A stage may override single boxes, and only when it needs to** (a big boss covers a box). Select the box and turn on **Different on this stage**: from then on the box is edited on that stage only, and the stage keeps just the fields that differ in `stages.json` under `hud` (`{ "commands": { "x": 60 } }`). A stage with no override carries no `hud` at all; the saved file never holds a field equal to the global one (`settleData` tidies this before every save). The inspector lists a stage's overrides in white with a revert arrow back to the all-battles value, the overlay puts a dot after the name of an overridden box, and turning the switch off sends the box back to the global layout. That is Tiled's template model ([Tiled templates](https://doc.mapeditor.org/en/stable/manual/using-templates/)) plus the per-field revert Tiled lacks (it is a planned feature there) and Godot has ([Godot inspector](https://docs.godotengine.org/en/stable/tutorials/editor/inspector_dock.html)). The unit tests are in `tests/stagehud.test.ts`.
- **What the game reads:** `loadStages(stages, backdrops, known, hud)` lays each stage's overrides over the global layout (`resolveStage`) and hands the scene, the HUD widgets, Battle Test and the stage lab a stage with a full `hud`, as before. A merged box that would leave the screen is refused by the checker.
- **The bottom band (HUD polish round 1).** Boxes that sit side by side on one row (the party table, the command strip and the enemy box in every preset but the PS4 one) are framed as one window with a divider in each gap, and a box set to "never" or dragged off the row leaves the band. Each box keeps its own x, y, w and h, so dragging, resizing and the revert arrows work as before; only the frame behind them is shared (`bandPlans` in `src/stage/hudlayout.ts`).

### 3.7 Inspector

With nothing selected, the inspector shows the stage:

| Section | Fields |
|---|---|
| Basics | Name; id (read-only, change it with Rename); Note for Claude |
| Battleback | Wall, Floor, Foreground and Ambient pickers, each with a thumbnail and a parallax ratio |
| Ground | Horizon; Floor top; Floor bottom |
| Depth rows | One line per row: foot height, tint swatch, shadow scale and alpha (blank inherits Shadows); Add row, Remove row (refused while a slot uses it) |
| Shadows | Width, ratio (how flat), alpha: the default every row starts from |
| HUD layout · all battles | The preset (global); the values moved by hand, with revert arrows; and under "This stage" the boxes this stage overrides, with revert arrows back to the all-battles value |
| Enemy positions | The group shown (chosen with Enemies in the top bar), **Lay out evenly**, **Copy from n−1**, Reset preview (3.8) |

With a slot selected: an **Align** bar (below), which slot ("Party 2", "Enemy 3 of 3"), row (a dropdown of rows), x (slider plus number box), the resulting foot y (read-only, from the row), draw order (Auto, Forward or Back) and the foot anchor of the sprite standing there (measured or overridden, with a revert arrow back to the measurement). With a HUD region selected: the Align bar, its name, **Different on this stage**, x, y, width, height, visibility and opacity.

**The Align bar** sits at the top of the inspector whenever fighters or HUD boxes are selected: **Left, Centre, Right** and **Back, Middle, Front** (a HUD box: **Top, Middle, Bottom**), and with three or more selected **Spread across** and **Spread rows** (a HUD box: **Spread down**). Each button shows its Alt key in its hover text (2.6). Rules are in 3.4.

**Plain words and "?" tips (Mark, 2026-10-03).** Every setting whose meaning or visual effect is not obvious carries a small "?" beside its label (and so does each group title). Resting the pointer on it, or focusing it with the keyboard, opens one bubble that says what the setting is and what you will see change, in short plain sentences for a beginner (the `tip` helper in `src/stage/edit/dom.ts`; one bubble for the page, placed with `position: fixed` so a scrolling panel cannot cut it off). The most opaque labels were renamed: "Width share" is **Shadow width**, "How flat" is **Flatness**, "Strength" is **Darkness**, "haze" is **Distance haze**, "Smallest" and "Largest" kept their words but gained tips, "Mode" is **How it is placed**, "Ambient" is **Weather**. The data key stays beside every label in small monospace, as above. The floor's puddles, far fade and neon glow, which were not editable before, are in a **Floor look** group so their tips have something to explain.

Every field follows the house pattern: a slider paired with a number box for numbers, a plain-language label with the data name beside it in monospace, and a revert arrow when the value differs from the default or the inherited one ([Godot inspector](https://docs.godotengine.org/en/stable/tutorials/editor/inspector_dock.html)). The spike plan mentions Tweakpane for number fields (`docs/spikes/phaser-stage.md`); it is fine for step 2 if wrapped so the revert arrow, override colours and notes field still appear (inferred).

### 3.8 Formations: slot sets by enemy count

`stages.json` already keeps a slot set for each enemy count (`"1"` to `"6"`, `"boss"`, `"boss+1"`, `"boss+2"`), so a fight with three enemies looks composed rather than squeezed. The toolbar's **Enemies** buttons pick which set is shown and edited (they are the only place; the inspector's Enemy positions group says which one is showing).

- **Lay out evenly** re-lays the shown set evenly: enemies spread across the rows from front to back and across the right half of the stage, like MZ's Align button, which re-lays a troop left to right in entry order ([MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html)). It is one undo step, so it is safe to try. It was called Align until the design-tool Align bar (3.7) arrived and the two names clashed.
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
- **Built (P4-battle, rounds 1 and 2):** the dialog has an "Edited · unsaved" or "Saved" badge (the fight always uses the stage as it is on screen), the party tabs, the Status readout (the game's stat code), a **troop picker** over the stage's own enemy groups ("3", "boss+1"... with the enemies in each; the chips follow it, and the last group used on a stage is remembered), **Test one move** (pick a hero's Attack or any skill: that hero uses it every round, the others guard, and the fight plays itself, so a designer can watch one move without a menu turn), full resources, auto-play, 1x/2x speed and a seed, remembered per browser. In the fight the arrows choose, Enter confirms, Backspace steps back, **A** toggles auto-play, **Esc** leaves. Summons draw the new enemies and boss phase changes swap the picture. The dialog says plainly that it is a partial test: no timed-press ring (every action resolves with timing "none"), and Combo, Item and Run are stubbed. Not built: per-slot equipment pickers and the F9 debug panel. Moves are `src/data/moves.json` (4.2), played by `src/stage/perform.ts`.
- The last choices are remembered per browser so the second test is one keypress.
- Exit criterion this serves: save-to-battle-test in under a minute (`docs/spikes/phaser-stage.md`).

### 3.10 Saving

A Vite dev plugin at `/__stage/stages` (proposed name) following 2.5: `GET` returns the file, `POST` validates the whole file with `src/stage/config.ts` and writes `src/data/stages.json` (and `axes.json`), replying `{ ok, problems: [] }`. The one global HUD layout has its own endpoint, `/__stage/hud`, with the same contract: `GET` returns `hud.json`, `POST` takes `{ layout }`, checks it with `checkHudFile` (the check the game's loader uses) and writes `src/data/hud.json` in the stable format. **Save (Ctrl+S) writes only the files that changed**, checks all three first as the game will see them (a stage's HUD overrides laid over the layout must still fit the screen), and says which file did not go if one fails, leaving that part unsaved. The running page reloads the saved stage through the same loader the game uses, which is the spike's "load the saved stage back" check. The DEV menu entry in `src/dev/tools.ts` changes from "Stage lab (Phaser spike)" to "Battle Stage Editor" with a one-line purpose and the file it writes.

---

## 4. Future tools

Each tool gets the standard layout from section 2. The table maps it to its RPG Maker counterpart and the best outside pattern; the notes below say what to take from each.

| Tool | RPG Maker counterpart | Best outside pattern |
|---|---|---|
| Troop and encounter editor | Troops tab and battle event pages; map encounter list ([MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html), [MZ maps](https://rpgmakerofficial.com/product/MZ_help-en/01_07.html)) | Tiled templates and object references ([templates](https://doc.mapeditor.org/en/stable/manual/using-templates/), [objects](https://doc.mapeditor.org/en/stable/manual/objects/)) |
| Animation Composer | Animations tab timing rows; MV cell animation; the official 2D Animation Editor ([MZ Animations](https://rpgmakerofficial.com/product/MZ_help-en/01_08_09.html), [MV Animations](https://rpgmakerofficial.com/product/MV_Help/page/01_08_09.html), [2D Animation Editor](https://store.rpgmakerofficial.com/products/2d-animation-editor-mz)) | MUGEN's AIR frame list and per-sprite axis, OpenBOR's per-frame movement, Spine events (section 6.2); Aseprite timeline, tags, onion skin and slices; Godot call tracks ([Aseprite timeline](https://www.aseprite.org/docs/timeline/), [Godot track types](https://docs.godotengine.org/en/stable/tutorials/animation/animation_track_types.html)) |
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

What it edits: one move per entry (proposed `src/data/moves.json`), such as Rook's strike or Kit's three-blow combo, assembled from hand-picked Sprite Fusion stills. RPG Maker has nothing that does this job (section 6.2). The record below is MUGEN's AIR frame line with a Spine-style event lane added, and the screen borrows Aseprite's timeline.

**The frame record.** Each column of the timeline is one frame:

| Field | What it holds | Precedent |
|---|---|---|
| `still` | Which Sprite Fusion picture, by file | AIR's group and image numbers into the sprite file ([Elecbyte AIR docs](https://elecbyte.com/mugendocs/air.html)) |
| axis | The still's stand-on point, stored once per still rather than per frame | MUGEN's per-sprite axis ([AIR docs](https://elecbyte.com/mugendocs/air.html)) |
| `offset` | A small x, y shift for this frame only, measured from the axis | AIR's x, y ([AIR docs](https://elecbyte.com/mugendocs/air.html)) |
| `hold` | How long the frame shows, in ticks; `-1` on the last frame holds until the battle releases it | AIR's time and its `-1` ([AIR docs](https://elecbyte.com/mugendocs/air.html)) |
| `flip` | Mirror, rarely needed (see "Facing and mirroring" in `docs/CONCEPTS.md`) | AIR's `H`/`V` |
| `move` | dx and dz of the fighter on this frame, for a lunge | OpenBOR's `move` and `movez` ([OpenBOR animations](https://chronocrash.com/obor/wiki/animations-overview/)) |
| events | Named cues on this frame: `hit`, `smear`, `fx`, `sfx`, `shake`, `flash` | Spine events, with int, float and string payloads ([Spine events](https://esotericsoftware.com/spine-events)) |

- **Frames of different sizes, lined up by the axis crosshair.** Every still keeps its own canvas; Rook's overhead wind-up is 69x110 and his low follow-through 101x66, and neither gets padded or re-cut. At playback each still is drawn so its axis lands on the fighter's ground point plus that frame's offset, which gives both frames one ground point and stops the body jumping between them. MUGEN works this way, and the community's way of aligning mixed-size sheets is a stored axis per sprite at the feet or body, never the image centre ([ChronoCrash conversion thread](https://www.chronocrash.com/forum/threads/converting-mugen-chars-to-openbor.1074/page-2), [Makko](https://blog.makko.ai/sprite-animation-alignment-anchor-points-scale-and-using-characters-in-multiple-games/)). OpenBOR shows the cost of the alternative: one offset per animation needs pre-aligned canvases, and its wiki warns that mismatched ones make entities "shake or slide" ([OpenBOR Animation Overview](https://chronocrash.com/openbor/wiki/index.php/Animation_Overview)).
- **Editing the axis.** On the canvas the axis is a crosshair on the selected still: drag it, or nudge it with the arrows (1 px, Shift for 8). A toolbar toggle, **Axis / Offset**, picks which of the two the arrows move. The axis starts at the foot `src/stage/feet.ts` measures, or bottom-centre when none is found. For a lunge Mark can move it to the planted foot instead (see "Anchoring by the planted foot" in `docs/CONCEPTS.md`; `SF_ANCHORS` in `src/art/rig2/sfstrike.ts` is the hand-coded version). Because the axis belongs to the still, fixing it once fixes every move that uses that picture, and the stage editor's foot-anchor handle (3.4) edits the same record. Axis and offset moves go through the shared 100-step undo (2.5).
- **Holds in ticks.** Holds are whole ticks at 60 per second, drawn as cell width and labelled with milliseconds beside them ("4 ticks, 67 ms"). MUGEN counts the same 60 Hz ticks ([AIR docs](https://elecbyte.com/mugendocs/air.html)); OpenBOR's centisecond default needed hand-tuning when moves were carried between the two ([ChronoCrash conversion thread](https://www.chronocrash.com/forum/threads/converting-mugen-chars-to-openbor.1074/page-2)), which is the argument for one unit everywhere. The battle's own pose clock runs at a different pace (see "Pose frames are not 60 fps frames" in `docs/CONCEPTS.md`), so the conversion happens once, where the battle loads a move, and never inside a move (inferred).
- **Timeline and lanes.** Rows above are frame layers, usually just the body, with weapon and effect layers when a move needs them, as in Aseprite's cels ([Aseprite cels](https://www.aseprite.org/docs/cel/)). Below sit fixed lanes: **Move** (the lunge), **Effects** (smear, hit spark, GPU hit), **Sound**, and **Events** (hit, shake, flash). RPG Maker's official 2D Animation Editor add-on has frame, cell, sound and flash tracks ([2D Animation Editor](https://store.rpgmakerofficial.com/products/2d-animation-editor-mz)), and MZ's own Animations tab lists sound and flash timings around an Effekseer effect ([MZ Animations](https://rpgmakerofficial.com/product/MZ_help-en/01_08_09.html)). The Move lane and the hit marker are what neither of those has.
- **The hit frame.** A `hit` event marks the exact tick the blow lands. It carries the hitstop (attacker freeze ticks and target shake ticks, MUGEN's `pausetime` on its HitDef, [MUGEN state controllers](https://elecbyte.com/mugendocs/sctrls.html)), a contact point measured from the axis where sparks spawn, and a reach in depth rows, so a blow can't land on a target several rows away. That reach is IKEMEN GO's `attack.depth` idea reduced to a row count ([Character features](https://github.com/ikemen-engine/Ikemen-GO/wiki/Character-features)). Kit's combo has three `hit` events; the damage still resolves once (see "Combo of blows from one action" in `docs/CONCEPTS.md`). Hitstop appears on the timeline as a hatched gap after its hit, so Mark sees the real time it adds.
- **Startup, active and recovery.** Above the strip, a bar splits the move into startup (ticks before the first hit), active (the hit frames) and recovery (after the last), with the total in ticks and milliseconds. These are fighting-game frame-data terms ([Dustloop](https://dustloop.com/w/Using_Frame_Data)). The bar is computed from the frames and the hit events and never typed in (inferred; no source showed how any editor displays this, section 6.2). In a turn-based fight it answers two questions at a glance: how long until the blow lands, and how long until the attacker is home.
- **Effects are spawned, not drawn into stills.** A smear, a hit spark or the GPU hit is an event at a tick with an offset from the axis or from the contact point, and the effect is its own object with its own depth. OpenBOR spawns its hit flash as a separate model at the contact point in the same way ([OpenBOR Hit Effects](https://chronocrash.com/openbor/wiki/index.php/Hit_Effects)). The picker offers the code swipes (`drawSwipe` in `src/art/rig2/sfstrike.ts`) and FX lab presets (`src/data/fx.json`).
- **Contact, swerve and flash (built, P4-battle round 2).** A `hit` event of a move that shows drawn pictures must carry `contact` {dx, dy}: where the weapon IS on that tick, from the attacker's feet (Rook's blade tip is 58 forward and 5 up). The lunge is computed FROM it: the attacker stops where that point is `pierce` pixels inside the target's SILHOUETTE at that height (`src/stage/contact.ts` reads the target's own pixels, so a tall boss's shoulder pod is not mistaken for its leg), and the spark, cut and floating number appear on the same point. A frame's `move` also has `sw`, a fraction of the SWERVE (the distance down the stage that takes the fighter clear in front of its side-mates, measured from where they stand): the lunge runs out along the front lane, closes onto the target's row on the swing, and goes home the same way, so it passes in front of the crew and not through them. `flash` on a frame or a hit is a strength from 0 to 1 (a jab flashes less than a finisher; the flash steps down during the hitstop) and `tint` is a red wash for a hero who is hit. A binding may say `targetBelow` (a height in pixels) so a short target gets a crouching variant. `$down` is the still for a knocked-out hero: until real art exists the stage cuts a kneel out of the hero's own idle (`src/stage/kneel.ts`).
- **Lunge path.** The Move lane holds dx and dz per frame, and the canvas draws the path as one dot per tick from the start slot to the contact, flagging the largest step (see "Constant-rate dash" in `docs/CONCEPTS.md`). A dz lets the attacker change depth row on the way, for instance onto the lane in front of an ally ("Attack lane and depth cue"). Move stays separate from offset: the shadow and the contact point travel with the fighter, while an offset only shifts the picture.
- **Onion skin and ground guides**: previous and next frames tinted under the current one, toggled with F3 as in Aseprite ([Aseprite onion skinning](https://www.aseprite.org/docs/onion-skinning/)), plus the floor line and the shadow ellipse at the ground point, so a planted foot can be checked against the ground across frames.
- **Tags**: named frame ranges (idle, wind-up, strike, recover) with a direction: forward, reverse or ping-pong ([Aseprite tags](https://www.aseprite.org/docs/tags/)). MZ's sheet convention fits inside this: three frames per motion, looping 1-2-3-2 (ping-pong) or once 1-2-3 (forward) ([MZ sprite sheets](https://rpgmakerofficial.com/product/MZ_help-en/01_11_02.html)).
- **Preview**: Play (looping), Step (one tick forward or back) and Play at battle speed, all in the composer's canvas. Preview fires the visual events (flash, shake, hitstop, sound, effects) and never applies damage; Godot's editor preview skips call-track events for the same reason ([Godot track types](https://docs.godotengine.org/en/stable/tutorials/animation/animation_track_types.html)).
- **Bulk tools** from MV's editor: copy cells between frames, shift a range, tween between two frames ([MV Animations](https://rpgmakerofficial.com/product/MV_Help/page/01_08_09.html)).
- **Test button**: "Play in battle" runs the move on the real stage against a target on a chosen row, so reach and lunge are checked against real depth rows, and Battle Test fires the events for real.
- **Not built: hitbox and hurtbox drawing.** MUGEN's attack and body boxes (Clsn1 and Clsn2, [AIR docs](https://elecbyte.com/mugendocs/air.html)) decide hits in a real-time fighter. A turn-based battle already knows who is hit, so a `hit` event with a contact point and a row reach does the job. Boxes come back only if per-frame hurtboxes are ever wanted.

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
16. The top bar holds view choices and the inspector holds properties; no control is in both (3.2).
17. Every setting whose meaning or visual effect is not obvious has a "?" that says, in plain words, what it is and what changes on screen (3.7), and the tool has a short in-tool help for its core ideas (3.0).
18. Shift locks a drag to one direction, sliders update the view while dragged, and the selection can be aligned in one click (2.3, 3.7).

---

## 6. Beyond RPG Maker: depth stages and frame-by-frame moves

Two jobs the Shadow Jog Engine needs have no RPG Maker equivalent, so Mark asked (2026-10-02) how the engines that had to build them did it. The research went through a page-summarising fetcher like the rest of this guide, so wording is paraphrased. Public sources were thin in places; each subsection ends with its gaps rather than filling them with guesses.

### 6.1 Battle stages with depth

**What RPG Maker lacks.** MZ crops a fixed 1000×740 battleback, the lower part in side view ([MZ battlebacks](https://rpgmakerofficial.com/product/MZ_help-en/01_11_01.html)), places side-view actors by a formula in its core script (3.1), and lets you drag enemies freely on a flat picture in the Troops tab ([MZ Troops](https://rpgmakerofficial.com/product/MZ_help-en/01_08_07.html)). Nowhere is there a floor band, a depth row or a draw order to edit. Mark's brief was a stage "angled such that the characters appear on different Z-axis values": heroes on the left facing right, enemies on the right, rear figures higher on screen, nearer ones drawn over them, a contact shadow under each, and a horizon and floor the designer can move.

**OpenBOR**, the open-source 2D brawler engine, solved this decades ago and is the main precedent.

- *Axes.* Z runs toward the camera: lower values are further away, and as an entity comes closer it moves down the screen and draws over farther ones ([OpenBOR axis wiki](https://chronocrash.com/obor/wiki/axis/)).
- *The walkable band.* Each level sets `z zmin zmax [BGheight]`, all three measured in pixels from the top of the stage image (not quite screen rows once the stage scrolls). zmin is how high up entities may walk, zmax how far down, with defaults of 160 and 232; the optional third number moves where the background art bottoms out (default 160) so it can be matched to zmin. Forum examples read `z 146 240` and `z 194 249 160`, and modders are told to measure their stage picture in pixels to find where the floor starts and ends ([Z vs. Panel Interaction](https://chronocrash.com/forum/threads/z-vs-panel-interaction.8250/latest)). That measuring step is the manual version of a draggable horizon and floor.
- *Placement.* `coords x z a` puts an entity at an x, a z and an altitude, measured against the level rather than the screen, and `at N` spawns it when the level has scrolled to N ([coords thread](https://chronocrash.com/forum/threads/param-z-in-coords-is-relative-to-level-and-not-to-screen.3448/), [spawn by level position](https://chronocrash.com/forum/threads/how-to-spawn-entity-at-position-of-level-not-screen-position.5318/)).
- *Layers.* `bglayer`, `fglayer`, `panel` and `frontpanel` each take a z (positive nearer the screen, negative further), separate x and z parallax ratios, position, spacing, repeat, alpha and a water mode ([fglayer syntax thread](https://www.chronocrash.com/forum/threads/fglayer.1803/latest); the same thread says some of these layer parameters don't currently work).
- *Shadows.* There are two kinds. Static shadow sprites are picked by an index 0 to 6 (the wiki page doesn't say where they anchor); "replica" shadows project the current frame, steered by a level-wide `light` command (x leans it, z sets its length). Flags choose the kind per state: `static_ground`, `static_air`, `replica_ground` and `replica_air`; an air-only shadow combines an air flag with the ground setting turned off ([OpenBOR shadows](https://chronocrash.com/obor/wiki/shadows/)).
- *Editing UI.* The community level editor, Chronocrash Modders Tools, switches between a text view and a visual level view. A red rectangle marks the camera and scrolls with the arrow keys, so a spawn can be seen landing on screen; walls, holes and platforms are dragged out with the mouse, and layers show at their z positions ([Chronocrash Modders Tools](https://www.chronocrash.com/forum/resources/chronocrash-modders-tools.139/)).

**Other brawler engines** publish little. GameMaker's "Beat'em Up Engine" advertises 2.5D movement with a jump on z, depth handling and "battle areas" that bound the camera and the screen, with no data format given ([GameMaker Marketplace](https://marketplace.gamemaker.io/assets/7720/beat-em-up-engine), [itch.io thread](https://itch.io/t/396704/beatem-up-engine-for-game-maker-studio-2)). The Streets of Rage 4 developer material found is design philosophy only ([Gematsu](https://gematsu.com/2019/11/streets-of-rage-4-behind-the-gameplay-developer-diary)).

**General 2D engines** agree on one thing: sort by y, at the feet.

- *Godot* draws a node with a higher y in front when `y_sort_enabled` is on, relative to nodes at the same z-index ([CanvasItem](https://docs.godotengine.org/en/latest/classes/class_canvasitem.html)). The sort point is the node's position, so the sprite must be offset until its origin is at its feet ([KidsCanCode Y-sort](https://kidscancode.org/godot_recipes/4.x/2d/using_ysort/index.html)). A tile layer's `y_sort_origin` adds an integer to each tile's sort value "to fake a different height level" ([TileMapLayer](https://docs.godotengine.org/en/latest/classes/class_tilemaplayer.html)), and a common pitfall is a z-index overriding the y-sort ([bugnet.io](https://bugnet.io/blog/how-to-fix-godot-ysort-feet-sorting-with-wrong-origin)). No y-sort editor gizmo could be verified in Godot's docs.
- *Unity* sorts by sorting layer, then Order in Layer, then distance along a Transparency Sort Axis (Perspective, Orthographic or a Custom Axis, the last documented for isometric maps). A sprite's sort point is its centre by default or its pivot, set in the Sprite Editor, and a Sorting Group makes a multi-part figure sort as one ([Unity 2D sorting](https://docs.unity3d.com/2023.1/Documentation/Manual/2DSorting.html)).
- *Tiled* orders an object layer `topdown` (by y, the default) or `index` (by hand, raised and lowered with Page Up and Page Down), with ties going to the object made last ([Tiled draw order](https://discourse.mapeditor.org/t/objectgroup-rendering-order/1586)).

**JRPGs** were the weakest source. A Data Crystal page describing enemy positions as `yyyyxxxx` bytes could not be fetched (403) or confirmed as Final Fantasy VI's battle formations ([Data Crystal](https://datacrystal.tcrf.net/wiki/Final_Fantasy_VI/Monster_Script_Format)), so treat it as unverified. Chrono Trigger and Cosmic Star Heroine fight on the explored map, which makes each layout hand-made per encounter ([Siliconera](https://www.siliconera.com/cosmic-star-heroine-unexpected-psx-surprise/)). Octopath Traveler's HD-2D gets its depth from a 3D camera, depth of field and tilt-shift over flat sprites, not from authored floor rows ([HD-2D](https://en.wikipedia.org/wiki/HD-2D)).

**What we adopt** (all specified in 3.4, 3.5 and 3.7):

1. The floor as two numbers plus a separate horizon, which is OpenBOR's zmin, zmax and background height. Our `floor.y0` (the horizon), `floor.y1` and `backdrop.horizonY` already match, and the handles move them.
2. One sort key at the feet, `depthFor(y, x)`, fed by a per-sprite foot anchor, as Godot, Unity and Tiled all require. The anchor gets a visible crosshair because everything depends on it.
3. A manual forward and back override within a row, from Tiled's index order, for the rare bad overlap.
4. A whole figure (body, weapon, smear, shadow) sorting as one, from Unity's Sorting Group.
5. Shadow rules: an ellipse on the foot anchor, a per-row scale and alpha next to the per-row tint, and a shadow that stays on the floor when the figure leaves it, after OpenBOR's grounded kinds.
6. A parallax ratio per backdrop layer, from OpenBOR's layer ratios.
7. ~~A camera rectangle overlay, after the OpenBOR community editor's camera view~~ (built, then removed 2026-10-03: the battle camera never moves, so it outlined the screen and nothing else; see 3.4).
8. A read-only text view beside the visual one, from the same editor.

**What we reject, and why:**

- *A free z per fighter* (OpenBOR's `coords x z a`). Our rows are the z values; a free number would let fighters drift off rows and break formations (inferred).
- *Walls, holes and platforms.* They exist for brawler movement through a level. JRPG fighters stand on slots.
- *Replica shadows.* A projected silhouette per frame, lit from a direction, costs a draw per figure per frame and reads as realistic lighting next to flat pixel ellipses (inferred). Worth a second look only if a stage ever wants one strong light.
- *A separate "battle area" object.* The floor band already bounds where figures can stand.
- *Sorting layers or a z-index per fighter.* Two systems can disagree, and the Godot pitfall above is exactly that. One key, with the override folded into it.
- *More digging for FF6 or Chrono Trigger numbers.* Unverified and slow. Measuring screenshots of the games Mark likes (row spacing, how steep the party's diagonal is, shadow width against sprite width) is cheaper and answers the real question (inferred).

**Gaps.** No authoritative pixel-art convention for contact shadows turned up, only general tutorials and an Aseprite oval-shadow script ([dynamic oval shadow](https://azuna-pixels.itch.io/dinamic-oval-shadow-layer)); the flattened dark ellipse at the feet is common practice, not a cited rule. The FF6 formation data is unverified.

### 6.2 Building moves frame by frame

**What RPG Maker lacks.** MZ's side-view battlers are one fixed sheet: equal cells, three frames per motion, each motion looping 1-2-3-2 or playing once ([MZ sprite sheets](https://rpgmakerofficial.com/product/MZ_help-en/01_11_02.html)). Equal cells leave no room for a per-frame anchor, a per-frame hold or a marked hit frame. The Animations tab times sounds and flashes around an Effekseer effect ([MZ Animations](https://rpgmakerofficial.com/product/MZ_help-en/01_08_09.html)), which is about the effect, not the attacker's body, and when damage lands is the battle system's business rather than a frame's (inferred). The official 2D Animation Editor add-on adds frame, cell, sound and flash tracks ([2D Animation Editor](https://store.rpgmakerofficial.com/products/2d-animation-editor-mz)), with no anchor or hit marker that its store page mentions. Mark's need is the opposite end: hand-picked Sprite Fusion stills of different canvas sizes (Rook's 69x110 wind-up, his 101x66 follow-through), each standing on the same ground point, with chosen holds, an exact hit frame, smear and effect timing, a lunge, and a preview.

**MUGEN** (Elecbyte's fighting-game engine) is the base model.

- *The frame line.* An action is a list of elements, each `group, image, x, y, time, [flip], [blend]`. Group and image point into the sprite file; x and y are offsets from the sprite's axis, positive x to the right and positive y DOWN (to raise a sprite 15 px you write -15; [AIR docs](https://elecbyte.com/mugendocs/air.html)). Our composer's `offset` uses the same screen convention (y down); time is in 60 Hz ticks, with `-1` on the last element holding forever. `Loopstart` marks where a loop returns to, flip is `H`, `V` or `VH`, and blend is additive, subtractive or an alpha form ([Elecbyte AIR docs](https://elecbyte.com/mugendocs/air.html)).
- *The axis.* Every sprite carries its own axis, set when the sprite file is built, and frame offsets and boxes are measured from it. That shared reference is what keeps a character steady across frames ([AIR docs](https://elecbyte.com/mugendocs/air.html)).
- *Boxes.* Clsn1 is an attack box and Clsn2 a body box; the `Default` variants carry over to every later frame until replaced ([AIR docs](https://elecbyte.com/mugendocs/air.html)).
- *Hit timing.* The animation owns frames, durations and boxes. A separate HitDef in the character's state owns the pausetime (attacker freeze and target shake), the hit spark and where it appears, and the hit sound; a hit happens when an attack box overlaps a body box, and one HitDef is one hit ([MUGEN state controllers](https://elecbyte.com/mugendocs/sctrls.html)). So the moment of the hit belongs to the move and its boxes, not to a flag on a frame (inferred).

**IKEMEN GO** is an open-source (MIT) Go engine aiming at MUGEN 1.1 beta compatibility ([repo](https://github.com/ikemen-engine/Ikemen-GO)). It keeps the frame line untouched and adds, among other things, depth through `depth` and `attack.depth` constants so attacks collide in depth too, extra blend modes, a "Copy Action" shortcut, custom shaders and higher variable limits ([Character features](https://github.com/ikemen-engine/Ikemen-GO/wiki/Character-features)). Its wiki also lists Lua scripting and 3D models, unverified here ([wiki](https://github.com/ikemen-engine/Ikemen-GO/wiki)).

**Fighter Factory**, the community MUGEN editor, has no official UI documentation that could be found. A tutorial (not re-checked; unverified) describes a Sprites menu with Add and "Add Group to AIR", an animation list, floor-level guidelines, and a collision box drawn on one frame and applied across frames ([FF Ultimate tutorial](https://itstillworks.com/12585853/how-to-make-a-mugen-character-in-fighter-factory-ultimate)). For frames of different sizes the community workflow is to lay every frame on one large canvas with a shared axis, import each with its axis values, save the set "aligned" (a canvas sized to fit all sprites plus a text file of axes), then trim. The axis goes at the body or feet, never the image centre ([ChronoCrash conversion thread](https://www.chronocrash.com/forum/threads/converting-mugen-chars-to-openbor.1074/page-2)). Makko's guide says the same: the anchor is the one pixel where the character meets the world, normally bottom-centre at the feet ([Makko](https://blog.makko.ai/sprite-animation-alignment-anchor-points-scale-and-using-characters-in-multiple-games/)).

**OpenBOR** authors animations as text: `anim`, then `offset`, `delay` and `frame <image>` lines. A `frame` line commits the current state, property lines set the state for the next frame, and one-shot properties such as a frame sound reset after each frame. Delay defaults to centiseconds, and the offset stands each frame on one world point, usually between the feet ([Animation Overview](https://chronocrash.com/openbor/wiki/index.php/Animation_Overview), [animations overview](https://chronocrash.com/obor/wiki/animations-overview/)). Per frame it can also carry body boxes (`bbox`) and attack boxes, movement (`move`, `movea`, `movez`), `jumpframe`, `landframe` and `dropframe`, and attached sounds, spawns and scripts. Its hit flash is a separate model spawned at the contact point with its own z and layer, and the sound can live in that model's animation ([Hit Effects](https://chronocrash.com/openbor/wiki/index.php/Hit_Effects)). Unlike MUGEN it has one offset per animation unless overridden, so it relies on pre-aligned canvases, and its wiki warns that mismatched ones make entities shake or slide ([Animation Overview](https://chronocrash.com/openbor/wiki/index.php/Animation_Overview)).

**Aseprite and Spine** supply the timeline ideas. Aseprite tags name a frame range with a direction ([tags](https://www.aseprite.org/docs/tags/)), and its slices carry a pivot and per-frame keys with bounds (user data on slices is likely but not shown on that page), exported to JSON: the nearest existing per-frame anchor format, though it lives in the art file ([slices](https://www.aseprite.org/docs/slices/)). Spine events are named triggers keyed on the timeline with int, float and string payloads and an optional audio path; the game handles them in code (spawn particles, hurt an enemy), and they can be grouped in folders ([Spine events](https://esotericsoftware.com/spine-events)). That is the cleanest model found for hit, smear and sound cues, and more flexible than MUGEN's one HitDef per hit.

**Frame-data vocabulary** comes from fighting games: startup is the time to the first hitting frame, active the frames that can hit, recovery the rest until the character can act; hitstun and blockstun lock the defender; a cancel window is how long after contact another move can interrupt; frame advantage is the difference between the two sides' recovery ([Dustloop](https://dustloop.com/w/Using_Frame_Data), [SRK glossary](https://srk.shib.live/w/Street_Fighter_V/Glossary)). Hitstop, the freeze both fighters get on contact, is MUGEN's `pausetime` ([MUGEN state controllers](https://elecbyte.com/mugendocs/sctrls.html)).

**What we adopt** (all specified in 4.2):

1. MUGEN's frame line as the frame record (still, offset, hold, flip), plus a Spine-style event list on each frame instead of a separate HitDef.
2. One axis per still, defaulting to the feet, draggable as a crosshair, with stills never re-padded. Mixed canvas sizes then line up by construction.
3. Ticks at 60 per second as the only authoring unit, with milliseconds shown beside them.
4. A `hit` event that carries the hitstop (MUGEN's pausetime), a contact point and a row reach (IKEMEN's `attack.depth`, reduced to rows).
5. Per-frame dx and dz in a Move lane, from OpenBOR's `move` and `movez`, kept apart from the picture offset.
6. Effects as spawned objects placed relative to the axis or the contact point, from OpenBOR's hit flash.
7. A startup, active and recovery bar derived from the frames, using the fighting-game vocabulary.

**What we reject, and why:**

- *Hitbox and hurtbox drawing* (Clsn1, Clsn2, OpenBOR's `bbox`). A turn-based battle already knows who is hit; one `hit` event does the job.
- *One offset per animation over pre-aligned canvases* (OpenBOR's default). Padding Mark's stills to a common canvas is extra work, and the OpenBOR wiki's own warning about shaking and sliding is the failure we are avoiding.
- *Centiseconds, or any second unit.* The 60 versus 200 Hz mismatch had to be tuned by hand in MUGEN conversions ([ChronoCrash conversion thread](https://www.chronocrash.com/forum/threads/converting-mugen-chars-to-openbor.1074/page-2)).
- *Hit timing kept in a separate state file* (MUGEN's HitDef). Answering "when does it hit" should not mean opening two places; the hit sits on the timeline where Mark can see it.
- *Cancel windows and frame advantage.* They matter between real-time inputs. The nearest thing here is the timed-hit ring, which could become an event later if it needs authoring (inferred).
- *IKEMEN's Lua and 3D models.* Unverified and not needed.

**Gaps.** No documentation turned up for Fighter Factory's panels, onion skin or playback, so the composer's onion skin comes from Aseprite (4.2), not from Fighter Factory. No source showed how any editor displays startup, active and recovery; the bar in 4.2 is our design. DragonBones was not examined, and Elecbyte's sprite-file page returned 403.
