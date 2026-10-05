<!-- diagram-design-profile
name: Shadow Jog
slug: shadow-jog
source-url: none
created: 2026-10-05
updated: 2026-10-05
notes: Dark-only skin from the Shadow Jog game palette (hudcolours.ts, draw.ts, font.ts). Amber accent, cyan link.
-->
# Style Guide

**The single source of truth for colors, typography, and tokens.** Every diagram draws from this — not from hex values inlined in other reference files. If you want to change the visual skin of Diagram Design, change this file.

This is the **Shadow Jog** skin: the game's own UI palette (`UI` in `src/stage/hudcolours.ts`, the `drawWindow` navy panels, the bitmap-font text colours) mapped onto the semantic roles. It is a **dark-only** skin. Build every diagram from `assets/template-dark.html`. The Light column below deliberately repeats the Dark column, so any variant a generator picks still renders in the game palette. Every colour is a hex the game already uses (see the role notes). No glow, no shadow, no bloom: the game's GPU bloom stays in the game.

---

## Tokens

### Semantic roles

Every token is referred to by **semantic role**, not by its hex value. Type references (`type-*.md`) and SKILL.md say `accent`, not `#ffcc3d`.

| Role | Purpose | Default (light) | Default (dark) |
|---|---|---|---|
| `paper` | Page background, default node fill | `#0d0c1f` (panel bottom, `fillBot`) | `#0d0c1f` (panel bottom, `fillBot`) |
| `paper-2` | Diagram container bg, secondary fill | `#1c1a3a` (panel top, `fillTop`) | `#1c1a3a` (panel top, `fillTop`) |
| `ink` | Primary text, primary stroke | `#f4f1ff` (game text white) | `#f4f1ff` (game text white) |
| `ink-strong` | High-contrast text on warm accent fills | `#07060d` (window outline) | `#07060d` (window outline) |
| `muted` | Secondary text, default arrow stroke | `#bfc3e4` (HUD `dim`) | `#bfc3e4` (HUD `dim`) |
| `soft` | Sublabels, boundary labels | `#8f94bd` (HUD `soft`) | `#8f94bd` (HUD `soft`) |
| `rule` | Hairline borders | `rgba(122,128,196,0.28)` (`frameLit` at 28%) | `rgba(122,128,196,0.28)` (`frameLit` at 28%) |
| `rule-solid` | Stronger borders, baselines | `#7a80c4` (window `frameLit`) | `#7a80c4` (window `frameLit`) |
| `accent` | Focal / 1–2 max per diagram | `#ffcc3d` (game amber) | `#ffcc3d` (game amber) |
| `accent-tint` | Fill for accent-bordered boxes | `rgba(255,204,61,0.10)` | `rgba(255,204,61,0.10)` |
| `link` | HTTP/API calls, external arrows | `#3fe0f0` (game cyan) | `#3fe0f0` (game cyan) |

> **Palette source:** the game's UI constants (`hudcolours.ts`, `src/ui/draw.ts`) and its text colours (`src/engine/font.ts`). `paper`, `paper-2`, `ink`, `ink-strong`, `muted`, `soft`, `rule-solid`, `accent`, and `link` are exact game hexes. `rule` and `accent-tint` are game hexes at a fixed alpha. Nothing is invented.

> **Why amber, not pink:** amber is the game's "this one matters" colour (critical hits, the selected command). Pink sits next to the lavender frame and the violet in hue, so a pink focal node would blur into the chrome. Amber is also warm against a cool navy field, the same logic as the default skin's tangerine.

> **Cyan is `link` only.** Use `link` for API or external arrows and nothing else. Cyan on navy is the shortcut to the neon look this skill avoids, so it never fills a box and never carries a glow.

> **Mask rects.** The opaque rect behind an arrow label uses the `paper` hex `#0d0c1f`, not `#f5f5f5`. On a `paper-2` container, use `#1c1a3a`. The same applies to the page `<rect>` and the arrow markers: marker fills are `#bfc3e4` (arrow), `#ffcc3d` (arrow-accent), and `#3fe0f0` (arrow-link).

### Inversion rule

This skin is dark-first, so there is no light-to-dark inversion. If a light variant is ever needed, derive it from the dark values on purpose and save it as a second profile. Do not flip these values by rule.

### Series palette (multi-series chart types only)

Game colours for chart types that must distinguish several overlapping series (currently: **radar**). `accent` (amber) stays reserved for the focal series and `link` (cyan) is not used here. The rest of the diagram keeps muted-ink variants.

