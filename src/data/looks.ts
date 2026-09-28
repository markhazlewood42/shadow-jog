/** Character appearance definitions (field sprites). */
import type { CharLook } from '../art/chars';
import { Rng } from '../engine/rng';

export const LOOKS = {
  kit: {
    skin: '#b97a52', hair: '#2e1d33', hairStyle: 'ponytail',
    top: '#d8452e', inner: '#1d1b2a', accent: '#f2b84b',
    pants: '#2b3350', boots: '#3a2a2a',
  },
  rook: {
    skin: '#e0b08a', hair: '#8d8f99', hairStyle: 'short',
    top: '#4d5238', coat: '#4d5238', inner: '#23232e', accent: '#b58a4a',
    pants: '#2a2a33', boots: '#1c1a22', cyberArm: 'right',
    accessories: ['shades', 'beard'], goggles: '#1a1822', visor: '#ffb13d',
  },
  hex: {
    body: 'short', skin: '#f0c7a4', hair: '#2fbfb0', hairStyle: 'bun',
    top: '#6a3fa0', inner: '#2a2438', accent: '#ffcc3d',
    pants: '#3a3350', boots: '#2a2030',
    accessories: ['goggles'], goggles: '#3b3448', visor: '#3fe0f0',
  },
  sable: {
    body: 'big', skin: '#8a9a6a', hair: '#e8e4da', hairStyle: 'long',
    top: '#8c2f39', inner: '#3a2a24', accent: '#d9b36c',
    pants: '#4a3a30', boots: '#2a2020', accessories: ['tusks'],
  },
  pale: {
    skin: '#eadbd0', hair: '#dcd8cf', hairStyle: 'slick',
    top: '#e4e4ea', inner: '#16161e', accent: '#c02040',
    pants: '#e4e4ea', boots: '#16161e', accessories: ['visor'], visor: '#ff3050',
  },
  dutch: {
    skin: '#6e4430', hair: '#1a1418', hairStyle: 'bald',
    top: '#6a2a58', inner: '#e8c85a', accent: '#e8c85a',
    pants: '#1e1c26', boots: '#1a1418', accessories: ['beard'],
  },
  mags: {
    body: 'short', skin: '#d9a47e', hair: '#c9c4bb', hairStyle: 'bob',
    top: '#8a5a2e', inner: '#3a3a3a', accent: '#62e06a',
    pants: '#3d3a30', boots: '#2a2420', accessories: ['goggles'], goggles: '#5a4a3a', visor: '#62e06a',
  },
  ganger: {
    skin: '#c28a64', hair: '#e8452e', hairStyle: 'mohawk',
    top: '#2a2a30', sleeves: '#c28a64', inner: '#2a2a30', accent: '#e8452e',
    pants: '#3a3448', boots: '#1a1418',
  },
  corpsec: {
    skin: '#d8b090', hair: '#20202a', hairStyle: 'cap', hat: '#1f2a44',
    top: '#2c3b5e', inner: '#2c3b5e', accent: '#9aa3b8',
    pants: '#1f2a44', boots: '#101018', accessories: ['visor'], visor: '#3fe0f0',
  },
} satisfies Record<string, CharLook>;

const SKINS = ['#f2c9a5', '#e0b08a', '#c98a5e', '#a5673f', '#7a4a30', '#5a3624', '#eadbd0'];
const HAIRS = ['#1a1418', '#2e1d33', '#4a2e22', '#8a5a2e', '#c9c4bb', '#d8452e', '#ff4fb0', '#3fe0f0', '#62e06a', '#b07cff', '#e8d070'];
const NEON = new Set(['#ff4fb0', '#3fe0f0', '#62e06a', '#b07cff']);
const NATURAL = HAIRS.filter((h) => !NEON.has(h));
const TOPS = ['#2c3b5e', '#6a3fa0', '#8c2f39', '#2f6a5a', '#4d5238', '#a0652f', '#34344a', '#1d5c6a', '#7a2e5a', '#5a5f7a', '#b8b0a0'];
const PANTS = ['#2a2a33', '#2b3350', '#3a3448', '#3d3a30', '#1e1c26', '#4a3a30'];
const ACCENTS = ['#ffcc3d', '#3fe0f0', '#ff4fb0', '#62e06a', '#ffa24a', '#b07cff', '#d9b36c'];
const STYLES = ['short', 'ponytail', 'bun', 'long', 'mohawk', 'slick', 'cap', 'hood', 'spiky', 'bald', 'bob'] as const;

/** Deterministic random pedestrian look from a seed. */
export function randomLook(seed: number): CharLook {
  const r = new Rng(seed * 7919 + 17);
  const body = r.chance(0.12) ? 'short' : r.chance(0.1) ? 'big' : 'std';
  const look: CharLook = {
    body,
    skin: body === 'big' && r.chance(0.6) ? r.pick(['#8a9a6a', '#7a8a5e', '#9a8a7a']) : r.pick(SKINS),
    hair: r.pick(HAIRS),
    hairStyle: r.pick(STYLES),
    top: r.pick(TOPS),
    accent: r.pick(ACCENTS),
    pants: r.pick(PANTS),
    boots: r.pick(['#1a1418', '#2a2420', '#3a2a2a']),
    accessories: [],
  };
  if (r.chance(0.3)) look.inner = r.pick(TOPS);
  if (r.chance(0.2)) look.coat = look.top;
  if (r.chance(0.15)) look.cyberArm = r.chance(0.5) ? 'left' : 'right';
  if (r.chance(0.15)) {
    look.accessories!.push('visor');
    look.visor = r.pick(ACCENTS);
  } else if (r.chance(0.12)) look.accessories!.push('shades');
  if (body === 'big' && r.chance(0.6)) look.accessories!.push('tusks');
  if (body === 'std' && r.chance(0.15)) look.accessories!.push('elfears');
  if (look.hairStyle === 'cap') look.hat = r.pick(TOPS);
  // Neon dye is for statement cuts; on a big rounded style it reads as a flat ball.
  if (NEON.has(look.hair) && !['mohawk', 'spiky', 'ponytail', 'slick'].includes(look.hairStyle)) look.hair = r.pick(NATURAL);
  // A face of their own: most people look neutral, some grin, a few give nothing away.
  look.mouth = r.pick(['line', 'line', 'line', 'grin', 'none'] as const);
  look.brows = r.chance(0.75);
  return look;
}
