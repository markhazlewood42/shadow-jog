/** Field actors: party members and NPCs moving tile-to-tile with smooth interpolation. */
import { buildChar, walkFrame, type CharLook, type CharSprite, type Dir } from '../art/chars';
import type { NpcDef } from './types';
import { critterSprite, type Critter } from '../art/critters';
import { TS } from './tiles';

export const DIRS: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

export function dirTo(fx: number, fy: number, tx: number, ty: number): Dir {
  const dx = tx - fx, dy = ty - fy;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export function opposite(d: Dir): Dir {
  return d === 'up' ? 'down' : d === 'down' ? 'up' : d === 'left' ? 'right' : 'left';
}

export class Actor {
  id: string;
  sprite: CharSprite;
  look: CharLook;
  /** Tile position (destination while moving). */
  x: number;
  y: number;
  /** Pixel feet position. */
  px: number;
  py: number;
  dir: Dir;
  visible = true;
  solid = true;
  moving = false;
  private fromX = 0;
  private fromY = 0;
  private t = 0;
  private dur = 12;
  /** Accumulated walk distance in half-tiles (drives the walk cycle). */
  private stride = 0;
  npc?: NpcDef;
  /** Wander bookkeeping. */
  home: [number, number];
  idle = 0;
  /** Queue of scripted steps. */
  path: Dir[] = [];
  pathSpeed = 12;
  onPathDone: (() => void) | null = null;
  emote: { kind: string; t: number; dur: number } | null = null;
  /** Vertical hop offset (px) for little jumps in cutscenes. */
  hop = 0;
  /** Is this actor a party member following the leader? */
  follower = false;

  constructor(id: string, look: CharLook, x: number, y: number, dir: Dir = 'down') {
    this.id = id;
    this.look = look;
    this.sprite = buildChar(look);
    this.x = x;
    this.y = y;
    this.px = x * TS + 8;
    this.py = y * TS + 15;
    this.dir = dir;
    this.home = [x, y];
  }

  useCritter(kind: Critter): void {
    this.sprite = critterSprite(kind);
  }

  setLook(look: CharLook): void {
    this.look = look;
    this.sprite = buildChar(look);
  }

  place(x: number, y: number, dir?: Dir): void {
    this.x = x;
    this.y = y;
    this.px = x * TS + 8;
    this.py = y * TS + 15;
    this.moving = false;
    if (dir) this.dir = dir;
  }

  /** Begin a one-tile move (caller has checked collision). */
  step(dir: Dir, dur: number): void {
    const [dx, dy] = DIRS[dir];
    this.dir = dir;
    this.fromX = this.x;
    this.fromY = this.y;
    this.x += dx;
    this.y += dy;
    this.t = 0;
    this.dur = dur;
    this.moving = true;
    this.settleFrom = -1;
  }

  /** Move to an arbitrary adjacent-or-same tile (followers). */
  stepTo(x: number, y: number, dur: number): void {
    if (x === this.x && y === this.y) return;
    this.dir = dirTo(this.x, this.y, x, y);
    this.fromX = this.x;
    this.fromY = this.y;
    this.x = x;
    this.y = y;
    this.t = 0;
    this.dur = dur;
    this.moving = true;
    this.settleFrom = -1;
  }

  /** Easing out of the current step: progress when it began (−1 = not settling), frames in, length. */
  private settleFrom = -1;
  private settleT = 0;
  private settleDur = 0;

  /**
   * The player let go mid-step: the rest of the step decelerates to a stop (twice the remaining
   * time, ease-out, so it leaves at the walking speed and arrives at rest) instead of halting dead.
   */
  settle(): void {
    if (!this.moving || this.settleFrom >= 0) return;
    const k = Math.min(1, this.t / this.dur);
    if (k < 0.5) return; // a quick tap still takes one clean step
    this.settleFrom = k;
    this.settleT = 0;
    this.settleDur = Math.max(2, Math.round((1 - k) * this.dur * 2));
  }

  /** Advance interpolation. Returns true on the frame a step completes. */
  update(): boolean {
    if (this.emote) {
      this.emote.t++;
      if (this.emote.t >= this.emote.dur) this.emote = null;
    }
    if (!this.moving) return false;
    this.t++;
    let k = Math.min(1, this.t / this.dur);
    if (this.settleFrom >= 0) {
      this.settleT++;
      const u = Math.min(1, this.settleT / this.settleDur);
      k = u >= 1 ? 1 : this.settleFrom + (1 - this.settleFrom) * (1 - (1 - u) ** 2);
    }
    this.px = (this.fromX + (this.x - this.fromX) * k) * TS + 8;
    this.py = (this.fromY + (this.y - this.fromY) * k) * TS + 15;
    this.stride += 2 / this.dur;
    if (k >= 1) {
      this.moving = false;
      this.settleFrom = -1;
      return true;
    }
    return false;
  }

  frame(): HTMLCanvasElement {
    const phase = this.moving ? Math.floor(this.stride + 1) & 3 : 0;
    const idx = this.moving ? walkFrame(phase) : 0;
    return this.sprite.frames[this.dir][idx]!;
  }

  /** Top-left draw position in world pixels. */
  drawX(): number {
    return Math.round(this.px - this.sprite.ax);
  }
  drawY(): number {
    return Math.round(this.py - this.sprite.ay - this.hop);
  }
}
