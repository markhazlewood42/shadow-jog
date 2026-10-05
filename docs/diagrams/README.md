# Diagrams

The diagrams in Shadow Jog's docs are made with the `diagram-design` skill (in Mark's home-base: `skills/diagram-design/`, command `/diagram-design`). Mark's rule (2026-10-05): use it, not Mermaid, for architecture and technical diagrams.

- **Where they live.** Each diagram sits in a `diagrams/` folder next to the doc that shows it: `docs/diagrams/` for docs in `docs/`, and `docs/engine/diagrams/` for the engine design. Each diagram has two files: the `.png` that the doc embeds, and the `.html` source to edit.
- **The look.** The repo-root file `.diagram-design` selects the `shadow-jog` profile: a dark skin from the game's own UI colours (navy panels, lavender frame, white text, amber for the one or two focal nodes, cyan for links, no glow). `profile/shadow-jog.md` is a copy of that profile, and `profile/NOTES.md` explains the colour mapping and the contrast ratios. On a new machine, copy `profile/shadow-jog.md` to `~/.diagram-design/profiles/shadow-jog.md`.
- **To change a diagram.** Edit its `.html`, run the skill's checks (`scripts/self_check.py` and `repo-scripts/verify-geometry.py` in the skill folder), then render a new `.png` at device scale 2 with a solid background in the profile's paper colour, so it reads in GitHub's light and dark themes.
- **Text size.** GitHub shows a doc image at about 880 CSS pixels wide. Keep every label readable at that width.
