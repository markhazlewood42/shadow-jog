# Spike: Phaser tooling spike (the side-view battle stage and its editor)

Branch `spike/phaser-stage` (draft PR, never merged), checked out next to the main project at `projects/shadow-jog-phaser`. Plan and background: `docs/PHASE-0.2.md` (decision 6 and the "How the three fit together" update), on the release-prep branch until it merges. Builds on `spike/side-battle` (the side-view spike) and its stage design (`docs/spikes/side-battle-stage.md` and `docs/spikes/stage-configs/`, coming from that branch).

## Question
If the new side-view battle stage is built natively in Phaser 4 with an in-game edit mode, can Mark design battle stages himself (horizon and floor, hero and enemy positions on depth rows, HUD layout, then a battle test), and is Phaser a better base for a "Shadow Jog Engine" toolset than the current engine?

## Why now
Mark asked (2026-10-02) for tools to make battle-design calls himself, like RPG Maker's troop placement view and battle test, instead of agents iterating on layouts by hand, and whether Phaser makes a bespoke toolset easier. Agent judging plateaued at about 7/10 on exactly these taste calls. Phaser keeps a list of on-screen objects with positions and depth and makes them draggable with a setting, so an edit mode can live inside the real battle scene; on the current immediate-mode engine every tool has to build its own hit-testing and preview. Building the editor on the current engine first would mean building its object layer twice if we port. Getting it wrong costs either a port that doesn't pay off, or tools built on a base we later leave.

## Time box
About 4-6 working sessions of Claude time. The box closes **2026-10-09** whatever state the spike is in. Step 1 is built to fail fast.

## Exit criteria (written before any code, dated 2026-10-02)
- GO if all of these hold:
  - **Mark can design a stage himself:** open the editor, move the horizon and floor, drag the four heroes and the enemies onto depth rows (overlap order and floor shadows follow automatically), move or switch the HUD layout, save, and press battle test to play a real fight on that stage, without agent help. Save-to-battle-test takes under a minute.
  - **What you drag is what the game draws:** the edit mode runs inside the same scene the battle uses, not a separate preview.
  - **The battle is real:** the fight is driven by the existing battle engine (`src/battle`, unchanged), and Rook's strike plays from Mark's Sprite Fusion frames with the lunge, hitstop and hit effect.
  - **It runs well:** 60 fps with the crew, four enemies and effects; frame time p95 under 6 ms on this machine; the spike's tests run in CI (including whatever GPU-less runners do).
  - **It is a base worth building on:** the judges (engineering and design lenses) and Mark would rather build the next tools (animation composer, troop editor, maps via Tiled) on this than on the current engine, with the reasons written down.
- NO-GO if any of these happens:
  - Getting Phaser to show the crew on a stage from a stage config takes more than 2 sessions (step 1).
  - Edit mode can't be what-you-see-is-what-you-get without a separate preview path.
  - Phaser 4 gaps (bugs, missing docs, v3-only answers) cost more than a session in total.
  - It can't run in CI.
- Informational, not gates: bundle size (Phaser is about 350 kB gzipped; Mark's dependency policy allows it), how Phaser's filters compare with our bloom, how much of the current renderer could be reused.

## Steps
1. **Shell and stage (fail-fast):** a separate DEV-only entry (for example `/stagelab.html`) running Phaser 4 at 480x270 with integer scaling and pixel-art settings; load a stage config (the side-view spike's StageConfig format) and draw the backdrop with its 3/4 floor, depth rows, contact shadows and depth sorting; Mark's four heroes (Sprite Fusion idle loops) on the left facing right, enemies on the right.
2. **Edit mode:** toggle edit; drag heroes and enemies (snap to depth rows, live overlap order and shadows), drag horizon and floor handles, move HUD regions or pick a HUD preset, a small settings panel (Tweakpane, MIT) for numbers; save to `src/data/stages.json` through a Vite dev plugin, the same way the FX lab saves `fx.json`; load the saved stage back.
3. **HUD:** the side-view HUD from the stage design (turn order, commands, party status) as Phaser objects whose regions come from the config.
4. **Battle test:** run a real fight on the stage through `src/battle`, with Rook's strike from Mark's frames (lunge, smear, hitstop, hit effect) and a basic hurt reaction.
5. **Measure and compare:** frame time, bundle size, CI; lines of code for shell, stage, editor; a written comparison with what the same editor would take on the current engine.
6. **Result:** fill in below; Mark decides GO / NO-GO.

## Assets and cost
- Phaser 4.2.1 (MIT, free) added as a dependency on this branch only; Tweakpane (MIT, free) if used.
- Mark's Sprite Fusion sprites are loaded from his local `spritefusion-tests/` folder through the DEV server only (a link in this checkout points at the main checkout's folder); they are never copied into a tracked path or committed.
- No paid services.

## Result (filled in at the end)
- Outcome: GO / NO-GO / ABANDONED
- Date:
- Numbers:
- Draft PR:
- Archive tag:
- Notes: what was learned and what to rebuild.
