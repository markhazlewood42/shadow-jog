/**
 * The Battle Stage Editor (dev only; page: `/stageedit.html`; Phaser spike `spike/phaser-stage`).
 *
 * This file wires the pieces together; each piece has its own file:
 *
 *   `session.ts`   the data being edited, selection, undo, "unsaved"   (no page, no Phaser)
 *   `model.ts`     what each edit does to a stage                      (pure functions)
 *   `StageScene`   the real battle stage in the centre                 (Phaser, `../stagescene.ts`)
 *   `overlay.ts`   the handles drawn over it                           (SVG)
 *   `interact.ts`  clicking and dragging                               (pointer events)
 *   `inspector.ts` the form on the right                               (DOM)
 *   `panels.ts`    the stage list, palette, JSON pane, status line
 *   `keys.ts`      the keyboard table
 *   `save.ts`      the checks and file format Save shares with the dev server
 *
 * The idea that keeps it honest (WYSIWYG): the editor never draws a copy of the stage. Every change goes into the
 * session's data; the page then hands the changed stage to the SAME `StageScene` a battle uses (`applyStage`), and
 * the scene repaints the floor, moves the fighters, re-sorts them and redraws the HUD. What you see is the scene.
 * The handles are an overlay on top, and the panels read the session.
 *
 * Saving: Save posts both data files to the dev server (`vite.config.ts` `stageEdit`), which checks them with the
 * module the game loads them with and writes them in a stable format; the page then reads the file back through
 * that same loader and compares, which is the spike's "load the saved stage back" check.
 */
import Phaser from 'phaser';
import { BG_IDS } from '../../art/battlebg';
import { ENEMIES } from '../../data/enemies';
import { formatJson } from '../../tools/jsonfmt';
import { bootStage } from '../boot';
import { type AxesFile, loadAxes, loadStages, type StageConfig, type StageFile } from '../config';
import { connectHook, emptyHook } from '../labhook';
import { STAGE_KNOWN } from '../known';
import type { Phase } from '../demo';
import type { Fighter } from '../stagescene';
import { BattleTest, type BattleTestOptions, stageForTest } from '../battletest';
import type { Key } from '../battleflow';
import { battleTestDialog } from './battledialog';
import { confirmBox, infoBox, promptBox } from './dialog';
import { byId, h, isTyping } from './dom';
import { Inspector, setLabel } from './inspector';
import { Interact } from './interact';
import { KEYS, matchKey, shown } from './keys';
import { deleteStage, duplicateStage, newStage, nudgeSlots, renameStage, setFloorBottom, setHorizon, setHudBox, setRowY, stepOrder } from './model';
import { type OverlayFigure, overlayMarkup } from './overlay';
import { JsonPane, Palette, setButtons, StageList, StatusBar } from './panels';
import { prepareSave } from './save';
import { type EditorData, type Item, Session } from './session';
import { ViewState } from './view';
import { HUD_PRESETS, HUD_REGION_NAMES, PRESET_IDS, type PresetId } from '../hudpresets';
import type { Layer } from './hit';

declare global {
  interface Window {
    /** The editor's own test hook: the session and view, and a way to flush a pending scene update. */
    __stageedit?: {
      session: Session;
      view: ViewState;
      flush: () => void;
      save: () => Promise<boolean>;
      interact: Interact;
      /** The running Battle Test, or null. */
      battle: () => BattleTest | null;
      /** Start a Battle Test with these options without the dialog (tests use it; the dialog's Start does the same). */
      startBattle: (opts: BattleTestOptions) => BattleTest;
      stopBattle: () => void;
    };
  }
}

const query = new URLSearchParams(location.search);
const scratch = query.get('scratch');
/** The save endpoint's address (`?scratch=<name>` makes it use a private copy, for tests). */
const ENDPOINT = `/__stage/stages${scratch ? `?scratch=${encodeURIComponent(scratch)}` : ''}`;
const FILE_NAME = scratch ? `scratch copy "${scratch}"` : 'src/data/stages.json';

const status = new (class {
  el = byId('st-msg');
})();
let say: (text: string, kind?: '' | 'bad' | 'good') => void = (t, k = '') => {
  status.el.textContent = t;
  status.el.className = `msg ${k}`;
};