| Token | Light | Dark | Notes |
|---|---|---|---|
| `series-1` | `#62e06a` (game green) | `#62e06a` | Non-focal series |
| `series-2` | `#3aa0e8` (resource bar blue) | `#3aa0e8` | Non-focal series |
| `series-3` | `#b07cff` (game violet) | `#b07cff` | Non-focal series |
| `series-4` | `#ff4fb0` (game pink) | `#ff4fb0` | Non-focal series |
| `series-5` | `#8f94bd` (HUD `soft`) | `#8f94bd` | Non-focal series |

Fills sit at `0.22` opacity; strokes use the full colour. **Don't backfill these tokens to non-chart types.**

### Terminal skin (opt-in alternate)

A self-contained palette for the terminal-window primitive (see [primitive-terminal.md](primitive-terminal.md)). It is not part of this skin and is not affected by it.

| Token | Hex | Purpose |
|---|---|---|
| `terminal-page` | `#0a0a0a` | Page background behind the window |
| `terminal-paper` | `#141414` | Window body, node fill |
| `terminal-bar` | `#1b1b1b` | Titlebar strip |
| `terminal-border` | `#2b2b2b` | Window border, hairlines |
| `terminal-ink` | `#f5f5f5` | Primary text, primary stroke (same white-smoke as default `ink`) |
| `terminal-muted` | `#9a9a9a` | Secondary text, sublabels, ring stroke |
| `terminal-soft` | `#5c5c5c` | Tertiary — inactive dots, spokes |
| `terminal-accent` | `#ff5a36` | The one accent — focal station, prompt sign, active dot |
| `terminal-accent-tint` | `rgba(255,90,54,0.12)` | Fill for accent-bordered boxes |

**1-accent rule still holds.** Everything that isn't `terminal-ink` or `terminal-muted`/`terminal-soft` should be `terminal-accent` — never introduce a second hue.

---

## Typography

| Role | Family | Size | Weight | Usage |
|---|---|---|---|---|
| `title` | Instrument Serif | 1.75rem | 400 | Page H1 |
| `node-name` | Geist (sans) | 12px | 600 | Human-readable labels |
| `sublabel` | Geist Mono | 9px | 400 | Port, protocol, URL, field type |
| `eyebrow` | Geist Mono | 7–8px | 500, tracked 0.18em, uppercase | Type tags, axis labels |
| `arrow-label` | Geist Mono | 8px | 400, tracked 0.06em | Arrow annotations |
| `callout` | Instrument Serif *italic* | 14px | 400 | Editorial asides only |

### Font stack

```html
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&family=Noto+Serif:ital@0;1&family=Noto+Sans+KR:wght@400;500;600&family=Noto+Serif+KR:wght@400&family=Noto+Sans+TC:wght@400;500;600&family=Noto+Serif+TC:wght@400&display=swap" rel="stylesheet">
```

### Korean labels

Geist and Instrument Serif carry no Hangul. A Korean `<text>` element extends its own family — never swap the skin:

```svg
<text font-family="'Geist', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif">결제 서비스</text>
```

Both Noto faces ship in the font link above, so the web font resolves before any locally installed one and the same file renders identically on macOS, Windows, and a reviewer's browser. The local families follow it for offline viewing. Page titles need the serif equivalent — `'Instrument Serif', 'Noto Serif KR', serif` — or a mixed Latin/Korean title resolves Hangul through the platform's generic serif and the two halves disagree. Google's `css2` endpoint slices Korean by unicode-range, so a diagram with a handful of Korean labels downloads only the slices it touches. The four templates carry both faces because a new diagram may contain Hangul; the shipped Latin-only examples keep the shorter link, since a file with no Hangul has nothing to resolve.

**Width budget.** Measure per character, not per script: **every Unicode wide or full-width character costs 1em, every other character costs its face's Latin advance** (0.60em sans, 0.62em mono), and nonspacing/enclosing marks cost nothing. Sum over the string and multiply by the font size for the text width, then add padding and round the box up to the next multiple of 4. `verify-treemap.py` enforces exactly this text width for treemap cell labels; the padding and rounding are authoring convention, and no other type carries an automatic check, so on those the budget is yours to hold.

Counting by script is the trap. `주문 v2.1` is two full-width syllables and five narrow characters; a formula that tallies Hangul, Latin letters, and spaces silently drops `2`, `.`, and `1` and sizes the box for four of its seven characters. Every rendered character costs something — measure per character, never per script.

Three rules follow from Hangul metrics:

