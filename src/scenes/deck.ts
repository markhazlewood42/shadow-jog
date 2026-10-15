/**
 * Hex's deck, close up. Three ways in:
 * - 'dead': when Hex first shows it off, coprocessor slot empty, screen crying. Look, then go.
 * - 'seat': bringing them the Stingray. Hands-on: line the chip's pins up with the socket (a press
 *   as they meet), snap the two retention clips, then watch it boot. The boot unlocks Overload
 *   (the script sets the flag after: `s.unlock('stingray_seated')`).
 * - 'view': from the menu once it's running: the deck, what's in each slot, and their programs.
 *   The empty expansion slots are where later chapters' parts go.
 *
 * Added after Mark's first playthrough (2026-09-29): "When Hex is talking about or using their
 * deck, I want to see it… Maybe a mini-interaction… to insert the component we retrieved that can
 * be built on later."
 *
 * Native sje scene (M8b phase 3). How it is built:
 *  - The deck, the chip, the LEDs and the sparks are ART. They are painted into one canvas picture (`art`) the size of the screen, which the scene
 *    clears and paints again every tick, because the chip, the LEDs and the sparks move.
 *  - Every word on screen is a kit `TextObject`; every window is a kit `NineSlice`. The prompt box and Hex's line box are built again only when
 *    their words change (`guide`, `lineBox`). The slots page of the menu view is built once.
 */
import { CHIP_H, CHIP_W, DECK, DECK_H, DECK_W, deckBody, drawAntennaTip, drawChip, drawLeds } from '../art/deck';
import { type Face, getPortrait } from '../art/portraits';
import { sfx } from '../audio/sfx';
import { ABILITIES } from '../data/abilities';
import { autoClose } from '../game/debug';
import { knownAbilities } from '../game/party';
import { state } from '../game/state';
import { CanvasImage, Container, type TextObject, UI } from '../sje';
import { H, W } from '../sje/core/size';
import { ELEMENT_COLOR, ELEMENT_ICON, markElements } from './battlekit/tables';
import { UiScene } from './uiscene';
import { ViewBuilder } from './uiview';

export type DeckMode = 'dead' | 'seat' | 'view';

type Phase = 'look' | 'align' | 'drop' | 'clips' | 'boot' | 'done';

/**
 * Where the deck sits on screen, as plain data (the editor rule: a position is a named value).
 * The deck art stays 1x. The group (the deck, a gap, and the side panel) is centered across the
 * screen, and sits in the middle of the room above Hex's line box, lifted a little so that the
 * gap under it is the larger one (WP5 of the 640x360 move: the deck used to hug the top, with a
 * hole above the line).
 */
const LINE_BOX_H = 54, LINE_BOX_GAP = 8;
/** The top of Hex's line box, at the foot of the screen. */
const LINE_Y = H - LINE_BOX_H - LINE_BOX_GAP;
const DECK_PANEL_GAP = 18, DECK_PANEL_W = 168, DECK_LIFT = 10;
const DX = Math.round((W - (DECK_W + DECK_PANEL_GAP + DECK_PANEL_W)) / 2);
const DY = Math.round((LINE_Y - DECK_H) / 2) - DECK_LIFT;
/** The side panel (prompts, and the slots view): its left edge and width. */
const PANEL_X = DX + DECK_W + DECK_PANEL_GAP;
/** The dark plate under the deck (14 px wider on each side, 12 px above): the art paints it, and the layout test reads it. */
export const DECK_PLATE = { x: DX - 14, y: DY - 12, w: DECK_W + 28, h: DECK_H + 20 };
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

/** How many boot lines the little screen shows at once. */
const BOOT_SHOWN = 4;

/** The color of a boot line (the new program in gold, the last line in cyan). */
function bootColor(line: string): string {
  return line.includes('NEW') ? '#ffe07a' : line.includes('ONLINE') ? '#6ff3ff' : '#6affc0';
}

export class DeckScene extends UiScene<void> {
  private phase: Phase;
  private phaseT = 0;
  /** Align: the chip swings side to side over the socket; misses slow it down. */
  private misses = 0;
  private chipX = SOCKET_X + 20;
  private chipY = HOVER_Y;
  private clips = 0;
  private bounce = 0;
  private line: { face: Face; text: string } = { face: 'neutral', text: '' };
  private sparks: { x: number; y: number; vx: number; vy: number; life: number }[] = [];

