/**
 * Part-based character sprites. Hand-authored 16×24 letter templates (body per direction/frame,
 * hair per style/direction, accessories) are composited, optionally reshaped for body type,
 * palette-mapped with auto-derived shadows, then auto-outlined.
 *
 * Letters: s/S skin · e eye · t/T top · i/I inner shirt · a/A accent · k/K/n near-or-left arm+hand ·
 * j/J/o right arm+hand · p/P pants · q/Q upper leg (pants or coat) · b/B boots ·
 * h/H/l hair · g/G goggles frame/lens · v visor (emissive) · w tusk/bone · x cut.
 */
import { pixelSurface, surface } from '../engine/canvas';
import { rgb, shade } from '../engine/color';

export type Dir = 'down' | 'up' | 'left' | 'right';
export type Body = 'std' | 'short' | 'big';
export type HairStyle =
  | 'short' | 'ponytail' | 'bun' | 'long' | 'mohawk' | 'slick' | 'cap' | 'hood' | 'spiky' | 'bald' | 'bob';
export type Accessory = 'visor' | 'shades' | 'goggles' | 'tusks' | 'elfears' | 'beard' | 'mask';

export interface CharLook {
  body?: Body;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  top: string;
  inner?: string;
  sleeves?: string;
  accent: string;
  pants: string;
  boots: string;
  coat?: string;
  cyberArm?: 'left' | 'right';
  eyes?: string;
  /** Hat / hood color (cap, hood styles). Defaults: cap → accent, hood → top. */
  hat?: string;
  visor?: string;
  goggles?: string;
  accessories?: Accessory[];
}

export interface CharSprite {
  /** 3 frames per direction: stand, stepA, stepB. */
  frames: Record<Dir, HTMLCanvasElement[]>;
  w: number;
  h: number;
  /** Pixel inside the frame that sits on the entity's ground point. */
  ax: number;
  ay: number;
}

// ---------------------------------------------------------------- body templates (std)
const HEAD_DOWN = [
  '................',
  '................',
  '......ssss......',
  '.....ssssss.....',
  '....ssssssss....',
  '....ssssssss....',
  '....ssssssss....',
  '....ssessess....',
  '....ssessess....',
  '....ssssssss....',
  '.....ssssss.....',
  '......SSSS......',
];
const HEAD_UP = [
  '................',
  '................',
  '......ssss......',
  '.....ssssss.....',
  '....ssssssss....',
  '....ssssssss....',
  '....ssssssss....',
  '....ssssssss....',
  '....ssssssss....',
  '....ssssssss....',
  '.....ssssss.....',
  '......ssss......',
];
const HEAD_SIDE = [
  '................',
  '................',
  '......ssss......',
  '.....ssssss.....',
  '....ssssssss....',
  '....ssssssss....',
  '....ssssssss....',
  '....sessssss....',
  '...ssessssss....',
  '....ssssssss....',
  '.....ssssss.....',
  '.......SSS......',
];

const TORSO_DOWN = [
  '...ktttiitttj...',
  '...ktttiitttj...',
  '...kTttiittTj...',
  '...kTttiittTj...',
  '...kTtaaaatTj...',
  '...nqqqppqqqo...',
  '....qqqPPqqq....',
  '....qpp..ppq....',
];
const TORSO_UP = [
  '...kttttttttj...',
  '...kttttttttj...',
  '...kTttttttTj...',
  '...kTttTTttTj...',
  '...kTtaaaatTj...',
  '...nqqqppqqqo...',
  '....qqqPPqqq....',
  '....qpp..ppq....',
];
const LEGS_STAND = ['....ppP..Ppp....', '....ppP..Ppp....', '....bbb..bbb....', '....BBB..BBB....'];
const LEGS_A = ['....ppP..Ppp....', '....ppP..bbb....', '....bbb..BBB....', '....BBB.........'];
const LEGS_B = ['....ppP..Ppp....', '....bbb..Ppp....', '....BBB..bbb....', '.........BBB....'];

function frontFrame(head: string[], torso: string[], legs: string[], swing: 0 | 1 | 2): string[] {
  const rows = [...head, ...torso, ...legs];
  if (swing === 1) {
    // left hand forward (raised one pixel)
    rows[16] = rows[16]!.slice(0, 3) + 'n' + rows[16]!.slice(4);
    rows[17] = rows[17]!.slice(0, 3) + '.' + rows[17]!.slice(4);
  } else if (swing === 2) {
    rows[16] = rows[16]!.slice(0, 12) + 'o' + rows[16]!.slice(13);
    rows[17] = rows[17]!.slice(0, 12) + '.' + rows[17]!.slice(13);
  }
  return rows;
}

