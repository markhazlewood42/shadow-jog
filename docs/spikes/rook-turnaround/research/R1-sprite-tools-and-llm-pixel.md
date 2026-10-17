# R1: How AI sprite tools make sprites, and how LLMs draw pixel art

Date: 2026-10-17. Method: read-only web research. No Sprite Fusion MCP calls, no credits, no image generation. Every claim has a URL. "Inference" marks a claim that no source states.

## Short answer

1. Every dedicated pixel-art tool found uses a trained or fine-tuned image model (diffusion, sometimes a video model), plus post-processing that snaps to a grid and cuts the palette. None says that it prompts a text LLM to place pixels.
2. For 8 facings, the tools condition on a reference image. Ludo states that it builds a rigged 3D model. PixelLab trains a dedicated rotation model and says that small 45-degree steps work better than large jumps. General platforms (Scenario) use general image-edit models.
3. Public tests of LLMs that write raw pixel grids show weak results. Shape primitives, a returned grid or render, and a judge help. No source shows an LLM that invents unseen views of a character with high pixel accuracy.

## Findings per tool

### Sprite Fusion (spritefusion.com)
- Known: "an in-house model built specifically for professional pixel art". The output is "constrained to the selected size" (16, 32, 64 px). https://www.spritefusion.com/pixel-art-generator
- Known: it makes "N, NE, E, SE, S, SW, W, and NW views as one grouped batch". A style mode matches "palette, proportions, and rendering" of one reference sprite. https://www.spritefusion.com/pixel-art-generator
- Known: Hugo Duprez trains the model himself, and the model is "still a work in progress" (August 2026). https://phaser.io/news/2026/08/sprite-fusion-tilemap-editor-phaser
- Known: Sprite Fusion also ships Pixel Snapper, an open-source fixer for AI pixel art. It uses K-means palette, edge profiles to find the pixel step, and a color vote per grid cell. https://www.spritefusion.com/pixel-snapper/how-to-fix-ai-pixel-art
- Not public: architecture, base model, training data, and how the 8 views stay consistent.
- Inference: a team that publishes a grid-snap tool probably uses a similar snap step after its own generator. No source confirms this.

### PixelLab (pixellab.ai)
- Known: the PixelLab team published Pixel Party XL, "a full model training for better pixel art adherence based on SDXL". It works best near 128x128 and needs an 8x nearest-neighbor downscale. https://huggingface.co/pixelparty/pixel-party-xl
- Known: named in-house models "PixFlux" and "BitForge". https://www.pixellab.ai/llms-full.txt
- Known: the Rotate tool "is primarily trained to take an image of a character and generate 8 rotational views". Start from a south-facing reference. Sizes are 16 to 128 px. https://pixellab.ai/docs/tools/rotate
- Known: two rotation methods. One reference for all 7 views, or chain 45-degree steps. The model "is usually better at making small rotations", but chain errors accumulate. Fixes: inpaint, hand touch-up then re-run as init image, and mirror a good view for symmetric characters. https://pixellab.ai/docs/guides/rotating-a-character
- Known: the Pro tool returns all 8 views in "a single 3x3 grid (8 directions plus center reference)". https://www.pixellab.ai/docs/tools/create-8-rotations-pro
- Known: skeleton animation. "Set reference will automatically 'estimate skeleton'". Templates supply poses. Frames are "frozen" or inpainted, and "the model will produce better results with more information" (freeze 2, generate 1). https://www.pixellab.ai/docs/tools/animate-with-skeleton
- Inference: the 3x3 grid output suggests that the model makes all views in one image, so views share attention and stay consistent. This is a common multi-view trick (see MVDream below). PixelLab does not state it.

### Retro Diffusion (Astropulse)
- Known: the flagship model "uses the FLUX architecture". Earlier versions used "multiple specialized LoRAs". The founder says that success "is mostly about dataset, data preparation, and post processing". Post-processing is a "proprietary downscaling algorithm that uses clustering techniques" plus color quantization. https://runware.ai/blog/retro-diffusion-creating-authentic-pixel-art-with-ai-at-scale
- Known: character consistency comes from prompts, "Rather than relying on image-to-image approaches". Same source.
- Known: training data is "licensed assets from Astropulse and other pixel artists with their consent". The older local model is SD 1.5 compatible. https://astropulse.gumroad.com/l/RetroDiffusionModel
- Known: rd-animation makes short low-frame sprite sheets. An example preset is "four_angle_walking" at 48x48. https://replicate.com/blog/retro-diffusions-pixel-art-models-are-now-on-replicate
- Known: in RD Animation, reference images guide pose or design but "aren't used as starting frames". https://help.scenario.com/en/articles/retro-diffusion-models-the-essentials/

