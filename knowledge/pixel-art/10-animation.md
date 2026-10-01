---
type: topic
title: "Module 10: Animation"
project: shadow-jog
created: 2026-10-01
updated: 2026-10-01
tags: [pixel-art, animation, walk-cycle, key-poses, smear-frames, sub-pixel, timing, squash-and-stretch]
sources: ["[[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11 beginner series]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/pe-animation|Pixel-Editor animation]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-animation-principles|Wikipedia: Animation principles]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-08-animation|Slynyrd 8]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-50-walk-cycle|Slynyrd 50]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-09-melee|Slynyrd 9]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/hg101-phantasy-star-iv|HG101 on PSIV]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/tinywarrior-subpixel|Tiny Warrior Games]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd 39]]", "[[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd 47]]"]
---

# Module 10: Animation

Previous: [[projects/shadow-jog/knowledge/pixel-art/09-sprites-and-characters|Sprites and characters]]. Next: [[projects/shadow-jog/knowledge/pixel-art/11-tiles-and-environments|Tiles and environments]]. Terms are defined in the [[projects/shadow-jog/knowledge/pixel-art/glossary|glossary]].

## What you'll learn

- How frames, timing and loops make motion.
- How to plan an animation from key poses, and how many frames a walk or run really needs.
- The few classic principles (squash and stretch, anticipation, follow-through) that matter most in pixel art.
- What smear frames and sub-pixel animation are.
- Why some games animate very little and still feel alive.

## The core ideas

**Animation is a list of pictures with a duration each.** Each picture is a frame. Playing them in order produces the impression of movement, and the length of time each frame stays on screen controls pace and weight. Saint11's first animation lesson uses a bouncing ball. Giving the ground-contact frame a longer duration (the example uses 300 ms) makes the bounce feel grounded, and changing durations costs nothing compared with drawing more frames ([[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11 beginner series]]). Pixel-Editor.com agrees: short durations during fast action and longer ones in holds are the main control over pace in pixel animation, which has no automatic tweening ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-animation|Pixel-Editor animation]]).

**Straight-ahead or pose-to-pose.** Straight-ahead means drawing frame after frame in order. Saint11 recommends it for beginners, starting from a still frame that sets the look. Pose-to-pose means drawing the key poses first (the extremes of the action) and filling in between them. Wikipedia's article on the classic twelve principles names both as separate methods ([[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-animation-principles|Wikipedia: Animation principles]]). Slynyrd's run-cycle lesson is a pose-to-pose lesson. Find the most dynamic poses, make them strong, and add transitions only if needed ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-08-animation|Slynyrd 8]]).

**Key poses carry the animation.** In a walk, the stride pose (opposite arm and leg extended, a slight forward lean) is the one that matters most. Pixel-Editor.com observes that this one pose, mirrored, yields a basic four-frame walk. In Slynyrd's human walk cycle the structure has four named positions: contact (heel touches, limbs at maximum extension, body at its lowest), down (the foot flattens), passing (legs cross, the tallest pose) and swing (the leading leg at its widest arc). He says an 8-frame loop is the optimum fluid version, a 4-frame version is sparse but captures the motion, and a 6-frame version drops the least harmful frames ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-50-walk-cycle|Slynyrd 50]]). The head's height over the cycle follows a triangular wave, with sharper turns than a perfect sine, which feels more energetic. Fewer frames can also be better. Extra in-betweens dilute strong key poses (Slynyrd 8). The Mega Man run is his example of an effective short cycle: three distinct frames, with strong stride poses and the character leaning forward.

**Frame counts and rates, with a disagreement.** Pixel-Editor.com calls 8 frames per second the industry standard for sprite animation, with 12 for impacts and 4 to 6 for ambient loops. I did not find another source that states a standard rate, and the page offers no evidence for the claim, so treat the numbers as starting points. Slynyrd's note shows the real relationship. A 3-frame run at 160 ms per frame feels different from an 8-frame run at 80 ms per frame, and when you remove frames from a cycle you have to retime what is left or it turns sluggish ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-08-animation|Slynyrd 8]]). Frame count and duration are one decision, and that is more useful than a fixed rate.

**Hold frames and overshoot give weight.** Freezing a pose for a few extra frames on contact or at the peak of a swing amplifies impact. Slynyrd's melee lesson adds that overshooting the stopping point slightly, as a pendulum would, suggests momentum, and that holds should stay short. Long ones read as awkward ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-09-melee|Slynyrd 9]]). Pixel-Editor.com's animation guide calls repeated frames the main easing tool in pixel art.