const SIDE_STAND = [
  '.....tttttt.....',
  '.....ttkktt.....',
  '.....tTkkTt.....',
  '.....tTkkTt.....',
  '.....aaKKaa.....',
  '.....qqnnqq.....',
  '.....qqqqqq.....',
  '.....qppppq.....',
  '......pppp......',
  '......pPPp......',
  '.....bbbbb......',
  '.....BBBBB......',
];
const SIDE_A = [
  '.....tttttt.....',
  '.....ttkktt.....',
  '.....tkkTtt.....',
  '....kkTTttt.....',
  '....nnaaaaa.....',
  '.....qqqqqq.....',
  '.....qqqqqq.....',
  '....pppPPpp.....',
  '....pp....PP....',
  '...pP......PP...',
  '..bbb......BBB..',
  '..BBB.......BB..',
];
const SIDE_B = [
  '.....tttttt.....',
  '.....ttkktt.....',
  '.....tttkkt.....',
  '.....tttTkk.....',
  '.....aaaaann....',
  '.....qqqqqq.....',
  '.....qqqqqq.....',
  '....PPPppPP.....',
  '....PP....pp....',
  '...PP......pP...',
  '..BBB......bbb..',
  '..BBB.......BB..',
];

const BODY: Record<'down' | 'up' | 'side', string[][]> = {
  down: [
    frontFrame(HEAD_DOWN, TORSO_DOWN, LEGS_STAND, 0),
    frontFrame(HEAD_DOWN, TORSO_DOWN, LEGS_A, 1),
    frontFrame(HEAD_DOWN, TORSO_DOWN, LEGS_B, 2),
  ],
  up: [
    frontFrame(HEAD_UP, TORSO_UP, LEGS_STAND, 0),
    frontFrame(HEAD_UP, TORSO_UP, LEGS_A, 2),
    frontFrame(HEAD_UP, TORSO_UP, LEGS_B, 1),
  ],
  side: [[...HEAD_SIDE, ...SIDE_STAND], [...HEAD_SIDE, ...SIDE_A], [...HEAD_SIDE, ...SIDE_B]],
};

// ---------------------------------------------------------------- hair (rows 0..n, overlaid)
type HairSet = { down: string[]; up: string[]; side: string[] };

