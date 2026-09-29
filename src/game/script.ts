/** Story scripting API. Scripts are async functions that `await` presentation steps. */
import type { Dir } from '../art/chars';
import type { MemberId } from './state';

export type Emote = '!' | '?' | '...' | '♥' | '!!' | 'zzz' | 'anger' | 'sweat';

export interface SayOpts {
  /** Portrait expression key (default 'neutral'). */
  face?: string;
  /** Position the box at the top of the screen. */
  top?: boolean;
  /** Auto-advance after N frames (cutscene narration). */
  auto?: number;
}

export type BattleResult = 'win' | 'lose' | 'run';

export interface ScriptApi {
  say(who: string | null, text: string, opts?: SayOpts): Promise<void>;
  /** Narration box without a speaker. */
  narrate(text: string, opts?: SayOpts): Promise<void>;
  ask(who: string | null, text: string, options: string[], opts?: SayOpts & { cancel?: number }): Promise<number>;
  wait(frames: number): Promise<void>;

  flag(name: string): boolean;
  get(name: string): number | boolean | string | undefined;
  set(name: string, v?: number | boolean | string): void;

  give(item: string, qty?: number, quiet?: boolean): Promise<void>;
  take(item: string, qty?: number): boolean;
  has(item: string, qty?: number): boolean;
  cred(delta: number, quiet?: boolean): Promise<void>;
  credits(): number;
  join(id: MemberId, quiet?: boolean): Promise<void>;
  leave(id: MemberId): void;
  inParty(id: MemberId): boolean;
  restoreParty(): void;
  /** TP and skill uses back for the standing crew (no healing). */
  refreshFocus(): void;
  /**
   * Set a story flag that unlocks abilities (CH1_STORY_FLAGS): newly usable skills get their
   * charges. Returns the names of what it unlocked, for the script to announce.
   */
  unlock(flag: string): string[];
  /** Hex's deck, close up: 'dead' (no coprocessor), 'seat' (the Stingray, hands-on), or 'view'. */
  deck(mode: 'dead' | 'seat' | 'view'): Promise<void>;

  battle(encounter: string, opts?: { canRun?: boolean; boss?: boolean; music?: string; bg?: string; loseOk?: boolean }): Promise<BattleResult>;
  warp(map: string, x: number, y: number, dir?: Dir, opts?: { fade?: boolean }): Promise<void>;

  /** Move an entity ('player' | npc id) along a path like "uuullr" or explicit dirs. */
  move(who: string, path: string, opts?: { speed?: number; wait?: boolean; face?: Dir }): Promise<void>;
  face(who: string, dir: Dir | 'player'): void;
  emote(who: string, e: Emote, frames?: number): Promise<void>;
  spawn(id: string, x: number, y: number, dir: Dir, look: string): void;
  despawn(id: string): void;
  /** Hide/show the follower train (for cutscenes where members stand separately). */
  followers(visible: boolean): void;
  /** Place a party member as a standalone actor (id = member id) at a tile. */
  actor(id: MemberId, x: number, y: number, dir: Dir): void;
  /** Merge standalone party actors back into the follower train. */
  regroup(): void;
  pan(x: number, y: number, frames?: number): Promise<void>;
  panBack(frames?: number): Promise<void>;

  fadeOut(frames?: number, color?: string): Promise<void>;
  fadeIn(frames?: number): Promise<void>;
  shake(frames?: number, mag?: number): void;
  flash(color?: string, frames?: number): void;
  sfx(name: string): void;
  music(name: string | null, fade?: number): void;

  shop(id: string): Promise<void>;
  inn(pricePerHead: number, name?: string): Promise<void>;
  clinic(): Promise<void>;
  banner(text: string, sub?: string): Promise<void>;
  panels(id: string): Promise<void>;
  /** Show "Chapter complete" end-of-demo flow. */
  endChapter(): Promise<void>;
  savePrompt(): Promise<void>;
  /** Show an item/tutorial hint card. */
  tutorial(title: string, body: string): Promise<void>;
  /** Rebuild the current map (after a flag changes its terrain). */
  refreshMap(): void;
  /** Mark an objective (shown in the menu). */
  objective(text: string): void;
}

export type ScriptFn = (s: ScriptApi) => Promise<void>;
