# PixelLab: what to take from it before the plan ends

Mark's PixelLab plan (Tier 1, 2,000 generations a month) started 2026-09-30 and he'll cancel it after one month, around **2026-10-30**. This page records what PixelLab does, what we learned from using it, and what our own tooling should copy, so the value stays after the plan is gone. The bet (Mark, 2026-09-30): code-drawn art plus Claude Code on his Max plan can recreate most of it, with consistency PixelLab couldn't give us.

Sources: PixelLab's API spec (`https://api.pixellab.ai/v2/openapi.json`, `/v2/llms.txt`), its editor docs (`https://www.pixellab.ai/docs`), and our own art pass (round 1: 963 generations, 165 options over 98 assets; round 2 and the portrait expressions after it). How the pass ran: `docs/DEVELOPING.md` §8. Balance on 2026-09-30, late: **827 generations**.

## What we keep, and on what terms

- **The art is ours to use, commercially too.** PixelLab's FAQ: "Yes, we only ask that you do not train new models with the images." Tracing them into our rig isn't training a model.
- **PixelLab says it doesn't store generated images** unless a tool says so (characters and objects made through the API do live in your account, and may go when it does). Ours are local: `media/art-pass/` (23 MB, every option and Mark's review) and `media/snapshots/art-pass-2026-09-30.tar.gz` (13 MB). **Both are git-ignored and on this machine only.** An off-machine copy is an open question for Mark (the repo is public, so not there unless he wants the art public).
- **What the game uses now:** tilesets and props as PNGs (`public/art/`); everything with a body (crew, NPCs, townsfolk, enemies, portraits) is *traced* from PixelLab picks into palette-indexed data (`public/art/rig/*.json`) and drawn and animated by code (rig v2, `docs/ARCHITECTURE.md` §7).

## What PixelLab does, and what replaces it

