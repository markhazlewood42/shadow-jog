/**
 * The command icons (Phaser spike `spike/phaser-stage`): attack, skill, combo, item, guard and run as 16x16
 * pixel pictures written out as text. Each letter is a colour from `PALETTE`; "." is transparent. Round 2 of the HUD polish
 * redrew them by hand (a steel sword with a gold guard, a four-point spark, two chasing arrows, a potion flask, a blue shield
 * with a gold cross): five or six tones each, lit from the top left, in the portraits' palette. The fill is written here; a
 * one-pixel dark outline is added round it in code.
 *
 * Writing a small sprite as text is a time-honoured trick: it can be read and edited in any editor, diffed in
 * git, and turned into a picture by a dozen lines of code (`iconRaw`) with no image file to load.
 */
import { hexRgb, newRaw, type Raw } from './pixels';

export type IconKind = 'attack' | 'skill' | 'combo' | 'item' | 'guard' | 'run';

export const ICON_SIZE = 16;

/** Letter to colour (the dark outline is not in the pictures: `iconRaw` adds it round whatever is drawn). */
export const PALETTE: Readonly<Record<string, string>> = {
  w: '#f4f8ff',
  b: '#b6c0d8',
  v: '#7280a4',
  u: '#454d70',
  d: '#ffcc3d',
  D: '#c9871a',
  f: '#fff6b8',
  e: '#a8672c',
  E: '#5e3a1a',
  i: '#ff4fb0',
  I: '#b0287a',
  j: '#ffb8e0',
  g: '#b07cff',
  G: '#6a3fc0',
  h: '#e0d0ff',
  p: '#9cc2ff',
  P: '#4f8cff',
  o: '#2c56c4',
  O: '#1b3585',
  q: '#c8fbff',
  l: '#3fe0f0',
  k: '#2aa0bd',
};

/** The pictures, one string per row. */
const ROWS: Record<IconKind, readonly string[]> = {
  attack: [
    '................',
    '..............w.',
    '............wbb.',
    '...........wbv..',
    '..........wbv...',
    '.........wbv....',
    '........wbv.....',
    '.......wbv......',
    '...fd.wbv.......',
    '....dd..........',
    '.....dd.........',
    '...eE.dD........',
    '..eE...dD.......',
    '.dE.............',
    '.dD.............',
    '................',
  ],
  skill: [
    '................',
    '.......dd.......',
    '.......dd.......',
    '......dddd......',
    '......ffff......',
    '.....fffffd.....',
    '..dddffffddddd..',
    '.ddddfffddddddd.',
    '.ddddffdddddddd.',
    '..dddfddddDDDD..',
    '.....ddddDD.....',
    '......dddD......',
    '......dddD......',
    '.......dd.......',
    '.......dd.......',
    '................',
  ],
  combo: [
    '................',
    '..........h.....',
    '..........hh....',
    '..hhhhhhhhhhh...',
    '..gggggggggggg..',
    '..GGGGGGGGGGG...',
    '..........GG....',
    '..........G.....',
    '.....j..........',
    '....jj..........',
    '...jjjjjjjjjjj..',
    '..iiiiiiiiiiii..',
    '...IIIIIIIIIII..',
    '....II..........',
    '.....I..........',
    '................',
  ],
  item: [
    '................',
    '......eeEE......',
    '......eeEE......',
    '......wbbv......',
    '......wbbv......',
    '......jiII......',
    '.....jiiiII.....',
    '....jiiiiiII....',
    '...jiwiiiiiII...',
    '...jiwiiiiiII...',
    '...jiiijiiiII...',
    '...jiiiiiiiII...',
    '....iIIIIIII....',
    '.....iIIIII.....',
    '................',
    '................',
  ],
  guard: [
    '................',
    '..pppppppppppp..',
    '..pPPPPPPPPPPo..',
    '..pPPPPfdPPPPo..',
    '..pPPPPfdPPPPo..',
    '..pPffffddddPo..',
    '..pPddddddddPo..',
    '..pPPPPfdPPooo..',
    '..poooofdooooo..',
    '...pooofdoooO...',
    '....poofdooO....',
    '.....pooooO.....',
    '......pooO......',
    '.......po.......',
    '................',
    '................',
  ],
  run: [
    '................',
    '................',
    '..mmmmmmmmmmmm..',
    '..mmmmmnnnnnn...',
    '...mmmmmnnnnn...',
    '....mmmmmnnnn...',
    '.....mmmmmnnnn..',
    '......mmmmmnnn..',
    '.....mmmmmnnnn..',
    '....mmmmmnnnn...',
    '...mmmmmnnnnn...',
    '..mmmmmnnnnnn...',
    '..mmmmmmmmmmmm..',
    '................',
    '................',
    '................',
  ],
};

/**
 * What each command icon is called, in three sizes: the three-letter code printed under the icon (so every icon has a
 * name on the screen all the time, the way ref 1 prints POW/GRD/AGI), the full name on the strip's caption line for the
 * lit icon, and one short line about what it does (shown beside the name when the icon has no cost).
 */
export const COMMAND_INFO: Readonly<Record<IconKind, { code: string; name: string; hint: string }>> = {
  attack: { code: 'ATK', name: 'Attack', hint: 'Hit one foe' },
  skill: { code: 'SKL', name: 'Skill', hint: 'Special moves' },
  combo: { code: 'CMB', name: 'Combo', hint: 'Team chain' },
  item: { code: 'ITM', name: 'Item', hint: 'Use a kit item' },
  guard: { code: 'GRD', name: 'Guard', hint: 'Take less damage' },
  run: { code: 'RUN', name: 'Run', hint: 'Try to escape' },
};

/** The icon kinds in the order the command strip shows them (run lives on the strip's far end in the real game; the stage shows the first five). */
export const COMMAND_ICONS: readonly IconKind[] = ['attack', 'skill', 'combo', 'item', 'guard'];

/** An icon as a picture. */
export function iconRaw(kind: IconKind): Raw {
  const out = newRaw(ICON_SIZE, ICON_SIZE);
  const drawn = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < ICON_SIZE && y < ICON_SIZE && (out.px[(y * ICON_SIZE + x) * 4 + 3] ?? 0) > 0;
  ROWS[kind].forEach((row, y) => {
    for (let x = 0; x < ICON_SIZE; x++) {
      const ch = row[x] ?? '.';
      const hex = PALETTE[ch];
      if (ch === '.' || !hex) continue;
      const c = hexRgb(hex);
      out.px.set([c[0], c[1], c[2], 255], (y * ICON_SIZE + x) * 4);
    }
  });
  // The outline: every empty pixel that touches a drawn one (diagonals too) turns the dark outline colour.
  const dark = hexRgb(OUTLINE);
  const ring: Array<[number, number]> = [];
  for (let y = 0; y < ICON_SIZE; y++)
    for (let x = 0; x < ICON_SIZE; x++) {
      if (drawn(x, y)) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (drawn(x + dx, y + dy)) ring.push([x, y]);
    }
  for (const [x, y] of ring) out.px.set([dark[0], dark[1], dark[2], 255], (y * ICON_SIZE + x) * 4);
  return out;
}

/** The outline colour (the game's UI outline). */
const OUTLINE = '#07060d';
