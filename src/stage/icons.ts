/**
 * The command icons (Phaser spike `spike/phaser-stage`): attack, skill, combo, item, guard and run as 16x16
 * pixel pictures written out as text. Each letter is a colour from `PALETTE`; "." is transparent. They are the
 * design mockup's placeholder icons (a sword, a spark, two arrows, a flask, a shield, a boot), drawn with a
 * one-pixel dark outline, and they stay placeholders until real icon art exists.
 *
 * Writing a small sprite as text is a time-honoured trick: it can be read and edited in any editor, diffed in
 * git, and turned into a picture by a dozen lines of code (`iconRaw`) with no image file to load.
 */
import { hexRgb, newRaw, type Raw } from './pixels';

export type IconKind = 'attack' | 'skill' | 'combo' | 'item' | 'guard' | 'run';

export const ICON_SIZE = 16;

/** Letter to colour. */
export const PALETTE: Readonly<Record<string, string>> = {
  a: '#07060d',
  b: '#b2a9cc',
  c: '#f4f1ff',
  d: '#ffcc3d',
  e: '#8c5a2a',
  f: '#fff4b0',
  g: '#b07cff',
  h: '#d8c2ff',
  i: '#ff4fb0',
  j: '#ffb0dc',
  k: '#2f9fb0',
  l: '#3fe0f0',
  m: '#62e06a',
  n: '#b8f2bc',
};

/** The pictures, one string per row. */
const ROWS: Record<IconKind, readonly string[]> = {
  attack: [
    '................',
    '................',
    '..........aaaaa.',
    '.........aabaca.',
    '........aabbcaa.',
    '.......aabbcbba.',
    '......aabbcbbaa.',
    '....aaabbcbbaa..',
    '...aadbbcbbaa...',
    '...adddcbbaa....',
    '..aabdddbaa.....',
    '.aabbcdddaa.....',
    '.abecbbddda.....',
    'aaeeebaadaa.....',
    'aeeebaaaaa......',
    'aaaaaa..........',
  ],
  skill: [
    '.......aaa......',
    '.......ada......',
    '......aadaa.....',
    '......addda.....',
    '.....aadfdaa....',
    '.....addfdda....',
    '...aaadfffdaaa..',
    '.aaadddfffdddaaa',
    '.adddfffffffddda',
    '.aaadddfffdddaaa',
    '...aaaddfddaaa..',
    '.....aadfdaa....',
    '......addda.....',
    '......aadaa.....',
    '.......ada......',
    '.......aaa......',
  ],
  combo: [
    '................',
    '........aaa.....',
    '........agaaa...',
    '.aaaaaaaagggaa..',
    '.agggggggggggaaa',
    '.aggggggggggggga',
    '.agggggggggggaaa',
    '.aaaaaahagggaa..',
    '...aahhhagaaaaaa',
    '.aaahhhhhhhhhhha',
    '.ahhhhhhhhhhhhha',
    '.aaahhhhhhhhhhha',
    '...aahhhaaaaaaaa',
    '....aaaha.......',
    '......aaa.......',
    '................',
  ],
  item: [
    '....aaaaaaaa....',
    '....aeeeeeea....',
    '....aeeeeeea....',
    '....aabbbbaa....',
    '.....abbbba.....',
    '.....aiiiia.....',
    '....aaiiiiaa....',
    '....aiiiiiia....',
    '...aaiiiiiiaa...',
    '...aiiijjjiia...',
    '..aaiijjjjiiaa..',
    '..aiiijjjjjiia..',
    '.aaiijjjjjjiiaa.',
    '.aiiiiiiiiiiiia.',
    '.aaaaaaaaaaaaaa.',
    '................',
  ],
  guard: [
    '................',
    '.aaaaaaaaaaaaaa.',
    '.akkkkkkkkkkkka.',
    '.aklllllkkkkkka.',
    '.aklllllkkkkkka.',
    '.aklllllkkkkkka.',
    '.aklllllkkkkkka.',
    '.aklllllkkkkkka.',
    '.aklllllkkkkkka.',
    '.aakllllkkkkkaa.',
    '..aaklllkkkkaa..',
    '...aakllkkkaa...',
    '....akklkkaa....',
    '....aakkkaa.....',
    '.....aakaa......',
    '......aaa.......',
  ],
  run: [
    '................',
    '................',
    '.aaaaaaaaaaaa...',
    '.ammmmmnnnnnaa..',
    '.aammmmmnnnnna..',
    '..aammmmnnnnnaa.',
    '...ammmmmnnnnna.',
    '...aammmmnnnnnaa',
    '....aammmmnnnnna',
    '...aammmmnnnnnaa',
    '...ammmmmnnnnna.',
    '..aammmmnnnnnaa.',
    '.aammmmmnnnnna..',
    '.ammmmmnnnnnaa..',
    '.aaaaaaaaaaaa...',
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
  ROWS[kind].forEach((row, y) => {
    for (let x = 0; x < ICON_SIZE; x++) {
      const ch = row[x] ?? '.';
      const hex = PALETTE[ch];
      if (ch === '.' || !hex) continue;
      const c = hexRgb(hex);
      out.px.set([c[0], c[1], c[2], 255], (y * ICON_SIZE + x) * 4);
    }
  });
  return out;
}