**The principles that matter most.** The Disney "twelve principles" (Thomas and Johnston, 1981) are listed in Wikipedia's article. The four that pay off fastest in small sprites:

- Squash and stretch: the shape deforms with motion, and volume stays roughly constant. Squash on contact, stretch at speed.
- Anticipation: a small move opposite to the action (a crouch before a jump, an arm pulled back before a throw). Even one frame helps.
- Follow-through: loose parts keep moving after the body stops (hair, cloak, a weapon).
- Exaggeration: pure realism looks dull, so push the key poses.

All four appear in Pixel-Editor.com's animation guide and Saint11's ball lesson, and in Wikipedia's list ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-animation|Pixel-Editor animation]], [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-animation-principles|Wikipedia: Animation principles]]).

**Responsiveness against polish.** Slynyrd points out the tension for playable characters. Anticipation reads as input lag and long recovery as sluggishness, so a snappier animation with fewer frames can feel better than a lavish one ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-09-melee|Slynyrd 9]]). In a turn-based game the player is not controlling the animation, so there is more room for anticipation and holds. The cost is the player's patience, and the game's own battle pace ([[projects/shadow-jog/knowledge/pixel-art/sources/hg101-phantasy-star-iv|HG101 on PSIV]]) shows how important that is: Phantasy Star IV kept its elaborate animations on both sides but speeded them up compared with the series' earlier games.

**Smear frames.** A smear frame draws the motion itself: a stretched limb, a trailing arc, a streak where the weapon swept. It replaces several in-betweens, and is meant to be on screen for only a frame or so. Slynyrd says a single smear usually suffices, that it should follow the arc of the swing and that smears should stay few and fast ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-09-melee|Slynyrd 9]]).

**Sub-pixel animation.** The grid only allows whole-pixel positions, so slow movements look jerky. Sub-pixel animation fakes half-pixel steps by adding and removing pixels at the moving edges, usually with in-between tones, so the shape appears to slide smoothly. Tiny Warrior Games' article says it works better on larger sprites and on simple regions, and warns against smearing detailed areas ([[projects/shadow-jog/knowledge/pixel-art/sources/tinywarrior-subpixel|Tiny Warrior Games]]).

```
a bar sliding half a pixel (m = a tone between bar and background)
f1  ..DDDD....
f2  ..mDDDm...
f3  ...DDDD...
```

**Idles and economy.** Slynyrd's introduction notes that early JRPGs often reused walk frames as idle animation, so characters appeared to march in place, and that a simple idle (a bounce or a breath) is enough. In his Phantasy Star-inspired study he keeps idles static and lets the vibrant palette provide life, with a three-frame walk ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd 39]]). The idea behind both is that animation is a budget, and a small team cannot give every character an eight-frame idle.

**Loops and checking.** Always watch the animation looped at speed. A single-pass viewing hides the seam. Onion skinning shows the previous frame faintly under the current one so you can check spacing ([[projects/shadow-jog/knowledge/pixel-art/sources/pe-animation|Pixel-Editor animation]]). Even one orphan pixel is obvious in a loop (Slynyrd 8), because it repeats.

**Start simple.** Slynyrd's advice is to design sprites with clear colour separation for the sake of animating, and to pick a size you can keep up with. A bouncing ball is the standard first exercise in Saint11's and Pixel-Editor.com's lessons.

## Common mistakes

- Equal timing on every frame, which feels like a slideshow.
- No anticipation or follow-through, so actions start and stop instantly.
- A walk with no vertical bob (it glides).
- Squash without volume (the ball grows when it lands).
- A loop that does not match end to start.
- Redrawing the whole character in each frame, so clothes and details drift. Slynyrd's solution is to build from a dummy and keep details consistent.
- Trying to animate a detailed sprite before the motion works with the plain version.

## Practice

1. Animate a bouncing ball: straight-ahead, 8 frames, then adjust only durations, then add squash and stretch.
2. Draw the contact and passing poses of a walk, mirror them for the other side, and loop at four frames. Then add two more and compare.
3. Make a one-frame smear for a sword swing and test how many frames of it you can show before it looks like a mistake.
4. Slide a rectangle across 8 pixels using whole steps, then redo it with half-pixel frames.
5. Play the same run as three frames at 160 ms and as eight frames at 80 ms, and describe how the two feel different.

## How I'd teach it

