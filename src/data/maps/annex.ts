/** K-M Annex 7 (B2) and the loading dock where the job goes wrong. */
import type { MapDef } from '../../field/types';
import { annexDoor, annexGuards, annexLog, betrayal, cryopod, wardenFight } from '../../story/chapter1';
import { LOOKS } from '../looks';
import { Grid } from './grid';

const W = 44, H = 34;

// L lab wall · _ lab floor · D sealed door · + floor grate
const g = new Grid(W, H, 'L')
  // Service room (ladder down from the Sinkline)
  .rect(2, 2, 9, 6, '_')
  // Corridor east to the security checkpoint
  .rect(6, 8, 3, 3, '_')
  .rect(6, 10, 8, 2, '_')
  .rect(14, 10, 1, 2, 'D')
  // Central lab hall
  .rect(15, 3, 15, 16, '_')
  // Side armory (west of the hall)
  .rect(15, 20, 6, 4, '_')
  .rect(17, 19, 2, 1, '_')
  // Cryo lab (north-east)
  .rect(31, 3, 11, 9, '_')
  .rect(30, 6, 1, 3, '_')
  // Passage south to the Warden chamber
  .rect(26, 19, 3, 3, '_')
  .rect(26, 22, 3, 1, 'D')
  // Warden chamber
  .rect(18, 23, 22, 9, '_')
  .rect(37, 32, 3, 1, '_');

export const annex: MapDef = {
  id: 'annex',
  name: 'K-M Annex 7',
  banner: 'ANNEX 7',
  bannerSub: 'Kessler-Mori · Decommissioned',
  kind: 'dungeon',
  terrain: g.rows(),
  legend: { L: 'lab_wall', _: 'lab_floor', D: 'lab_door', '+': 'grate' },
  ambient: '#6a7aa0',
  weather: 'none',
  music: 'lab',
  battleBg: 'lab',
  entrance: { map: 'world', x: 26, y: 38 },
  encounters: [{ table: 'annex', rate: 22, bg: 'lab', rect: [15, 3, 27, 29] }],
  patches: [
    { when: (f) => !!f.annex_key, rects: [[14, 10, 1, 2, '_']] },
    { when: (f) => !!f.sable_joined, rects: [[26, 22, 3, 1, '_']] },
  ],
  props: [
    { kind: 'ladder', x: 3, y: 2 },
    { kind: 'crates', x: 9, y: 3 },
    { kind: 'crates', x: 2, y: 6 },
    { kind: 'desk', x: 17, y: 4, w: 2 },
    { kind: 'desk', x: 22, y: 4, w: 2 },
    { kind: 'terminal', x: 27, y: 3, color: '#3fe0f0' },
    { kind: 'terminal', x: 16, y: 12, color: '#3fe0f0' },
    { kind: 'terminal', x: 29, y: 14, color: '#ff4fb0' },
    { kind: 'tank', x: 18, y: 8 },
    { kind: 'tank', x: 20, y: 8 },
    { kind: 'tank', x: 24, y: 8, color: '#b07cff' },
    { kind: 'tank', x: 26, y: 8 },
    { kind: 'tank', x: 18, y: 15, color: '#ff6a5a' },
    { kind: 'tank', x: 22, y: 15 },
    { kind: 'screen', x: 20, y: 2, w: 3, color: '#3fe0f0' },
    { kind: 'screen', x: 33, y: 2, w: 3, color: '#9ad8ff' },
    { kind: 'cryopod', x: 36, y: 4, w: 2 },
    { kind: 'tank', x: 33, y: 5, color: '#9ad8ff' },
    { kind: 'tank', x: 40, y: 5, color: '#9ad8ff' },
    { kind: 'desk', x: 33, y: 9, w: 2 },
    { kind: 'rack', x: 16, y: 20, w: 2 },
    { kind: 'rack', x: 19, y: 20, w: 2 },
    { kind: 'tank', x: 21, y: 25, color: '#ff3a4a' },
    { kind: 'tank', x: 36, y: 25, color: '#ff3a4a' },
    { kind: 'barrier', x: 37, y: 31, w: 3, pass: true },
  ],
  chests: [
    { id: 'a1', x: 9, y: 6, item: 'trauma_patch', qty: 2, kind: 'locker' },
    { id: 'a2', x: 16, y: 22, item: 'mono_katana', kind: 'case' },
    { id: 'a3', x: 20, y: 22, item: 'smartpistol', kind: 'case' },
    { id: 'a4', x: 28, y: 17, item: 'dragon_fang', kind: 'case' },
    { id: 'a5', x: 41, y: 10, item: 'neurotab', qty: 3, kind: 'locker' },
    { id: 'a6', x: 15, y: 17, item: 'km_badge', qty: 2, kind: 'crate' },
    { id: 'a7', x: 39, y: 10, item: 'bone_staff', kind: 'case' },
  ],
  npcs: [
    { id: 'sentinel_a', x: 11, y: 10, dir: 'left', look: LOOKS.corpsec, name: 'K-M Sentinel', when: (f) => !f.annex_key, talk: annexGuards },
    { id: 'sentinel_b', x: 12, y: 11, dir: 'left', look: LOOKS.corpsec, name: 'K-M Sentinel', when: (f) => !f.annex_key, talk: annexGuards },
  ],
  events: [
    { id: 'guards', x: 8, y: 10, w: 2, h: 2, on: 'touch', once: true, when: (f) => !f.annex_key, run: annexGuards },
    { id: 'door', x: 14, y: 10, h: 2, on: 'action', when: (f) => !f.annex_key, run: annexDoor },
    {
      id: 'log1', x: 27, y: 3, on: 'action',
      run: annexLog('PROJECT VESSEL · OVERVIEW', 'Awakened subjects carry measurable essence reserves. Extraction yields a stable, transferable mana substrate. Applications: power, weapons, obedience.'),
    },
    {
      id: 'log2', x: 16, y: 12, on: 'action',
      run: annexLog('SUBJECT LOG · S-3', 'Subject S-3 (human, hermetic) expired during extraction. Residual spirit bound to the WARDEN security core. Recommendation: repurpose all future expirees. Waste nothing.'),
    },
    {
      id: 'log3', x: 29, y: 14, on: 'action',
      run: async (s) => {
        await annexLog('MAIL · to: J. PALE', 'Your contractors should reach S-7 by the 14th. Once the asset is recovered, the contractors are to be reclassified as {r}liabilities{/}. — Operations')(s);
        if (!s.flag('read_mail')) {
          s.set('read_mail');
          await s.say('kit', '"Liabilities." That’s us. That’s us, right?', { face: 'angry' });
          await s.say('rook', 'That’s us.');
          await s.say('hex', 'Great. Love that. Can we not be liabilities? I’d like to be an asset. A thriving asset.', { face: 'sad' });
        }
      },
    },
    {
      id: 'log4', x: 33, y: 9, on: 'action',
      run: annexLog('SUBJECT LOG · S-7', 'Subject S-7 (orc, shamanic, "crow" totem). Resistance to sedation: high. Yield: exceptional. Transfer to Arcology Level 90 on completion.'),
    },
    { id: 'pod', x: 36, y: 4, w: 2, on: 'action', run: cryopod },
    { id: 'pod_near', x: 35, y: 6, w: 4, h: 1, on: 'touch', once: true, when: (f) => !f.sable_joined, run: cryopod },
    { id: 'warden', x: 18, y: 24, w: 22, h: 1, on: 'touch', once: true, when: (f) => !!f.sable_joined && !f.warden, run: wardenFight },
    {
      id: 'sealed', x: 26, y: 22, w: 3, on: 'action', when: (f) => !f.sable_joined,
      run: async (s) => s.narrate('A heavy blast door. The panel reads {r}CONTAINMENT · LOCKED{/}.'),
    },
  ],
  warps: [
    { x: 3, y: 1, to: 'sinkline_1', tx: 44, ty: 29, dir: 'up', door: false },
    {
      x: 37, y: 32, w: 3, to: 'dock', tx: 9, ty: 4, dir: 'down',
      when: (f) => !!f.warden,
      blocked: async (s) => s.narrate('The freight lift. The call panel is dead until the facility releases its security lock.'),
    },
  ],
  lights: [
    { x: 6, y: 4, r: 60, color: '#dff6ff', i: 0.55 },
    { x: 22, y: 6, r: 90, color: '#dff6ff', i: 0.55 },
    { x: 22, y: 14, r: 80, color: '#b8e8ff', i: 0.45 },
    { x: 36, y: 7, r: 70, color: '#9ad8ff', i: 0.6 },
    { x: 29, y: 27, r: 110, color: '#ff3a4a', i: 0.45, flicker: true },
    { x: 18, y: 21, r: 50, color: '#ffd07a', i: 0.45 },
  ],
};