- **Sublabels stay Latin.** Ports, protocols, field types, and URLs are Latin anyway — keep `Geist Mono` there and don't translate them. Hangul in a 9px mono sublabel is unreadable and has no mono face to fall back to.
- **Floor of 12px.** Hangul goes muddy below 12px. If a Korean name doesn't fit at 12px, cut the name — don't shrink the type.
- **Arrow labels, eyebrows, and legend text switch register.** Those slots are 7–8px Geist Mono, uppercase and tracked, which Hangul has neither a face nor legibility for. A Korean label in one of those slots becomes 12px sans at weight 500 with no tracking and no uppercase transform, and its mask rect grows to match (16px tall, width from the budget above, still rounded to a multiple of 4). Latin labels in the same diagram keep the mono treatment.

**Load-bearing rule:** Mono is for *technical* content (ports, commands, URLs, field types). Names go in Geist sans. Page title is Instrument Serif. Italic Instrument Serif is reserved for annotation callouts (see [primitive-annotation.md](primitive-annotation.md)). **Never JetBrains Mono** as a blanket "dev" font.

### Traditional Chinese labels

Geist and Instrument Serif carry no Han. A Traditional Chinese `<text>` element extends its own family — never swap the skin:

```svg
<text font-family="'Geist', 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif">請求項比對</text>
```

Both Noto TC faces ship in the font link above, so the web font resolves before any locally installed one and the same file renders identically on macOS, Windows, and a reviewer's browser. The local families follow it for offline viewing. Page titles need the serif equivalent — `'Instrument Serif', 'Noto Serif TC', serif` — or a mixed Latin/Han title resolves Han through the platform's generic serif and the two halves disagree. Google's `css2` endpoint slices Chinese by unicode-range, so a diagram with a handful of Chinese labels downloads only the slices it touches.

**Width budget.** The per-character contract above is unchanged: every Unicode wide or full-width character costs 1em, every other character costs its face's Latin advance, and nonspacing marks cost nothing. Full-width punctuation — `（）「」，。：` — is wide and costs 1em as well, which is the part most often dropped.

Counting by script is the trap. `請求項 v2.1` is three full-width characters and five narrow ones; a formula that tallies Han and Latin letters silently drops `2`, `.`, and `1` and sizes the box for six of its nine characters.

Three rules follow from Han metrics, mirroring the Hangul ones:

- **Sublabels stay Latin.** Ports, protocols, field types, and URLs are Latin anyway — keep `Geist Mono` there and don't translate them. Han in a 9px mono sublabel is unreadable and has no mono face to fall back to. A sublabel that is prose rather than a value may be Chinese, but it then switches register by the third rule below.
- **Floor of 12px.** Han packs more strokes than Hangul into the same em box, so the 12px floor binds at least as hard here. If a Chinese name doesn't fit at 12px, cut the name — don't shrink the type.
- **Arrow labels, eyebrows, and legend text switch register.** Those slots are 7–8px Geist Mono, uppercase and tracked, which Han has neither a face nor legibility for. A Chinese label in one of those slots becomes 12px sans at weight 500 with no tracking and no uppercase transform, and its mask rect grows to match (16px tall, width from the budget above, still rounded to a multiple of 4). Latin labels in the same diagram keep the mono treatment.

Simplified Chinese takes the same three rules with the Simplified stack (`'Noto Sans SC'`, `'PingFang SC'`, `'Microsoft YaHei'`). That face does not ship in the link, so Simplified labels still resolve through whatever the viewer has locally.

### Cyrillic labels

Geist and Geist Mono ship Cyrillic (`cyrillic` and `cyrillic-ext` on Google Fonts), so names, sublabels, arrow labels, eyebrows, and legend text in Bulgarian, Russian, Ukrainian, or Serbian keep the Latin treatment: same faces, sizes, tracking, and uppercase. There is no register switch: Hangul and Han switch register because Geist Mono has no face for them, and Geist Mono does cover Cyrillic.

Instrument Serif carries no Cyrillic. A page title extends its family — `'Instrument Serif', 'Noto Serif', serif` — or a mixed Latin/Cyrillic title resolves Cyrillic through whatever face comes next and the two halves disagree. Noto Serif ships in the font link above, upright and italic, so an italic callout in Cyrillic takes the same stack.

**Noto Serif goes ahead of the CJK serifs.** When a stack also lists `'Noto Serif KR'` or `'Noto Serif TC'`, put `'Noto Serif'` ahead of them. Google Fonts slices Cyrillic into those faces as well, so a stack that reaches a CJK face first draws its Cyrillic from it. That is why the templates put `'Noto Serif'` between `'Instrument Serif'` and `'Noto Serif KR'`; Noto Serif has no Hangul or Han, so Korean and Chinese titles pass straight through it.