Begin with the ball and hold the character until the class can make it bounce convincingly. Then show the stride pose as the one drawing that matters most, and have learners animate a walk by mirroring it. Use timing before more drawing: show how changing durations alone changes weight. Novices often over-draw frames when what the animation needs is a hold. Offer a "frame budget" and have them justify each frame. Sub-pixel animation is optional and fits students who already have a sense of timing.

## In Shadow Jog

The field walk is a four-phase cycle whose phase advances with distance. In `src/field/actor.ts` the stride counter grows by two per tile moved, so the feet never slide on the ground. Rig v2 builds the walks from the traced standing frame. Below the hip, only trouser and boot colours move, the legs swing about the hip by RotSprite when seen from the side, a foot lifts one pixel when facing front or back, and the body bobs on passing steps (`docs/ARCHITECTURE.md` section 7, `rig2/rig.ts`). That matches the key-pose structure above (contact and passing) and respects "one pixel is the minimum movement that registers" in Slynyrd's tiny-pixel lesson ([[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd 47]]).

Battle animation follows the Phantasy Star IV approach `docs/CONCEPTS.md` describes: two or three held poses per action (stance, strike, recover) with code supplying movement, shake and smear. Key poses are set on a skeleton with fixed bone lengths and two-bone inverse kinematics, which is a way to prevent the stretched-limb problem that the tracing approach produced. All motion runs on one clock: `FX_PACE` (0.65) times the player's battle speed, with a `TURN_GAP` pause between actions, and a hitstop freeze on impact (`src/scenes/battle.ts`). The sources suggest a few additions:

1. **Anticipation and hold per action.** A one-frame wind-up before a strike, and a two-to-four-frame hold at contact, are the cheapest ways to add weight. Put them in the pose tables, so the pacing lives with the data.
2. **A smear frame per melee hit.** The renderer already trails tinted copies behind a strike. Following Slynyrd, one drawn arc frame, short and on the swing's path, would read better than several copies.
3. **Follow-through on loose parts.** Hair, coat hems and staffs hang still while legs move. A one-pixel lag on a coat hem after a stop would give the secondary motion that Wikipedia and Pixel-Editor.com name.
4. **Triangular bob.** If the body bob currently uses equal steps, a sharper rise and fall at the passing pose copies the triangular-wave finding in Slynyrd's walk-cycle article.
5. **Responsiveness.** `FX_PACE` slows every move. The Phantasy Star IV note says that its speed-up was a big part of what made its battles feel good, so it is worth keeping the pace setting visible in the options.

## Sources

- [[projects/shadow-jog/knowledge/pixel-art/sources/saint11-beginner-series|Saint11, Article 3: A Basic Aseprite Animation]]: https://saint11.art/pixel_art_articles/article3
- [[projects/shadow-jog/knowledge/pixel-art/sources/pe-animation|Pixel-Editor.com, Sprite Animation Fundamentals]]: https://www.pixel-editor.com/articles/sprite-animation-fundamentals
- [[projects/shadow-jog/knowledge/pixel-art/sources/wikipedia-animation-principles|Wikipedia, Twelve basic principles of animation]]: https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-08-animation|Slynyrd, Pixelblog 8: Intro to Animation]]: https://www.slynyrd.com/blog/2018/8/19/pixelblog-8-intro-to-animation
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-09-melee|Slynyrd, Pixelblog 9: Melee Attacks]]: https://www.slynyrd.com/blog/2018/9/8/pixelblog-9-melee-attacks
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-50-walk-cycle|Slynyrd, Pixelblog 50: Human Walk Cycle]]: https://www.slynyrd.com/blog/2024/5/24/pixelblog-50-human-walk-cycle
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-39-sci-fi-rpg|Slynyrd, Pixelblog 39: Sci-fi RPG]]: https://www.slynyrd.com/blog/2022/7/24/pixelblog-39-sci-fi-rpg
- [[projects/shadow-jog/knowledge/pixel-art/sources/slynyrd-47-tiny-pixels|Slynyrd, Pixelblog 47: Tiny Pixels]]: https://www.slynyrd.com/blog/2023/11/26/pixelblog-47-tiny-pixels
- [[projects/shadow-jog/knowledge/pixel-art/sources/tinywarrior-subpixel|Tiny Warrior Games, Pixel Art Sub-Pixel Animation]]: https://tinywarriorgames.com/2019/01/04/game-development-pixel-art-sub-pixel-animation/
- [[projects/shadow-jog/knowledge/pixel-art/sources/hg101-phantasy-star-iv|Hardcore Gaming 101, Phantasy Star IV]]: https://www.hardcoregaming101.net/phantasy-star-iv/