### Ludo.ai
- Known: "Ludo makes a rigged 3D model of your character, draws it in the style you pick" for up to eight directions. https://ludo.ai/docs/sprite-generator
- Known: animation uses video models (Hydra, Forge, "Forge Pixel" which renders on the sprite's own pixel grid). Ludo recovers the logical pixel size from style, file size, or lattice detection. Repeated edits "compound drift", so edit from the original. Same source.

### Scenario
- Known: the 8-Direction Sprite Generator turns "any character image into consistent 8-direction sprites". It runs on a general image model (the page lists a GPT Image model). It does not claim pixel art. https://www.scenario.com/apps/8-direction-sprite-generator
- Known: the turnaround guide lists general edit models (Nano Banana, Flux Kontext, GPT, Seedream). A Flux Kontext LoRA gives 4 views. https://www.scenario.com/post/generate-a-character-turnaround and https://www.scenario.com/models/character-turnaround-kontext

### God Mode AI and GameTorch
- Known: God Mode lists "isometric (8 directions)". Its pixel tool uses "a model trained for low-res sprites". Its Spine mode splits layers and moves bones, not "AI-repainted frames". https://www.godmodeai.co/
- Known: on its Show HN, the founder did not answer which models it uses. A commenter guessed "GPT 4o image => some image cleanup". https://hn.svelte.dev/item/44204181
- Known: the GameTorch founder called rotated views "a really hard problem. I'm working on it every single day." https://news.ycombinator.com/item?id=44207304

### Research and production methods for consistency
- Sprite Sheet Diffusion (CMU): Animate Anyone style. ReferenceNet for appearance, Pose Guider for skeleton, motion module. SD weights, 463 pairs from 11 characters. Consistency of fine detail stays a problem. https://arxiv.org/html/2412.03685v2
- Multi-view diffusion: Zero-1-to-3 conditions on an image plus relative camera pose (https://zero123.cs.columbia.edu). MVDream makes several views together for consistency (https://arxiv.org/pdf/2308.16512). SV3D uses video diffusion for orbit views (https://arxiv.org/abs/2403.12008). CharacterGen normalizes anime characters to a canonical pose before multi-view (https://hyper.ai/fr/papers/2402.17214).
- Pre-AI production: Dead Cells built 3D models and skeletons, then batch-rendered them to small pixel frames with an in-house tool. https://80.lv/articles/case-study-dead-cells-character-art-pipeline/
- Inference: no source confirms that any commercial pixel tool uses Zero123, SV3D, or MVDream. Ludo's 3D rig is the only stated 3D proxy.

## What is public about LLMs that draw pixel art directly

- Pixel Art Bench asks models for a 2-10 color palette and a 24x24 index grid, judged by Elo. No scores are posted yet. https://emergentmind.com/pixel-art-bench
- Asset Forge: "asking an LLM to output raw pixel arrays produces incoherent results". Shape primitives (rect, circle, polygon) on a fixed palette work better. Claude Sonnet drew, Claude Opus judged. Tiles and simple objects scored 4.0-4.8 of 5. Complex subjects at 32-64 px became blobs. The key judge fix was to give it the rendered PNG plus an ASCII grid. https://matthewdeaves.github.io/assetforge/
- SwordsBench: 10 drawing tools (pixels, line, rect, fill, circle, preview). Claude Opus 4 scored best (2.5 of 3) and kept "a consistent character concept". Claude Sonnet 4 lost "all sense of body proportions" in a 4-frame sheet. https://ljvmiranda921.github.io/notebook/2025/07/20/draw-me-a-swordsman/
- pixscii: "LLMs can't draw. This MCP can." One hex character per pixel, about 80 tokens for 16x16. Each tool returns the grid "agent verifies". It adds mirror, Bresenham line, and flood fill with leak check. https://github.com/rxolve/pixscii
- ASCIIEval: models read text-grid pictures much worse than humans, and accuracy drops as the art gets longer. https://arxiv.org/html/2410.01733v2
- SVG: render-and-score RL (RLRF) improves SVG because plain LLMs "never observe the visual output" (https://arxiv.org/abs/2505.20793). Render-in-the-Loop feeds each partial render back before the next primitive (https://www.alphaxiv.org/abs/2604.20730.md). Simon Willison's pelican test shows parts that "float apart" and connect to nothing (https://simonwillison.net/tags/pelican-riding-a-bicycle/).
- Visual Sketchpad: models that draw marks and then look at them gain 8.6% on vision tasks. https://neurips.cc/virtual/2024/102102
- Gap: no source tests an LLM that invents an unseen facing of a fixed character. This matches the 50-59% held-out result. No public method is known to fix it with text alone.

## Implications for an LLM-only pipeline with zero image generation

What we can borrow:
1. **Small rotation steps (PixelLab).** Make each new facing from its nearest done neighbor (S to SE to E), not from S alone. Fix and approve each view before it becomes the next reference. Errors chain, so gate each step. Source: https://pixellab.ai/docs/guides/rotating-a-character
2. **Mirror, do not invent.** Make SW, W, and NW as flips of SE, E, and NE, then hand-fix asymmetric parts (weapon hand, hair part). This cuts the invented views from 7 to 4 (SE, E, NE, N). Same source.
3. **A 3D proxy, without image models (Ludo, Dead Cells).** Build a coarse code model: body-part boxes or cylinders, with a skeleton, in a tiny voxel or ray-cast renderer. Render each facing to a 32 px silhouette and part mask. The LLM then fills colors and outline inside a known mask, which is close to the copy task (99.6%) and not free invention. Inference, supported by https://ludo.ai/docs/sprite-generator and https://80.lv/articles/case-study-dead-cells-character-art-pipeline/
4. **Skeleton plus freeze-and-fill (PixelLab).** For poses and animation, keep the skeleton in data and move parts. Change only the pixels that a part move touches, and keep the other frames frozen as context. Source: https://www.pixellab.ai/docs/tools/animate-with-skeleton
5. **All views in one canvas.** Ask for the 8 facings as one 3x3 sheet in one reply, so the model sees the views together. This copies the multi-view idea in text form. Inference from https://www.pixellab.ai/docs/tools/create-8-rotations-pro and https://arxiv.org/pdf/2308.16512
6. **Primitives over raw pixels, and render-and-look.** Give the drawer line, rect, fill, and mirror tools that return the grid. Give the judge the PNG plus the ASCII grid. Sources: https://matthewdeaves.github.io/assetforge/ and https://github.com/rxolve/pixscii
7. **Deterministic cleanup (Retro Diffusion, Sprite Fusion).** Snap the result to the locked palette, and check for orphan pixels and outline breaks in code after each LLM pass. Sources: https://runware.ai/blog/retro-diffusion-creating-authentic-pixel-art-with-ai-at-scale and https://www.spritefusion.com/pixel-snapper/how-to-fix-ai-pixel-art
8. **Edit from the original.** Repeated edits drift (Ludo). Always derive a new pose from the approved base facing, not from the last edit. Source: https://ludo.ai/docs/sprite-generator

What we cannot borrow:
- The core of every commercial tool is a trained image model with a learned 3D prior from many example views. A text LLM has no such prior at 32 px. The tools do not solve unseen views with better prompts, so better instructions alone will probably not move held-out accuracy far. Inference from all tool sources above.
- Video-model animation (Ludo, Midjourney) and image-edit models (Scenario) count as image generation. They are out of scope.
- Exact pixel match on held-out views is not a goal that any tool claims. The tools target "consistent" and fix by hand (PixelLab tips, GameTorch). A better metric may be part-mask agreement plus a judge, not exact pixels. Inference.

Bottom line (inference): the best fit is less "LLM invents a view" and more "code builds the geometry, the LLM paints inside it". A small part-based 3D proxy gives silhouettes and masks for all 8 facings and every pose. The LLM then works at copy-like accuracy, with mirror, palette snap, and a render-and-look judge around it.
