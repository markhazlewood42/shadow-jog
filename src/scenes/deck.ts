/**
 * Hex's deck, close up. Three ways in:
 * - 'dead': when Hex first shows it off, coprocessor slot empty, screen crying. Look, then go.
 * - 'seat': bringing her the Stingray. Hands-on: line the chip's pins up with the socket (a press
 *   as they meet), snap the two retention clips, then watch it boot. The boot unlocks Overload
 *   (the script sets the flag after: `s.unlock('stingray_seated')`).
 * - 'view': from the menu once it's running: the deck, what's in each slot, and her programs.
 *   The empty expansion slots are where later chapters' parts go.
 *
 * Added after Mark's first playthrough (2026-09-29): "When Hex is talking about or using their
 * deck, I want to see it… Maybe a mini-interaction… to insert the component we retrieved that can
 * be built on later."
 */
import { getPortrait, type Face } from '../art/portraits';
import { CHIP_H, CHIP_W, DECK, DECK_H, DECK_W, deckBody, drawAntennaTip, drawChip, drawLeds } from '../art/deck';
import { sfx } from '../audio/sfx';
import { ABILITIES } from '../data/abilities';
import type { Ctx } from '../engine/canvas';
import { drawParagraph, drawText, measure } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { autoClose } from '../game/debug';
import { knownAbilities } from '../game/party';
import { state } from '../game/state';
import { drawWindow, keyLegend, OVERLAY_DIM, UI } from '../ui/draw';
import { ELEMENT_COLOR, ELEMENT_ICON, markElements } from './battlekit/tables';

export type DeckMode = 'dead' | 'seat' | 'view';

type Phase = 'look' | 'align' | 'drop' | 'clips' | 'boot' | 'done';

/** Where the deck sits on screen. */
const DX = Math.round((W - DECK_W) / 2) - 70, DY = 26;
/** The chip's resting x over the socket (its pins over the contacts). */
const SOCKET_X = DX + DECK.socket.x + 2;
const HOVER_Y = DY + DECK.socket.y - 60;
const SEAT_Y = DY + DECK.socket.y + DECK.socket.h - CHIP_H;

/** The boot log, typed onto the screen a character a frame. */
const BOOT = [
  'FATHOM // STINGRAY',
  'handshake .... OK',
  'RAM 16 > 24 GiB',
  'SPIKE ANALYZE',
  'PATCH ........ OK',
  '+ OVERLOAD .. NEW',
  'STINGRAY ONLINE',
];

export class DeckScene extends Scene<void> {
  override opaque = false;
  override curtain = true;
  private phase: Phase;
  private t = 0;
  private phaseT = 0;
  /** Align: the chip swings side to side over the socket; misses slow it down. */
  private misses = 0;
  private chipX = SOCKET_X + 20;
  private chipY = HOVER_Y;
  private clips = 0;
  private bounce = 0;
  private line: { face: Face; text: string } = { face: 'neutral', text: '' };
  private sparks: { x: number; y: number; vx: number; vy: number; life: number }[] = [];

  constructor(readonly mode: DeckMode) {
    super();
    this.phase = mode === 'seat' ? 'align' : 'look';
    if (mode === 'dead') this.line = { face: 'sad', text: 'No coprocessor, no deck. She’s just a very expensive paperweight.' };
    if (mode === 'seat') this.line = { face: 'surprised', text: 'Pins to pins. Gently. She bites.' };
  }

  override enter(): void {
    sfx('confirm');
  }

  /** How far off true the chip may be and still seat: a little kinder with each miss. */
  private get tolerance(): number {
    return 4 + Math.min(4, this.misses * 2);
  }

