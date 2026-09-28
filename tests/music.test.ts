import { describe, expect, it } from 'vitest';
import { chordTimeline, compile, stepsOf } from '../src/audio/music';
import { noteToMidi } from '../src/audio/engine';
import { SONGS } from '../src/audio/songs';

describe('soundtrack', () => {
  for (const [name, spec] of Object.entries(SONGS)) {
    it(`${name} compiles with bar-aligned parts`, () => {
      const bars = spec.chords.split('|').filter((b) => b.trim()).length;
      for (const p of spec.parts) {
        if (!p.notes) continue;
        const pbars = p.notes.split('|').filter((b) => b.trim());
        expect(pbars.length, `${name} melody bars`).toBe(bars);
        for (const b of pbars) expect(16 % b.trim().split(/\s+/).length, `${name} bar "${b.trim()}"`).toBe(0);
      }
      const c = compile(spec);
      expect(c.length).toBe(bars * 16);
      expect(c.steps.some((s) => s.length > 0)).toBe(true);
    });
  }
});

/** Melody notes with their start step and held length ('-' extends, '.' rests). */
function melody(src: string): { midi: number; step: number; len: number }[] {
  const out: { midi: number; step: number; len: number }[] = [];
  for (const t of stepsOf(src)) {
    if (t.tok === '-') {
      const last = out[out.length - 1];
      if (last) last.len += t.len;
    } else if (t.tok === '.') out.push({ midi: -1, step: t.step, len: t.len });
    else out.push({ midi: noteToMidi(t.tok), step: t.step, len: t.len });
  }
  return out.filter((n) => n.midi >= 0);
}

describe('harmony', () => {
  for (const [name, spec] of Object.entries(SONGS)) {
    it(`${name}: held dissonances on the beat resolve by step`, () => {
      const { chords } = chordTimeline(spec.chords);
      const inChord = (midi: number, step: number) => {
        const ch = chords[step % chords.length];
        if (!ch) return true;
        // Chord tones plus the colours a melody can sit on: sixth and sevenths.
        const pcs = new Set([...ch.tones.map((t) => t % 12), (ch.root + 9) % 12, (ch.root + 10) % 12, (ch.root + 11) % 12]);
        return pcs.has(midi % 12);
      };
      const clashes: string[] = [];
      for (const p of spec.parts) {
        if (!p.notes) continue;
        const ns = melody(p.notes);
        ns.forEach((n, i) => {
          // Short or off-beat notes are passing and neighbour tones; held chord tones are fine.
          if (n.len < 4 || n.step % 4 !== 0 || inChord(n.midi, n.step)) return;
          // A held non-chord tone must be a suspension/appoggiatura: next note a step away, in the chord.
          const next = ns[i + 1] ?? ns[0]!;
          const step = Math.abs(next.midi - n.midi);
          if (step >= 1 && step <= 2 && inChord(next.midi, next.step)) return;
          // ...or an anticipation: the same pitch carried into the next chord, where it belongs.
          if (step === 0 && inChord(next.midi, next.step)) return;
          clashes.push(`bar ${Math.floor(n.step / 16) + 1} step ${n.step % 16}: midi ${n.midi} held ${n.len}, then ${next.midi}`);
        });
      }
      expect(clashes).toEqual([]);
    });
  }
});
