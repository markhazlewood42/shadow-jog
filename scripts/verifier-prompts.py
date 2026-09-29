"""
Builds the eleven reviewer prompts for a verification round from the rubric's verbatim template
(docs/quality/rubric.md) and the per-area evidence lists below.

    python scripts/verifier-prompts.py 13 [out_dir]

writes <out_dir>/verifier_r13_<n>.txt for n = 1..11 (out_dir defaults to ./reviewer-prompts,
which is gitignored). Each file is handed to a fresh
reviewer subagent ("Read this file and follow it exactly"). When a round adds screenshots or
evidence files, add them to that area's lists here.
"""
import json
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')
import os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..') + '/'
ROUND = int(sys.argv[1]) if len(sys.argv) > 1 else 0
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'reviewer-prompts')
os.makedirs(OUT, exist_ok=True)
rubric = open(ROOT + 'docs/quality/rubric.md', encoding='utf-8').read()
template = re.search(r'```\n(You are an independent reviewer.*?)```', rubric, re.S).group(1)
rows = {}
for line in rubric.splitlines():
    m = re.match(r'\| (\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|', line)
    if m:
        rows[int(m.group(1))] = (m.group(2).strip(), m.group(3).strip(), m.group(4).strip())

S = 'docs/screenshots/'
def shots(*names):
    return ', '.join(S + n for n in names)

