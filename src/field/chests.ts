/** Loot container sprites (closed / open). */
import { surface } from '../engine/canvas';

type Kind = 'crate' | 'locker' | 'case';
const cache = new Map<Kind, { closed: HTMLCanvasElement; open: HTMLCanvasElement }>();

export function chestSprites(kind: Kind): { closed: HTMLCanvasElement; open: HTMLCanvasElement } {
  let c = cache.get(kind);
  if (c) return c;
  const make = (open: boolean) => {
    const s = surface(16, 16);
    const g = s.ctx;
    const body = kind === 'locker' ? '#4a5a6e' : kind === 'case' ? '#2a2c38' : '#3e4656';
    const trim = kind === 'case' ? '#ff4fb0' : '#3fe0f0';
    g.fillStyle = '#0f0e17';
    g.fillRect(1, 5, 14, 11);
    g.fillStyle = body;
    g.fillRect(2, 8, 12, 7);
    g.fillStyle = '#5a6478';
    g.fillRect(2, 8, 12, 1);
    g.fillStyle = '#262a36';
    g.fillRect(2, 14, 12, 1);
    if (open) {
      g.fillStyle = '#0f0e17';
      g.fillRect(1, 1, 14, 5);
      g.fillStyle = '#12101a';
      g.fillRect(2, 6, 12, 2);
      g.fillStyle = body;
      g.fillRect(2, 2, 12, 3);
      g.fillStyle = '#6a7488';
      g.fillRect(2, 2, 12, 1);
    } else {
      g.fillStyle = body;
      g.fillRect(2, 6, 12, 2);
      g.fillStyle = '#6a7488';
      g.fillRect(2, 6, 12, 1);
      g.fillStyle = trim;
      g.fillRect(7, 9, 2, 2);
      g.fillStyle = '#ffffff';
      g.fillRect(7, 9, 1, 1);
    }
    g.fillStyle = trim;
    g.globalAlpha = 0.7;
    g.fillRect(3, 12, 10, 1);
    g.globalAlpha = 1;
    return s.canvas;
  };
  c = { closed: make(false), open: make(true) };
  cache.set(kind, c);
  return c;
}
