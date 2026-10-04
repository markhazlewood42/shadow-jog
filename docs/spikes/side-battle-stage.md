# Side-view battle stage: final design (spike/side-battle)

> Copied to main on 2026-10-04 as the record. The spike code stays on branch `spike/side-battle` (draft PR #3, never merged).

This is the battle-stage half of the side-view spike: camera, floor, backdrops, where everyone stands, and the battle HUD. It follows Mark's stage feedback in `docs/spikes/side-battle.md` ("the camera angle / perspective is pretty off", the Phantasy Star IV portrait row has to go, heroes on the left facing right, enemies on the right). It is one parallel exploration next to Mark's own mockup, so everything here is expressed as data a battle renderer or a future stage editor can load.

All numbers are screen pixels on the 480x270 game screen. Mockup images live in git-ignored `media/spike-side-battle/stage/` (paths at the end). The two stage configs are committed at `docs/spikes/stage-configs/street.json` and `sewer.json`.

## 1. What Mark's four references do (measured)

Each reference was measured by eye as a share of its screen, then converted to 480x270. Treat the numbers as about ±2%.

| | Ref 1: diagonal column + timeline | Ref 2: FF2 remake side view | Ref 3: 3/4 arc vs dragon | Ref 4: side-on action, combos |
|---|---|---|---|---|
| Horizon / wall base | 46% (y 125) | 28% (y 76) | 38% (y 103) | 24% (y 65) |
| Visible floor | 31% | 54% | 62% | most of the screen |
| How the floor shows depth | tiles, cross lines meet far above the screen | rows of flagstones, nearly flat | texture gets smaller and denser further back | cobbles shrink a little toward the top |
| Party | 4 in a diagonal column, rows 15 px apart, rear rows step toward the centre | zigzag column, rows 32 px apart | arc below the boss, seen from behind | 2 figures, rows 25 px apart |
| Character height | 12% of screen | 14% | 21% (close to ours) | 19% |
| Boss height | n/a | 52% | 51% | mech 27% |
| Shadows | small, faint | coloured oval, ring on the active hero | soft dark patches | small |
| HUD | timeline on top, command icons centre, 4 status panels bottom (about 40%) | bottom band only: icon strip left, HP table right (about 20%) | one icon (about 2%) | skill banner top, combo top-right, command list left, gauges bottom-right (about 35%, see-through) |

What they agree on:
- The floor takes 31-62% of the screen and the horizon sits 24-46% down.
- No sprite is shrunk for depth. Depth comes from height on screen, overlap (the lowest figure is drawn on top) and shadows.
- The battle line runs across the screen, left to right. Nothing on the floor points into the screen between the two sides.
- The HUD hugs the edges and is partly see-through.

Why our current side view read flat: every backdrop was drawn for the old behind-the-party camera, so the floor is a road running into the screen with lane lines meeting at a vanishing point in the middle of the fight. The floor said "looking down the road" while the fighters said "looking across". The horizon was low (y 132) with everyone standing right under it, the rows were only 36 px deep in total, the enemies shared one baseline, shadows were invisible on the dark road, and the HUD was the Phantasy Star IV row of four portrait panels.

Targets that came out of this (the measured brief): horizon y 92-112; at least 45% of the screen visible floor between the HUD bands; feet rows 14-24 px apart; lower figures drawn on top; a visible contact shadow under everyone; party left facing right, enemies right, a clear lane of at least 55 px between them; always-on HUD at most 20% of the screen; every sprite at 1x.

## 2. The three directions and how they scored

Three judges scored each direction on rubric v2 (stage, reference match, HUD, composition, readability, style, craft). Medians:

| Direction | Overall | Stage | Ref match | HUD | Composition | Readability | Style | Craft | Judges' pick |
|---|---|---|---|---|---|---|---|---|---|
| D1 classic (FF-style strip: icons bottom-left, HP table bottom-right) | 6.4 | 6 | 6 | 7 | 6 | 7 | 7 | 7 | 0 |
| D2 lanes (tiled lanes, ref 1 timeline on top, three bottom windows) | 7.0 | 8 | 7 | 7.5 | 6 | 8 | 8 | 6 | 0 |
| D3 arena (high camera, wet asphalt, almost no HUD, bars under feet) | 7.6 | 7.5 | 8 | 6.5 | 8 | 7 | 8 | 8 | 3 |

None passed the bar (median 8, every criterion 7, stage and reference match 8). D3 won on the stage itself: the floor and the fight are the picture. Its weak spot was the HUD: letter chips instead of faces in the turn order, no HP or resource numbers, a 1 px resource bar nobody can read.

## 3. The chosen design: D3's stage with D2's HUD discipline

**The stage is D3.** The camera looks across the battle line from high up. The street keeps its own skyline, storefronts and neon, moved up 32 px so its kerb becomes the floor's far edge at y 100. Below that, a new floor is drawn: horizontal slab bands that grow 1.2x taller toward the camera, staggered slab joints whose lines meet 400 px above the screen (so they look upright), asphalt flecks that get finer toward the horizon, neon spill from the signs, a few puddles, and a haze that thickens toward the back. Nothing on the floor points into the screen.

**Why D3 suits Shadow Jog.** It fixes exactly what Mark called out: fighters sit at clearly different depths (rear figures higher, lower figures on top, a dark contact shadow under each) and the floor finally agrees with that. It keeps the game's identity untouched (skyline, palette, neon, bitmap font, the drawWindow look) and it leaves the most room for attacks to travel across depth: Rook crosses 155 px and three rows to reach a rear punk in the action mockup.

**What changed from D3 (the judges' must-fixes):**
- Floor depth is stronger: brighter slab seams that strengthen toward the camera, joints that go from faint far away to clear up close, a dark grout row under each big near band, and a faint lit seam halfway between depth rows so each row reads as its own lane.
- The turn order is ref 1's timeline across the top centre (x 120-360, y 2-27): a 20x20 NOW chip, party chips above the line, enemy chips below it with a pink corner mark. Every chip is a 1x face cut from the real sprite (2 px-grain enemy art is cut at double size and reduced by exactly 2, never scaled by a fraction). No letters.
- HP and resources have numbers: a compact party table bottom-left (face, name, HP bar, HP now/max, resource label and value, active row highlighted). Rook shows "—", which is his real `tpLabel`: he has skill uses, not TP. The 1 px under-feet resource bars are gone.
- The acting hero gets the cyan ring, a name tab above the head, and the highlighted table row.
- Enemy names show only on the targeted enemy (with A/B tags for duplicates) and in the bottom-right box, which lists the foes while choosing and shows the target's name, HP and status chips while targeting or while an action plays.
- Hit flash is a near-white silhouette that keeps the dark outline, plus a 3 px knockback, not a grey 40% blend.
- The damage number sits just above the target's head in the 2x font with a dark outline and a CRIT label. A tall target in the back row gets it on its upper body instead, so it never lands under the banner.
- Rows moved up 4 px (rear row y 140 instead of 160) to use the dead floor under the horizon, and the front shadow ends 13 px above the bottom band.
- Tower tops cut by the 32 px shift now fade into the night sky (a 14-row dithered sky fade) instead of ending at a hard edge.
- Every enemy set in the config (1-6, boss, boss+1, boss+2) is rendered and checked, on both stages.
- The party column follows ref 1 and the brief: the lead (Kit) is lowest and furthest left, rear rows step 42 px toward the centre. This replaces D3's reversed arc, which put the front hero closest to the enemies and squeezed the lane. Heroes still overlap, as in ref 1, but bodies no longer pile up.

**Grafts kept:** D2's timeline, numeric status table, target box, CRIT label and combo box ("2 HIT 34", top-right, only during an action); D2's lane-per-row idea, applied subtly; D2's dashed amber lane line behind the back row (street); D1's cyan active ring, 1 px kerb shadow row, vertical neon reflection streaks under the brightest signs, and the rule that a lunging attacker borrows the target's feet row plus 1; D3's thin dashed path and dotted home-slot oval for the attacker (D2's heavy cyan afterimages were dropped).

**The second stage, the sewer, proves the data model.** The sewer art is a tunnel seen end-on, so it is a `mode: "replace"` stage: a new side wall of the same tunnel drawn in the sewer's own palette (slate planks, pale ribs as pillars, the copper pipe, two amber wall lamps, the green-lit grate as an outflow in the middle) with the water channel running left to right along the wall base, behind the back row. The floor is the concrete walkway, so shadows read strongly (33 or more brightness levels darker than the floor). Rows, party slots, enemy sets, shadows, sort rule and HUD are the same data as the street; only the backdrop block, the floor block, the haze colour and the boss x (the Lurker is wider than the Warden) differ.

**Every check passes** on all 8 mockups and all 18 enemy-set layouts (`final-checks.txt`): horizon 100; rows 140/157/174/191/208 (17 px apart); lane 64-84 px; nearest enemy left edge 260 or more; enemy right edge 476 or less; no sprite in the top HUD band; front shadow 13 px above the bottom band; always-on HUD 10.3-10.7% of the screen (19.2-19.6% with the commands and the enemy box open); visible floor between the HUD bands 47.4%; weakest shadow 13.1 brightness levels darker than the floor on the street, 33 or more on the sewer; every sprite pasted at 1x.

**Known gaps, stated plainly:**
- Enemy art is the shipped v0.1.0 enemies at their on-screen size: 2 px grain beside the heroes' 1 px grain, and the Rustfang Punk is 91 px tall, 1.4x hero height. The six-punk layout fits the screen and passes the checks, but it is a crowd (see the all-sets sheet). The fix is an art-pipeline decision, not a stage one (open question 1).
- Humanoid enemies face the camera, not the heroes. The creatures (Glowrat, Scrap Hound, Gutter Eel) already face left. Flipping a front-facing sprite changes nothing useful, so the humanoids need left-facing or three-quarter art (open question 2).
- Enemy HP bars are drawn over everything, so in the six-enemy set a rear enemy's bar crosses the head of the one in front. A renderer should draw each bar with its owner in the depth sort, or tuck it under the shadow.
- The Lurker's sprite rises out of a splash, which looks odd on a dry walkway. It belongs in the water.
- Command icons are placeholder pixel drawings. All numbers in the mockups are believable but invented (level-5 values from `src/data/party.ts` growth, real enemy max HP from `src/data/enemies.ts`).
- Not re-judged yet. The fixes target every must-fix the three judges listed, but the final design has no scores of its own.

## 4. The data: StageConfig

One JSON file per backdrop. The battle renderer reads it, a drag-and-drop stage editor writes it, Mark's mockup can use it. It is plain data with nothing engine-specific, so it carries over unchanged whether battles stay on our Canvas code or move to another framework. Fields marked "new" were added during this round; the rest are the brief's schema.

```ts
/**
 * StageConfig: everything about how one battle stage LOOKS and where everyone STANDS, as plain data.
 * One JSON file per backdrop (for example src/data/stages/street.json). The battle renderer reads it,
 * and a drag-and-drop stage editor writes it. Nothing here is engine-specific.
 *
 * Coordinates: screen pixels on the 480x270 game screen. (0,0) is the top-left corner, y grows downward.
 * "Feet" means the pixel row a character's soles stand on. Characters are placed by their feet, not their top-left corner.
 * Enemy SIZE is not here: it belongs to the enemy (its art), not to the stage.
 */
export interface StageConfig {
  /** Format version, so old files can be upgraded later. Always 1 for now. */
  version: 1;
  /** Short id, usually the backdrop's id ("street"). */
  id: string;
  /** Human-readable name for the editor's list. */
  name: string;
  /** The picture behind everything: sky, skyline, buildings, or a replacement back wall. */
  backdrop: StageBackdrop;
  /** The ground the fighters stand on, drawn fresh so it agrees with a side-on camera. */
  floor: StageFloor;
  /** Depth rows, from the BACK (highest on screen) to the FRONT (lowest). Slots refer to rows by index (0 = back row). */
  rows: DepthRow[];
  /** Where the heroes stand. Index 0 = the party's lead, the front-most hero. Heroes face right. */
  party: PartySlot[];
  /** Where enemies stand, one layout per group size: "1" to "6", "boss", "boss+1", "boss+2". Enemies face left. */
  enemySets: Record<string, EnemySlot[]>;
  /** The dark oval under every fighter that plants them on the floor. */
  shadow: ShadowStyle;
  /** Optional haze: rows further back are blended a little toward a fog colour. */
  depthTint?: DepthTint;
  /** How fighters are layered when they overlap. */
  sort: SortRule;
  /** Where the battle menus and readouts go. */
  hud: HudLayout;
}

/** Ids of the procedural backdrops in src/art/battlebg.ts. */
export type BackdropId = 'street' | 'sewer' | 'rustyard' | 'barrens' | 'park' | 'junction' | 'lab' | 'core';

export interface StageBackdrop {
  id: BackdropId;
  /**
   * "reproject": keep the backdrop's sky and buildings, move them by shiftY, and draw a new floor below the horizon.
   * "replace": the old art is a perspective box (a tunnel, a corridor), so a separate side-on back wall is drawn (wallId).
   */
  mode: 'reproject' | 'replace';
  /** Screen row where the floor's far edge meets the backdrop. Target 100 (allowed 92-112). */
  horizonY: number;
  /** How far to move the old picture up (negative) so its own horizon (row 132) lands on horizonY. -32 puts it at 100. */
  shiftY: number;
  /** NEW. Dithered fade at the top of the screen, so tall buildings cut by the shift fade into the sky instead of a hard edge. */
  skyFade?: { height: number; color: string; amount: number } | null;
  /** Replacement back-wall art id, used only when mode is "replace" (for example "sewer-sidewall"). */
  wallId?: string;
  /** Layers that slide at different speeds when the camera pans or shakes (0 = fixed, 1 = moves with the floor). */
  layers?: ParallaxLayer[];
  /** Optional framing drawn OVER the fighters at the screen edges. Keep it out of the slot area. */
  foreground?: { id: string; y: number; alpha?: number } | null;
  /** Weather or ambient effect ("rain", "embers", "drips"), or null. */
  ambient?: string | null;
}

export interface ParallaxLayer {
  id: string;
  /** Screen row of the layer's bottom edge. */
  y: number;
  /** 0 to 1: how much the layer moves compared with the floor. */
  speed: number;
}

export interface StageFloor {
  /** Top of the floor (equal to backdrop.horizonY). A 2 px kerb is drawn here: the edge colour, then a dark shadow row. */
  y0: number;
  /** Bottom of the floor (270; the HUD covers its lowest part). */
  y1: number;
  /** "bands": stripes that grow toward the camera; "grid": bands plus near-upright joints; "texture": a shrinking texture. */
  style: 'bands' | 'grid' | 'texture';
  /** Two colours the bands alternate between. */
  colors: [string, string];
  /** Kerb colour along the far edge, or null. */
  edge?: string | null;
  /** Height in px of the first (furthest) band. */
  bandStart: number;
  /** Each band is this many times taller than the one above it (1.15-1.3 reads as seen from above). */
  bandGrowth: number;
  /** NEW. A lit dithered line on top of each band; its strength goes from `far` at the horizon to `near` at the camera (0 to 1). */
  seam?: { color: string; far: number; near: number };
  /** For style "grid": the slab joints. */
  grid?: {
    /** Distance between joints at the bottom of the screen. */
    spacing: number;
    /** Row where the joint lines would meet. Must be -200 or less, so they look nearly upright. */
    vanishY: number;
    color: string;
    /** Joint strength at the horizon (0 to 1). */
    alpha: number;
    /** NEW. Joint strength at the camera, so joints get clearer up close. */
    nearAlpha?: number;
    /** NEW. Offset every other band's joints by half a slab, like laid paving. */
    stagger?: boolean;
  };
  /** Texture id and how much finer it gets toward the horizon (0 to 1). */
  texture?: { id: string; shrink: number };
  /** NEW. A faint lit line halfway between neighbouring depth rows, so each row reads as its own lane. */
  laneSeams?: { color: string; alpha: number } | null;
  /** Painted lines that run LEFT TO RIGHT. Keep them behind the back row or under the HUD, never between rows. */
  stripes?: FloorStripe[];
  /** Puddle reflections. They are placed away from every slot so nobody stands in one. */
  reflections?: { colors: string[]; count: number } | null;
  /** NEW. Bright backdrop pixels mirrored into the floor just below the kerb; `streaks` adds vertical neon streaks (0 = none). */
  neonSpill?: { reach: number; strength: number; streaks?: number } | null;
  /** NEW. The far floor dithers toward this colour over `reach` px. */
  haze?: { color: string; amount: number; reach: number } | null;
  /** Colour wash over the whole floor, or null. */
  tint?: { color: string; amount: number } | null;
  /** NEW. Random seed for flecks and puddles, so a stage always looks the same. */
  seed?: number;
}

export interface FloorStripe {
  y: number;
  h: number;
  color: string;
  alpha: number;
  /** [on, off] dash lengths in px, or null for solid. */
  dash?: [number, number] | null;
}

export interface DepthRow {
  /** Feet row on screen. Rows are 14-24 px apart. */
  y: number;
}

export interface PartySlot {
  /** Feet centre x. Rear rows sit closer to the screen centre. */
  x: number;
  /** Index into rows (0 = back row). */
  row: number;
  /** Small nudge from the row line, usually 0. */
  dy?: number;
}

export interface EnemySlot {
  x: number;
  row: number;
  dy?: number;
  /** "boss" slots get the boss shadow and a wider HP bar. Default "regular". */
  size?: 'regular' | 'boss';
}

export interface ShadowStyle {
  kind: 'oval' | 'none';
  /** Width as a share of the sprite's width, clamped to minW..maxW. Bosses use bossWidthScale up to bossMaxW. */
  widthScale: number;
  minW: number;
  maxW: number;
  bossWidthScale: number;
  bossMaxW: number;
  /** Height = width / aspect. */
  aspect: number;
  color: string;
  alpha: number;
  /** Strength of the 1 px dithered rim. */
  edgeAlpha: number;
  /** Ring around the acting fighter's shadow (the target gets the same ring in amber). */
  activeRing?: { color: string; extraW: number } | null;
}

export interface DepthTint {
  fog: string;
  /** Blend per row, back row first, 0 to 0.15 each. */
  amounts: number[];
  /** Keep the acting fighter and its target untinted. */
  exemptActive: boolean;
}

export interface SortRule {
  /** Draw in order of feet row: higher on screen first, so lower figures cover them. */
  by: 'feetY';
  /** On a tie, draw the one further from the screen centre first, then party before enemies. */
  tie: 'outerFirst';
  /** A lunging attacker borrows its target's feet row plus this many px while in contact. */
  lungeOverTarget: number;
}

export interface HudRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  /** "always", "input" (while choosing), "action" (while an action plays), or "never". */
  show: 'always' | 'input' | 'action' | 'never';
  /** 0 = fully see-through, 1 = solid. */
  opacity?: number;
}

export interface HudLayout {
  /** Starting layout the regions override: "timeline-bottom3" is this design. */
  preset: 'timeline-bottom3' | 'ff-strip' | 'action-left' | 'ps4-panels';
  /** Turn order: chips on a line, party above, enemies below, NOW chip at the left. */
  turnOrder: HudRegion & { style: 'timeline' | 'column'; chip: number; nowChip: number };
  /** The action menu: a row of icons with a label line, or text rows. */
  commands: HudRegion & { style: 'icons' | 'list'; icon?: number; rowH?: number };
  /** One compact row per hero: face, name, HP bar, HP numbers, resource label and value. */
  partyStatus: HudRegion & { style: 'rows' | 'panels'; rowH: number; face: number };
  /**
   * The enemy box (foe list while choosing, target details while targeting or acting), plus HP bars under each enemy.
   * NEW: `names` says when enemy names show on the stage: "target" (only the targeted one), "always" or "never".
   */
  enemyInfo: HudRegion & { barsOnStage: { w: number; h: number; gapBelowShadow: number } | null; names?: 'target' | 'always' | 'never' };
  /** Skill name or input prompt. */
  banner: HudRegion;
  /** Hit counter and total damage. */
  combo: HudRegion;
  /** NEW. A name tab above the acting hero's head. */
  activeTag?: { show: 'always' | 'never'; gapAboveHead: number };
  /** Limits the editor warns about. */
  limits: { maxScreenShare: number; maxBottomBand: number; minClearAboveBottom: number };
}
```

### street.json

```json
{
  "version": 1,
  "id": "street",
  "name": "Street",
  "backdrop": {
    "id": "street",
    "mode": "reproject",
    "horizonY": 100,
    "shiftY": -32,
    "skyFade": {
      "height": 14,
      "color": "#0b0920",
      "amount": 0.9
    },
    "layers": [],
    "foreground": null,
    "ambient": null
  },
  "floor": {
    "y0": 100,
    "y1": 270,
    "style": "grid",
    "colors": [
      "#30304e",
      "#23233b"
    ],
    "edge": "#3a3a5c",
    "bandStart": 3,
    "bandGrowth": 1.2,
    "seam": {
      "color": "#8080bc",
      "far": 0.3,
      "near": 0.7
    },
    "grid": {
      "spacing": 64,
      "vanishY": -400,
      "color": "#50508a",
      "alpha": 0.35,
      "nearAlpha": 0.85,
      "stagger": true
    },
    "texture": {
      "id": "asphalt-flecks",
      "shrink": 0.5
    },
    "laneSeams": {
      "color": "#6c6ca8",
      "alpha": 0.3
    },
    "stripes": [
      {
        "y": 124,
        "h": 2,
        "color": "#8a7430",
        "alpha": 0.75,
        "dash": [
          12,
          10
        ]
      }
    ],
    "reflections": {
      "colors": [
        "#3fe0f0",
        "#ff4fb0",
        "#ffcc3d"
      ],
      "count": 6
    },
    "neonSpill": {
      "reach": 26,
      "strength": 0.9,
      "streaks": 0.5
    },
    "haze": {
      "color": "#34305a",
      "amount": 0.45,
      "reach": 44
    },
    "tint": null,
    "seed": 7
  },
  "rows": [
    {
      "y": 140
    },
    {
      "y": 157
    },
    {
      "y": 174
    },
    {
      "y": 191
    },
    {
      "y": 208
    }
  ],
  "party": [
    {
      "x": 46,
      "row": 4
    },
    {
      "x": 88,
      "row": 3
    },
    {
      "x": 130,
      "row": 2
    },
    {
      "x": 172,
      "row": 1
    }
  ],
  "enemySets": {
    "1": [
      {
        "x": 356,
        "row": 2
      }
    ],
    "2": [
      {
        "x": 318,
        "row": 1
      },
      {
        "x": 404,
        "row": 3
      }
    ],
    "3": [
      {
        "x": 300,
        "row": 0
      },
      {
        "x": 396,
        "row": 2
      },
      {
        "x": 330,
        "row": 4
      }
    ],
    "4": [
      {
        "x": 300,
        "row": 0
      },
      {
        "x": 396,
        "row": 1
      },
      {
        "x": 322,
        "row": 3
      },
      {
        "x": 420,
        "row": 4
      }
    ],
    "5": [
      {
        "x": 298,
        "row": 0
      },
      {
        "x": 394,
        "row": 0
      },
      {
        "x": 346,
        "row": 2
      },
      {
        "x": 308,
        "row": 4
      },
      {
        "x": 406,
        "row": 4
      }
    ],
    "6": [
      {
        "x": 298,
        "row": 0
      },
      {
        "x": 394,
        "row": 0
      },
      {
        "x": 346,
        "row": 2
      },
      {
        "x": 428,
        "row": 2
      },
      {
        "x": 308,
        "row": 4
      },
      {
        "x": 406,
        "row": 4
      }
    ],
    "boss": [
      {
        "x": 396,
        "row": 3,
        "size": "boss"
      }
    ],
    "boss+1": [
      {
        "x": 400,
        "row": 3,
        "size": "boss"
      },
      {
        "x": 298,
        "row": 1
      }
    ],
    "boss+2": [
      {
        "x": 400,
        "row": 3,
        "size": "boss"
      },
      {
        "x": 292,
        "row": 0
      },
      {
        "x": 318,
        "row": 4
      }
    ]
  },
  "shadow": {
    "kind": "oval",
    "widthScale": 0.6,
    "minW": 16,
    "maxW": 40,
    "bossWidthScale": 0.5,
    "bossMaxW": 80,
    "aspect": 4,
    "color": "#000000",
    "alpha": 0.65,
    "edgeAlpha": 0.3,
    "activeRing": {
      "color": "#3fe0f0",
      "extraW": 6
    }
  },
  "depthTint": {
    "fog": "#34305a",
    "amounts": [
      0.12,
      0.09,
      0.06,
      0.03,
      0.0
    ],
    "exemptActive": true
  },
  "sort": {
    "by": "feetY",
    "tie": "outerFirst",
    "lungeOverTarget": 1
  },
  "hud": {
    "preset": "timeline-bottom3",
    "turnOrder": {
      "x": 120,
      "y": 2,
      "w": 240,
      "h": 25,
      "show": "always",
      "opacity": 0.8,
      "style": "timeline",
      "chip": 12,
      "nowChip": 20
    },
    "commands": {
      "x": 184,
      "y": 228,
      "w": 112,
      "h": 40,
      "show": "input",
      "opacity": 0.8,
      "style": "icons",
      "icon": 18
    },
    "partyStatus": {
      "x": 4,
      "y": 228,
      "w": 176,
      "h": 40,
      "show": "always",
      "opacity": 0.8,
      "style": "rows",
      "rowH": 9,
      "face": 8
    },
    "enemyInfo": {
      "x": 300,
      "y": 228,
      "w": 176,
      "h": 40,
      "show": "input",
      "opacity": 0.8,
      "barsOnStage": {
        "w": 32,
        "h": 2,
        "gapBelowShadow": 3
      },
      "names": "target"
    },
    "banner": {
      "x": 140,
      "y": 30,
      "w": 200,
      "h": 13,
      "show": "action",
      "opacity": 0.8
    },
    "combo": {
      "x": 404,
      "y": 2,
      "w": 72,
      "h": 25,
      "show": "action",
      "opacity": 0.8
    },
    "activeTag": {
      "show": "always",
      "gapAboveHead": 3
    },
    "limits": {
      "maxScreenShare": 0.2,
      "maxBottomBand": 44,
      "minClearAboveBottom": 12
    }
  }
}
```

### sewer.json

```json
{
  "version": 1,
  "id": "sewer",
  "name": "Sewer",
  "backdrop": {
    "id": "sewer",
    "mode": "replace",
    "horizonY": 100,
    "shiftY": 0,
    "wallId": "sewer-sidewall",
    "layers": [],
    "foreground": null,
    "ambient": "drips"
  },
  "floor": {
    "y0": 100,
    "y1": 270,
    "style": "grid",
    "colors": [
      "#4a5456",
      "#40494c"
    ],
    "edge": "#6b8080",
    "bandStart": 3,
    "bandGrowth": 1.2,
    "seam": {
      "color": "#6e8284",
      "far": 0.3,
      "near": 0.65
    },
    "grid": {
      "spacing": 72,
      "vanishY": -400,
      "color": "#2c3638",
      "alpha": 0.35,
      "nearAlpha": 0.8,
      "stagger": true
    },
    "texture": {
      "id": "concrete-flecks",
      "shrink": 0.5
    },
    "laneSeams": {
      "color": "#5c6b6e",
      "alpha": 0.3
    },
    "stripes": [
      {
        "y": 122,
        "h": 2,
        "color": "#1e2628",
        "alpha": 0.85,
        "dash": [
          10,
          3
        ]
      }
    ],
    "reflections": {
      "colors": [
        "#61ab93",
        "#ffcc76"
      ],
      "count": 5
    },
    "neonSpill": {
      "reach": 14,
      "strength": 0.6,
      "streaks": 0.0
    },
    "haze": {
      "color": "#2a4a44",
      "amount": 0.4,
      "reach": 40
    },
    "tint": null,
    "seed": 11
  },
  "rows": [
    {
      "y": 140
    },
    {
      "y": 157
    },
    {
      "y": 174
    },
    {
      "y": 191
    },
    {
      "y": 208
    }
  ],
  "party": [
    {
      "x": 46,
      "row": 4
    },
    {
      "x": 88,
      "row": 3
    },
    {
      "x": 130,
      "row": 2
    },
    {
      "x": 172,
      "row": 1
    }
  ],
  "enemySets": {
    "1": [
      {
        "x": 356,
        "row": 2
      }
    ],
    "2": [
      {
        "x": 318,
        "row": 1
      },
      {
        "x": 404,
        "row": 3
      }
    ],
    "3": [
      {
        "x": 300,
        "row": 0
      },
      {
        "x": 396,
        "row": 2
      },
      {
        "x": 330,
        "row": 4
      }
    ],
    "4": [
      {
        "x": 300,
        "row": 0
      },
      {
        "x": 396,
        "row": 1
      },
      {
        "x": 322,
        "row": 3
      },
      {
        "x": 420,
        "row": 4
      }
    ],
    "5": [
      {
        "x": 298,
        "row": 0
      },
      {
        "x": 394,
        "row": 0
      },
      {
        "x": 346,
        "row": 2
      },
      {
        "x": 308,
        "row": 4
      },
      {
        "x": 406,
        "row": 4
      }
    ],
    "6": [
      {
        "x": 298,
        "row": 0
      },
      {
        "x": 394,
        "row": 0
      },
      {
        "x": 346,
        "row": 2
      },
      {
        "x": 428,
        "row": 2
      },
      {
        "x": 308,
        "row": 4
      },
      {
        "x": 406,
        "row": 4
      }
    ],
    "boss": [
      {
        "x": 380,
        "row": 3,
        "size": "boss"
      }
    ],
    "boss+1": [
      {
        "x": 380,
        "row": 3,
        "size": "boss"
      },
      {
        "x": 294,
        "row": 1
      }
    ],
    "boss+2": [
      {
        "x": 380,
        "row": 3,
        "size": "boss"
      },
      {
        "x": 296,
        "row": 0
      },
      {
        "x": 290,
        "row": 4
      }
    ]
  },
  "shadow": {
    "kind": "oval",
    "widthScale": 0.6,
    "minW": 16,
    "maxW": 40,
    "bossWidthScale": 0.5,
    "bossMaxW": 80,
    "aspect": 4,
    "color": "#000000",
    "alpha": 0.65,
    "edgeAlpha": 0.3,
    "activeRing": {
      "color": "#3fe0f0",
      "extraW": 6
    }
  },
  "depthTint": {
    "fog": "#2a4a44",
    "amounts": [
      0.12,
      0.09,
      0.06,
      0.03,
      0.0
    ],
    "exemptActive": true
  },
  "sort": {
    "by": "feetY",
    "tie": "outerFirst",
    "lungeOverTarget": 1
  },
  "hud": {
    "preset": "timeline-bottom3",
    "turnOrder": {
      "x": 120,
      "y": 2,
      "w": 240,
      "h": 25,
      "show": "always",
      "opacity": 0.8,
      "style": "timeline",
      "chip": 12,
      "nowChip": 20
    },
    "commands": {
      "x": 184,
      "y": 228,
      "w": 112,
      "h": 40,
      "show": "input",
      "opacity": 0.8,
      "style": "icons",
      "icon": 18
    },
    "partyStatus": {
      "x": 4,
      "y": 228,
      "w": 176,
      "h": 40,
      "show": "always",
      "opacity": 0.8,
      "style": "rows",
      "rowH": 9,
      "face": 8
    },
    "enemyInfo": {
      "x": 300,
      "y": 228,
      "w": 176,
      "h": 40,
      "show": "input",
      "opacity": 0.8,
      "barsOnStage": {
        "w": 32,
        "h": 2,
        "gapBelowShadow": 3
      },
      "names": "target"
    },
    "banner": {
      "x": 140,
      "y": 30,
      "w": 200,
      "h": 13,
      "show": "action",
      "opacity": 0.8
    },
    "combo": {
      "x": 404,
      "y": 2,
      "w": 72,
      "h": 25,
      "show": "action",
      "opacity": 0.8
    },
    "activeTag": {
      "show": "always",
      "gapAboveHead": 3
    },
    "limits": {
      "maxScreenShare": 0.2,
      "maxBottomBand": 44,
      "minClearAboveBottom": 12
    }
  }
}
```

## 5. What the engine must do to render it

1. **Load the config** for the encounter's backdrop (`src/data/stages/<id>.json`), with a fallback to a default stage so a missing file never breaks a battle.
2. **Backdrop.** For `reproject`, draw the existing procedural backdrop from `src/art/battlebg.ts` moved by `shiftY`, but only above `horizonY`: its old road floor must not be drawn. Then apply `skyFade`. For `replace`, draw the named back wall instead. Each `mode: "replace"` backdrop (sewer, and probably core and lab) needs a new wall painter in `battlebg.ts`; the sewer one in the mockup script is the pattern. Cache the result as one bitmap per stage, as now.
3. **Floor.** Paint it once per stage into the same cached bitmap: kerb, growing bands, seams, joints, texture flecks, lane seams, stripes, neon spill and streaks, puddles (kept off the slots), haze. All of it is dither on the 4x4 Bayer matrix the backdrops already use, so it matches their look. This replaces the road floor for every backdrop, so the road's centre vanishing point disappears everywhere at once.
4. **Placement.** Heroes go to `party[i]` by party order; enemies to `enemySets[String(count)]`, or the boss sets when the encounter has a boss. Feet sit on `rows[row].y + dy`. The battle code stops computing positions itself.
5. **Depth sort.** Every frame, draw shadows first, then the rings, then fighters sorted by feet y (ties: further from the centre first, then party before enemies). A lunging attacker uses the target's feet y + `lungeOverTarget` while in contact. Effects draw over fighters, the HUD over everything. Enemy HP bars should draw with their owner in the sort (see the known gaps).
6. **Shadows and tint.** The contact oval per the `shadow` block, the cyan ring for the actor and an amber ring for the target, and the per-row depth tint with the actor and target exempt. Bake tinted copies per row once instead of tinting every frame.
7. **HUD widgets.** Each HUD region becomes a widget that reads its box and `show` rule from the config: timeline (needs a face crop per fighter: a face point per sprite, and for 2 px-grain art a crop at double size reduced by exactly 2), party table, command icon strip, enemy box (foe list or target details), banner, combo counter, on-stage enemy bars, active name tab, target name tab with A/B tags. The current `renderPanel` portrait row, the right-hand turn column and the prompt bar retire, or stay behind `preset: "ps4-panels"` for comparison only.
8. **Feedback.** Hit flash = a near-white silhouette that keeps the outline, 1-2 frames, with a 3 px knockback; damage numbers above the head, or on the upper body for tall rear targets.
9. **Checks as tests.** The acceptance checks in the mockup script (horizon range, row gaps, lane width, edges, front-shadow clearance, HUD share, shadow contrast) are cheap to run as a unit test over every stage file and every enemy set, so a bad edit fails `npm run check` instead of shipping.

## 6. What a Battle Stage Editor needs to edit it

The editor is a standalone page (like the FX lab) that loads a stage JSON, shows the real battle renderer, and saves the JSON back.
- **Backdrop panel:** pick the backdrop, switch reproject or replace, drag the horizon line (live-clamped to 92-112) with `shiftY` following it, sky-fade height.
- **Floor panel:** colour pickers for the two band colours, kerb and joints; sliders for band start, growth, seam strength far and near, joint spacing and strength, haze reach; add, drag and delete left-to-right stripes; puddle count and colours; a re-roll button for the seed.
- **Rows:** drag the depth-row lines up and down, with the 14-24 px gap rule shown as a warning.
- **Slots:** drag party and enemy feet markers; they snap to rows and show the sprite, its shadow and its overlap order live. A set picker (1-6, boss, boss+1, boss+2) and a roster picker to fill the set with real enemies, so the worst case (six punks) is one click.
- **Shadow and tint:** sliders for width share, aspect, strength, ring size; per-row tint amounts.
- **HUD:** drag and resize each region box, change its `show` rule and opacity, flip presets; a live readout of always-on screen share and the bottom-band clearance.
- **Checks:** the acceptance checks run on every change and list failures in plain words (for example "Set 6: enemy right edge 483, keep at 476 or less").
- **Battle test:** play a real fight in the stage with a chosen party and roster.
- **Save:** write `src/data/stages/<id>.json` the same way the FX lab writes `fx.json`.

## 7. Open questions for Mark

**Answered or defaulted 2026-10-02.** Questions 1 and 2: Mark chose to keep today's enemies in the spike and re-art them later; new side-facing (three-quarter, facing left) humanoid enemies at the crew's 1 px grain go on the Sprite Fusion shopping list (style reference now works at 64-96 px). Questions 3 to 5 default to the final design (ref 1's column, commands in the bottom band, new back walls for the indoor boxes and reprojection for outdoor stages); they become knobs in the Battle Stage Editor, where Mark can change them himself. Question 6 (the Lurker in the water channel) waits for the sewer fight. Question 7: yes, Mark's mockup will be expressed in this format and judged on the same rubric when it arrives.

1. **Enemy size and pixel grain.** The shipped enemies are 2 px-grain art at 2x, and the punk is 1.4x hero height. Options: (a) keep them as an accepted alpha exception; (b) draw humanoids at their native 1 px size (a punk about 46 px, 0.7x hero, the spike's current in-game default); (c) re-export the humanoid enemies at 1 px grain at about hero height (54-72 px), which is new art. Which one?
2. **Enemy facing.** The punks, medic, slinger, ghoul and the Warden face the camera, not the heroes. Is front-facing acceptable for alpha (a classic JRPG look), or should humanoid enemies get left-facing three-quarter art?
3. **Party column direction.** The final uses ref 1's column: lead hero lowest and furthest left, rear rows toward the centre. D3 had the reverse arc (lead lowest and nearest the enemies, like ref 3). Which reads better to you?
4. **Commands placement.** The final puts the command icons in the bottom band (bottom centre, ref 1 and 2). D3 popped a small list out beside the acting hero instead. Keep the bottom band, or try the pop-out again?
5. **Which backdrops get a new back wall?** The sewer needed one. Core and lab are probably also perspective boxes; the outdoor ones (street, rustyard, barrens, park, junction) should reproject. Agree?
6. **The Lurker** rises out of a splash. Should its fight put it in the water channel at the back, which would need its own slot rule?
7. **Your mockup.** When yours is ready, should it be loaded into this config format, so the two can be compared, merged, and judged on the same rubric?

## Files

Committed: this document, `docs/spikes/stage-configs/street.json`, `docs/spikes/stage-configs/sewer.json`.

Git-ignored, in `media/spike-side-battle/stage/`:
- Street: `final-street-0-empty.png`, `final-street-1-lineup.png` (Kit choosing), `final-street-2-boss.png` (Warden and two punks, Hex targeting), `final-street-3-action.png` (Rook's Arc Cut), `final-street-4-lineup.png` (six enemies, Sable acting), `final-street-9-all-sets.png` (every enemy set).
- Sewer: `final-sewer-0-empty.png`, `final-sewer-1-lineup.png` (ghoul, eel, Glowrat; Hex choosing), `final-sewer-2-boss.png` (The Lurker, Kit targeting), `final-sewer-3-action.png` (Kit's Iron Palm), `final-sewer-9-all-sets.png`.
- Each scene also has a `-x2.png` copy at double size. The checks are in `final-checks.txt`; the re-runnable source is in `final-src/` (`mkconfigs.py` writes the configs, `render.py` reads them and draws everything; paths inside point at the session scratchpad).
- Earlier rounds: `D1-classic-*`, `D2-lanes-*`, `D3-arena-*`.
