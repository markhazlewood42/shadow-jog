/** Character appearance definitions (field sprites). */
import type { CharLook } from '../art/chars';
import { Rng } from '../engine/rng';

export const LOOKS = {
  kit: {
    skin: '#b97a52', hair: '#2e1d33', hairStyle: 'ponytail',
    top: '#d8452e', inner: '#1d1b2a', accent: '#f2b84b',
    pants: '#2b3350', boots: '#3a2a2a',
    // Cocky and quick: a smirk, and she can't stand still.
    mouth: 'smirk',
    idle: 'bounce',
  },
  rook: {
    skin: '#e0b08a', hair: '#8d8f99', hairStyle: 'short',
    top: '#4d5238', coat: '#4d5238', inner: '#23232e', accent: '#b58a4a',
    pants: '#2a2a33', boots: '#1c1a22', cyberArm: 'right',
    accessories: ['shades', 'beard'], goggles: '#1a1822', visor: '#ffb13d',
    // The katana on his back: the hilt over his shoulder is how you spot Rook in a crowd.
    carry: 'katana',
    // Stands with his arms folded, waiting on everyone else.
    idle: 'crossed',
  },
  hex: {
    body: 'short', skin: '#f0c7a4', hair: '#2fbfb0', hairStyle: 'bun',
    top: '#6a3fa0', inner: '#2a2438', accent: '#ffcc3d',
    pants: '#3a3350', boots: '#2a2030',
    accessories: ['goggles'], goggles: '#3b3448', visor: '#3fe0f0',
    // Talks with her whole face.
    mouth: 'grin', brows: 'thick',
    // Her deck rides on her back, its whip antenna up over her head.
    carry: 'antenna',
  },
  sable: {
    body: 'big', skin: '#8a9a6a', hair: '#e8e4da', hairStyle: 'long',
    top: '#8c2f39', inner: '#3a2a24', accent: '#d9b36c',
    pants: '#4a3a30', boots: '#2a2020', accessories: ['tusks'],
    // Half-lidded, far away; gold eyes, and the tusks do the talking.
    eyeShape: 'narrow', eyes: '#c9a040', mouth: 'none',
    // The staff she walks with, taller than she is, feathers under its head.
    carry: 'staff',
  },
  pale: {
    skin: '#eadbd0', hair: '#dcd8cf', hairStyle: 'slick',
    top: '#e4e4ea', inner: '#16161e', accent: '#c02040',
    pants: '#e4e4ea', boots: '#16161e', accessories: ['visor'], visor: '#ff3050',
    mouth: 'smirk', brows: false,
  },
  // The fixer: big, bearded, a wide-brimmed hat with a gold band (reads from across the bar).
  dutch: {
    body: 'big', skin: '#6e4430', hair: '#1a1418', hairStyle: 'bald',
    top: '#6a2a58', inner: '#e8c85a', accent: '#e8c85a', coat: '#4a1e3e',
    pants: '#1e1c26', boots: '#1a1418', accessories: ['beard'],
    brows: 'thick', mouth: 'smile', carry: 'hat',
  },
  mags: {
    body: 'short', skin: '#d9a47e', hair: '#c9c4bb', hairStyle: 'bob',
    top: '#8a5a2e', inner: '#3a3a3a', accent: '#62e06a',
    pants: '#3d3a30', boots: '#2a2420', accessories: ['goggles'], goggles: '#5a4a3a', visor: '#62e06a',
    mouth: 'frown', eyeShape: 'narrow', carry: 'cane',
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
  // The same uniform on different people: a squad, not one sprite twice.
  corpsec2: {
    skin: '#7a4a30', hair: '#1a1418', hairStyle: 'short',
    top: '#2c3b5e', inner: '#2c3b5e', accent: '#9aa3b8',
    pants: '#1f2a44', boots: '#101018', accessories: ['shades'], mouth: 'frown',
  },
  corpsec3: {
    body: 'big', skin: '#e0b894', hair: '#8a5a2e', hairStyle: 'cap', hat: '#1f2a44',
    top: '#2c3b5e', inner: '#1f2a44', accent: '#ffcc3d',
    pants: '#1f2a44', boots: '#101018', accessories: ['visor'], visor: '#ffcc3d',
  },
  // Pale at the dock, in the rain: a clear umbrella rimmed in K-M red.
  pale_rain: {
    skin: '#eadbd0', hair: '#dcd8cf', hairStyle: 'slick',
    top: '#e4e4ea', inner: '#16161e', accent: '#c02040',
    pants: '#e4e4ea', boots: '#16161e', accessories: ['visor'], visor: '#ff3050',
    mouth: 'smirk', brows: false, umbrella: '#ff3050', umbrellaClear: true,
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
/** A street look for rainy exteriors: about a third of passers-by carry an umbrella. */
export function streetLook(seed: number): CharLook {
  const look = randomLook(seed);
  const r = new Rng(seed * 104729 + 3);
  if (r.chance(0.34)) {
    if (r.chance(0.35)) {
      look.umbrella = r.pick(['#ff4fb0', '#3fe0f0', '#b07cff', '#ffcc3d']);
      look.umbrellaClear = true;
    } else look.umbrella = r.pick(['#1a1822', '#8c2f39', '#2a4a6a', '#3a3a44', '#6a3fa0']);
  }
  return look;
}

export function randomLook(seed: number): CharLook {
  const r = new Rng(seed * 7919 + 17);
  // A crowd of more than one build: about a third of people aren't the standard frame.
  const body = r.chance(0.18) ? 'short' : r.chance(0.16) ? 'big' : 'std';
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
  // Different ways of standing, so a crowd isn't one pose in many palettes.
  const stance = r.next();
  if (stance < 0.3) look.stance = 'crossed';
  else if (stance < 0.51) look.stance = 'phone';
  return look;
}