  // The display objects, made in `create` (a display object needs the running scene).
  private art!: CanvasImage;
  /** The words on the little screen: the blinking complaint, the running status and the typed boot log. */
  private complaint!: TextObject;
  private status: TextObject[] = [];
  private bootLines: TextObject[] = [];
  private guide!: Container;
  private guideKey = '';
  private lineBox!: Container;
  private lineKey = '';

  constructor(readonly mode: DeckMode) {
    super();
    this.opaque = false;
    this.curtain = true;
    this.phase = mode === 'seat' ? 'align' : 'look';
    if (mode === 'dead') this.line = { face: 'sad', text: 'No coprocessor, no deck. She’s just a very expensive paperweight.' };
    if (mode === 'seat') this.line = { face: 'surprised', text: 'Pins to pins. Gently. She bites.' };
  }

  override create(): void {
    sfx('confirm');
    const ui = this.sys.ui;
    this.dim();
    this.art = new CanvasImage(this, 0, 0, W, H);
    ui.add(this.art);
    // The screen's words sit just over the art. They are made once and shown or hidden by `refreshView`.
    const words = new Container(this, 0, 0, 'screen-words');
    ui.add(words);
    const b = new ViewBuilder(this, words);
    const s = DECK.screen, x = DX + s.x, y = DY + s.y;
    this.complaint = b.text(x + s.w / 2, y + 17, 'NO CO-PRO', { align: 'center', shadow: false });
    this.status = [
      b.text(x + 30, y + 8, 'STINGRAY', { color: '#6ff3ff', shadow: false }),
      b.text(x + 30, y + 18, 'ONLINE', { color: '#62e06a', shadow: false }),
      b.text(x + 8, y + 30, `RAM ${24} GiB`, { color: '#3fbf88', shadow: false }),
    ];
    for (let i = 0; i < BOOT_SHOWN; i++) this.bootLines.push(b.text(x + 3, y + 3 + i * 10, '', { shadow: false }));
    this.guide = new Container(this, 0, 0, 'guide');
    this.lineBox = new Container(this, 0, 0, 'line-box');
    ui.add([this.guide, this.lineBox]);
    if (this.mode === 'view') this.buildSlots();
    this.paint();
  }

  /** How far off true the chip may be and still seat: a little kinder with each miss. */
  private get tolerance(): number {
    return 4 + Math.min(4, this.misses * 2);
  }

