/** The soundtrack. See music.ts for the notation. */
import type { SongSpec } from './music';

export const SONGS: Record<string, SongSpec> = {
  // Title — "Saltreach Nights". Brooding synthwave in A minor.
  title: {
    air: 0.012,
    intro: 2,
    bpm: 92,
    chords: 'Am | F | C | G | Am | F | C | E | F | G | Am | Am | F | G | E | E',
    drums: 'title',
    drumVol: 0.8,
    space: 'hall',
    parts: [
      { inst: 'lead2', vol: 0.9, rev: 0.35, del: 0.3, notes:
        'E5! - - - D5 - C5 - | C5 - - - A4 - - - | G4 - C5 - E5 - D5 - | D5 - - - - - . . |' +
        'E5 - - - D5 - C5 - | C5 - - - A4 - F5 - | E5 - - - D5 - C5 - | B4 - - - G#4 - - - |' +
        'A4 - C5 - F5 - E5 - | D5 - - - B4 - G4 - | A4 - C5 - E5 - A5 - | G5 - - - E5 - - - |' +
        'F5 - E5 - D5 - C5 - | D5 - - - G5 - - - | G#5 - - - E5 - B4 - | E5 - - - - - . .' },
      { inst: 'bass', gen: 'octave', octave: 1, vol: 0.9 },
      { inst: 'arp', gen: 'up16', octave: 4, vol: 0.45, del: 0.2 },
      { inst: 'pad', gen: 'chord', octave: 3, vol: 1, rev: 0.4 },
    ],
  },

  // Lantern Row — lo-fi rain-on-glass.
  town: {
    air: 0.01,
    gain: 1.1,
    intro: 1,
    bpm: 80,
    swing: 0.16,
    chords: 'Dm9 | G9 | Cmaj7 | A7 | Dm9 | G9 | Bbmaj7 | A7',
    drums: 'lofi',
    drumVol: 0.75,
    // Close walls and awnings: short, near reflections.
    space: 'room',
    parts: [
      { inst: 'bell', vol: 0.9, rev: 0.35, del: 0.25, notes:
        '. F5 - E5 D5 - A4 - | . B4 - C5 D5 - - - | . E5 - D5 C5 - G4 - | C#5 - - - A4 - - - |' +
        '. F5 - E5 D5 - A5 - | G5 - F5 - E5 - D5 - | F5 - - - D5 - Bb4 - | A4 - - - - - . .' },
      { inst: 'bass', gen: 'walk', octave: 1, vol: 0.8 },
      { inst: 'pluck', gen: 'broken', octave: 4, vol: 0.55, rev: 0.3 },
      { inst: 'pad', gen: 'chord', octave: 3, vol: 0.8, rev: 0.5 },
      { inst: 'reed', gen: 'counter', octave: 4, vol: 0.4, rev: 0.4 },
    ],
  },

  // The Drowned Saint — smoky lounge jazz.
  bar: {
    gain: -1.4,
    bpm: 76,
    swing: 0.28,
    chords: 'Gm7 | C9 | Fmaj7 | Bbmaj7 | Em7b5 | A7 | Dm7 | D7',
    drums: 'lofi',
    space: 'room',
    drumVol: 0.55,
    parts: [
      { inst: 'reed', vol: 0.75, rev: 0.45, del: 0.15, notes:
        'D5 - F5 - A5 - G5 - | E5 - - - Bb4 - - - | A4 - C5 - E5 - D5 - | D5 - - - A4 - - - |' +
        'Bb4 - D5 - G5 - F5 - | E5 - C#5 - A4 - - - | F5 - E5 - D5 - C5 - | C5 - - - F#4 - - -' },
      { inst: 'bass', gen: 'walk', octave: 1, vol: 0.85 },
      { inst: 'organ', gen: 'chord', octave: 3, vol: 0.7, rev: 0.3 },
    ],
  },

  // World map — "Sprawl Run".
  world: {
    air: 0.012,
    gain: 0.7,
    intro: 2,
    bpm: 116,
    chords: 'Em | C | G | D | Em | C | Am | B | C | D | Em | Em | C | D | B | B',
    drums: 'synthwave',
    space: 'hall',
    parts: [
      { inst: 'lead2', vol: 0.85, rev: 0.25, del: 0.22, notes:
        'E5 - - B4 E5 - G5 - | G5 - E5 - - - B4 - | D5 - - B4 D5 - G5 - | A5 - F#5 - - - D5 - |' +
        'E5 - - B4 E5 - G5 - | A5 - G5 - E5 - C5 - | C5 - D5 - E5 - A5 - | F#5 - - - D#5 - - - |' +
        'E5 - G5 - C6 - B5 - | A5 - - - F#5 - D5 - | G5 - F#5 - E5 - B4 - | E5 - - - - - . . |' +
        'C5 - E5 - G5 - C6 - | B5 - A5 - F#5 - D5 - | D#5 - F#5 - B5 - A5 - | F#5 - - - D#5 - B4 -' },
      { inst: 'bass', gen: 'sync', octave: 1, vol: 0.95 },
      { inst: 'arp', gen: 'up16', octave: 4, vol: 0.35, del: 0.15 },
      { inst: 'pad', gen: 'chord', octave: 3, vol: 0.7, rev: 0.35 },
    ],
  },

  // Rustyard — dusty, twangy.
  rustyard: {
    air: 0.01,
    gain: 1.1,
    swing: 0.1,
    intro: 1,
    bpm: 100,
    chords: 'G | F | C | G | Em | F | C | D',
    drums: 'halftime',
    space: 'hall',
    parts: [
      { inst: 'twang', vol: 1.3, rev: 0.25, del: 0.3, notes:
        'G4 - B4 - D5 - B4 - | C5 - A4 - F4 - A4 - | G4 - C5 - D5 - C5 - | B4 - - - G4 - - - |' +
        'E5 - D5 - B4 - G4 - | A4 - C5 - F5 - E5 - | E5 - G5 - E5 - C5 - | D5 - - - F#5 - - -' },
      { inst: 'bass', gen: 'pulse8', octave: 1, vol: 0.8 },
      { inst: 'organ', gen: 'chord', octave: 3, vol: 0.5, rev: 0.3 },
    ],
  },

  // The Sinkline — cold water, distant drips.
  dungeon: {
    air: 0.011,
    gain: 2.0,
    intro: 2,
    bpm: 88,
    chords: 'Cm | Cm | Ab | G | Cm | Cm | Db | G',
    drums: 'sparse',
    space: 'cave',
    parts: [
      { inst: 'bell', gen: 'bells', octave: 7, vol: 0.3, rev: 0.6, del: 0.35 },
      { inst: 'bell', vol: 1, rev: 0.5, del: 0.45, notes:
        'C5 - - - . . Eb5 - | D5 - C5 - . . G4 - | C5 - - - Eb5 - C5 - | B4 - - - - - . . |' +
        'G5 - - - . . F5 - | Eb5 - - - . . C5 - | F5 - - - Eb5 - Db5 - | D5 - - - B4 - - -' },
      { inst: 'sub', gen: 'long', octave: 1, vol: 0.32 },
      { inst: 'choir', gen: 'chord', octave: 3, vol: 0.9, rev: 0.6 },
      { inst: 'pluck', gen: 'broken', octave: 3, vol: 0.4, del: 0.3 },
    ],
  },

  // K-M Annex 7 — clinical arpeggios.
  lab: {
    air: 0.016,
    gain: 0.4,
    intro: 2,
    bpm: 124,
    chords: 'F#m | D | A | E | F#m | D | Bm | C#',
    drums: 'pulse',
    space: 'tunnel',
    drumVol: 0.8,
    parts: [
      { inst: 'lead', vol: 0.6, rev: 0.3, del: 0.4, notes:
        '. . C#5 - F#5 - E5 - | D5 - - - A4 - - - | . . E5 - A5 - G#5 - | E5 - - - B4 - - - |' +
        '. . C#5 - F#5 - A5 - | G#5 - F#5 - D5 - - - | F#5 - E5 - D5 - B4 - | C#5 - - - F5 - - -' },
      { inst: 'arp', gen: 'up16', octave: 4, vol: 0.5, del: 0.2 },
      { inst: 'bass', gen: 'pulse8', octave: 1, vol: 0.8 },
      { inst: 'pad', gen: 'chord', octave: 3, vol: 0.6, rev: 0.4 },
    ],
  },

  // Battle — "Crossfire".
  battle: {
    // Its peaks sat 0.6 dB over the limiter's threshold.
    gain: -0.8,
    bpm: 152,
    chords: 'Em | Em | C | D | Em | Em | C | B | Am | C | Em | Em | Am | C | B | B',
    drums: 'battle',
    space: 'here',
    parts: [
      { inst: 'lead2', vol: 0.8, rev: 0.18, del: 0.12, notes:
        'E5! - E5 - G5 - E5 - B5 - - - A5 - G5 - | F#5 - G5 - F#5 - E5 - D5 - - - B4 - - - |' +
        'C5 - E5 - G5 - C6 - B5 - A5 - G5 - - - | A5 - - - F#5 - D5 - F#5 - A5 - D6 - - - |' +
        'E5 - E5 - G5 - E5 - B5 - - - A5 - G5 - | F#5 - G5 - A5 - B5 - G5 - - - E5 - - - |' +
        'C6 - B5 - A5 - G5 - E5 - - - G5 - - - | F#5 - - - D#5 - - - B4 - - - F#5 - - - |' +
        'A5 - - - C6 - - - B5 - A5 - G5 - E5 - | G5 - - - E5 - - - C5 - - - E5 - G5 - |' +
        'B5 - - - G5 - - - E5 - - - G5 - B5 - | E6 - - - D6 - - - B5 - - - G5 - - - |' +
        'A5 - B5 - C6 - A5 - E5 - - - A5 - - - | G5 - A5 - B5 - G5 - E5 - - - C5 - - - |' +
        'D#5 - F#5 - B5 - A5 - F#5 - - - D#5 - - - | B4 - - - D#5 - - - F#5 - - - B5 - - -' },
      { inst: 'bass', gen: 'drive', octave: 1, vol: 0.9 },
      { inst: 'arp', gen: 'updown', octave: 4, vol: 0.3 },
      { inst: 'pad', gen: 'stab', octave: 4, vol: 0.6 },
      { inst: 'lead', gen: 'counter', octave: 4, vol: 0.32, rev: 0.2 },
    ],
  },

  // Boss — "Heavy Metal Warden".
  boss: {
    rests: [7],
    gain: -1.6,
    bpm: 164,
    chords: 'Dm | Dm | Bb | A | Dm | Dm | Eb | A | Gm | Gm | Dm | Dm | Bb | C | A | A',
    drums: 'boss',
    // Fights (and their jingles) happen in the room they broke out in.
    space: 'here',
    parts: [
      { inst: 'lead2', vol: 0.85, rev: 0.2, del: 0.1, notes:
        'D5! - - D5 - - F5 - E5 - D5 - C#5 - D5 - | A5 - - - G#5 - - - A5 - - - F5 - - - |' +
        'Bb5 - - Bb5 - - A5 - G5 - F5 - G5 - A5 - | E5 - - - C#5 - - - A4 - - - C#5 - E5 - |' +
        'D6 - - D6 - - C6 - A5 - F5 - A5 - C6 - | D6 - - - C#6 - - - D6 - - - A5 - - - |' +
        'G5 - - G5 - - Bb5 - Eb6 - D6 - Bb5 - G5 - | A5 - - - E5 - - - C#5 - - - A4 - - - |' +
        'G5 - - - Bb5 - - - D6 - - - Bb5 - A5 - | G5 - - - D5 - - - G5 - Bb5 - D6 - C6 - |' +
        'F5 - - - A5 - - - D6 - - - - - - - | C6 - D6 - C6 - A5 - F5 - - - E5 - - - |' +
        'F5 - - - Bb5 - - - D6 - - - F6 - - - | E6 - - - D6 - C6 - G5 - - - C6 - - - |' +
        'C#6 - - - E6 - - - A5 - - - C#6 - E6 - | A5 - - - - - - - E5 - - - C#5 - - -' },
      { inst: 'bass', gen: 'drive', octave: 1, vol: 1 },
      { inst: 'organ', gen: 'chord', octave: 3, vol: 0.7 },
      { inst: 'arp', gen: 'up16', octave: 4, vol: 0.25 },
      { inst: 'lead', gen: 'counter', octave: 4, vol: 0.3, rev: 0.2 },
    ],
  },

  // Boss phase two — the bound spirit.
  boss2: {
    rests: [11],
    gain: -1.7,
    bpm: 140,
    chords: 'Dm | Bb | Gm | A | Dm | F | Gm | A | Gm | Eb | Bb | F | Gm | Eb | A | A',
    drums: 'boss2',
    space: 'here',
    parts: [
      { inst: 'lead', vol: 0.8, rev: 0.4, del: 0.2, notes:
        'D5 - - - F5 - A5 - | Bb5 - - - A5 - F5 - | G5 - - - Bb5 - D6 - | C#6 - - - A5 - - - |' +
        'D6 - - - C6 - A5 - | C6 - - - A5 - F5 - | G5 - - - Bb5 - A5 - | A5 - - - - - . . |' +
        'G5 - - - Bb5 - D6 - | Eb6 - - - D6 - Bb5 - | D6 - - - F6 - - - | C6 - - - A5 - F5 - |' +
        'Bb5 - - - A5 - G5 - | G5 - - - Bb5 - Eb6 - | E6 - - - C#6 - A5 - | A5 - - - E5 - C#5 -' },
      { inst: 'choir', gen: 'chord', octave: 4, vol: 1.1, rev: 0.6 },
      { inst: 'bass', gen: 'octave', octave: 1, vol: 0.9 },
      { inst: 'arp', gen: 'up16', octave: 5, vol: 0.25, del: 0.3 },
    ],
  },

  // Victory fanfare, then a short celebratory loop.
  victory: {
    gain: 0.4,
    bpm: 140,
    chords: 'C | G | F | C | C | Am | F | G',
    drums: 'fanfare',
    loopBar: 4,
    space: 'here',
    parts: [
      { inst: 'lead2', vol: 0.9, rev: 0.3, del: 0.15, notes:
        'C5 - E5 - G5 - C6 - | B5 - - - D6 - - - | C6 - A5 - F5 - A5 - | G5 - - - - - . . |' +
        'E5 - G5 - E5 - C5 - | C5 - E5 - A5 - - - | A5 - G5 - F5 - A5 - | G5 - - - D5 - - -' },
      { inst: 'bass', gen: 'pulse8', octave: 1, vol: 0.8 },
      { inst: 'pad', gen: 'chord', octave: 3, vol: 0.7 },
    ],
  },
  victory_boss: {
    gain: -0.5,
    bpm: 120,
    chords: 'C | G/B | Am | F | C | G | F | C',
    drums: 'march',
    loopBar: 4,
    space: 'here',
    parts: [
      { inst: 'lead2', vol: 0.9, rev: 0.4, del: 0.2, notes:
        'G5 - - - C6 - - - | B5 - - - D6 - - - | C6 - - - E6 - - - | F6 - - - - - - - |' +
        'E6 - D6 - C6 - G5 - | B5 - - - G5 - - - | A5 - C6 - F6 - E6 - | C6 - - - - - . .' },
      { inst: 'choir', gen: 'chord', octave: 4, vol: 1, rev: 0.5 },
      { inst: 'bass', gen: 'long', octave: 1, vol: 0.9 },
    ],
  },

  gameover: {
    air: 0.011,
    gain: 2.0,
    bpm: 66,
    chords: 'Am | F | Dm | E | Am',
    // Loops from the second bar: the player may sit on Retry / Load / Title for a while, and a
    // one-shot dirge used to leave that screen in silence.
    loopBar: 1,
    space: 'hall',
    parts: [
      { inst: 'bell', gen: 'bells', octave: 7, vol: 0.3, rev: 0.6, del: 0.35 },
      { inst: 'bell', vol: 0.9, rev: 0.6, del: 0.4, notes: 'E5 - - - C5 - - - | A4 - - - F4 - - - | D5 - C5 - B4 - A4 - | G#4 - - - - - - - | A4 - - - - - - -' },
      { inst: 'pad', gen: 'chord', octave: 3, vol: 1, rev: 0.6 },
      { inst: 'sub', gen: 'long', octave: 1, vol: 0.3 },
    ],
  },

  // Sable's theme — for quiet, heavy moments.
  sable: {
    air: 0.011,
    gain: 2.5,
    swing: 0.08,
    bpm: 70,
    chords: 'Cm | Ab | Eb | Bb | Cm | Ab | Fm | G',
    // Story cues play in the scene they score.
    space: 'here',
    parts: [
      { inst: 'bell', gen: 'bells', octave: 7, vol: 0.3, rev: 0.6, del: 0.35 },
      { inst: 'bell', vol: 0.9, rev: 0.55, del: 0.35, notes:
        'G5 - - - Eb5 - D5 - | C5 - - - Eb5 - - - | Bb4 - - - G5 - F5 - | F5 - - - D5 - - - |' +
        'G5 - - - Bb5 - Ab5 - | G5 - - - Eb5 - C5 - | Ab5 - - - G5 - F5 - | D5 - - - B4 - - -' },
      { inst: 'pad', gen: 'chord', octave: 3, vol: 0.9, rev: 0.6 },
      { inst: 'pluck', gen: 'broken', octave: 3, vol: 0.45, rev: 0.4 },
      { inst: 'sub', gen: 'long', octave: 1, vol: 0.28 },
    ],
  },

  // Tension — betrayals, alarms, ambushes.
  tension: {
    air: 0.016,
    bpm: 112,
    chords: 'Bm | Bm | G | F# | Bm | Bm | G | F#',
    drums: 'heartbeat',
    space: 'here',
    parts: [
      { inst: 'bell', gen: 'bells', octave: 7, vol: 0.3, rev: 0.6, del: 0.35 },
      { inst: 'lead', vol: 0.6, rev: 0.4, del: 0.3, notes:
        '. . . . F#5 - - - | G5 - F#5 - D5 - - - | B4 - - - D5 - E5 - | C#5 - - - A#4 - - - |' +
        '. . . . F#5 - - - | A5 - G5 - F#5 - - - | E5 - D5 - B4 - G4 - | F#4 - - - - - . .' },
      { inst: 'bass', gen: 'pulse8', octave: 1, vol: 0.9 },
      { inst: 'choir', gen: 'chord', octave: 3, vol: 0.8, rev: 0.5 },
      { inst: 'pluck', gen: 'up8', octave: 4, vol: 0.4, del: 0.3 },
    ],
  },
};