const DW = 20, DH = 14;
const dg = new Grid(DW, DH, '#')
  .rect(1, 2, 18, 11, '=')
  .rect(1, 2, 18, 2, ',')
  .rect(8, 1, 3, 1, ',');

export const dock: MapDef = {
  id: 'dock',
  name: 'Loading Dock 7',
  banner: 'LOADING DOCK 7',
  bannerSub: 'Street level · 03:12',
  kind: 'town',
  terrain: dg.rows(),
  legend: {},
  ambient: '#3a3a6a',
  weather: 'rain',
  music: 'tension',
  battleBg: 'street',
  props: [
    { kind: 'car', x: 3, y: 9, w: 2, color: '#e4e4ea' },
    { kind: 'car', x: 14, y: 10, w: 2, color: '#1f2a44' },
    { kind: 'crates', x: 1, y: 4 },
    { kind: 'crates', x: 17, y: 5 },
    { kind: 'lamp', x: 5, y: 3, dir: 'right' },
    { kind: 'lamp', x: 15, y: 3, dir: 'left' },
    { kind: 'barrier', x: 7, y: 12, w: 6 },
  ],
  npcs: [
    { id: 'pale', x: 9, y: 9, dir: 'up', look: LOOKS.pale, name: 'Mr. Pale', talk: betrayal },
    { id: 'guard1', x: 7, y: 10, dir: 'up', look: LOOKS.corpsec, name: 'K-M Sentinel', talk: ['Eyes front. Mr. Pale doesn’t like to be kept waiting.'] },
    { id: 'guard2', x: 11, y: 10, dir: 'up', look: LOOKS.corpsec, name: 'K-M Sentinel', talk: ['Nothing personal, runners. You’re a line item.'] },
  ],
  onEnter: async (s) => {
    if (s.flag('chapter_end')) return;
    await s.wait(30);
    await s.move('player', 'dd');
    await betrayal(s);
  },
  lights: [
    { x: 4, y: 9, r: 50, color: '#fff0c0', i: 0.5 },
    { x: 15, y: 10, r: 50, color: '#ff3a3a', i: 0.5, flicker: true },
  ],
};