MAPS = ', '.join(S + 'maps/' + m + '.png' for m in ['lantern_row', 'bar', 'world', 'rustyard', 'sinkline_1', 'annex', 'dock'])
EV = 'docs/quality/evidence/'
areas = {
    1: (shots('11-battle-command.png', '13-battle-action.png', '04-lantern-row-street.png'),
        'src/engine/*.ts, src/main.ts, src/boot.ts, src/devroutes.ts, src/game/debug.ts, src/scenes/battle.ts, src/scenes/battlekit/*.ts (render.ts: the renderer split out of the scene; timing.ts; geom.ts), src/field/lighting.ts, e2e/perf.spec.ts, tests/orders.test.ts, tests/content.test.ts, tests/playback.test.ts, tests/glyphs.test.ts, tests/timing.test.ts, scripts/bundle-budget.mjs, src/scenes/field.ts, src/field/weather.ts, src/field/lighting.ts, src/battle/engine.ts, src/game/save.ts, tsconfig.json, biome.json, .github/workflows/ci.yml, tests/*.ts, src/scenes/fieldkit/*.ts (the field scene split), src/engine/shake.ts, src/scenes/battlekit/motion.ts, tests/atmosphere.test.ts, tests/motion.test.ts, src/engine/assert.ts, src/game/systems.ts (loadBattle: the battle chunk)',
        f'{EV}unit-tests.txt, {EV}typecheck.txt, {EV}lint.txt, {EV}perf.txt, {EV}bundle.txt'),
    2: (shots('04-lantern-row-street.png', '05-lantern-row-plaza.png', '06-bar-dialog.png', '18-sinkline.png', '19-world.png', '20-rustyard.png', '21-annex.png', '27-annex-lattice.png', '29-annex-crawlspace.png', '30-sinkline-intake.png', '31-world-radio-lot.png', 'progress-01-cast-sprites.png', '32-crowd-sprites.png', '37-annex-cryopod.png', '37b-annex-cryopod-empty.png', '18b-sinkline-intakes.png') + ', ' + MAPS,
        'src/art/chars.ts, src/data/looks.ts, src/field/tiles.ts, src/field/props.ts, src/field/buildings.ts, src/field/lighting.ts, src/field/weather.ts, src/data/maps/interiors.ts (bar), src/data/maps/lantern_row.ts (plaza), src/data/maps/sinkline.ts, src/data/maps/annex.ts, src/data/maps/world.ts, src/scenes/field.ts (drawShell: interiors in their building)',
        'none'),
    3: (shots('11-battle-command.png', '12-battle-techs.png', '13-battle-action.png', '14-battle-combo-hint.png', '15-battle-combo.png', '16-battle-warden.png', '17-battle-lurker.png', '22-battle-victory.png', '38-battle-rat-pack.png', '38b-battle-hound-pack.png', '15b-battle-triple-combo.png', '16b-enemy-poses.png', '16c-boss-poses.png', '13b-swing-gather.png', '13b-swing-raise.png', '13b-swing-cut.png', '13b-swing-settle.png'),
        'src/scenes/battle.ts, src/scenes/battlekit/*.ts, src/battle/fx.ts, src/art/enemies.ts, src/art/battlers.ts, src/art/battlebg.ts, src/art/portraits.ts',
        'none'),
    4: (shots('01-title.png', '03-dialog-portrait.png', '06-bar-dialog.png', '07-menu.png', '08-menu-status.png', '09-menu-equip.png', '10-shop.png', '12-battle-techs.png', '14-battle-combo-hint.png', '10b-shop-sell.png', '24-ending-results.png', '25-ending-next.png', '26-menu-bestiary.png', '33-menu-places.png', '33b-menu-place-map.png', '34-game-over.png', '35-options.png', '36-controls.png'),
        'src/ui/*.ts, src/engine/font.ts, src/scenes/menu.ts, src/scenes/placemap.ts, tests/layout.test.ts, src/scenes/shop.ts, src/scenes/saveload.ts, src/scenes/options.ts, src/scenes/dialog.ts, src/scenes/title.ts, src/scenes/controls.ts, src/scenes/gameover.ts, src/scenes/battlekit/render.ts (renderPanel, renderTargetInfo, renderOrder, menus), src/scenes/field.ts (drawShell), src/engine/display.ts (scaling), tests/glyphs.test.ts, src/main.ts (notice overlay), tests/ui-list.test.ts, tests/game.test.ts',
        f'{EV}unit-tests.txt'),
    5: (shots('11-battle-command.png', '12-battle-techs.png', '13-battle-action.png', '14-battle-combo-hint.png', '15-battle-combo.png', '16-battle-warden.png', '17-battle-lurker.png', '26-menu-bestiary.png', '15b-battle-triple-combo.png'),
        'src/battle/engine.ts, src/battle/ai.ts, src/battle/types.ts, src/data/abilities.ts, src/data/enemies.ts, src/scenes/battle.ts, src/scenes/battlekit/timing.ts, src/scenes/battlekit/playback.ts, src/game/settings.ts, tests/timing.test.ts, tests/balance.test.ts, tests/sim.ts, tests/stages.ts, tests/battle.test.ts, tests/auto.test.ts',
        f'{EV}unit-tests.txt'),
    6: (shots('09-menu-equip.png', '10-shop.png', '10b-shop-sell.png', '24-ending-results.png', '24c-ending-results-driven-test-run.png'),
        'src/data/items.ts, src/data/shops.ts, src/data/enemies.ts (xp/cred), src/data/maps/*.ts (chests), src/game/stages.ts, src/game/party.ts (rest, innPrice), src/game/systems.ts (inn, clinic), src/scenes/shop.ts (prices, discounts), src/story/chapter1.ts (magsReward: the collection fork), src/data/maps/rustyard.ts, tests/economy.test.ts, tests/economy.ts, tests/route.ts, tests/pacing.test.ts, tests/stages.ts, tests/balance.test.ts, e2e/economy.spec.ts',
        f'{EV}unit-tests.txt, {EV}e2e-playthrough.txt'),
    7: (shots('02-intro-panels.png', '03-dialog-portrait.png', '06-bar-dialog.png', '23-ending-panels.png', '23b-ending-finale.png', '24-ending-results.png', '25-ending-next.png', '15b-battle-triple-combo.png'),
        'docs/GDD.md (glossary), src/story/chapter1.ts, src/scenes/panels.ts, src/scenes/ending.ts, src/data/maps/*.ts (NPC and event dialogue), src/data/items.ts and src/data/enemies.ts (descriptions, lore), src/data/speakers.ts',
        'none'),
    8: (shots('04-lantern-row-street.png', '05-lantern-row-plaza.png', '18-sinkline.png', '19-world.png', '20-rustyard.png', '21-annex.png', '27-annex-lattice.png', '28-annex-panel.png', '29-annex-crawlspace.png', '30-sinkline-intake.png', '31-world-radio-lot.png', '33-menu-places.png', '33b-menu-place-map.png', '37-annex-cryopod.png', '37b-annex-cryopod-empty.png', '18b-sinkline-intakes.png', '18c-sinkline-lure.png') + ', ' + MAPS,
        'src/data/maps/*.ts, src/field/props.ts (valve, loom, lure), src/story/chapter1.ts (puzzles: pumpValve, floodgate, relay, lattice, latticeEmitters), tests/maps.test.ts, tests/mapgraph.ts',
        f'{EV}unit-tests.txt'),
    9: ('docs/quality/evidence/audio/*.png (one spectrogram per song, rendered offline through the game mix; open a few)',
        'src/audio/engine.ts, src/audio/music.ts, src/audio/songs.ts, src/audio/sfx.ts, tests/music.test.ts, src/scenes/dialog.ts (ducking), src/scenes/options.ts (volume preview), src/scenes/field.ts (placeMusic), src/data/maps/annex.ts (dock space), e2e/audio-evidence.spec.ts',
        f'{EV}audio.txt (levels, loudness range, band balance, SFX levels from offline renders), {EV}audio-loops.txt (every loop seam rendered and measured), {EV}unit-tests.txt'),
    10: (shots('02-intro-panels.png', '03-dialog-portrait.png', '13-battle-action.png', '15-battle-combo.png', '22-battle-victory.png', '23b-ending-finale.png', '34-game-over.png', '13b-swing-gather.png', '13b-swing-raise.png', '13b-swing-cut.png', '13b-swing-settle.png', '15b-battle-triple-combo.png'),
        'src/scenes/battle.ts, src/scenes/battlekit/*.ts, src/battle/fx.ts, src/scenes/gameover.ts, e2e/perf.spec.ts (input latency), src/scenes/dialog.ts, src/scenes/panels.ts, src/scenes/field.ts, src/engine/game.ts, src/engine/input.ts, src/game/settings.ts, src/scenes/options.ts, src/field/weather.ts, src/field/actor.ts, src/ui/list.ts, src/engine/shake.ts, src/scenes/battlekit/motion.ts, tests/motion.test.ts',
        f'{EV}perf.txt, {EV}e2e-playthrough.txt'),
    11: ('none (judge from code and test output)',
        'index.html (the pre-start error screen), src/main.ts, src/engine/game.ts, src/engine/errors.ts, src/boot.ts, src/game/save.ts, src/game/systems.ts, src/scenes/saveload.ts, src/scenes/title.ts, e2e/*.spec.ts, e2e/route.ts, tests/save.test.ts, tests/game.test.ts, tests/maps.test.ts, e2e/prod.spec.ts, e2e/economy.spec.ts, e2e/chaos.spec.ts, tests/fixtures/save-v1-annex.json, src/audio/engine.ts (navigation-safe audio), playwright.config.ts, .github/workflows/ci.yml',
        f'{EV}e2e-playthrough.txt, {EV}unit-tests.txt, {EV}ci-engines.txt (a CI run: every E2E test, with WebKit and Firefox on the save, game-over and shipped-build flows)'),
}
out = {}
for n, (scr, files, test) in areas.items():
    name, bar, cap = rows[n]
    p = (template.replace('{AREA_NAME}', name).replace('{AREA_BAR}', bar).replace('{AREA_CAP}', cap)
         .replace('{SCREENSHOT_PATHS}', scr).replace('{FILE_PATHS}', files).replace('{TEST_OUTPUT_PATH}', test))
    p = 'Working directory: C:/Users/markh/home-base/projects/shadow-jog (all paths are relative to it). Read-only review: do not edit any files.\n\n' + p
    out[n] = {'name': name, 'prompt': p}
json.dump(out, open(os.path.join(OUT, 'prompts.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for n, v in out.items():
    open(os.path.join(OUT, f'verifier_r{ROUND}_{n}.txt'), 'w', encoding='utf-8').write(v['prompt'])
print('wrote', len(out))