const HAIR: Record<HairStyle, HairSet> = {
  short: {
    down: [
      '................',
      '......hhhh......',
      '....hhhhhhhh....',
      '...hhhhhhhlhh...',
      '...hhhhhhhhhh...',
      '...hhHhhhHhhh...',
      '...hh.H..H.hh...',
      '...H........H...',
    ],
    up: [
      '................',
      '......hhhh......',
      '....hhhhhhhh....',
      '...hhhhhhhlhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hHhhhhhhHh...',
      '...HhhhhhhhhH...',
      '....HhhhhhhH....',
      '.....HHHHHH.....',
    ],
    side: [
      '................',
      '......hhhh......',
      '.....hhhhhhh....',
      '....hhhhhhlhh...',
      '...hhhhhhhhhhh..',
      '...hhHhhhhhhhh..',
      '....h...hhhhhh..',
      '........Hhhhhh..',
      '.........hhhhh..',
      '.........Hhhh...',
      '..........HH....',
    ],
  },
  ponytail: {
    down: [
      '.......hh.......',
      '.....hhhhhh.....',
      '....hhhhhhhh....',
      '...hhhhhhhlhh...',
      '...hhhhhhhhhh...',
      '...hhhHhhHhhh...',
      '...hh.h..h.hh...',
      '...hH......Hh...',
      '...H........H...',
    ],
    up: [
      '.......hh.......',
      '.....hhhhhh.....',
      '....hhhhhhhh....',
      '...hhhhhhlhhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hHhhhhhhHh...',
      '...HhhhhhhhhH...',
      '....HhhhhhhH....',
      '.....HHhhHH.....',
      '.......hh.......',
      '.......hh.......',
      '.......hH.......',
      '.......hH.......',
      '........H.......',
    ],
    side: [
      '................',
      '......hhhh......',
      '.....hhhhhhh....',
      '....hhhhhhlhhh..',
      '...hhhhhhhhhhhh.',
      '...hhHhhhhhhhhhh',
      '....h...hhhhh.hh',
      '........Hhhhh..h',
      '.........hhhh..H',
      '.........Hhh....',
      '..........H.....',
    ],
  },
  bun: {
    down: [
      '......hlhh......',
      '......hhhH......',
      '....hhhhhhhh....',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hHhhhhhhHh...',
      '...hh......hh...',
      '...h........h...',
    ],
    up: [
      '......hlhh......',
      '......hhhH......',
      '....hhhhhhhh....',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hHhhhhhhHh...',
      '...HhhhhhhhhH...',
      '....HhhhhhhH....',
      '.....HHHHHH.....',
    ],
    side: [
      '.........hlh....',
      '.........hhH....',
      '.....hhhhhhh....',
      '....hhhhhhhhh...',
      '...hhhhhhhhhhh..',
      '...hhHhhhhhhhh..',
      '....h...hhhhhh..',
      '........Hhhhhh..',
      '.........hhhhh..',
      '.........Hhhh...',
      '..........HH....',
    ],
  },
  long: {
    down: [
      '................',
      '......hhhh......',
      '....hhhhhhhh....',
      '...hhhhhhhlhh...',
      '...hhhhhhhhhh...',
      '...hhhHhhHhhh...',
      '...hh......hh...',
      '...hh......hh...',
      '...hH......Hh...',
      '...hH......Hh...',
      '..hhH......Hhh..',
      '..hH........Hh..',
      '..hH........Hh..',
      '..H..........H..',
    ],
    up: [
      '................',
      '......hhhh......',
      '....hhhhhhhh....',
      '...hhhhhhhlhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '..hhhhhhhhhhhh..',
      '..hHhhhhhhhhHh..',
      '..hHhhHhhHhhHh..',
      '..H.HhH..HhH.H..',
      '.....H....H.....',
    ],
    side: [
      '................',
      '......hhhh......',
      '.....hhhhhhh....',
      '....hhhhhhlhh...',
      '...hhhhhhhhhhh..',
      '...hhHhhhhhhhh..',
      '....h...hhhhhh..',
      '........hhhhhh..',
      '........hhhhhhh.',
      '........Hhhhhhh.',
      '........Hhhhhhh.',
      '.........Hhhhhh.',
      '.........HhhhH..',
      '..........H.H...',
    ],
  },
  mohawk: {
    down: [
      '.......hh.......',
      '.......hl.......',
      '......hhhH......',
      '.......hH.......',
      '.......hH.......',
    ],
    up: [
      '.......hh.......',
      '.......hl.......',
      '......hhhH......',
      '.......hH.......',
      '.......hH.......',
      '.......hH.......',
      '.......hH.......',
      '.......HH.......',
    ],
    side: [
      '.....hhh........',
      '....hhlhhh......',
      '.....hhhhhhh....',
      '.......hhhhhh...',
      '..........hhh...',
      '...........H....',
    ],
  },
  slick: {
    down: [
      '................',
      '................',
      '.....hhhhhh.....',
      '....hhhlllhh....',
      '...hhhhhhhhhh...',
      '...hHhhhhhhHh...',
      '...H........H...',
    ],
    up: [
      '................',
      '................',
      '.....hhhhhh.....',
      '....hhhhlhhh....',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...HhhhhhhhhH...',
      '....HhhhhhhH....',
      '.....HHHHHH.....',
    ],
    side: [
      '................',
      '................',
      '.....hhhhhh.....',
      '....hlllhhhh....',
      '...hhhhhhhhhhh..',
      '....hhhhhhhhhh..',
      '........hhhhhh..',
      '........Hhhhhh..',
      '.........hhhhH..',
      '.........HhhH...',
      '..........HH....',
    ],
  },
  cap: {
    down: [
      '................',
      '......cccc......',
      '....cccccccc....',
      '...h........h...',
      '...cccccccccc...',
      '..CCCCCCCCCCCC..',
      '...c........c...',
    ],
    up: [
      '................',
      '......cccc......',
      '....cccccccc....',
      '...cccccccccc...',
      '...cccccccccc...',
      '...cccccccccc...',
      '...CCCCCCCCCC...',
      '....hhhhhhhh....',
      '....hhhhhhhh....',
      '.....hhhhhh.....',
    ],
    side: [
      '................',
      '......cccc......',
      '.....ccccccc....',
      '....ccccccccc...',
      '...ccccccccccc..',
      'CCCCCccccccccc..',
      '........hhhhhh..',
      '........hhhhhh..',
      '.........hhhh...',
    ],
  },
  hood: {
    down: [
      '.....cccccc.....',
      '....cccccccc....',
      '...cccccccccc...',
      '..cccccccccccc..',
      '..ccCCCCCCCCcc..',
      '..ccC......Ccc..',
      '..cC........Cc..',
      '..cC........Cc..',
      '..cC........Cc..',
      '..ccC......Ccc..',
      '...ccC....Ccc...',
      '....cc....cc....',
    ],
    up: [
      '.....cccccc.....',
      '....cccccccc....',
      '...cccccccccc...',
      '..cccccccccccc..',
      '..cccccccccccc..',
      '..cccccccccccc..',
      '..cccccccccccc..',
      '..cccccccccccc..',
      '..cccccccccccc..',
      '..cCccccccccCc..',
      '...CccccccccC...',
      '....CCccccCC....',
    ],
    side: [
      '.....cccccc.....',
      '....cccccccc....',
      '...cccccccccc...',
      '..cccccccccccc..',
      '..cCCCcccccccc..',
      '..C....ccccccc..',
      '.......ccccccc..',
      '.......Ccccccc..',
      '.......Ccccccc..',
      '........Cccccc..',
      '........CCccc...',
      '.........CCc....',
    ],
  },
  spiky: {
    down: [
      '...h..h..h..h...',
      '...hh.hh.hhhh...',
      '....hhhhhhhh....',
      '...hhhhhhhlhh...',
      '..hhhhhhhhhhhh..',
      '...hHhHhhHhHh...',
      '...hh.H..H.hh...',
      '...H........H...',
    ],
    up: [
      '...h..h..h..h...',
      '...hh.hh.hhhh...',
      '....hhhhhhhh....',
      '...hhhhhhhlhh...',
      '..hhhhhhhhhhhh..',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hHhhhhhhHh...',
      '...HhhhhhhhhH...',
      '....HhhhhhhH....',
      '.....HHHHHH.....',
    ],
    side: [
      '.....h..h.h.....',
      '.....hh.hhhh.h..',
      '.....hhhhhhhhh..',
      '....hhhhhhlhhhh.',
      '...hhhhhhhhhhhhh',
      '..hhhHhhhhhhhhh.',
      '....h...hhhhhhh.',
      '........Hhhhhh..',
      '.........hhhhh..',
      '.........Hhhh...',
      '..........HH....',
    ],
  },
  bald: { down: [], up: [], side: [] },
  bob: {
    down: [
      '................',
      '......hhhh......',
      '....hhhhhhhh....',
      '...hhhhhhhlhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hhH....Hhh...',
      '...hH......Hh...',
      '...hH......Hh...',
      '...hH......Hh...',
      '...HH......HH...',
    ],
    up: [
      '................',
      '......hhhh......',
      '....hhhhhhhh....',
      '...hhhhhhhlhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hhhhhhhhhh...',
      '...hHhhhhhhHh...',
      '...HHHHHHHHHH...',
    ],
    side: [
      '................',
      '......hhhh......',
      '.....hhhhhhh....',
      '....hhhhhhlhh...',
      '...hhhhhhhhhhh..',
      '...hhhhhhhhhhh..',
      '....hh..hhhhhh..',
      '........hhhhhh..',
      '........hhhhhh..',
      '........Hhhhhh..',
      '........HHHHHH..',
    ],
  },
};