| PixelLab capability | What it gave us | Our replacement | Status |
|---|---|---|---|
| **Create character/object from a style image** (Pro Flash, `style_image`) | The look Mark liked: today's designs redrawn with more detail. The thing code can't do. | Trace once, then code: rig v2 draws, poses and recolours traced frames. New characters need a new source (see "After the plan"). | Done for every existing character |
| **8 rotations from one view** | Four facings per character | Traced per facing; code can't turn a character. Generate facings for future characters *before the plan ends*. | Gap for new characters |
| **Template / text animations** (walk, attack, cast) | Walks with small glitches; battle animations unusable (bodies drift, hair and clothes change, moves don't read) | Code animation on the rig: walks (legs by colour, foot lift, RotSprite stride), battle key poses, and next the **skeleton** (fixed-length bones, no stretching) with Mark's pose editor | Walks done; skeleton next |
| **Skeleton animation** (`estimate-skeleton`, `animate-with-skeleton-v3`, Re-pose) | Not used | The skeleton rig and editor we're building: a deterministic version of the same idea. Copy their joint model (below). | In progress |
| **Interpolation** (in-betweens from two keyframes) | Not used | Tweening bone angles between key poses: trivial once poses are skeleton data | Planned with the skeleton |
| **Inpainting** (mask = may change) | Portrait expressions (only the face box redrawn), arm poses on Kit's back (identity held, poses wrong) | Code redraws of the masked feature (expressions: eyes and mouth moved a pixel or two), and a **touch-up layer** in the editor: per-frame pixel fixes painted over the rig's output, by Mark or by Claude from his notes | Expressions done; touch-ups planned |
| **Lip-sync** (`vocal-animation` visemes, free `lip-sync` frame plan) | Not used | A talk frame per face, flapped while text types (done). Next step if wanted: 3–4 mouth shapes picked from the letters (open vowels, closed m/b/p), all code. | Basic done |
| **Wang tilesets** (two terrains, 16 corner tiles, 3 generations) | 5 tilesets in the game; the weakest category (generic raised blocks) | Kept as PNGs (Mark likes them). In code: procedural texture per terrain plus generated corner masks; `wangOverlay` in `src/art/drawn.ts` already lays any set in. | Kept |
| **Map objects / props** | 17 props in the game | Kept as PNGs; the prop painters stay for light, flicker and blocking | Kept |
| **Reduce colours** (frames quantized together to one shared palette) | Not used; we wrote our own | `scripts/art/trace.mjs`: one palette per character across all its frames (28 field, 40 battle/enemy/portrait) | Done |
| **Correct pixel art** (stray and anti-aliased pixels, tighter palette) | Not used | A cleanup pass in the tracer: orphan pixels, near-duplicate colours | Easy to add |
| **Unzoom** (recover native pixels from an upscaled image) | Not used | Detect the pixel grid and sample one per cell: a few lines in the tracer, for importing reference art | Easy to add |
| **Remove background** | PixelLab returned transparent frames | Flood fill from the corners with a colour tolerance | Easy to add |
| **Character states** (one text edit applied to every facing, snapped to the source palette) | Not used | Palette swaps and part swaps on the rig: the random-NPC generator prototype (status.md) | Queued |
| **Review objects** (`select-frames`, `dismiss-review`) | Not used | Our review page: versions side by side, frame flags, notes (`/artreview.html`) | Done, ours is better |

## Ideas to copy for our tooling

- **Their skeleton has 18 named joints:** nose, neck, eyes, ears, shoulders, elbows, "arms" (hands), hips, knees, "legs" (feet). Coordinates run 0–1 across the image, so one skeleton fits any size. Each joint also carries a **draw order** (`z_index`, higher on top: an arm in front of the body or behind it) and a **depth** (0–255, nearer the camera is higher, used to foreshorten). Our skeleton should name joints the same way, so a pose can move between characters, and keep draw order per bone.
- **Estimate the skeleton automatically**, then let the user nudge joints. A novice should never have to place a skeleton from nothing. In our tool, I place each character's joints once, and Mark only poses.
- **"Fixed head: always"** copies the reference frame's head into every frame, so the face never changes. The rig gets this for free, because unmoved parts are the traced pixels themselves.
- **Freeze some frames, generate the rest.** PixelLab's modes: freeze one frame and make two, or freeze two and make one. For us that's key poses (frozen, set by Mark) and in-betweens (made by code).
- **A "show reference" overlay** puts the source frame faintly behind the one being edited, which is onion skinning. The editor needs it.
- **The mask is a permission boundary:** paint where change is allowed, and everything else is locked. That's the right mental model for touch-ups. Mark paints the area, says what's wrong, and only that area changes.
- **Snap edits to the source palette** (`use_color_palette_from_reference`), so a fix can't bring in a colour the character doesn't have. Touch-ups in our editor pick from the character's palette only.
- **Describe the look, not the pose.** PixelLab's animation prompts separate what a character looks like from the motion. Our notes to Claude should separate them the same way ("the fist", "goes up past her head").

## What we learned from using it

- **Style references beat names.** Pro Flash with today's art as the style image was the best recipe. Naming "Phantasy Star IV" made output noisier, and prompt-only portraits came out as tiny full figures, not busts.
- **Faithful redraws beat new designs** (Mark's picks), for enemies especially. The bosses were the best of the lot.
- **AI animation drifts.** Bodies, hair and clothes change from frame to frame, and the moves didn't read. That's what sent us back to code animation on traced frames.
- **Inpainting keeps identity but not intent.** Kit's arm poses looked like her, but they weren't her moves. Pose direction has to come from Mark.
- **The tileset tool is generic,** making raised-block tiles. "Today's colours, more texture" came closest.
- **Operations:** 8 background jobs at a time (an animation is one job per direction, and the API may quietly start fewer); failed jobs must be re-requested, not re-polled; 128 px rotations took 15–20 minutes under load. Costs: a Pro Flash character 6–8 generations, an image 5–9, a template animation 1 per direction, a Wang tileset 3, a map object 1.

## Worth doing before the plan ends (each needs Mark's OK; costs in generations)

1. **Standing frames for every character, enemy and portrait still to come.** This is the one thing code can't make: the base drawing the rig traces. Anything planned for later chapters is worth generating now, in four facings, styled on the current art. Cost: about 6–8 per character, 5–9 per portrait or enemy.
2. **Run `estimate-skeleton` on our sprites** (cost unknown; check with one call). It would show where PixelLab puts joints on our art, as a starting point for our skeletons.
3. **Save one free `lip-sync` frame plan** as a format reference, in case mouth shapes become worth it (0 generations).
4. **Confirm `media/art-pass/` is complete,** comparing against `GET /characters` and `GET /objects` (free), and back it up off this machine.

## After the plan

New characters will need another source for their base drawing. In order of preference:

- **The random-NPC generator:** parts and palettes from the traced townsfolk, swapped and recoloured. It covers crowds and minor NPCs.
- **Mark draws them** in our editor, with the rig doing the animation.
- **Another generator** for a single standing frame, traced the same way.

Everything after the base drawing (facings aside) is already ours: tracing, walks, poses, expressions, talking, effects.
