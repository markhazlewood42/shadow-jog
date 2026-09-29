# SHADOW JOG

A cyberpunk-fantasy JRPG for the browser, in the vein of Phantasy Star IV: a world map, a town, a small crew,
round-based battles with combos and timed presses, and a story told in dialogue and comic panels. Chapter One,
"Milk Run", is an alpha of about 45–75 minutes.

Everything is made in code: the sprites, tiles, portraits, music and sound are generated at runtime, with zero
runtime dependencies (Vite + TypeScript, Canvas 2D at 480×270).

```bash
npm install
npm run dev        # http://localhost:3007
npm run build && npm run preview   # the shipped build, http://localhost:3008
npm run check      # lint, typecheck, unit tests
```

Controls: arrows/WASD move, Z/Enter confirm, X/Esc back, C/Tab menu, Shift dash, F fullscreen (rebindable in
Options → Controls).

## Documentation

- `status.md`: where the project stands and what's next
- `docs/GDD.md`: the design · `docs/GLOSSARY.md`: names and terms · `docs/SETTING.md`: the world
- `docs/ARCHITECTURE.md`: how the code fits together · `docs/DEVELOPING.md`: working on it
- `docs/quality/GRADING.md`: how quality was graded, and the score history