// ---------------------------------------------------------------- accessories
const ACC: Record<Accessory, HairSet> = {
  visor: {
    down: ['', '', '', '', '', '', '', '...gvvvvvvvvg...'],
    up: ['', '', '', '', '', '', '', '...g........g...'],
    side: ['', '', '', '', '', '', '', '...vvvvgg.......'],
  },
  shades: {
    down: ['', '', '', '', '', '', '', '....gGGggGGg....', '.....gg..gg.....'],
    up: [],
    side: ['', '', '', '', '', '', '', '...gGGgg........', '....gg..........'],
  },
  goggles: {
    down: ['', '', '', '', '...gGGggggGGg...', '....gg....gg....'],
    up: ['', '', '', '', '...gggggggggg...'],
    side: ['', '', '', '...gg...........', '...gGGgggggg....', '....gg..........'],
  },
  tusks: {
    down: ['', '', '', '', '', '', '', '', '', '.....w....w.....', '.....w....w.....'],
    up: [],
    side: ['', '', '', '', '', '', '', '', '', '...w............', '...w............'],
  },
  elfears: {
    down: ['', '', '', '', '..s..........s..', '..ss........ss..', '...s........s...'],
    up: ['', '', '', '', '..s..........s..', '..ss........ss..', '...s........s...'],
    side: ['', '', '', '', '.........s......', '........ss......', '........s.......'],
  },
  beard: {
    down: ['', '', '', '', '', '', '', '', '....h......h....', '....hhhHHhhh....', '.....hhhhhh.....', '......HHHH......'],
    up: [],
    side: ['', '', '', '', '', '', '', '', '....h...........', '...hhHhh........', '....hhhhhh......', '.....HHHH.......'],
  },
  mask: {
    down: ['', '', '', '', '', '', '', '', '....gggggggg....', '....gGgGgGgg....', '.....gggggg.....'],
    up: [],
    side: ['', '', '', '', '', '', '', '', '...gggg.........', '...gGgGg........', '....ggg.........'],
  },
};

