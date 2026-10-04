/**
 * Mark's shipped design data (`src/data/*.json`), checked for INVARIANTS only: every file loads with the loader the game uses,
 * the hand-written structure is complete, and the files are in the stable format the editor writes them in. He edits these
 * files in the Battle Stage Editor, so nothing here may pin a value he can change (a position, a size, a proportion), and a
 * design-rule warning never fails this file (warnings are advice; the rules themselves are tested on fixtures in
 * `stagerules.test.ts`). The hero proportions and enemy facing files have their invariants beside their other tests
 * (`stageproportions.test.ts`, `stagefacing.test.ts`). The rule and the reason: `docs/DEVELOPING.md`, "Tests vs design data".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BG_IDS } from '../src/art/battlebg';
import { ENEMIES } from '../src/data/enemies';
import axesJson from '../src/data/axes.json';
import { checkAxes, checkHudFile, checkStages, enemySlots, SET_KEYS, setSize } from '../src/stage/config';
import { CREW_IDS } from '../src/stage/crew';
import { STAGE_KNOWN } from '../src/stage/known';
import { shippedEntries, shippedHud, shippedHudJson, shippedStages, shippedStagesJson } from './stagefiles';

const known = { enemies: Object.keys(ENEMIES), bosses: Object.keys(ENEMIES).filter((k) => ENEMIES[k]?.boss), crew: CREW_IDS };

describe('the shipped stage files', () => {
  it('stages.json passes the game’s own checks, with real backdrops, enemy keys and crew ids', () => {
    expect(checkStages(shippedStagesJson, BG_IDS, known)).toEqual([]);
    expect(checkStages(shippedStagesJson, BG_IDS, STAGE_KNOWN)).toEqual([]);
    expect(Object.keys(shippedEntries()).length).toBeGreaterThan(0);
  });

  it('hud.json passes the loader', () => {
    expect(checkHudFile(shippedHudJson)).toEqual([]);
    expect(shippedHud()).toBeDefined();
  });

  it('axes.json passes the checks', () => {
    expect(checkAxes(axesJson)).toEqual([]);
  });

  it('every stage has an enemy slot set for every group size and a roster that fills each, boss first in the boss sets', () => {
    for (const [id, s] of Object.entries(shippedStages())) {
      expect(s.id, id).toBe(id);
      expect(s.party, id).toHaveLength(CREW_IDS.length);
      for (const key of SET_KEYS) {
        expect(enemySlots(s, key), `${id} ${key}`).toHaveLength(setSize(key));
        expect(s.demo.rosters[key], `${id} ${key}`).toHaveLength(setSize(key));
      }
      for (const key of ['boss', 'boss+1', 'boss+2']) expect(enemySlots(s, key)[0]?.size, `${id} ${key}`).toBe('boss');
    }
  });

  it('every file uses LF line endings', () => {
    for (const f of ['stages', 'hud', 'axes', 'enemyfacing', 'heroes']) {
      const text = readFileSync(new URL(`../src/data/${f}.json`, import.meta.url), 'utf8');
      expect(text.includes('\r'), `${f}.json`).toBe(false);
    }
  });
});