/** Read both data files from the dev server and check them with the loaders the game uses. */
async function loadFiles(): Promise<EditorData> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, { cache: 'no-store' });
  } catch {
    throw new Error('Could not reach the dev server to read the stage files. Is npm run dev running?');
  }
  const body = (await res.json()) as { ok: boolean; problems: string[]; stages: string; axes: string };
  if (!res.ok || !body.ok) throw new Error(`The dev server could not read the stage files: ${body.problems.join('; ')}`);
  const stages = loadStages(JSON.parse(body.stages), BG_IDS, STAGE_KNOWN);
  const axes = loadAxes(JSON.parse(body.axes));
  return { stages, axes };
}

async function main(): Promise<void> {
  say('Loading the stage files…');
  const hook = emptyHook();
  window.__stagelab = hook;
  const fail = (m: string): void => {
    hook.error = m;
    say(m, 'bad');
    console.error(m);
  };

  const initial = await loadFiles();
  const wanted = query.get('stage');
  const session = new Session(initial, wanted ?? Object.keys(initial.stages)[0] ?? '', (s) => formatJson(s));
  const view = new ViewState();
  const setParam = query.get('set');
  session.setKey = setParam && setParam in session.stage.enemySets ? setParam : '3';
  if (query.get('phase') === 'choose' || query.get('phase') === 'target' || query.get('phase') === 'act') view.phase = query.get('phase') as Phase;
  if (query.get('json') === '1') view.jsonOpen = true;

  const booted = await bootStage({
    parent: 'stage',
    stageId: session.stageId,
    setKey: session.setKey,
    phase: view.phase,
    stages: initial.stages,
    axes: initial.axes,
    query,
    onError: fail,
  });
  const scene = booted.scene;
  const sceneNow = (): typeof scene => scene;

  connectHook(hook, booted, () => start());

  function start(): void {
    // ---------------------------------------------------------------- the pieces
    const centre = byId('centre');
    const svg = byId<SVGSVGElement>('ovsvg');
    const layer = byId('ovlayer');
    const canvas = booted.game.canvas;
    const bar = new StatusBar(session, byId('st-pos'), byId('st-sel'), byId('st-save'), byId('st-msg'));
    say = (t, k) => bar.say(t, k);

    /** The stage as the scene should show it: the saved-to-be data with the previewed enemies swapped in. */
    const previewed = (): StageConfig => {
      const copy = JSON.parse(JSON.stringify(session.stage)) as StageConfig;
      const roster = view.roster(session.stage, session.setKey);
      copy.demo.rosters[session.setKey] = roster;
      return copy;
    };

    /** The Battle Test in progress, if any. */
    let testing: BattleTest | null = null;
    let wantFloor: StageConfig | undefined;
    let scheduled = false;
    let lastAxes = JSON.stringify(initial.axes);
    /** Put the scene in step with the session. Batched to one per animation frame, so a fast drag costs one repaint a frame. */
    const syncScene = (floorFrom?: StageConfig): void => {
      wantFloor = floorFrom;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(flush);
    };
    function flush(): void {
      scheduled = false;
      // A Battle Test owns the scene until it ends; the editor catches up afterwards (`stopTest` syncs).
      if (testing) return;
      const stage = previewed();
      const axes = JSON.stringify(session.data.axes);
      try {
        if (axes !== lastAxes) {
          lastAxes = axes;
          scene.setAxes(session.data.axes);
        }
        scene.applyStage(stage, wantFloor);
        const roster = stage.demo.rosters[session.setKey] ?? [];
        if (scene.enemySet !== session.setKey || roster.join() !== scene.enemies.join()) scene.setEnemies(roster, session.setKey);
        if (scene.currentPhase !== view.phase) scene.setPhase(view.phase);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
      wantFloor = undefined;
      redraw();
    }

    // ---------------------------------------------------------------- the overlay
    const figures = (): OverlayFigure[] =>
      (['party', 'enemy'] as const).flatMap((side) =>
        scene.fighters
          .filter((f) => f.side === side)
          .map((f, index): OverlayFigure => {
            const b = scene.boxOf(f);
            const sh = session.data.axes[f.axisKey];
            return { side, index, x: f.x, y: f.y, left: b.left, right: b.right, top: b.top, order: f.slot.order ?? 0, shifted: !!sh && (sh.x !== 0 || sh.y !== 0) };
          }),
      );
    function redraw(): void {
      const r = canvas.getBoundingClientRect();
      const c = centre.getBoundingClientRect();
      const scale = r.width / 480;
      svg.style.left = `${r.left - c.left}px`;
      svg.style.top = `${r.top - c.top}px`;
      svg.style.width = `${r.width}px`;
      svg.style.height = `${r.height}px`;
      const handles = view.mode === 'edit' && !testing && r.width > 0;
      svg.style.display = handles ? 'block' : 'none';
      if (handles) svg.innerHTML = overlayMarkup({ stage: session.stage, figures: figures(), selection: session.selection, hover: interact.hover, show: view.show, phase: view.phase, locked: view.locked }, scale);
      refreshPanels();
    }

    // ---------------------------------------------------------------- panels
    const inspector = new Inspector(byId('inspector'), {
      session,
      view,
      scene: sceneNow,
      notify: (m, bad) => bar.say(m, bad ? 'bad' : ''),
      previewEnemy,
      resetPreview: () => {
        view.clearPreview(session.stageId, session.setKey);
        syncScene();
        bar.say('Back to the stage’s own demo enemies in this group.');
      },
    });
    const list = new StageList(
      session,
      byId('stages'),
      byId<HTMLInputElement>('find'),
      { onPick: (id) => session.showStage(id), onNew: () => void listNew(), onDuplicate: () => void listDuplicate(), onRename: () => void listRename(), onDelete: () => void listDelete() },
      { new: byId('s-new'), dup: byId('s-dup'), ren: byId('s-ren'), del: byId('s-del') },
    );
    const palette = new Palette(session, view, sceneNow, byId('heroes'), byId('enemies'), { select: (it) => session.select([it]), apply: (enemy) => applyPaletteEnemy(enemy) });
    const json = new JsonPane(session, view, byId('jsonpane'), byId('jsontext'), byId('jsontitle'), byId('jsonsub'));

    function describe(it: Item): string {
      switch (it.kind) {
        case 'fighter': {
          const f = fighterOf(it);
          return it.side === 'party' ? `${f?.name ?? 'Hero'} (Party ${it.index + 1})` : `${f?.name ?? 'Enemy'} (Enemy ${it.index + 1})`;
        }
        case 'anchor':
          return `Foot anchor of ${fighterOf(it)?.name ?? 'a figure'}`;
        case 'hud':
          return `HUD box: ${HUD_REGION_NAMES[it.region]}`;
        case 'horizon':
          return `Horizon ${session.stage.backdrop.horizonY}`;
        case 'floor':
          return `Floor bottom ${session.stage.floor.y1}`;
        case 'row':
          return `Row ${it.index + 1} (y ${session.stage.rows[it.index]?.y})`;
      }
    }
    function fighterOf(it: Extract<Item, { kind: 'fighter' | 'anchor' }>): Fighter | undefined {
      return scene.fighters.filter((f) => f.side === it.side)[it.index];
    }

    let pointer: { x: number; y: number } | null = null;
    const interact = new Interact({
      session,
      view,
      scene: sceneNow,
      canvas: () => canvas,
      layer,
      redraw,
      syncScene,
      onPointer: (p, hit) => {
        pointer = p;
        bar.pointer(p, hit ? describe(hit) : '');
      },
    });

    function refreshPanels(): void {
      bar.update(describe);
      byId('stagename').textContent = session.stage.name;
      byId<HTMLSelectElement>('s-preset').value = session.stage.hud.preset;
      byId('dirtydot').hidden = !session.dirty;
      document.title = `${session.dirty ? '• ' : ''}Battle Stage Editor`;
      byId<HTMLButtonElement>('b-save').disabled = !session.dirty;
      byId<HTMLButtonElement>('b-revert').disabled = !session.dirty;
      byId<HTMLButtonElement>('b-undo').disabled = !session.canUndo;
      byId<HTMLButtonElement>('b-redo').disabled = !session.canRedo;
      // toggles
      const on = (id: string, v: boolean): void => {
        byId(id).classList.toggle('on', v);
      };
      on('t-rows', view.snapRows);
      on('t-grid', view.snapGrid);
      on('t-hud', view.show.hud);
      on('t-guides', view.show.guides);
      on('t-safe', view.show.safe);
      on('t-cam', view.show.camera);
      on('t-anchors', view.show.anchors);
      on('t-fg', false);
      on('t-json', view.jsonOpen);
      for (const b of document.querySelectorAll<HTMLElement>('#seg-mode button')) b.classList.toggle('on', b.dataset.mode === view.mode);
      for (const b of document.querySelectorAll<HTMLElement>('#seg-phase button')) b.classList.toggle('on', b.dataset.phase === view.phase);
      for (const b of document.querySelectorAll<HTMLElement>('#seg-set button')) b.classList.toggle('on', b.dataset.set === session.setKey);
      const locks = byId('locks');
      locks.replaceChildren(...[...view.locked].map((l) => h('button', { type: 'button', class: 'lockchip', title: 'Click to unlock', onclick: () => toggleLock(l) }, `Locked: ${l}`)));
      list.render();
      inspector.refresh();
      palette.render();
      json.render();
    }

    // ---------------------------------------------------------------- toolbar
    setButtons(byId('seg-set'), (k) => session.showSet(k));
    byId('seg-mode').addEventListener('click', (e) => {
      const m = (e.target as HTMLElement).dataset.mode;
      if (m === 'edit' || m === 'play') setMode(m);
    });
    byId('seg-phase').addEventListener('click', (e) => {
      const p = (e.target as HTMLElement).dataset.phase;
      if (p === 'choose' || p === 'target' || p === 'act') {
        view.phase = p;
        view.remember();
        syncScene();
      }
    });
    const toggle = (id: string, fn: () => void): void =>
      byId(id).addEventListener('click', () => {
        fn();
        view.remember();
        redraw();
      });
    toggle('t-rows', () => {
      view.snapRows = !view.snapRows;
    });
    toggle('t-grid', () => {
      view.snapGrid = !view.snapGrid;
    });
    toggle('t-hud', () => {
      view.show.hud = !view.show.hud;
    });
    toggle('t-guides', () => {
      view.show.guides = !view.show.guides;
    });
    toggle('t-safe', () => {
      view.show.safe = !view.show.safe;
    });
    toggle('t-cam', () => {
      view.show.camera = !view.show.camera;
    });
    toggle('t-anchors', () => {
      view.show.anchors = !view.show.anchors;
    });
    toggle('t-json', () => {
      view.jsonOpen = !view.jsonOpen;
    });
    byId('t-fg').addEventListener('click', () => bar.say('This stage has no foreground layer to show; the street’s rails are part of its picture.'));
    const presetSel = byId<HTMLSelectElement>('s-preset');
    presetSel.replaceChildren(...PRESET_IDS.map((id) => h('option', { value: id, title: HUD_PRESETS[id].about }, HUD_PRESETS[id].name)));
    presetSel.addEventListener('change', () => {
      inspector.applyPresetNow(presetSel.value as PresetId, false);
      presetSel.blur();
    });
    byId('b-undo').addEventListener('click', () => doUndo());
    byId('b-redo').addEventListener('click', () => doRedo());
    byId('b-save').addEventListener('click', () => void save());
    byId('b-revert').addEventListener('click', () => void revert());
    byId('b-test').addEventListener('click', () => {
      if (testing) stopTest();
      else void battleTest();
    });
    byId('b-keys').addEventListener('click', () => void showKeys());
    byId('j-copy').addEventListener('click', () => void copyJson());

    function setMode(m: 'edit' | 'play'): void {
      view.mode = m;
      if (m === 'play') interact.cancel();
      scene.setEditMode(false);
      bar.say(m === 'play' ? 'Play: the handles are hidden. Press E to edit again.' : 'Edit: click or drag things on the stage.');
      redraw();
    }
    function toggleLock(l: Layer): void {
      if (view.locked.has(l)) view.locked.delete(l);
      else view.locked.add(l);
      bar.say(view.locked.has(l) ? `Locked ${l}: it can’t be picked until you unlock it (Ctrl+L, or click the red chip).` : `Unlocked ${l}.`);
      redraw();
    }

    // ---------------------------------------------------------------- actions
    const doUndo = (): void => {
      if (!session.undo()) bar.say('Nothing to undo.');
    };
    const doRedo = (): void => {
      if (!session.redo()) bar.say('Nothing to redo.');
    };

    /** Battle Test (Ctrl+Enter): ask who fights, then run a real fight on the stage as it is in this page, saved or not. */
    async function battleTest(): Promise<void> {
      if (testing) return;
      const stage = previewed();
      const opts = await battleTestDialog({ stage, setKey: session.setKey, roster: stage.demo.rosters[session.setKey] ?? [], unsaved: session.dirty });
      if (opts) startTest(opts);
    }

    function startTest(opts: BattleTestOptions): BattleTest {
      if (testing) stopTest();
      interact.cancel();
      scene.setEditMode(false);
      scene.applyStage(stageForTest(previewed(), opts));
      scene.setEnemies(opts.roster, opts.setKey);
      const bt = new BattleTest(scene, opts);
      testing = bt;
      layer.style.pointerEvents = 'none';
      byId('b-test').classList.add('on');
      byId('b-test').textContent = 'Testing…';
      redraw();
      testStatus('');
      return bt;
    }

    function stopTest(): void {
      if (!testing) return;
      testing.stop();
      testing = null;
      layer.style.pointerEvents = '';
      byId('b-test').classList.remove('on');
      byId('b-test').textContent = 'Battle Test';
      syncScene();
      bar.say('Back to editing. Selection, zoom and undo history are as you left them.');
    }

    /** The status line while a test runs: what is going on and which keys do what. */
    let lastTestLine = '';
    function testStatus(force: string): void {
      if (!testing) return;
      const s = testing.status();
      const prefix = session.dirty ? 'Testing unsaved changes' : 'Testing the saved stage';
      const who = s.mode === 'command' || s.mode === 'target' ? `${testing.flow.battle.unit(testing.flow.hero)?.name ?? 'Hero'}’s orders` : s.mode === 'playing' ? 'the round plays' : 'the fight is over';
      const over = s.outcome === 'win' ? 'Victory' : s.outcome === 'lose' ? 'Defeat' : 'The fight is over';
      const line = force || (s.mode === 'over' ? `${over}. Press Esc to go back to editing.` : `${prefix} · round ${s.round + (s.mode === 'playing' ? 0 : 1)} · ${who}${s.message ? ` · ${s.message}` : ''} · arrows choose, Enter confirms, Backspace steps back, A auto-play, Esc leaves`);
      if (line !== lastTestLine) {
        lastTestLine = line;
        bar.say(line, s.mode === 'over' ? (s.outcome === 'win' ? 'good' : 'bad') : '');
      }
      requestAnimationFrame(() => testStatus(''));
    }

    /** Keys while a test runs: they go to the fight, never to the editor. Returns true when it handled the key. */
    function testKey(e: KeyboardEvent): boolean {
      const bt = testing;
      if (!bt) return false;
      const map: Record<string, Key> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'ok', ' ': 'ok', z: 'ok', Z: 'ok', Backspace: 'back', x: 'back', X: 'back' };
      if (e.key === 'Escape') stopTest();
      else if (e.key === 'a' || e.key === 'A') bt.setAuto(!bt.flow.autoPlay);
      else if (map[e.key]) bt.press(map[e.key] as Key);
      else return false;
      e.preventDefault();
      return true;
    }

    async function copyJson(): Promise<void> {
      try {
        await navigator.clipboard.writeText(formatJson(session.stage));
        bar.say(`Copied "${session.stageId}" as JSON.`, 'good');
      } catch {
        bar.say('The browser would not let the page use the clipboard; select the text in the JSON pane and copy it.', 'bad');
      }
    }

    async function save(): Promise<boolean> {
      const data = { stages: session.data.stages, axes: session.data.axes };
      const made = prepareSave(data);
      if (!made.ok) {
        bar.say(`Not saved: ${made.problems[0]}${made.problems.length > 1 ? ` (and ${made.problems.length - 1} more)` : ''}`, 'bad');
        return false;
      }
      let res: Response;
      try {
        res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      } catch {
        bar.say('Not saved: could not reach the dev server. Is npm run dev running?', 'bad');
        return false;
      }
      const body = (await res.json().catch(() => null)) as { ok: boolean; problems: string[] } | null;
      if (!res.ok || !body?.ok) {
        bar.say(`Not saved: ${body?.problems?.[0] ?? `the dev server answered ${res.status}`}`, 'bad');
        return false;
      }
      // Load it back through the game's own loader: the file on disk must be what the editor holds.
      let back: EditorData;
      try {
        back = await loadFiles();
      } catch (e) {
        bar.say(`Saved, but reading it back failed: ${e instanceof Error ? e.message : String(e)}`, 'bad');
        return false;
      }
      const same = formatJson(back.stages) === formatJson(data.stages) && formatJson(back.axes) === formatJson(stripZero(data.axes));
      session.markSaved();
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      bar.say(same ? `Saved to ${FILE_NAME} at ${t}. Commit it to ship it.` : `Saved to ${FILE_NAME} at ${t}, but the file read back differently from what the editor holds.`, same ? 'good' : 'bad');
      refreshPanels();
      return true;
    }
    function stripZero(axes: AxesFile): AxesFile {
      return Object.fromEntries(Object.entries(axes).filter(([, v]) => v.x !== 0 || v.y !== 0));
    }

    async function revert(): Promise<void> {
      if (!session.dirty) return;
      const n = session.changeCount;
      const ok = await confirmBox('Revert', `Throw away ${n} change${n === 1 ? '' : 's'} to ${session.stageId}? The saved file is loaded again.`, 'Throw away');
      if (!ok) return;
      try {
        session.load(await loadFiles());
        syncScene();
        bar.say(`Reloaded ${FILE_NAME}; unsaved changes are gone.`);
      } catch (e) {
        bar.say(`Could not reload: ${e instanceof Error ? e.message : String(e)}`, 'bad');
      }
    }

    async function listNew(): Promise<void> {
      const name = await promptBox('New stage', 'Name (it starts as a copy of this stage)', 'New stage', 'Create');
      if (name === null) return;
      let id = '';
      let why = '';
      session.edit(`New stage "${name}"`, (d) => {
        const r = newStage(d.stages, session.stageId, name);
        if (r.ok) id = r.id;
        else why = r.reason;
      });
      if (id) session.showStage(id);
      if (why) bar.say(why, 'bad');
      else bar.say(`Made "${id}" from a copy of the stage before it. Save to keep it.`);
    }
    async function listDuplicate(): Promise<void> {
      let id = '';
      let why = '';
      session.edit(`Duplicate ${session.stageId}`, (d) => {
        const r = duplicateStage(d.stages, session.stageId);
        if (r.ok) id = r.id;
        else why = r.reason;
      });
      if (id) session.showStage(id);
      if (why) bar.say(why, 'bad');
    }
    async function listRename(): Promise<void> {
      const cur = session.stage;
      const name = await promptBox('Rename stage', 'Name', cur.name, 'Rename');
      if (name === null) return;
      const id = await promptBox('Rename stage', 'Id (lowercase words joined by dashes; renaming it updates every reference)', cur.id, 'Rename');
      if (id === null) return;
      let to = cur.id;
      let why = '';
      session.edit(`Rename ${cur.id}`, (d) => {
        const r = renameStage(d.stages, cur.id, name, id);
        if (r.ok) to = r.id;
        else why = r.reason;
      });
      if (why) bar.say(why, 'bad');
      else if (to !== cur.id || name !== cur.name) {
        session.stageId = to;
        session.showStage(to);
      }
    }
    async function listDelete(): Promise<void> {
      const id = session.stageId;
      if (Object.keys(session.data.stages).length <= 1) {
        bar.say('The last stage cannot be deleted.', 'bad');
        return;
      }
      if (!(await confirmBox('Delete stage', `Delete "${id}"? You can undo this until you leave the page.`, 'Delete'))) return;
      let next = '';
      let why = '';
      session.edit(`Delete ${id}`, (d) => {
        const r = deleteStage(d.stages, id);
        if (r.ok) next = r.id;
        else why = r.reason;
      });
      if (why) bar.say(why, 'bad');
      else if (next) session.showStage(next);
    }

    function previewEnemy(index: number, key: string): void {
      if (!(key in ENEMIES)) return;
      view.setPreview(session.stage, session.setKey, index, key);
      syncScene();
      bar.say(`${ENEMIES[key]?.name ?? key} now stands in E${index + 1} (a preview only; the stage stores places, not people).`);
    }
    function applyPaletteEnemy(enemy: string): void {
      const sel = session.selection.find((i) => i.kind === 'fighter' && i.side === 'enemy');
      previewEnemy(sel && sel.kind === 'fighter' ? sel.index : 0, enemy);
    }

    async function showKeys(): Promise<void> {
      const rows: Node[] = [];
      for (const group of ['File', 'Edit', 'Move', 'View', 'Test'] as const) {
        rows.push(h('tr', {}, h('th', { colspan: '2' }, group)));
        for (const k of KEYS.filter((x) => x.group === group)) rows.push(h('tr', {}, h('td', {}, ...k.combos.flatMap((c, i) => [i ? ' or ' : '', h('kbd', {}, shown(c))])), h('td', {}, k.label)));
      }
      await infoBox('Keys', h('table', { class: 'keys-table' }, ...rows));
    }

    // ---------------------------------------------------------------- the keyboard
    const nudge = (dx: number, dy: number): void => {
      const it = session.selection[0];
      if (!it) return;
      const id = session.stageId;
      if (it.kind === 'fighter') {
        const side = it.side;
        const idx = session.selectedFighters(side);
        // Up and down move whole rows (back is up); sideways moves pixels.
        session.edit(`Nudge ${idx.length > 1 ? `${idx.length} fighters` : describe(it)}`, (d) => nudgeSlots(d.stages[id] as StageConfig, side, session.setKey, idx, dx, Math.sign(dy)));
      } else if (it.kind === 'anchor') inspector.nudgeShift(dx, dy);
      else if (it.kind === 'horizon') session.edit('Move the horizon', (d) => void setHorizon(d.stages[id] as StageConfig, (d.stages[id] as StageConfig).backdrop.horizonY + dy));
      else if (it.kind === 'floor') session.edit('Move the floor bottom', (d) => void setFloorBottom(d.stages[id] as StageConfig, (d.stages[id] as StageConfig).floor.y1 + dy));
      else if (it.kind === 'row') session.edit(`Move row ${it.index + 1}`, (d) => void setRowY(d.stages[id] as StageConfig, it.index, ((d.stages[id] as StageConfig).rows[it.index]?.y ?? 0) + dy));
      else if (it.kind === 'hud') {
        const regions = session.selection.flatMap((s) => (s.kind === 'hud' ? [s.region] : []));
        session.edit(`Nudge ${regions.map((r) => HUD_REGION_NAMES[r]).join(', ')}`, (d) => {
          const st = d.stages[id] as StageConfig;
          for (const r of regions) setHudBox(st, r, { x: st.hud[r].x + dx, y: st.hud[r].y + dy });
        });
      }
    };
    const order = (by: 1 | -1): void => {
      const idx = session.selection.flatMap((s) => (s.kind === 'fighter' ? [s] : []));
      const first = idx[0];
      if (!first) {
        bar.say('Select a fighter first: Ctrl+] brings it forward, Ctrl+[ sends it back, within its row.');
        return;
      }
      let result: number = 0;
      session.edit(by > 0 ? 'Bring forward' : 'Send back', (d) => {
        for (const it of idx) result = stepOrder(d.stages[session.stageId] as StageConfig, it.side, session.setKey, it.index, by);
      });
      bar.say(result === 0 ? 'Draw order: automatic.' : result > 0 ? 'Brought forward: drawn over its neighbours on the same row.' : 'Sent back: drawn behind its neighbours on the same row.');
    };
    const goStage = (by: number): void => {
      const ids = Object.keys(session.data.stages);
      const at = ids.indexOf(session.stageId);
      const next = ids[(at + by + ids.length) % ids.length];
      if (next) session.showStage(next);
    };
    const run: Record<string, (e: KeyboardEvent) => void> = {
      save: () => void save(),
      undo: doUndo,
      redo: doRedo,
      duplicate: () => void listDuplicate(),
      find: () => byId<HTMLInputElement>('find').focus(),
      prev: () => goStage(-1),
      next: () => goStage(1),
      selectAll: () => {
        const first = session.selection[0];
        const side = first?.kind === 'fighter' ? first.side : 'party';
        const n = scene.fighters.filter((f) => f.side === side).length;
        session.select(Array.from({ length: n }, (_, index): Item => ({ kind: 'fighter', side, index })));
      },
      deselect: () => {
        if (interact.cancel()) bar.say('Drag cancelled.');
        else session.select([]);
      },
      copy: () => void copyJson(),
      left: () => nudge(-1, 0),
      right: () => nudge(1, 0),
      up: () => nudge(0, -1),
      down: () => nudge(0, 1),
      left8: () => nudge(-8, 0),
      right8: () => nudge(8, 0),
      up8: () => nudge(0, -8),
      down8: () => nudge(0, 8),
      forward: () => order(1),
      back: () => order(-1),
      grid: () => {
        view.snapGrid = !view.snapGrid;
        view.remember();
        bar.say(`Grid snap ${view.snapGrid ? 'on' : 'off'}.`);
        redraw();
      },
      lock: () => {
        const it = session.selection[0];
        if (!it) return bar.say('Select something first: Ctrl+L locks its layer so it can’t be picked by accident.');
        toggleLock(it.kind === 'fighter' || it.kind === 'anchor' ? 'fighters' : it.kind === 'hud' ? 'hud' : 'ground');
      },
      hud: () => {
        view.show.hud = !view.show.hud;
        view.remember();
        redraw();
      },
      mode: () => setMode(view.mode === 'edit' ? 'play' : 'edit'),
      test: () => void battleTest(),
    };
    document.addEventListener('keydown', (e) => {
      if (document.querySelector('.dlg-back')) return; // a dialog handles its own keys
      if (testing) {
        testKey(e);
        return; // while a fight runs the editor's keys stay out of the way
      }
      const def = matchKey(e);
      if (!def) return;
      if (isTyping(e.target) && !def.everywhere) return;
      const fn = run[def.id];
      if (!fn) return;
      e.preventDefault();
      fn(e);
    });

    // ---------------------------------------------------------------- dropping an enemy from the palette onto a slot
    layer.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('text/plain')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    layer.addEventListener('drop', (e) => {
      const key = e.dataTransfer?.getData('text/plain');
      if (!key || !(key in ENEMIES)) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const gx = ((e.clientX - r.left) / r.width) * 480;
      const gy = ((e.clientY - r.top) / r.height) * 270;
      const foes = scene.fighters.filter((f) => f.side === 'enemy');
      let best = -1;
      let bestD = 70;
      foes.forEach((f, i) => {
        const b = scene.boxOf(f);
        const inside = gx >= b.left && gx <= b.right && gy >= b.top && gy <= f.y + 4;
        const d = inside ? 0 : Math.hypot(gx - f.x, gy - f.y);
        if (d < bestD) {
          best = i;
          bestD = d;
        }
      });
      if (best >= 0) {
        session.select([{ kind: 'fighter', side: 'enemy', index: best }]);
        previewEnemy(best, key);
      } else bar.say('Drop an enemy on one of the enemy slots (E1, E2...).', 'bad');
    });

    // ---------------------------------------------------------------- reacting to the session
    session.on((e) => {
      switch (e.type) {
        case 'live':
          // The pointer code asked for its own scene sync (it may freeze the floor); just redraw the handles and panels.
          redraw();
          break;
        default:
          syncScene();
          break;
      }
    });
    // A leave-the-page warning while there are unsaved changes (`docs/TOOLING-UI.md` 2.5).
    window.addEventListener('beforeunload', (e) => {
      if (session.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    window.addEventListener('resize', redraw);
    booted.game.scale.on(Phaser.Scale.Events.RESIZE, redraw);
    new ResizeObserver(redraw).observe(centre);

    scene.setEditMode(false);
    window.__stageedit = { session, view, flush, save, interact, battle: () => testing, startBattle: startTest, stopBattle: stopTest };
    inspector.build();
    flush();
    bar.say(booted.standIns ? 'Mark’s Sprite Fusion sheets are not on this machine: the crew are stand-in blocks.' : 'Click a fighter, the horizon, a row or a HUD box. Drag to move it; Ctrl+S saves; the Keys button lists the shortcuts.');
    void pointer;
    void setLabel;
  }
}

main().catch((e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  say(m, 'bad');
  console.error(e);
  if (window.__stagelab) window.__stagelab.error = m;
});

export type { StageFile };