**Width budget.** The per-character contract above is unchanged: every character costs its face's Latin advance (0.60em sans, 0.62em mono). It fits Geist Mono exactly and Geist sans only on average. Geist Mono is monospaced: a Cyrillic glyph advances exactly as far as a Latin one, so sublabels, arrow labels, eyebrows, legend text, and their mask rects are sized as for Latin. Geist sans is not. Its wide Cyrillic letters, capitals and lowercase alike (such as `Ж Ш Щ Ю Ы`, `ж ш щ ы ю`), run well past the 0.60em average: `Шкаф ODF-2` at 12px is budgeted at 72px and draws at about 76. Rounding the box up to a multiple of 4 recovers at most 3px, so it is not the remedy. Leave the overshoot in the box padding and measure a Cyrillic sans name in the browser — `verify-treemap.py` holds the budget, not the drawn width, so it will not catch the overshoot.

Counting by script is still the trap. `Шкаф ODF-2` is four Cyrillic letters, a space, three Latin letters, a hyphen, and a digit; a formula that tallies Cyrillic letters, Latin letters, and spaces silently drops `-` and `2` and sizes the box for eight of its ten characters.

**Preserve printed labels.** A label the reader matches against a physical thing — a cabinet, a splice closure, a port map — carries the exact printed string. Don't transliterate it and don't re-case it; if one has to sit in an uppercase slot such as an eyebrow, drop the transform for that label rather than re-case the printed string. `Шкаф ODF-2` stays `Шкаф ODF-2`, not `Shkaf ODF-2`.

---

## Stroke, radius, spacing

| Token | Value | Use |
|---|---|---|
| `stroke-thin` | `0.8` | Tag-box outlines, leaf nodes |
| `stroke-default` | `1` | Most strokes |
| `stroke-strong` | `1.2` | Emphasis strokes |
| `radius-sm` | `4` | Small tags |
| `radius-md` | `6` | Node boxes |
| `radius-lg` | `8` | Containers, rings |
| `grid` | `4` | Every coord, size, and gap is divisible by 4 (hard rule) |

---

## Node type → treatment

Semantic role combinations — reference these by name in type specs. On the dark paper a white box would shout, so `backend` fills with `paper-2`.

| Type | Fill | Stroke |
|---|---|---|
| `focal` (1–2 max) | `accent-tint` | `accent` |
| `backend` | `paper-2` (`#1c1a3a`) | `ink` |
| `store` | `ink @ 0.05` | `muted` |
| `external` | `ink @ 0.03` | `ink @ 0.30` |
| `input` | `muted @ 0.10` | `soft` |
| `optional` | `ink @ 0.02` | `ink @ 0.20` dashed `4,3` |
| `security` | `accent @ 0.05` | `accent @ 0.50` dashed `4,4` |

---

## Customizing the skin

Four options:

1. **Run onboarding** — see [`onboarding.md`](onboarding.md). Drop a URL; the skill extracts the palette + fonts and rewrites this file.
2. **Edit by hand** — change the hex values in the tables above. Run the pre-output taste gate afterward to verify the accent still reads as "focal" against the new paper color.
3. **Brand handoff** — paste your existing design-token JSON into a new section here and map its tokens to the semantic roles above.
4. **Client profiles** — save and switch named skins, or bind one to a project, using [`profiles.md`](profiles.md).

### Constraints (don't break these)

- **Contrast**: `ink` must hit WCAG AA on `paper`. `muted` must hit AA on `paper` for 11px+ text.
- **One accent**: pick one color for `accent`. Two accents erases the focal signal.
- **No rainbow palette**: if your brand ships 8 colors, pick 3 (paper, ink, accent). The rest become `muted` variants.
- **Serif + sans + mono**: three families, not more. If brand typography is all sans, keep Instrument Serif for `title` and `callout` anyway — the contrast is load-bearing.
- **Paper is deep navy, not black (deliberate exception)**: the shipped rule asks for a warm-neutral paper. This skin takes the game's navy panel instead, because matching the game is its purpose. Never use pure black or pure white.
- **Dot pattern is optional, not default**: the 22×22 dot pattern is an opt-in "dotted paper" variant (good for long-form editorial hero diagrams). The default background is a clean `paper` fill, no pattern. When the pattern is enabled, it should sit at ~10% opacity of `ink` on `paper` — visible but quiet.
- **Container is clean by default**: the diagram sits directly on the page paper, no secondary container background or border. A framed variant (`paper-2` bg + `rule` border + 8px radius + padding) is available as an opt-in for card-heavy layouts, but don't reach for it by default — the extra chrome fights the figure.