  update(): void {
    this.t++;
    this.phaseT++;
    const inp = this.game.input;
    // Test harnesses skip the hands-on part (the script sets the flag either way).
    if (autoClose(this.t, 60)) {
      this.close();
      return;
    }
    for (const p of this.sparks) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      p.life--;
    }
    this.sparks = this.sparks.filter((p) => p.life > 0);
    if (this.bounce > 0) this.bounce--;
    switch (this.phase) {
      case 'look':
        if (inp.pressed('confirm') || inp.pressed('cancel')) {
          sfx('cancel');
          this.close();
        }
        break;
      case 'align': {
        // A slow swing that slows further after each miss.
        const speed = 0.035 / (1 + this.misses * 0.4);
        this.chipX = SOCKET_X + Math.sin(this.phaseT * speed + 1.2) * 22;
        this.chipY = HOVER_Y + (this.bounce > 0 ? -Math.sin((this.bounce / 12) * Math.PI) * 6 : 0);
        if (inp.pressed('confirm')) {
          if (Math.abs(this.chipX - SOCKET_X) <= this.tolerance) {
            this.chipX = SOCKET_X;
            this.go('drop');
            sfx('confirm');
          } else {
            this.misses++;
            this.bounce = 12;
            sfx('buzz');
            this.line = { face: 'surprised', text: this.misses === 1 ? 'Easy! Easy. Line the pins up first.' : 'Wait for the gold to meet the gold.' };
          }
        }
        break;
      }
      case 'drop':
        this.chipY = HOVER_Y + (SEAT_Y - HOVER_Y) * Math.min(1, (this.phaseT / 14) ** 2);
        if (this.phaseT >= 14) {
          this.chipY = SEAT_Y;
          sfx('equip');
          this.game.shake(8, 1);
          this.spark(SOCKET_X + CHIP_W / 2, SEAT_Y + CHIP_H - 2, 8);
          this.line = { face: 'neutral', text: 'Now the clips. Both of them. Click, click.' };
          this.go('clips');
        }
        break;
      case 'clips':
        if (inp.pressed('confirm') && this.phaseT > 8) {
          this.clips++;
          sfx('bump');
          const side = this.clips === 1 ? DX + DECK.socket.x - 3 : DX + DECK.socket.x + DECK.socket.w + 2;
          this.spark(side, DY + DECK.socket.y + 6, 6);
          if (this.clips >= 2) {
            this.line = { face: 'neutral', text: 'Come on, come on…' };
            sfx('code');
            this.go('boot');
          }
        }
        break;
      case 'boot': {
        const total = BOOT.reduce((n, l) => n + l.length, 0);
        if (this.phaseT % 30 === 0) sfx('blip');
        if (this.phaseT > total + 30) {
          sfx('levelup');
          this.line = { face: 'happy', text: 'Aaand she lives. Hi, baby. Did you miss me? You missed me.' };
          this.go('done');
        }
        break;
      }
      case 'done':
        if (this.phaseT > 20 && (inp.pressed('confirm') || inp.pressed('cancel'))) {
          sfx('confirm');
          this.close();
        }
        break;
    }
  }

  private go(p: Phase): void {
    this.phase = p;
    this.phaseT = 0;
  }

  private spark(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) this.sparks.push({ x, y, vx: (Math.random() - 0.5) * 2.4, vy: -Math.random() * 2 - 0.4, life: 14 + Math.floor(Math.random() * 8) });
  }

  /** Is the Stingray in the deck (seated in this scene, or already)? */
  private get seated(): boolean {
    return this.mode === 'view' || (this.mode === 'seat' && this.phase !== 'align' && this.phase !== 'drop');
  }

  private get live(): boolean {
    return this.mode === 'view' || this.phase === 'done' || (this.phase === 'boot' && this.phaseT > 10);
  }

  render(ctx: Ctx): void {
    ctx.fillStyle = OVERLAY_DIM;
    ctx.fillRect(0, 0, W, H);
    // A dark bench to set it on, lit from the screen.
    ctx.fillStyle = '#0c0b14';
    ctx.fillRect(DX - 14, DY - 12, DECK_W + 28, DECK_H + 20);
    ctx.fillStyle = '#1a1826';
    ctx.fillRect(DX - 14, DY + DECK_H + 4, DECK_W + 28, 4);
    ctx.drawImage(deckBody(), DX, DY);
    this.renderScreen(ctx);
    const lit = this.mode === 'view' || this.phase === 'done' ? DECK.leds.n : this.phase === 'boot' ? Math.min(DECK.leds.n, Math.floor(this.phaseT / 18)) : 0;
    drawLeds(ctx, DX, DY, lit, this.mode === 'dead', this.t);
    drawAntennaTip(ctx, DX, DY, this.live, this.t);
    if (this.mode !== 'dead') this.renderChip(ctx);
    for (const p of this.sparks) {
      ctx.fillStyle = p.life > 8 ? '#fff0a0' : '#ffb04a';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    if (this.mode === 'view') this.renderSlots(ctx);
    else this.renderGuide(ctx);
    if (this.line.text && this.mode !== 'view') this.renderLine(ctx);
  }

  private renderScreen(ctx: Ctx): void {
    const s = DECK.screen, x = DX + s.x, y = DY + s.y;
    if (this.mode === 'dead') {
      // Dead: a crying face and a blinking complaint.
      ctx.fillStyle = '#6a1a24';
      for (const [a, b] of [[40, 12], [60, 12]] as const) ctx.fillRect(x + a, y + b, 6, 2);
      ctx.fillRect(x + 42, y + 15, 2, 5);
      ctx.fillRect(x + 62, y + 15, 2, 5);
      ctx.fillRect(x + 44, y + 26, 18, 2);
      ctx.fillRect(x + 42, y + 28, 2, 2);
      ctx.fillRect(x + 62, y + 28, 2, 2);
      if (Math.floor(this.t / 30) % 2 === 0) drawText(ctx, 'NO CO-PRO', x + s.w / 2, y + 33, { color: '#ff4a4a', align: 'center', shadow: false });
      return;
    }
    if (!this.live && this.phase !== 'boot') {
      drawText(ctx, 'NO CO-PRO', x + s.w / 2, y + 17, { color: Math.floor(this.t / 30) % 2 ? '#ff4a4a' : '#6a1a24', align: 'center', shadow: false });
      return;
    }
    ctx.fillStyle = '#06140f';
    ctx.fillRect(x, y, s.w, s.h);
    if (this.mode === 'view' || this.phase === 'done') {
      // Running: the fin logo and a status line.
      drawChipLogo(ctx, x + 8, y + 8);
      drawText(ctx, 'STINGRAY', x + 30, y + 8, { color: '#6ff3ff', shadow: false });
      drawText(ctx, 'ONLINE', x + 30, y + 18, { color: '#62e06a', shadow: false });
      drawText(ctx, `RAM ${24} GiB`, x + 8, y + 30, { color: '#3fbf88', shadow: false });
      return;
    }
    // Booting: the log typed a character a frame; the lines scroll once they overflow.
    let chars = Math.max(0, this.phaseT - 10);
    const lines: string[] = [];
    for (const l of BOOT) {
      if (chars <= 0) break;
      lines.push(l.slice(0, chars));
      chars -= l.length;
    }
    const shown = lines.slice(-4);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, s.w, s.h);
    ctx.clip();
    shown.forEach((l, i) => {
      drawText(ctx, l, x + 3, y + 3 + i * 10, { color: l.includes('NEW') ? '#ffe07a' : l.includes('ONLINE') ? '#6ff3ff' : '#6affc0', shadow: false });
    });
    ctx.restore();
  }

  private renderChip(ctx: Ctx): void {
    const glow = this.live ? 0.6 + 0.4 * Math.sin(this.t * 0.12) : 0;
    const x = this.mode === 'view' ? SOCKET_X : this.chipX, y = this.mode === 'view' ? SEAT_Y : this.chipY;
    if (this.phase === 'align' || this.phase === 'drop') {
      // A shadow on the bay floor, where it would land.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(Math.round(x) + 2, DY + DECK.socket.y + DECK.socket.h - 4, CHIP_W - 4, 3);
    }
    drawChip(ctx, x, y, glow);
    // The retention clips over the chip's ends once seated.
    if (this.seated) {
      const n = this.mode === 'view' ? 2 : this.clips;
      ctx.fillStyle = '#9aa0b8';
      if (n >= 1) ctx.fillRect(DX + DECK.socket.x - 3, SEAT_Y + 3, 4, 6);
      if (n >= 2) ctx.fillRect(DX + DECK.socket.x + DECK.socket.w - 1, SEAT_Y + 3, 4, 6);
    }
  }

  /** The prompt for the step in hand, and in Align, the pin guide (gold meets gold). */
  private renderGuide(ctx: Ctx): void {
    const key = this.game.input.keyName('confirm');
    let prompt = '';
    if (this.phase === 'align') {
      const off = Math.abs(this.chipX - SOCKET_X);
      const ok = off <= this.tolerance;
      // Guide ticks from the chip's first and last pins down to the socket's.
      ctx.fillStyle = ok ? '#62e06a' : '#8a6a26';
      for (const px of [4, CHIP_W - 6]) {
        ctx.fillRect(Math.round(this.chipX) + px, Math.round(this.chipY) + CHIP_H + 1, 2, SEAT_Y - Math.round(this.chipY) - 2);
      }
      ctx.fillStyle = ok ? '#62e06a' : '#e0b04a';
      ctx.fillRect(SOCKET_X + 4, SEAT_Y + CHIP_H - 1, 2, 2);
      ctx.fillRect(SOCKET_X + CHIP_W - 6, SEAT_Y + CHIP_H - 1, 2, 2);
      prompt = `Press {y}${key}{/} as the pins line up over the socket.`;
    } else if (this.phase === 'clips') prompt = `Press {y}${key}{/} to snap the clips: ${this.clips}/2.`;
    else if (this.phase === 'boot') prompt = '{d}Booting…{/}';
    else if (this.phase === 'done') prompt = `{y}NEW PROGRAM{/}  ${this.overloadLine()}`;
    else if (this.mode === 'dead') prompt = '{d}Hex’s deck. The coprocessor slot is empty.{/}';
    if (!prompt) return;
    const px = DX + DECK_W + 18, pw = W - px - 10;
    drawWindow(ctx, px, DY + 6, pw, 70, { plain: true, accent: UI.violet });
    drawParagraph(ctx, prompt, px + 8, DY + 14, pw - 16, { lineH: 11 });
    if (this.phase === 'done') drawParagraph(ctx, markElements(ABILITIES.overload?.desc ?? ''), px + 8, DY + 36, pw - 16, { color: UI.dim, lineH: 10 });
  }

  private overloadLine(): string {
    const ab = ABILITIES.overload;
    if (!ab) return '';
    const el = ab.element;
    return el ? `{#${ELEMENT_COLOR[el].slice(1)}}${ELEMENT_ICON[el]}{/} ${ab.name}` : ab.name;
  }

  /** Hex's line, at the foot of the screen with her face. */
  private renderLine(ctx: Ctx): void {
    const y = H - 62, x = 8, w = W - 16;
    drawWindow(ctx, x, y, w, 54, { accent: '#c3a0ff', footer: this.phase === 'look' || this.phase === 'done' ? keyLegend(this.game.input, 'back') : undefined });
    const port = getPortrait('hex', this.line.face);
    if (port) ctx.drawImage(port, x + 6, y + 5, 44, 44);
    drawText(ctx, 'Hex', x + 58, y + 7, { color: '#c3a0ff' });
    drawParagraph(ctx, this.line.text, x + 58, y + 20, w - 70, { lineH: 11 });
  }

  /** The menu view: what's in each slot, and the programs the deck runs. */
  private renderSlots(ctx: Ctx): void {
    const px = DX + DECK_W + 18, pw = W - px - 10;
    drawWindow(ctx, px, 8, pw, H - 16, { title: 'HEX’S DECK', accent: UI.violet, footer: keyLegend(this.game.input, 'back') });
    let y = 24;
    const slot = (name: string, what: string, color: string, note: string) => {
      drawText(ctx, name, px + 8, y, { color: UI.dim });
      drawText(ctx, what, px + pw - 8, y, { align: 'right', color });
      y += 10;
      y += 10 * drawParagraph(ctx, note, px + 12, y, pw - 20, { color: '#8a8fa8', lineH: 10 });
      y += 4;
    };
    slot('CO-PRO', 'Stingray', '#6ff3ff', 'Fathom Systems. More RAM; runs Overload.');
    slot('EXPANSION A', 'empty', UI.disabled, 'Waiting on a part.');
    slot('EXPANSION B', 'empty', UI.disabled, 'Waiting on a part.');
    y += 2;
    drawText(ctx, 'PROGRAMS', px + 8, y, { color: UI.cyan });
    y += 12;
    const hex = state.members.hex;
    for (const id of hex ? knownAbilities(hex, 'tech') : []) {
      const ab = ABILITIES[id];
      if (!ab) continue;
      const el = ab.element;
      if (el) drawText(ctx, ELEMENT_ICON[el], px + 10, y, { color: ELEMENT_COLOR[el] });
      drawText(ctx, ab.name, px + 10 + measure('') + 4, y);
      drawText(ctx, `${ab.cost ?? 0} RAM`, px + pw - 8, y, { align: 'right', color: UI.dim });
      y += 11;
    }
  }
}

/** The Stingray's fin logo at screen size (the boot screen's mark). */
function drawChipLogo(ctx: Ctx, x: number, y: number): void {
  ctx.fillStyle = '#6ff3ff';
  ctx.fillRect(x, y + 12, 16, 3);
  ctx.fillRect(x + 3, y + 9, 11, 3);
  ctx.fillRect(x + 6, y + 6, 7, 3);
  ctx.fillRect(x + 9, y + 3, 4, 3);
  ctx.fillRect(x + 11, y, 2, 3);
}