function overlay(base: string[], over: string[]): void {
  over.forEach((row, y) => {
    if (!row || y >= base.length) return;
    const b = base[y]!.split('');
    for (let x = 0; x < row.length && x < b.length; x++) {
      const c = row[x]!;
      if (c !== '.') b[x] = c;
    }
    base[y] = b.join('');
  });
}

/** Reshape a std letter grid for a body type. Returns a new grid (may change size). */
function reshape(rows: string[], body: Body): string[] {
  if (body === 'std') return rows;
  if (body === 'short') {
    // Stockier torso (+2 wide), shorter torso and legs.
    const out = rows.map((r, y) => (y >= 12 && y <= 19 ? r.slice(1, 8) + r[7] + r[8] + r.slice(8, 15) : r));
    return out.filter((_, y) => y !== 13 && y !== 18 && y !== 20);
  }
  // big: wider everywhere (+2), taller torso and legs
  const wide = rows.map((r) => '.' + r.slice(0, 8) + r[7] + r[8] + r.slice(8) + '.');
  const out: string[] = [];
  wide.forEach((r, y) => {
    out.push(r);
    if (y === 14 || y === 20) out.push(r);
  });
  return out;
}

const OUTLINE = '#120e1d';

interface Pal {
  [letter: string]: string | null;
}

function palette(look: CharLook, nearArm: 'left' | 'right' | null): Pal {
  const metal = '#9aa3b8';
  const sd = (c: string, a = -0.38) => shade(c, a);
  const sleeves = look.sleeves ?? look.top;
  const armColor = (side: 'left' | 'right') => (look.cyberArm === side ? metal : sleeves);
  const handColor = (side: 'left' | 'right') => (look.cyberArm === side ? '#c3cad8' : look.skin);
  const leftSide: 'left' | 'right' = nearArm ?? 'left';
  const rightSide: 'left' | 'right' = nearArm ? nearArm : 'right';
  const upper = look.coat ?? look.pants;
  const inner = look.inner ?? look.top;
  const hat = look.hat ?? (look.hairStyle === 'hood' ? look.top : look.accent);
  return {
    s: look.skin, S: sd(look.skin, -0.28),
    e: look.eyes ?? '#1a1426',
    t: look.top, T: sd(look.top),
    i: inner, I: sd(inner),
    a: look.accent, A: sd(look.accent),
    k: armColor(leftSide), K: sd(armColor(leftSide)), n: handColor(leftSide),
    j: armColor(rightSide), J: sd(armColor(rightSide)), o: handColor(rightSide),
    p: look.pants, P: sd(look.pants),
    q: upper, Q: sd(upper),
    b: look.boots, B: sd(look.boots, -0.45),
    h: look.hair, H: sd(look.hair, -0.4), l: shade(look.hair, 0.4),
    g: look.goggles ?? '#2a2838', G: look.visor ?? '#3fe0f0',
    v: look.visor ?? '#ff4fb0',
    w: '#efe6cf',
    c: hat, C: sd(hat, -0.4),
    x: null,
  };
}

