/**
 * Battle Test (Phaser spike `spike/phaser-stage`): a REAL fight on the stage you are looking at, unsaved edits included.
 *
 * RPG Maker's "Battle Test" opens a dialog (who is in the party, their levels, which troop) and starts a fight. This is
 * the same idea. The page (`edit/battledialog.ts`) asks the questions; this file runs the answer:
 *
 *   BattleFlow   (battleflow.ts)  the game's own battle engine, plus the menus that give the heroes orders
 *   Performer    (perform.ts)     plays each action out on the stage with the moves in `moves.json`
 *   LiveFx       (livefx.ts)      the sparks, glow, numbers and shake
 *   StageScene   (stagescene.ts)  the stage, the fighters and the HUD, the SAME scene the editor uses
 *
 * `BattleTest` is the glue. Once per tick it asks "is the performer busy?"; if not, it asks the flow for the next
 * action of the round (or, between rounds, waits for orders) and hands it over. Keys come in through `press`.
 *
 * Everything is driven from `tick()`, so `scene.step(n)` plays n ticks of the fight without waiting: that is how the
 * end-to-end test runs a whole turn in a fraction of a second.
 */
import { BattleFlow, type BattleTestOptions, type Key, type Mode } from './battleflow';
import { LiveFx } from './livefx';
import { Performer } from './perform';
import type { LiveHook, StageScene } from './stagescene';

/** What a test or the status line can ask. */
export interface BattleStatus {
  mode: Mode;
  round: number;
  outcome: 'win' | 'lose' | 'fled' | null;
  /** What the player sees (the health bars). */
  party: Array<{ id: string; name: string; hp: number; maxHp: number; tp: number; down: boolean }>;
  foes: Array<{ id: string; name: string; hp: number; maxHp: number; down: boolean }>;
  /** True while an action or flinch is playing. */
  busy: boolean;
  /** Ticks of hitstop left. */
  pause: number;
  /** The last few things that happened, plainly. */
  log: string[];
  message: string;
}

export { type BattleTestOptions, stageForTest } from './battleflow';

export class BattleTest implements LiveHook {
  readonly flow: BattleFlow;
  readonly perf: Performer;
  private readonly fx: LiveFx;
  private idle = 0;
  private stopped = false;
  /** Called when the fight ends (win or lose), so a page can say so. */
  onOver: ((outcome: 'win' | 'lose' | 'fled') => void) | null = null;
  private overSaid = false;

  /**
   * The scene must already show the stage, party and enemies the options name (call `scene.applyStage(stageForTest(...))`
   * and `scene.setEnemies(...)` first; the page does).
   */
  constructor(
    private readonly scene: StageScene,
    readonly options: BattleTestOptions,
  ) {
    const partyFighters = scene.fighters.filter((f) => f.side === 'party');
    options.party.forEach((m, i) => {
      if (partyFighters[i]?.id !== m.id) throw new Error(`Party slot ${i + 1} should show ${m.id} but the stage shows ${partyFighters[i]?.id ?? 'nobody'}`);
    });
    const foes = scene.fighters.filter((f) => f.side === 'enemy');
    if (foes.length !== options.roster.length) throw new Error(`The stage shows ${foes.length} enemies but the test has ${options.roster.length}`);
    this.resetFighters();
    const { moves, stills } = scene.battleAssets();
    scene.prebake();
    this.flow = new BattleFlow({ demo: { ...scene.config.demo, party: options.party }, roster: options.roster, seed: options.seed, fullResources: options.fullResources, drill: options.drill ?? null });
    this.flow.autoPlay = options.auto || !!options.drill;
    this.fx = new LiveFx(scene);
    this.perf = new Performer(scene, this.flow, this.fx, moves, stills);
    scene.speed = options.speed;
    scene.setLive(this.flow.view(), this);
  }

  get frozen(): boolean {
    return this.perf.frozen;
  }

  /** Every fighter back to its idle state and home slot. */
  private resetFighters(): void {
    for (const f of this.scene.fighters) {
      f.still = null;
      f.offX = 0;
      f.offY = 0;
      f.alpha = 1;
      f.down = false;
      f.flash = false;
      f.flashAmt = 1;
      f.tintAmt = 0;
      f.bodyDx = 0;
      f.x = f.baseX;
      f.y = f.baseY;
      f.sortY = f.baseY;
      f.home.setVisible(false);
      this.scene.restyleFighter(f);
    }
  }

  private refresh(): void {
    this.scene.liveView = this.flow.view();
    this.scene.redrawLive();
  }

  // ---------------------------------------------------------------- the clock

  /** Called by the scene once per game tick. */
  tick(): void {
    if (this.stopped) return;
    this.perf.tick();
    if (this.perf.busy) return;
    const flow = this.flow;
    if (flow.mode === 'command' || flow.mode === 'target') {
      if (flow.autoPlay) {
        // A short beat so the menu is seen before the round starts.
        if (++this.idle >= 24) {
          this.idle = 0;
          this.begin();
        }
      }
      return;
    }
    if (flow.mode === 'playing') {
      const script = flow.nextScript();
      if (script) this.perf.start(script);
      else {
        flow.endRound();
        this.perf.resetRound();
        this.idle = 0;
        this.refresh();
      }
      return;
    }
    if (flow.mode === 'over' && !this.overSaid) {
      this.overSaid = true;
      const outcome = flow.outcome ?? (flow.party.every((c) => c.hp <= 0) ? 'lose' : 'win');
      flow.setPlaying({ actor: -1, targetFoe: null, banner: outcome === 'win' ? 'VICTORY' : outcome === 'lose' ? 'DEFEAT' : 'ESCAPED', act: null });
      this.refresh();
      this.onOver?.(outcome);
    }
  }

  // ---------------------------------------------------------------- orders

  /** Start the round with the orders chosen so far (anyone without one gets an auto order). */
  begin(): void {
    this.flow.beginRound();
    this.refresh();
  }

  /** A key in the orders menus. Ignored while a round plays. */
  press(k: Key): void {
    if (this.flow.mode !== 'command' && this.flow.mode !== 'target') return;
    const ready = this.flow.press(k);
    if (ready) this.begin();
    else this.refresh();
  }

  /** Turn auto-play on or off. */
  setAuto(on: boolean): void {
    this.flow.autoPlay = on;
    this.idle = 0;
  }

  /** True when `back` has something to step back from (so Esc can leave the test instead). */
  get canStepBack(): boolean {
    return this.flow.mode === 'target' || (this.flow.mode === 'command' && this.flow.hero > 0);
  }

  // ---------------------------------------------------------------- reading it

  status(): BattleStatus {
    const f = this.flow;
    const party = f.battle.party.map((c) => {
      const d = f.disp.get(c.uid);
      return { id: c.key, name: c.name, hp: d?.hp ?? c.hp, maxHp: c.base.maxHp, tp: d?.tp ?? c.tp, down: !!d?.down };
    });
    const foes = f.battle.enemies.map((c) => {
      const d = f.disp.get(c.uid);
      return { id: c.key, name: c.name, hp: d?.hp ?? c.hp, maxHp: c.base.maxHp, down: !!d?.down };
    });
    return { mode: f.mode, round: f.rounds, outcome: f.outcome, party, foes, busy: this.perf.busy, pause: this.perf.pause, log: this.perf.log.slice(-8), message: f.message };
  }

  // ---------------------------------------------------------------- leaving

  /** End the test: the stage goes back to its lab state. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.fx.destroy();
    this.scene.speed = 1;
    this.resetFighters();
    this.scene.endLive(this.options.roster, this.options.setKey);
  }
}
