/**
 * The script API a field offers its story scripts: dialogue, flags, items, party, movement,
 * camera and services. Built once per FieldScene; it reaches into the scene through the members
 * the scene leaves public for it.
 */
import type { Dir } from '../../art/chars';
import { sfx } from '../../audio/sfx';
import { music } from '../../audio/music';
import { Actor, dirTo } from '../../field/actor';
import { TS } from '../../field/tiles';
import type { NpcDef } from '../../field/types';
import type { Emote, ScriptApi } from '../../game/script';
import { flags, state } from '../../game/state';
import { LOOKS } from '../../data/looks';
import { fieldHooks } from '../../game/hooks';
import { DialogScene } from '../dialog';
import type { FieldScene } from '../field';
import { cameraOrigin } from './camera';
import { holdFor } from './popins';

export function scriptApi(f: FieldScene): ScriptApi {
  return {
    say: async (who, text, opts) => {
      await f.game.run(new DialogScene({ who, text, top: opts?.top, face: opts?.face, auto: opts?.auto }));
    },
    narrate: async (text, opts) => {
      await f.game.run(new DialogScene({ who: null, text, top: opts?.top, auto: opts?.auto }));
    },
    ask: async (who, text, options, opts) =>
      f.game.run(new DialogScene({ who, text, choices: options, cancel: opts?.cancel, top: opts?.top, face: opts?.face })),
    wait: (n) => f.game.wait(n),
    flag: (n) => flags.has(n),
    get: (n) => flags.get(n),
    set: (n, v) => flags.set(n, v),
    give: async (item, qty = 1, quiet) => {
      await fieldHooks.give?.(f, item, qty, !!quiet);
    },
    take: (item, qty = 1) => fieldHooks.take?.(item, qty) ?? false,
    has: (item, qty = 1) => (state.inventory[item] ?? 0) >= qty,
    cred: async (delta, quiet) => {
      state.cred = Math.max(0, state.cred + delta);
      if (!quiet && delta > 0) {
        sfx('cred');
        await f.api.narrate(`Got {y}${delta.toLocaleString('en-US')}¢{/}.`);
      }
    },
    credits: () => state.cred,
    join: async (id, quiet) => {
      await fieldHooks.join?.(f, id, !!quiet);
    },
    leave: (id) => {
      fieldHooks.leave?.(f, id);
    },
    inParty: (id) => state.party.includes(id),
    restoreParty: () => fieldHooks.restoreParty?.(),
    unlock: (flag) => fieldHooks.unlock?.(flag) ?? [],
    deck: async (mode) => {
      await fieldHooks.deck?.(f, mode);
    },
    refreshFocus: () => fieldHooks.refreshFocus?.(),
    battle: async (enc, opts) => (fieldHooks.battle ? fieldHooks.battle(f, enc, opts ?? {}) : 'win'),
    warp: async (mapId, x, y, dir, opts) => {
      await f.warp(mapId, x, y, dir ?? f.leader.dir, opts?.fade !== false);
    },
    move: (who, path, opts) =>
      new Promise<void>((res) => {
        const a = f.find(who);
        if (!a) return res();
        const map: Record<string, Dir> = { u: 'up', d: 'down', l: 'left', r: 'right' };
        const steps = path.split('').map((c) => map[c]).filter(Boolean) as Dir[];
        if (!steps.length) {
          if (opts?.face) a.dir = opts.face;
          return res();
        }
        a.path.push(...steps);
        a.pathSpeed = opts?.speed ?? 14;
        a.onPathDone = () => {
          if (opts?.face) a.dir = opts.face;
          if (a === f.leader) {
            state.x = a.x;
            state.y = a.y;
          }
          res();
        };
        if (!a.moving) f.advancePath(a);
        if (opts?.wait === false) res();
      }),
    face: (who, dir) => {
      const a = f.find(who);
      if (!a) return;
      a.dir = dir === 'player' ? dirTo(a.x, a.y, f.leader.x, f.leader.y) : dir;
    },
    emote: async (who, e: Emote, frames = 50) => {
      const a = f.find(who);
      if (!a) return;
      sfx(e === '!' || e === '!!' ? 'alert' : 'emote');
      a.emote = { kind: e, t: 0, dur: frames };
      await f.game.wait(frames);
    },
    spawn: (id, x, y, dir, look) => {
      f.npcs = f.npcs.filter((n) => n.id !== id);
      const lk = LOOKS[look as keyof typeof LOOKS];
      const a = new Actor(id, lk, x, y, dir);
      a.npc = { id, x, y, look: lk, move: 'static' } as NpcDef;
      f.npcs.push(a);
    },
    despawn: (id) => {
      f.npcs = f.npcs.filter((n) => n.id !== id);
    },
    followers: (v) => {
      f.followersVisible = v;
    },
    actor: (id, x, y, dir) => {
      const p = f.party.find((a) => a.id === id);
      if (!p) return;
      p.follower = false;
      p.place(x, y, dir);
    },
    regroup: () => {
      const l = f.leader;
      for (const p of f.party) {
        if (p === l) continue;
        p.follower = true;
        p.place(l.x, l.y, l.dir);
      }
      f.trail = f.party.map(() => [l.x, l.y] as [number, number]);
      f.followersVisible = true;
    },
    pan: (x, y, frames = 40) =>
      new Promise<void>((res) => {
        // The same camera rule as the scene's own camera (fieldkit/camera.ts), so the pan lands
        // exactly where the camera will rest afterwards, on a map of any size.
        const focus = { x: x * TS + 8, y: y * TS + 8 };
        const t = cameraOrigin(focus.x, focus.y, f.map.w * TS, f.map.h * TS, f.cameraBox);
        f.camOverride = focus;
        // A pan is the beat that reveals things: it lifts an event curtain (fieldkit/popins.ts, option b),
        // and the pop-in table may ask it to hold on its target before the script goes on.
        f.curtainEvent = null;
        const hold = holdFor(f.def.id, x, y);
        const done = hold > 0 ? () => void f.game.wait(hold).then(res) : res;
        f.panTarget = { x: t.x, y: t.y, frames, t: 0, sx: f.camX, sy: f.camY, res: done };
      }),
    panBack: (frames = 30) =>
      new Promise<void>((res) => {
        f.camOverride = null;
        const t = f.targetCam();
        f.panTarget = { x: t.x, y: t.y, frames, t: 0, sx: f.camX, sy: f.camY, res };
      }),
    fadeOut: (frames = 20, color) => f.game.fadeOut(frames, color),
    fadeIn: (frames = 20) => f.game.fadeIn(frames),
    shake: (frames, mag) => f.game.shake(frames, mag),
    flash: (color, frames) => f.game.flash(color, frames),
    sfx: (n) => sfx(n),
    music: (n, fade) => music(n, fade),
    shop: async (id) => { await fieldHooks.shop?.(f, id); },
    inn: async (price, name) => { await fieldHooks.inn?.(f, price, name); },
    clinic: async () => { await fieldHooks.clinic?.(f); },
    banner: async (text, sub) => {
      f.showBanner(text, sub ?? '');
      await f.game.wait(60);
    },
    panels: async (id) => { await fieldHooks.panels?.(f, id); },
    endChapter: async () => { await fieldHooks.endChapter?.(f); },
    savePrompt: async () => { await fieldHooks.savePrompt?.(f); },
    tutorial: async (title, body) => { await fieldHooks.tutorial?.(f, title, body); },
    refreshMap: () => {
      const l = f.leader;
      const followers = f.followersVisible;
      f.load(f.def.id, l.x, l.y, l.dir);
      f.followersVisible = followers;
    },
    objective: (text) => {
      f.objectiveText = text;
      flags.set('objective', text);
    },
  };
}
