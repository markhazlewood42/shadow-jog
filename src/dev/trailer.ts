/**
 * Trailer tooling (dev only; driven by scripts/trailer.mjs, reached as `window.__SJ__.trailer()`).
 *
 * - `card(lines, seconds)`: a title card in the game's own font, scaled up, on black; it's an
 *   opaque scene, so its neon underline blooms with the GPU effects like everything else.
 * - `hold(song)`: one song for a whole section, whatever the scenes ask for (audio/music.ts).
 * - `record.start()` / `record.stop(file)`: the game's picture (the GPU effects canvas, or the 2D
 *   one without them) and its own audio mix, straight to an MP4 the browser downloads.
 * - `quiet()`: no autosaves or their notices, no random fights, full screen shake and flash.
 * - `toughen(k)`: the enemies on the field last `k` times as long (a staged fight's rounds).
 */
import { audio } from '../audio/engine';
import { holdMusic, music } from '../audio/music';
import { type Ctx, surface } from '../engine/canvas';
import { drawText, measure } from '../engine/font';
import { type Game, Scene } from '../engine/game';
import { H, W } from '../sje/core/size';
import { postfx } from '../engine/postfx';
import { settings } from '../game/settings';
import { state } from '../game/state';
import { autosavePolicy } from '../game/systems';

export interface CardLine {
  text: string;
  /** Pixels per font pixel (the font is 7 px tall: 5 makes a 35 px line). */
  scale: number;
  color?: string;
  /** A neon rule under the line, in this colour. */
  rule?: string;
}

/** Text drawn once at font size, then scaled up nearest-neighbour: big pixel lettering. */
function bigText(text: string, color: string): HTMLCanvasElement {
  const w = measure(text) + 2;
  const s = surface(w, 10);
  drawText(s.ctx, text, 1, 1, { color, shadow: '#1a1020' });
  return s.canvas;
}

/** A title card: lines stacked in the middle of a black screen, fading in and out. */
class CardScene extends Scene<void> {
  private t = 0;
  private readonly art: { img: HTMLCanvasElement; line: CardLine }[];
  constructor(
    lines: CardLine[],
    private readonly frames: number,
  ) {
    super();
    this.art = lines.map((line) => ({ img: bigText(line.text, line.color ?? '#e8e6ff'), line }));
  }
  update(): void {
    if (++this.t >= this.frames) this.close();
  }
  render(ctx: Ctx): void {
    ctx.fillStyle = '#07060d';
    ctx.fillRect(0, 0, W, H);
    const fade = Math.min(1, this.t / 14, (this.frames - this.t) / 14);
    const gap = 8;
    const total = this.art.reduce((n, a) => n + a.img.height * a.line.scale + (a.line.rule ? 6 : 0), 0) + gap * (this.art.length - 1);
    let y = Math.round((H - total) / 2);
    const glow = postfx.glowLayer();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = Math.max(0, fade);
    for (const { img, line } of this.art) {
      const w = img.width * line.scale, h = img.height * line.scale;
      const x = Math.round((W - w) / 2);
      ctx.drawImage(img, x, y, w, h);
      if (line.rule) {
        // The rule grows out from the middle as the card arrives.
        const rw = Math.round(w * Math.min(1, this.t / 30));
        ctx.fillStyle = line.rule;
        ctx.fillRect(Math.round((W - rw) / 2), y + h + 2, rw, 2);
        if (glow) {
          glow.globalAlpha = Math.max(0, fade);
          glow.fillStyle = line.rule;
          glow.fillRect(Math.round((W - rw) / 2), y + h + 1, rw, 4);
          glow.drawImage(img, x, y, w, h);
          glow.globalAlpha = 1;
        }
        y += 6;
      }
      y += h + gap;
    }
    ctx.globalAlpha = 1;
  }
}

let game: Game | null = null;

/** Called by boot.ts: the game to put cards on. */
export function attach(g: Game): void {
  game = g;
}

/** Show a card for `seconds`, over whatever is on screen; resolves when it's gone. */
export async function card(lines: CardLine[], seconds: number): Promise<void> {
  if (!game) throw new Error('trailer: not attached');
  await game.run(new CardScene(lines, Math.round(seconds * 60)));
}

/** Hold one song (null lets the scenes choose again). */
export function hold(song: string | null, fadeFrames = 30): void {
  holdMusic(song, fadeFrames);
}

/** Let go of the held song and fade it out over `frames`. */
export function fadeOut(frames = 90): void {
  holdMusic(null);
  music(null, frames);
}

/** For the camera: no autosaves (or notices about them), no objective box, full shake and flash. */
export function quiet(): void {
  autosavePolicy.enabled = false;
  autosavePolicy.pausedNoticeShown = true;
  settings.shake = 2;
  settings.flash = 2;
  state.flags.objective = '';
  // No random fights wandering into a shot.
  state.flags.noEncounters = true;
}

/**
 * Make the enemies on the field `k` times as tough (max and current HP, and what the HP bars
 * show), so a staged fight lasts the rounds it's scripted for.
 */
export function toughen(k: number): void {
  const s = game?.top as unknown as { battle?: { enemies: { uid: number; hp: number; base: { maxHp: number } }[] }; d?: (uid: number) => { hp: number; shownHp: number; lagHp: number } };
  if (!s?.battle || !s.d) return;
  for (const e of s.battle.enemies) {
    e.base.maxHp = Math.round(e.base.maxHp * k);
    e.hp = e.base.maxHp;
    const d = s.d(e.uid);
    d.hp = d.shownHp = d.lagHp = e.hp;
  }
}

// ------------------------------------------------------------------ recording
let rec: MediaRecorder | null = null;
let chunks: Blob[] = [];
let tap: MediaStreamAudioDestinationNode | null = null;
let limiter: DynamicsCompressorNode | null = null;

/** The best MP4 this browser can record: H.264 High at level 4.2 (1080p60), AAC; else WebM. */
function pickType(): string {
  for (const t of ['video/mp4;codecs=avc1.64002a,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export const record = {
  /** Start recording what's on screen and what's playing. Returns the format chosen. */
  start(videoBitsPerSecond = 16_000_000): string {
    // The one canvas of the page: the game's own (the old `#fx` overlay and `#screen` pair are gone since M6).
    const canvas = document.querySelector('canvas');
    const c = audio.ctx;
    if (!canvas || !c) throw new Error('trailer: nothing to record (no canvas, or audio not started)');
    const stream = canvas.captureStream(60);
    // The game's whole mix, as it leaves the master bus, through a limiter like the speakers' own
    // (engine.ts), so peaks don't clip in the file.
    tap = c.createMediaStreamDestination();
    limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.ratio.value = 20;
    limiter.knee.value = 0;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    audio.master.connect(limiter).connect(tap);
    for (const t of tap.stream.getAudioTracks()) stream.addTrack(t);
    const mimeType = pickType();
    chunks = [];
    rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond, audioBitsPerSecond: 192_000 });
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.start(1000);
    return mimeType;
  },
  /** Stop, and hand the file to the browser as a download named `file`. Resolves with its size. */
  async stop(file: string): Promise<number> {
    const r = rec;
    if (!r) throw new Error('trailer: not recording');
    const done = new Promise<void>((res) => {
      r.onstop = () => res();
    });
    r.stop();
    await done;
    if (limiter) audio.master.disconnect(limiter);
    tap = null;
    limiter = null;
    rec = null;
    const blob = new Blob(chunks, { type: r.mimeType });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return blob.size;
  },
};