function paint(rows: string[], pal: Pal): HTMLCanvasElement {
  const h = rows.length;
  const w = rows[0]!.length;
  const pw = w + 2;
  const ph = h + 2;
  const s = pixelSurface(pw, ph);
  const img = s.ctx.createImageData(pw, ph);
  const d = img.data;
  const opaque = new Uint8Array(pw * ph);
  for (let y = 0; y < h; y++) {
    const row = rows[y]!;
    for (let x = 0; x < w; x++) {
      const c = row[x]!;
      if (c === '.') continue;
      const col = pal[c];
      if (!col) continue;
      const [r, g, b] = rgb(col);
      const i = ((y + 1) * pw + (x + 1)) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      opaque[(y + 1) * pw + (x + 1)] = 1;
    }
  }
  const [or, og, ob] = rgb(OUTLINE);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const k = y * pw + x;
      if (opaque[k]) continue;
      const n =
        (x > 0 && opaque[k - 1]) || (x < pw - 1 && opaque[k + 1]) || (y > 0 && opaque[k - pw]) || (y < ph - 1 && opaque[k + pw]);
      if (n) {
        const i = k * 4;
        d[i] = or; d[i + 1] = og; d[i + 2] = ob; d[i + 3] = 255;
      }
    }
  }
  s.ctx.putImageData(img, 0, 0);
  // Return a GPU-friendly copy.
  const out = surface(pw, ph);
  out.ctx.drawImage(s.canvas, 0, 0);
  return out.canvas;
}

function buildGrid(look: CharLook, view: 'down' | 'up' | 'side', frame: number): string[] {
  const rows = [...BODY[view][frame]!];
  const hair = HAIR[look.hairStyle][view];
  // Accessories that sit under the hair (ears), then hair, then face gear.
  const accs = look.accessories ?? [];
  if (accs.includes('elfears')) overlay(rows, ACC.elfears[view]);
  if (accs.includes('beard')) overlay(rows, ACC.beard[view]);
  overlay(rows, hair);
  for (const a of accs) if (a !== 'elfears' && a !== 'beard') overlay(rows, ACC[a][view]);
  return reshape(rows, look.body ?? 'std');
}

const cache = new Map<string, CharSprite>();

export function buildChar(look: CharLook): CharSprite {
  const key = JSON.stringify(look);
  const hit = cache.get(key);
  if (hit) return hit;
  const frames: Record<Dir, HTMLCanvasElement[]> = { down: [], up: [], left: [], right: [] };
  const palFront = palette(look, null);
  const palBack: Pal = { ...palette(look, null) };
  // From behind, the character's left arm is on screen-left.
  palBack.k = palette(look, 'left').k; palBack.K = palette(look, 'left').K; palBack.n = palette(look, 'left').n;
  palBack.j = palette(look, 'right').k; palBack.J = palette(look, 'right').K; palBack.o = palette(look, 'right').n;
  // Facing the viewer, the character's right arm is on screen-left.
  palFront.k = palette(look, 'right').k; palFront.K = palette(look, 'right').K; palFront.n = palette(look, 'right').n;
  palFront.j = palette(look, 'left').k; palFront.J = palette(look, 'left').K; palFront.o = palette(look, 'left').n;
  for (let f = 0; f < 3; f++) {
    frames.down.push(paint(buildGrid(look, 'down', f), palFront));
    frames.up.push(paint(buildGrid(look, 'up', f), palBack));
    const side = buildGrid(look, 'side', f);
    // Facing left, the near arm is the character's left arm; facing right, the right arm.
    frames.left.push(paint(side, palette(look, 'left')));
    const flipped = side.map((r) => r.split('').reverse().join(''));
    frames.right.push(paint(flipped, palette(look, 'right')));
  }
  const w = frames.down[0]!.width;
  const h = frames.down[0]!.height;
  const sprite: CharSprite = { frames, w, h, ax: Math.floor(w / 2), ay: h - 2 };
  cache.set(key, sprite);
  return sprite;
}

/** Walk cycle frame index for a step phase 0..3 → [stand, A, stand, B]. */
export function walkFrame(phase: number): number {
  return [0, 1, 0, 2][phase & 3]!;
}