  protected tick(): void {
    this.phaseT++;
    const keys = this.input.actions;
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
        if (keys.justPressed('confirm') || keys.justPressed('cancel')) {
          sfx('cancel');
          this.close();
        }
        break;
      case 'align': {
        // A slow swing that slows further after each miss.
        const speed = 0.035 / (1 + this.misses * 0.4);
        this.chipX = SOCKET_X + Math.sin(this.phaseT * speed + 1.2) * 22;
        this.chipY = HOVER_Y + (this.bounce > 0 ? -Math.sin((this.bounce / 12) * Math.PI) * 6 : 0);
        if (keys.justPressed('confirm')) {
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
        if (keys.justPressed('confirm') && this.phaseT > 8) {
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
        if (this.phaseT > 20 && (keys.justPressed('confirm') || keys.justPressed('cancel'))) {
          sfx('confirm');
          this.close();
        }
        break;
    }
    // A closed scene has had its objects destroyed.
    if (!this.closed) this.paint();
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

  // ---- the picture ------------------------------------------------------------------------------------------

  /** Paint the art again, then bring the words and boxes up to date. */
  private paint(): void {
    const ctx = this.art.ctx;
    ctx.clearRect(0, 0, W, H);
    // A dark bench to set it on, lit from the screen.
    ctx.fillStyle = '#0c0b14';
    ctx.fillRect(DECK_PLATE.x, DECK_PLATE.y, DECK_PLATE.w, DECK_PLATE.h);
    ctx.fillStyle = '#1a1826';
    ctx.fillRect(DX - 14, DY + DECK_H + 4, DECK_W + 28, 4);
    ctx.drawImage(deckBody(), DX, DY);
    this.paintScreen(ctx);
    const lit = this.mode === 'view' || this.phase === 'done' ? DECK.leds.n : this.phase === 'boot' ? Math.min(DECK.leds.n, Math.floor(this.phaseT / 18)) : 0;
    drawLeds(ctx, DX, DY, lit, this.mode === 'dead', this.t);
    drawAntennaTip(ctx, DX, DY, this.live, this.t);
    if (this.mode !== 'dead') this.paintChip(ctx);
    for (const p of this.sparks) {
      ctx.fillStyle = p.life > 8 ? '#fff0a0' : '#ffb04a';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    if (this.mode !== 'view') this.paintGuideTicks(ctx);
    this.art.refresh();
    this.refreshView();
  }

  /** The little screen: its pixels go into the art, its words are the text objects. */
  private paintScreen(ctx: CanvasRenderingContext2D): void {
    const s = DECK.screen, x = DX + s.x, y = DY + s.y;
    if (this.mode === 'dead') {
      // Dead: a crying face (the blinking complaint is a text).
      ctx.fillStyle = '#6a1a24';
      for (const [a, b] of [[40, 12], [60, 12]] as const) ctx.fillRect(x + a, y + b, 6, 2);
      ctx.fillRect(x + 42, y + 15, 2, 5);
      ctx.fillRect(x + 62, y + 15, 2, 5);
      ctx.fillRect(x + 44, y + 26, 18, 2);
      ctx.fillRect(x + 42, y + 28, 2, 2);
      ctx.fillRect(x + 62, y + 28, 2, 2);
      return;
    }
    if (!this.live && this.phase !== 'boot') return;
    ctx.fillStyle = '#06140f';
    ctx.fillRect(x, y, s.w, s.h);
    if (this.mode === 'view' || this.phase === 'done') {
      // Running: the fin logo of the Stingray's mark.
      const lx = x + 8, ly = y + 8;
      ctx.fillStyle = '#6ff3ff';
      ctx.fillRect(lx, ly + 12, 16, 3);
      ctx.fillRect(lx + 3, ly + 9, 11, 3);
      ctx.fillRect(lx + 6, ly + 6, 7, 3);
      ctx.fillRect(lx + 9, ly + 3, 4, 3);
      ctx.fillRect(lx + 11, ly, 2, 3);
    }
  }

  private paintChip(ctx: CanvasRenderingContext2D): void {
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

  /** In Align, the pin guide: ticks from the chip's first and last pins down to the socket's (gold meets gold). */
  private paintGuideTicks(ctx: CanvasRenderingContext2D): void {
    if (this.phase !== 'align') return;
    const off = Math.abs(this.chipX - SOCKET_X);
    const ok = off <= this.tolerance;
    ctx.fillStyle = ok ? '#62e06a' : '#8a6a26';
    for (const px of [4, CHIP_W - 6]) {
      ctx.fillRect(Math.round(this.chipX) + px, Math.round(this.chipY) + CHIP_H + 1, 2, SEAT_Y - Math.round(this.chipY) - 2);
    }
    ctx.fillStyle = ok ? '#62e06a' : '#e0b04a';
    ctx.fillRect(SOCKET_X + 4, SEAT_Y + CHIP_H - 1, 2, 2);
    ctx.fillRect(SOCKET_X + CHIP_W - 6, SEAT_Y + CHIP_H - 1, 2, 2);
  }

  /** Bring the screen's words, the prompt box and Hex's line box up to date with the state. */
  private refreshView(): void {
    const s = DECK.screen;
    const blink = Math.floor(this.t / 30) % 2;
    const dead = this.mode === 'dead';
    const waiting = !dead && !this.live && this.phase !== 'boot';
    this.complaint.setVisible(dead ? blink === 0 : waiting);
    if (dead) this.complaint.setPosition(DX + s.x + s.w / 2, DY + s.y + 33).setStyle({ color: '#ff4a4a' });
    else this.complaint.setPosition(DX + s.x + s.w / 2, DY + s.y + 17).setStyle({ color: blink ? '#ff4a4a' : '#6a1a24' });
    const running = !dead && (this.mode === 'view' || this.phase === 'done');
    for (const t of this.status) t.setVisible(running);
    // Booting: the log typed a character a frame; the lines scroll once they overflow.
    const booting = !dead && !running && this.phase === 'boot';
    let chars = Math.max(0, this.phaseT - 10);
    const lines: string[] = [];
    for (const l of BOOT) {
      if (chars <= 0) break;
      lines.push(l.slice(0, chars));
      chars -= l.length;
    }
    const shown = lines.slice(-BOOT_SHOWN);
    this.bootLines.forEach((t, i) => {
      const l = shown[i];
      t.setVisible(booting && l !== undefined);
      if (booting && l !== undefined) t.setText(l).setStyle({ color: bootColor(l) });
    });
    this.refreshGuide();
    this.refreshLine();
  }

  /** The prompt for the step in hand (the box beside the deck). */
  private promptText(): string {
    const key = this.input.actions.keyName('confirm');
    if (this.phase === 'align') return `Press {y}${key}{/} as the pins line up over the socket.`;
    if (this.phase === 'clips') return `Press {y}${key}{/} to snap the clips: ${this.clips}/2.`;
    if (this.phase === 'boot') return '{d}Booting…{/}';
    if (this.phase === 'done') return `{y}NEW PROGRAM{/}  ${this.overloadLine()}`;
    if (this.mode === 'dead') return '{d}Hex’s deck. The coprocessor slot is empty.{/}';
    return '';
  }

  private refreshGuide(): void {
    const prompt = this.mode === 'view' ? '' : this.promptText();
    const key = `${prompt}|${this.phase === 'done'}`;
    if (key === this.guideKey) return;
    this.guideKey = key;
    this.guide.removeAll(true);
    if (!prompt) return;
    const b = new ViewBuilder(this, this.guide);
    const px = PANEL_X, pw = DECK_PANEL_W;
    b.win(px, DY + 6, pw, 70, { plain: true, accent: UI.violet });
    b.para(prompt, px + 8, DY + 14, pw - 16, { lineH: 11 });
    if (this.phase === 'done') b.para(markElements(ABILITIES.overload?.desc ?? ''), px + 8, DY + 36, pw - 16, { color: UI.dim, lineH: 10 });
  }

  private overloadLine(): string {
    const ab = ABILITIES.overload;
    if (!ab) return '';
    const el = ab.element;
    return el ? `{#${ELEMENT_COLOR[el].slice(1)}}${ELEMENT_ICON[el]}{/} ${ab.name}` : ab.name;
  }

  /** Hex's line, at the foot of the screen with their face. */
  private refreshLine(): void {
    const show = !!this.line.text && this.mode !== 'view';
    const footer = this.phase === 'look' || this.phase === 'done';
    const key = show ? `${this.line.face}|${this.line.text}|${footer}` : '';
    if (key === this.lineKey) return;
    this.lineKey = key;
    this.lineBox.removeAll(true);
    if (!show) return;
    const b = new ViewBuilder(this, this.lineBox);
    const y = LINE_Y, x = 8, w = W - 16;
    b.win(x, y, w, LINE_BOX_H, footer ? { accent: '#c3a0ff', footer: this.legend('back') } : { accent: '#c3a0ff' });
    const port = getPortrait('hex', this.line.face);
    if (port) b.pic(x + 6, y + 5, 44, 44, (c) => c.drawImage(port, 0, 0, 44, 44));
    b.text(x + 58, y + 7, 'Hex', { color: '#c3a0ff' });
    b.para(this.line.text, x + 58, y + 20, w - 70, { lineH: 11 });
  }

  /** The menu view: what's in each slot, and the programs the deck runs. Built once. */
  private buildSlots(): void {
    const box = new Container(this, 0, 0, 'slots');
    this.sys.ui.add(box);
    const b = new ViewBuilder(this, box);
    const px = PANEL_X, pw = DECK_PANEL_W;
    b.win(px, 8, pw, H - 16, { title: 'HEX’S DECK', accent: UI.violet, footer: this.legend('back') });
    let y = 24;
    const slot = (name: string, what: string, color: string, note: string): void => {
      b.text(px + 8, y, name, { color: UI.dim });
      b.text(px + pw - 8, y, what, { align: 'right', color });
      y += 10;
      y += 10 * b.para(note, px + 12, y, pw - 20, { color: '#8a8fa8', lineH: 10 });
      y += 4;
    };
    slot('CO-PRO', 'Stingray', '#6ff3ff', 'Fathom Systems. More RAM; runs Overload.');
    slot('EXPANSION A', 'empty', UI.disabled, 'Waiting on a part.');
    slot('EXPANSION B', 'empty', UI.disabled, 'Waiting on a part.');
    y += 2;
    b.text(px + 8, y, 'PROGRAMS', { color: UI.cyan });
    y += 12;
    const hex = state.members.hex;
    for (const id of hex ? knownAbilities(hex, 'tech') : []) {
      const ab = ABILITIES[id];
      if (!ab) continue;
      const el = ab.element;
      if (el) b.text(px + 10, y, ELEMENT_ICON[el], { color: ELEMENT_COLOR[el] });
      // The name starts 14 px in: the icon's room (the old code added the width of an empty string, which is 0).
      b.text(px + 14, y, ab.name);
      b.text(px + pw - 8, y, `${ab.cost ?? 0} RAM`, { align: 'right', color: UI.dim });
      y += 11;
    }
  }
}
