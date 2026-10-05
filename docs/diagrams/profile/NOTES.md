# Shadow Jog profile for diagram-design

Result: the `shadow-jog` profile is ready to install. It is a dark-only skin built from the game's own colours.

## Files

| File | Install to |
|---|---|
| `shadow-jog.md` | `~/.diagram-design/profiles/shadow-jog.md` |
| `.diagram-design` | The repo root of the project. Content is exactly `profile: shadow-jog` |
| `swatches.html` and `swatches.png` | Reference only. The sheet passes `self_check.py` and `verify-geometry.py` with 0 findings. |

The profile body is the shipped `style-guide.md` with these changes: the intro, the Semantic roles table, the Series palette, the `backend` node fill, and the paper constraint. The Typography, Stroke, and Terminal sections are unchanged.

## Role mapping

Contrast ratios use the WCAG formula. The Light and Dark columns of the profile hold the same values.

| Role | Hex | Game source | On paper (#0d0c1f) | On paper-2 (#1c1a3a) |
|---|---|---|---|---|
| paper | `#0d0c1f` | `UI.fillBot` | n/a | n/a |
| paper-2 | `#1c1a3a` | `UI.fillTop` | n/a | n/a |
| ink | `#f4f1ff` | `UI.text`, `TEXT` | 17.32 | 15.00 |
| ink-strong | `#07060d` | `UI.outline` | 13.41 on accent | n/a |
| muted | `#bfc3e4` | `UI.dim` | 11.14 | 9.65 |
| soft | `#8f94bd` | `UI.soft` | 6.55 | 5.67 |
| rule | `rgba(122,128,196,0.28)` | `UI.frameLit` at 28% | 1.45 (decorative) | 1.49 (decorative) |
| rule-solid | `#7a80c4` | `UI.frameLit` | 5.24 | 4.54 |
| accent | `#ffcc3d` | `UI.amber` | 12.81 | 11.09 |
| accent-tint | `rgba(255,204,61,0.10)` | `UI.amber` at 10% | accent text 8.93, ink 12.08 (over paper-2) | n/a |
| link | `#3fe0f0` | `UI.cyan` | 12.05 | 10.44 |

Every text role is above WCAG AA (4.5:1) on both papers. `soft` is the lowest at 5.67:1. `ink` and `muted` meet the skin constraints with a wide margin. Node fills (store, input, focal tint) were also checked: `muted` is at least 9.6:1 and `soft` is at least 5.5:1 on them.

## Why these choices

- **Paper pair.** The game draws its windows as a vertical gradient from `fillTop` to `fillBot`. The profile uses the two ends as two flat papers. This keeps the navy look with no gradient.
- **Accent is amber, not pink.** Amber is the game's "this matters" colour (critical hits, the selected command). Pink is close in hue to the lavender frame and the violet, so a pink focal node would blur into the chrome. Amber is also warm against a cool field, so it reads as focal at a glance.
- **Cyan is `link` only.** Cyan never fills a box. This avoids the "dark mode plus cyan glow" anti-pattern.
- **`rule-solid` is `frameLit`, not `frame`.** The game's `frame` (`#4a4f86`) is only 2.53:1 on paper. `frameLit` gives 5.24:1, which suits baselines and axes. `rule` is a 28% hairline of the same colour. It resolves to `#2c2c4d`, close to the game's `inner` panel colour.
- **`backend` fill is `paper-2`.** The shipped rule fills `backend` with white. White would shout on navy.
- **Series palette** (radar only) uses game colours: green, resource blue, violet, pink, and `soft`. Amber and cyan stay out, because they are `accent` and `link`.
- **Typography is unchanged:** Geist, Geist Mono, Instrument Serif. A pixel title face (for example Pixelify Sans) would add a fourth family. It would not make the diagrams easier to read. Add one later only if Mark wants the look.

## Rules a generator must follow with this skin

1. Start from `assets/template-dark.html`. Replace its hex values with the table above (page rect `#0d0c1f`, markers `#bfc3e4`, `#ffcc3d`, `#3fe0f0`).
2. Use `#0d0c1f` for every label mask and node mask. The checklist text says `#f5f5f5`. That value is wrong for this skin.
3. Put `accent` on 1 or 2 nodes at most. No glow, no shadow, no bloom.

## Deliberate exceptions

- The shipped constraint "paper is warm-neutral" is replaced by "deep navy, not black". Matching the game is the purpose of the skin.
- The skin has no light variant. If one is needed, save a second profile.
- The checklist text in `SKILL.md` still names `#f5f5f5` for masks. This file records the override. No change was made to the vendored skill.

## Open decision for Mark

The main session must install the two files. The home-directory profile library does not exist yet on this machine, and `default.md` is created on the first `save` or `load`.
