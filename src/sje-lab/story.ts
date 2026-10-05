/**
 * The lab's STORY SCRIPT: a stand-in for a real story script that calls `s.hack(def)`
 * (docs/engine/frame-and-rendering.md 7.2, step B2 of the spike). It does what a story does:
 *
 *     say a line in 2D            ->  KIT: Jacking in.
 *     await hack(def)             ->  the 3D scene runs, then closes with a HackResult
 *     say a line in 2D again      ->  KIT: Hack ... (the story CONTINUED)
 *
 * The lab's `hack` is the real door (`src/hack3d/door.ts`): it probes WebGL2, loads the 3D chunk
 * with a dynamic import, runs the scene through `game.run`, and applies the author's policy.
 * `say` is a one-line dialog scene, so "a 2D line before and after" is a real scene on the stack.
 *
 * Every step is written into `log` with the game tick and the wall-clock time, so a test can check
 * ORDER (the line before came first, the line after came last) and TIMING (a context loss resolved
 * the hack within 2 seconds).
 */
import { drawText, measure } from '../engine/font';
import { surface } from '../engine/canvas';
import { type Game, Scene } from '../sje';
import type { Frame3DPreference } from '../sje/three';
import { type HackOutcome, hackDoor, hackWithPolicy } from '../hack3d/door';
import { describeResult, type HackDef, type HackResult } from '../hack3d/result';

/** Where the dialog box is on the 480x270 screen, so a test can look at the right pixels. */
export const STORY_BOX = { x: 20, y: 222, w: 440, h: 30 };

export interface StoryLogEntry {
  /** What happened: `say`, `hack-start`, `hack-result`, `outcome`... */
  what: string;
  /** The game tick when it happened. */
  tick: number;
  /** Milliseconds since the story started. */
  ms: number;
}

/** A one-line dialog over whatever is below it. It closes itself after `holdTicks` ticks. */
class LineScene extends Scene<void> {
  private left: number;
  /** The texture key of this line (the scene's own key makes it unique). */
  private textureKey = '';

  constructor(
    private readonly text: string,
    holdTicks: number,
  ) {
    super();
    this.left = holdTicks;
    this.opaque = false;
  }

  override create(): void {
    const w = Math.max(measure(this.text) + 2, 8);
    const s = surface(w, 11);
    drawText(s.ctx, this.text, 0, 0, { color: '#f4f1ff' });
    this.textureKey = `story-line-${this.key}`;
    this.textures.addCanvas(this.textureKey, s.canvas);
    const ui = this.add.layer({ ui: true });
    const g = this.add.graphics().setDepth(1);
    ui.add(g);
    const b = STORY_BOX;
    // An opaque box with a pink 1 px edge, so the line is easy to see over any picture.
    g.fillStyle(0xff4fb0).fillRect(b.x, b.y, b.w, b.h);
    g.fillStyle(0x0a0918).fillRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
    ui.add(this.add.image(b.x + 8, b.y + 10, this.textureKey).setOrigin(0, 0).setDepth(5));
    this.events.on('shutdown', () => this.textures.remove(this.textureKey));
  }

  fixedUpdate(): void {
    if (--this.left <= 0) this.close();
  }
}

export class LabStory {
  readonly log: StoryLogEntry[] = [];
  /** The last result of the raw `hack` door, and when (ms since the story started) it arrived. */
  lastResult: { result: HackResult; ms: number } | null = null;
  /** The finished outcome of `run`, once there is one. */
  outcome: HackOutcome | null = null;
  private t0 = performance.now();

  /** Extra options for every hack the lab starts (Part A turns the HUD off, for instance). */
  hackOptions: { hud?: boolean } = {};

  constructor(
    private readonly game: Game,
    private readonly frameMode: Frame3DPreference,
  ) {}

  /** Time zero is "now". Called when a story starts. */
  private restartClock(): void {
    this.t0 = performance.now();
  }

  private note(what: string): void {
    this.log.push({ what, tick: this.game.tick, ms: Math.round(performance.now() - this.t0) });
  }

  /** Show one 2D line for `ticks` ticks. Resolves when the line closes. */
  say(text: string, ticks = 30): Promise<void> {
    this.note(`say: ${text}`);
    return this.game.run(new LineScene(text, ticks));
  }

  /** The lab's `s.hack`: one try through the real door. Always resolves. */
  async hack(def: HackDef): Promise<HackResult> {
    this.note('hack-start');
    const result = await hackDoor(this.game, def, { frameMode: this.frameMode, ...this.hackOptions });
    this.lastResult = { result, ms: Math.round(performance.now() - this.t0) };
    this.note(`hack-result: ${describeResult(result)}`);
    return result;
  }

  /** The whole story: a line, the hack with the author's policy, a line. Resolves with the outcome. */
  async run(def: HackDef, holdTicks = 30): Promise<HackOutcome> {
    this.restartClock();
    this.log.length = 0;
    this.lastResult = null;
    this.outcome = null;
    await this.say('KIT: Jacking in. Watch the trace.', holdTicks);
    const outcome = await hackWithPolicy(
      def,
      (d) => this.hack(d),
      async () => {
        this.note('alternative-2d');
        await this.say('KIT: No 3D on this deck. Doing it the slow way.', holdTicks);
        return 'success';
      },
    );
    this.note(`outcome: ${outcome.outcome} via ${outcome.via}`);
    await this.say(`KIT: Hack ${outcome.outcome === 'success' ? 'done' : 'failed'}. Moving on.`, holdTicks);
    this.note('story-end');
    this.outcome = outcome;
    return outcome;
  }
}
