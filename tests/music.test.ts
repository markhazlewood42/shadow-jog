import { describe, expect, it } from 'vitest';
import { compile } from '../src/audio/music';
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
