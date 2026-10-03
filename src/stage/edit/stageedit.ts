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
 *   `../rules.ts`  the design's rules, run live: broken ones become warnings (red outline, chip, status line)
 *
 * The idea that keeps it honest (WYSIWYG): the editor never draws a copy of the stage. Every change goes into the
 * session's data; the page then hands the changed stage to the SAME `StageScene` a battle uses (`applyStage`), and
 * the scene repaints the floor, moves the fighters, re-sorts them and redraws the HUD. What you see is the scene.
 * The handles are an overlay on top, and the panels read the session.
 *
 * Saving: Save posts the data files to the dev server (`vite.config.ts` `stageEdit`): the stages and the foot-anchor
 * corrections to one endpoint, the ONE global HUD layout to another. The server checks each with the module the game
 * loads it with and writes it in a stable format; the page then reads the files back through the same loaders and
 * compares, which is the spike's "load the saved stage back" check. Only the files that changed are written.
 */
import Phaser from 'phaser';
import { BG_IDS } from '../../art/battlebg';
import { ENEMIES } from '../../data/enemies';
import { formatJson } from '../../tools/jsonfmt';
import { bootStage } from '../boot';
import { type AxesFile, type FigureBox, loadAxes, loadEntries, loadHud, resolveStage, resolveStages, SCREEN_H, SCREEN_W, SET_KEYS, type StageConfig, type StageEntry, type StageFile } from '../config';
import { RULE_WHY, type StageWarning, stageWarnings } from '../rules';
import { connectHook, emptyHook } from '../labhook';
import { STAGE_KNOWN } from '../known';
import { devicePixelsPerGamePixel, zoomLine } from '../zoom';
import type { Phase } from '../demo';
import type { Fighter } from '../stagescene';
import { BattleTest, type BattleTestOptions, stageForTest } from '../battletest';
import type { Key } from '../battleflow';
import { battleTestDialog } from './battledialog';
import { confirmBox, infoBox, promptBox } from './dialog';
import { byId, h, hideTips, installTips, isTyping } from './dom';
import { type AlignHow, Inspector, setLabel } from './inspector';
import { Interact } from './interact';
import { KEYS, matchKey, MOUSE, shown } from './keys';
import { deleteStage, duplicateStage, hudNow, isOverridden, newStage, nudgeSlots, renameStage, setFloorBottom, setHorizon, setHudBox, setRowY, stepOrder } from './model';
import { type OverlayFigure, overlayMarkup } from './overlay';
import { JsonPane, Palette, setButtons, StageList, StatusBar } from './panels';
import { AXES_FILE, formatHud, HUD_FILE, prepareSave, STAGES_FILE } from './save';
import { type EditorData, type Item, type Part, sameItem, Session, toggleInSelection } from './session';
import { ViewState } from './view';
import { HUD_REGION_NAMES, HUD_REGIONS } from '../hudpresets';
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
      /** Line up the selection, as the Align bar does (tests use it). */
      align: (how: AlignHow) => boolean;
      /** Every design rule broken on every stage right now (what the Warnings chip lists; tests use it). */
      warnings: () => StageWarning[];
    };
  }
}

const query = new URLSearchParams(location.search);
const scratch = query.get('scratch');
/** The save endpoint's address (`?scratch=<name>` makes it use a private copy, for tests). */
const ENDPOINT = `/__stage/stages${scratch ? `?scratch=${encodeURIComponent(scratch)}` : ''}`;
/** The global HUD layout has its own file (`src/data/hud.json`) and its own endpoint to READ it. It is saved together with the stages, through ENDPOINT. */
const HUD_ENDPOINT = `/__stage/hud${scratch ? `?scratch=${encodeURIComponent(scratch)}` : ''}`;
/** The order files are named in: the same on the Save tooltip, in the messages and in the Revert confirm. */
const PART_ORDER: readonly Part[] = ['stages', 'hud', 'axes'];
const PART_FILE: Record<Part, string> = { stages: STAGES_FILE, hud: HUD_FILE, axes: AXES_FILE };
/** What messages call the files written: the real paths of the parts that changed, or the private scratch copy tests use. */
const fileNames = (parts: readonly Part[]): string => {
  if (scratch) return `scratch copy "${scratch}"`;
  const files = PART_ORDER.filter((p) => parts.includes(p)).map((p) => PART_FILE[p]);
  return files.length > 1 ? `${files.slice(0, -1).join(', ')} and ${files[files.length - 1]}` : (files[0] ?? '');
};
/** The short file names for a tooltip, only for the files that changed: "stages.json, axes.json". */
const shortNames = (parts: readonly Part[]): string => PART_ORDER.filter((p) => parts.includes(p)).map((p) => `${p}.json`).join(', ');

const status = new (class {
  el = byId('st-msg');
})();
let say: (text: string, kind?: '' | 'bad' | 'good') => void = (t, k = '') => {
  status.el.textContent = t;
  status.el.className = `msg ${k}`;
};

/** Read the data files from the dev server and check them with the loaders the game uses. */
async function loadFiles(): Promise<EditorData> {
  let res: Response;
  let hudRes: Response;
  try {
    [res, hudRes] = await Promise.all([fetch(ENDPOINT, { cache: 'no-store' }), fetch(HUD_ENDPOINT, { cache: 'no-store' })]);
  } catch {
    throw new Error('Could not reach the dev server to read the stage files. Is npm run dev running?');
  }
  const body = (await res.json()) as { ok: boolean; problems: string[]; stages: string; axes: string };
  if (!res.ok || !body.ok) throw new Error(`The dev server could not read the stage files: ${body.problems.join('; ')}`);
  const hudBody = (await hudRes.json()) as { ok: boolean; problems: string[]; hud: string };
  if (!hudRes.ok || !hudBody.ok) throw new Error(`The dev server could not read the HUD file: ${hudBody.problems.join('; ')}`);
  const hud = loadHud(JSON.parse(hudBody.hud));
  const stages = loadEntries(JSON.parse(body.stages), BG_IDS, STAGE_KNOWN);
  const axes = loadAxes(JSON.parse(body.axes));
  return { stages, axes, hud };
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
  // The left panel may be folded away (remembered per browser): do it before the stage boots so the stage measures its real room.
  document.body.classList.toggle('left-off', !view.leftOpen);
  const setParam = query.get('set');
  session.setKey = setParam && setParam in session.stage.enemySets ? setParam : '3';
  if (query.get('phase') === 'choose' || query.get('phase') === 'target' || query.get('phase') === 'act') view.phase = query.get('phase') as Phase;
  if (query.get('json') === '1') view.jsonOpen = true;

  const booted = await bootStage({
    parent: 'stage',
    stageId: session.stageId,
    setKey: session.setKey,
    phase: view.phase,
    stages: resolveStages(initial.stages, initial.hud),
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

    /** The stage as the scene should show it: the saved-to-be data with the global HUD filled in and the previewed enemies swapped in. */
    const previewed = (): StageConfig => {
      const copy = JSON.parse(JSON.stringify(session.resolved)) as StageConfig;
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
    /** The fighters that break a rule for the stage and enemy count on show: `side:index` (a red outline is drawn on each). */
    const brokenNow = (): Set<string> => new Set(warnings.filter((w) => w.stageId === session.stageId && w.setKey === session.setKey).flatMap((w) => w.culprits.map((c) => `${c.side}:${c.index}`)));
    const figures = (): OverlayFigure[] => {
      const broken = brokenNow();
      return (['party', 'enemy'] as const).flatMap((side) =>
        scene.fighters
          .filter((f) => f.side === side)
          .map((f, index): OverlayFigure => {
            const b = scene.boxOf(f);
            const sh = session.data.axes[f.axisKey];
            return { side, index, x: f.x, y: f.y, left: b.left, right: b.right, top: b.top, order: f.slot.order ?? 0, shifted: !!sh && (sh.x !== 0 || sh.y !== 0), broken: broken.has(`${side}:${index}`) };
          }),
      );
    };

    // ---------------------------------------------------------------- the design's rules, live (rules.ts)
    /** Every broken rule on every stage and enemy count, worked out again whenever the picture is drawn. */
    let warnings: StageWarning[] = [];
    /** The roster each enemy count shows: the previewed enemies if you swapped some in, else the stage's own. */
    const rosterOf = (cfg: StageConfig, key: string): string[] => view.roster(cfg, key);
    function computeWarnings(): StageWarning[] {
      const out: StageWarning[] = [];
      try {
        for (const entry of Object.values(session.data.stages)) {
          const cfg = resolveStage(entry, session.data.hud);
          const boxes: Record<string, FigureBox[]> = {};
          for (const key of SET_KEYS) if (cfg.enemySets[key]) boxes[key] = scene.figureBoxesFor(cfg, key, rosterOf(cfg, key));
          out.push(...stageWarnings(cfg, boxes));
        }
      } catch {
        // A half-edited stage (a row just removed...) can fail to measure for a moment; the save check says what is wrong with it.
        return [];
      }
      return out;
    }
    const warnChip = byId<HTMLButtonElement>('b-warn');
    const warnPop = byId('warnpop');
    /** Update the chip, the status-bar line and (if open) the list. */
    function showWarnings(): void {
      const n = warnings.length;
      warnChip.textContent = `Warnings (${n})`;
      warnChip.classList.toggle('has', n > 0);
      const here = warnings.filter((w) => w.stageId === session.stageId && (w.setKey === null || w.setKey === session.setKey));
      const line = byId('st-warn');
      line.hidden = here.length === 0;
      const first = here[0];
      line.textContent = first ? `Design rule: ${first.text}${here.length > 1 ? ` (+${here.length - 1} more)` : ''}` : '';
      line.title = here.map((w) => w.text).join('\n');
      if (!warnPop.hidden) renderWarnList();
    }
    function renderWarnList(): void {
      const byStage = new Map<string, StageWarning[]>();
      for (const w of warnings) byStage.set(w.stageId, [...(byStage.get(w.stageId) ?? []), w]);
      // The stage on show first.
      const order = [...byStage.keys()].sort((a, b) => Number(b === session.stageId) - Number(a === session.stageId));
      const kids: Node[] = [
        h('h2', {}, warnings.length ? `Warnings (${warnings.length})` : 'No warnings'),
        h('p', { class: 'wnote' }, warnings.length ? 'These places break the design’s rules. They never stop you from saving. Click one to go there.' : 'Every stage follows the design’s rules for every enemy count.'),
      ];
      for (const id of order) {
        const list = byStage.get(id) ?? [];
        kids.push(h('h3', {}, `${session.data.stages[id]?.name ?? id}${id === session.stageId ? ' (this stage)' : ''}`));
        for (const w of list)
          kids.push(
            h(
              'button',
              { type: 'button', class: 'wi', 'data-key': `${w.stageId}${w.setKey ? ` ${w.setKey}` : ''}: ${w.text}`, 'data-rule': w.rule, onclick: () => goToWarning(w) },
              h('b', {}, w.setKey ? setLabel(w.setKey) : 'Whole stage'),
              ` · ${w.text}`,
              h('small', {}, RULE_WHY[w.rule]),
            ),
          );
      }
      warnPop.replaceChildren(...kids);
    }
    function placeWarnPop(): void {
      const r = warnChip.getBoundingClientRect();
      warnPop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - warnPop.offsetWidth - 8))}px`;
      warnPop.style.top = `${r.bottom + 6}px`;
    }
    function toggleWarnPop(open: boolean): void {
      warnPop.hidden = !open;
      warnChip.classList.toggle('open', open);
      warnChip.setAttribute('aria-expanded', String(open));
      if (open) {
        hideTips();
        renderWarnList();
        placeWarnPop();
      }
    }
    /** Go to a warning: its stage, its enemy count, and the fighters to blame selected. */
    function goToWarning(w: StageWarning): void {
      toggleWarnPop(false);
      if (w.stageId !== session.stageId) session.showStage(w.stageId);
      if (w.setKey && w.setKey !== session.setKey) session.showSet(w.setKey);
      session.select(w.culprits.map((c): Item => ({ kind: 'fighter', side: c.side, index: c.index })));
      bar.say(`${w.setKey ? `${setLabel(w.setKey)}: ` : ''}${w.text}. ${RULE_WHY[w.rule]}`);
    }
    warnChip.addEventListener('click', () => toggleWarnPop(!!warnPop.hidden));
    document.addEventListener('pointerdown', (e) => {
      if (!warnPop.hidden && !warnPop.contains(e.target as Node) && e.target !== warnChip) toggleWarnPop(false);
    });
    /**
     * The zoom readout in the status line. The stage is always drawn at a whole number of screen pixels per game pixel
     * (`boot.ts`, `zoom.ts`). When it is only 1x because the panels take the room, and hiding the left panel would reach
     * a bigger whole zoom, the readout says so and names the key.
     */
    function showZoom(): void {
      const el = byId('st-zoom');
      const { width, height } = booted.game.scale.parentSize;
      const dpr = window.devicePixelRatio || 1;
      const k = devicePixelsPerGamePixel(width, height, SCREEN_W, SCREEN_H, dpr);
      const leftW = view.leftOpen ? byId('left').getBoundingClientRect().width : 0;
      const wider = devicePixelsPerGamePixel(width + leftW, height, SCREEN_W, SCREEN_H, dpr);
      const line = zoomLine(k, dpr, wider, view.leftOpen);
      el.title = line.title;
      el.replaceChildren(line.text, ...(line.hint ? [h('span', { class: 'hint' }, line.hint)] : []));
    }
    function redraw(): void {
      const r = canvas.getBoundingClientRect();
      const c = centre.getBoundingClientRect();
      const scale = r.width / 480;
      svg.style.left = `${r.left - c.left}px`;
      svg.style.top = `${r.top - c.top}px`;
      svg.style.width = `${r.width}px`;
      svg.style.height = `${r.height}px`;
      warnings = computeWarnings();
      const handles = view.mode === 'edit' && !testing && r.width > 0;
      svg.style.display = handles ? 'block' : 'none';
      if (handles) svg.innerHTML = overlayMarkup({ stage: session.resolved, figures: figures(), selection: session.selection, hover: interact.hover, hudOverridden: new Set(HUD_REGIONS.filter((r) => isOverridden(session.stage, r))), show: view.show, phase: view.phase, locked: view.locked }, scale);
      showWarnings();
      showZoom();
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
      warnings: () => warnings.filter((w) => w.stageId === session.stageId),
    });
    const list = new StageList(
      session,
      byId('stages'),
      byId<HTMLInputElement>('find'),
      { onPick: (id) => session.showStage(id), onNew: () => void listNew(), onDuplicate: () => void listDuplicate(), onChangeId: () => void listChangeId(), onDelete: () => void listDelete() },
      { new: byId('s-new'), dup: byId('s-dup'), ren: byId('s-ren'), del: byId('s-del') },
    );
    const palette = new Palette(session, sceneNow, byId('heroes'), byId('enemies'), {
      // Shift+click or Ctrl+click in the panel adds to the selection (or takes out what is already in it), like Figma's layers.
      select: (items, additive) => {
        if (!additive) return session.select(items);
        const allIn = items.every((it) => session.selection.some((c) => sameItem(c, it)));
        let next: Item[] = session.selection;
        for (const it of items) if (next.some((c) => sameItem(c, it)) === allIn) next = toggleInSelection(next, it);
        session.select(next);
      },
      apply: (enemy) => applyPaletteEnemy(enemy),
      say: (text) => bar.say(text),
    });
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
          return `HUD box: ${HUD_REGION_NAMES[it.region]} (${isOverridden(session.stage, it.region) ? 'this stage only' : 'all battles'})`;
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
      say: (m) => bar.say(m),
    });

    function refreshPanels(): void {
      bar.update(describe);
      byId('stagename').textContent = session.stage.name;
      byId('dirtydot').hidden = !session.dirty;
      document.title = `${session.dirty ? '• ' : ''}Battle Stage Editor`;
      const save = byId<HTMLButtonElement>('b-save');
      save.disabled = !session.dirty;
      // The tooltip names the files this Save would write: the ones that changed.
      save.title = session.dirty ? `Save ${shortNames(session.dirtyParts)} (Ctrl+S)` : 'Nothing to save yet. Save writes only the files you changed (Ctrl+S)';
      byId<HTMLButtonElement>('b-revert').disabled = !session.dirty;
      byId<HTMLButtonElement>('b-undo').disabled = !session.canUndo;
      byId<HTMLButtonElement>('b-redo').disabled = !session.canRedo;
      byId('b-undo').title = session.canUndo ? `Undo “${session.nextUndoLabel}” (Ctrl+Z)` : 'Nothing to undo (Ctrl+Z)';
      byId('b-redo').title = session.canRedo ? `Redo “${session.nextRedoLabel}” (Ctrl+Y)` : 'Nothing to redo (Ctrl+Y)';
      // toggles
      const on = (id: string, v: boolean): void => {
        byId(id).classList.toggle('on', v);
      };
      on('t-rows', view.snapRows);
      on('t-grid', view.snapGrid);
      on('t-hud', view.show.hud);
      on('t-guides', view.show.guides);
      on('t-safe', view.show.safe);
      on('t-anchors', view.show.anchors);
      on('t-left', view.leftOpen);
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
    toggle('t-anchors', () => {
      view.show.anchors = !view.show.anchors;
    });
    toggle('t-json', () => {
      view.jsonOpen = !view.jsonOpen;
    });
    byId('t-left').addEventListener('click', () => setLeftPanel(!view.leftOpen));
    byId('b-help').addEventListener('click', () => void showHelp());
    byId('stage-help').addEventListener('click', () => void showHelp());
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

    /** Show or hide the left panel (remembered per browser). The stage view gets the room back and the stage refits to a whole zoom. */
    function setLeftPanel(open: boolean): void {
      view.leftOpen = open;
      document.body.classList.toggle('left-off', !open);
      view.remember();
      // The stage's parent changed size: let the scale manager measure it again, then draw the handles over the new canvas.
      requestAnimationFrame(() => {
        booted.game.scale.refresh();
        redraw();
      });
      bar.say(open ? 'Left panel shown.' : 'Left panel hidden: the stage has more room. Press P or use “Left panel” to bring it back.');
    }
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
      bar.say(view.locked.has(l) ? `Locked ${l}: it can’t be picked until you unlock it (press L again, or click the red chip).` : `Unlocked ${l}.`);
      redraw();
    }

    // ---------------------------------------------------------------- actions
    const doUndo = (): void => {
      const label = session.nextUndoLabel;
      if (!session.undo()) bar.say('Nothing to undo.');
      else bar.say(label ? `Undid “${label}”.` : 'Undid the last change.');
    };
    const doRedo = (): void => {
      const label = session.nextRedoLabel;
      if (!session.redo()) bar.say('Nothing to redo.');
      else bar.say(label ? `Redid “${label}”.` : 'Redid the change.');
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

    /** POST one JSON body; returns the problems when the dev server refuses or cannot be reached, else null. */
    async function post(url: string, payload: unknown): Promise<string | null> {
      let res: Response;
      try {
        res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } catch {
        return 'could not reach the dev server. Is npm run dev running?';
      }
      const body = (await res.json().catch(() => null)) as { ok: boolean; problems: string[] } | null;
      if (!res.ok || !body?.ok) return body?.problems?.[0] ?? `the dev server answered ${res.status}`;
      return null;
    }

    /**
     * Save (Ctrl+S): ONE request writes the files that changed (`stages.json`, `hud.json`, `axes.json`) together.
     * Everything is checked first, all three together and as the game will see them (each stage's own HUD boxes against the
     * NEW global HUD), by the same code the dev server runs, so a bad file never leaves the page. If the server refuses
     * (or cannot be reached), no file was changed: it writes them as a set or not at all.
     */
    async function save(): Promise<boolean> {
      // Tidy first: a stage override keeps only what differs from the all-battles HUD (an empty "different on this stage" box is not saved).
      session.settle();
      const dirty = session.dirtyParts;
      const body = { stages: session.data.stages, axes: session.data.axes, hud: session.data.hud, write: dirty };
      // The stages are checked against the HUD that will be on disk afterwards: the new one if the HUD is saved now, else the saved one.
      const made = prepareSave(body, formatHud(session.saved.hud));
      if (!made.ok) {
        bar.say(`Not saved: ${made.problems[0]}${made.problems.length > 1 ? ` (and ${made.problems.length - 1} more)` : ''}. No file was changed.`, 'bad');
        return false;
      }
      if (!dirty.length) {
        bar.say('Nothing to save: no file changed. (A “Different on this stage” box with nothing different is not saved.)');
        refreshPanels();
        return true;
      }
      const why = await post(ENDPOINT, body);
      if (why) {
        bar.say(`Not saved: ${why}${why.endsWith('.') ? '' : '.'} No file was changed.`, 'bad');
        return false;
      }
      const written: Part[] = dirty;
      const data = body;
      const hud = session.data.hud;
      // Load it back through the game's own loaders: the files on disk must be what the editor holds.
      let back: EditorData;
      try {
        back = await loadFiles();
      } catch (e) {
        session.markSaved(written);
        bar.say(`Saved, but reading it back failed: ${e instanceof Error ? e.message : String(e)}`, 'bad');
        return false;
      }
      const same =
        (!written.includes('stages') || formatJson(back.stages) === formatJson(data.stages)) &&
        (!written.includes('axes') || formatJson(back.axes) === formatJson(stripZero(data.axes))) &&
        (!written.includes('hud') || formatHud(back.hud) === formatHud(hud));
      session.markSaved(written);
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const where = fileNames(written);
      const many = where.includes(' and ') || where.includes(', ');
      bar.say(same ? `Saved to ${where} at ${t}. Commit ${many ? 'them' : 'it'} to ship ${many ? 'them' : 'it'}.` : `Saved to ${where} at ${t}, but the file read back differently from what the editor holds.`, same ? 'good' : 'bad');
      refreshPanels();
      return true;
    }
    function stripZero(axes: AxesFile): AxesFile {
      return Object.fromEntries(Object.entries(axes).filter(([, v]) => v.x !== 0 || v.y !== 0));
    }

    async function revert(): Promise<void> {
      if (!session.dirty) return;
      const n = session.changeCount;
      // Say WHAT the changes are to: the stages that differ from the file, the foot anchors, and the global HUD (which every battle uses).
      const parts = session.dirtyParts;
      const ids = new Set([...Object.keys(session.data.stages), ...Object.keys(session.saved.stages)]);
      const changed = [...ids].filter((id) => JSON.stringify(session.data.stages[id]) !== JSON.stringify(session.saved.stages[id]));
      const what = [...(parts.includes('stages') ? [changed.length ? changed.join(' and ') : session.stageId] : []), ...(parts.includes('axes') ? ['the foot anchors'] : []), ...(parts.includes('hud') ? ['the global HUD (hud.json, used by every battle)'] : [])];
      const list = what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}` : (what[0] ?? session.stageId);
      const ok = await confirmBox('Revert', `Throw away ${n} change${n === 1 ? '' : 's'} to ${list}? The saved file${what.length > 1 ? 's are' : ' is'} loaded again.`, 'Throw away');
      if (!ok) return;
      try {
        session.load(await loadFiles());
        syncScene();
        bar.say(`Reloaded ${fileNames(['stages', 'hud'])}; unsaved changes are gone.`);
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
    /** The stage's NAME is edited in the inspector (the only place for it). This button changes the ID, the short name other files use. */
    async function listChangeId(): Promise<void> {
      const { id: oldId, name } = session.stage;
      const id = await promptBox('Change id', 'Id (lowercase words joined by dashes; every reference is updated)', oldId, 'Change id');
      if (id === null || id === oldId) return;
      let to = oldId;
      let why = '';
      session.edit(`Change the id of ${oldId}`, (d) => {
        const r = renameStage(d.stages, oldId, name, id);
        if (r.ok) to = r.id;
        else why = r.reason;
      });
      if (why) bar.say(why, 'bad');
      else if (to !== oldId) {
        session.showStage(to);
        bar.say(`The id is now “${to}”. Save to keep it.`);
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

    /** The help panel: what a stage is, and where each setting lives (Mark asked, 2026-10-03: "I need some help with core concepts and orientation"). */
    async function showHelp(): Promise<void> {
      const p = (...kids: Array<Node | string>): HTMLElement => h('p', {}, ...kids);
      const b = (t: string): HTMLElement => h('b', {}, t);
      await infoBox(
        'Help: what am I editing?',
        h(
          'div',
          { class: 'helpbody' },
          h('h3', {}, 'A stage is one battleground'),
          p('A stage is one place where fights happen, such as the street or the sewer. It holds:'),
          h(
            'ul',
            {},
            h('li', {}, 'the backdrop picture;'),
            h('li', {}, 'the horizon and the floor;'),
            h('li', {}, 'the depth rows, which are the rows people stand on;'),
            h('li', {}, 'where the heroes stand;'),
            h('li', {}, 'where the enemies stand, for each enemy count from 1 to 6 and for a boss.'),
          ),
          p('Every fight at that place uses the stage. A map says which stage each area uses with ', h('code', {}, 'bg'), '. The fights in the Sinkline use ', h('code', {}, 'sewer'), '.'),
          h('h3', {}, 'Who fights is not part of a stage'),
          p('Who fights is the encounter: the list of who you fight in one battle. RPG Maker calls it a troop. A troop editor will come later. The “Enemies” buttons in the top bar only choose which enemy count you look at. It is a preview.'),
          h('h3', {}, 'Haze, shadows and the floor belong to the stage'),
          p('The haze, the shadows and the look of the floor are settings of each stage. They are not global. Only the HUD is the same everywhere.'),
          h('h3', {}, 'The HUD is the same everywhere'),
          p(b('The HUD'), ' is the menu and the numbers drawn over a battle. There is ', b('one HUD layout for every battle'), '. Move a box and it moves on every stage. A stage can have its own copy of a single box when it needs one, for example when a big boss covers a box. Select the box and turn on “Different on this stage”.'),
          h('h3', {}, 'What is live today'),
          p('Only this editor, Battle Test and the stage lab read stages today. The shipped game will read them after a go-ahead.'),
          h('h3', {}, 'Mouse tricks'),
          h(
            'ul',
            {},
            h('li', {}, b('Shift+click '), 'adds a thing to the selection, or takes it out. Shift+click or Ctrl+click works in “Who’s standing here” too.'),
            h('li', {}, b('Shift+drag '), 'locks the move to sideways or up and down.'),
            h('li', {}, b('Ctrl+drag '), 'flips the grid snap for that one drag.'),
          ),
          h('h3', {}, 'Align with one key'),
          p('Select a fighter or a HUD box, then press one letter. ', b('A'), ' aligns left, ', b('C'), ' centre and ', b('D'), ' right. ', b('W'), ' goes to the back row (a HUD box: top), ', b('M'), ' to the middle and ', b('S'), ' to the front (a HUD box: bottom). With three or more selected, ', b('X'), ' spreads them evenly across and ', b('Y'), ' evenly over the rows. The letters do nothing while you type in a box. They are plain letters on purpose: a key that needs Ctrl+Alt is AltGr on many keyboards and types a character.'),
          h('h3', {}, 'Warnings'),
          p('The design has rules, such as “keep a clear gap between heroes and enemies”. A fighter that breaks one gets a red outline, and the “Warnings” button in the top bar lists every broken rule. A warning never stops you from saving.'),
          h('h3', {}, 'Where things live'),
          h(
            'ul',
            {},
            h('li', {}, b('Top bar: '), 'what you look at (enemy count, moment, overlays), Battle Test and Save.'),
            h('li', {}, b('Right panel: '), 'the settings of what you selected. Nothing selected: the settings of the stage and of the HUD.'),
            h('li', {}, b('Left panel: '), 'the stage list, and the people standing on the stage. The “Left panel” button in the top bar, or the ', b('P'), ' key, hides it. The stage then has more room, and on a small screen it can be drawn bigger.'),
            h('li', {}, b('The “?” marks: '), 'rest on one to read what a setting does and what you will see change.'),
          ),
        ),
      );
    }

    async function showKeys(): Promise<void> {
      // The mouse tricks come first: they are the ones nobody finds by accident.
      const rows: Node[] = [h('tr', {}, h('th', { colspan: '2' }, 'Mouse'))];
      for (const m of MOUSE) rows.push(h('tr', {}, h('td', {}, h('kbd', {}, m.gesture)), h('td', {}, m.label)));
      for (const group of ['File', 'Edit', 'Move', 'Align', 'View', 'Test'] as const) {
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
        session.edit(`Nudge ${idx.length > 1 ? `${idx.length} fighters` : describe(it)}`, (d) => nudgeSlots(d.stages[id] as StageEntry, side, session.setKey, idx, dx, Math.sign(dy)));
      } else if (it.kind === 'anchor') inspector.nudgeShift(dx, dy);
      else if (it.kind === 'horizon') session.edit('Move the horizon', (d) => void setHorizon(d.stages[id] as StageEntry, (d.stages[id] as StageEntry).backdrop.horizonY + dy));
      else if (it.kind === 'floor') session.edit('Move the floor bottom', (d) => void setFloorBottom(d.stages[id] as StageEntry, (d.stages[id] as StageEntry).floor.y1 + dy));
      else if (it.kind === 'row') session.edit(`Move row ${it.index + 1}`, (d) => void setRowY(d.stages[id] as StageEntry, it.index, ((d.stages[id] as StageEntry).rows[it.index]?.y ?? 0) + dy));
      else if (it.kind === 'hud') {
        const regions = session.selection.flatMap((s) => (s.kind === 'hud' ? [s.region] : []));
        session.edit(`Nudge ${regions.map((r) => HUD_REGION_NAMES[r]).join(', ')}`, (d) => {
          for (const r of regions) setHudBox(d, id, r, { x: Number(hudNow(d, id, r, 'x')) + dx, y: Number(hudNow(d, id, r, 'y')) + dy });
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
        for (const it of idx) result = stepOrder(d.stages[session.stageId] as StageEntry, it.side, session.setKey, it.index, by);
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
      alignLeft: () => void inspector.alignSelection('left'),
      alignCentre: () => void inspector.alignSelection('centre'),
      alignRight: () => void inspector.alignSelection('right'),
      alignBack: () => void inspector.alignSelection('back'),
      alignMiddle: () => void inspector.alignSelection('middle'),
      alignFront: () => void inspector.alignSelection('front'),
      spreadAcross: () => void inspector.alignSelection('spreadAcross'),
      spreadDepth: () => void inspector.alignSelection('spreadDepth'),
      help: () => void showHelp(),
      leftPanel: () => setLeftPanel(!view.leftOpen),
      grid: () => {
        view.snapGrid = !view.snapGrid;
        view.remember();
        bar.say(`Grid snap ${view.snapGrid ? 'on' : 'off'}.`);
        redraw();
      },
      lock: () => {
        const it = session.selection[0];
        if (!it) return bar.say('Select something first: L locks its layer so it can’t be picked by accident.');
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
      if (!warnPop.hidden && e.key === 'Escape') {
        toggleWarnPop(false);
        return;
      }
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
      // A held-down letter repeats; an Align key must be one undo step per press, not a flood of them.
      if (e.repeat && def.group === 'Align') return;
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
          // A drag on the stage asked for its own scene sync (it may freeze the floor), so only the handles and panels
          // are redrawn here. A slider has no sync of its own: it says `scene`, and the stage follows the slider live.
          if (e.scene) syncScene();
          redraw();
          break;
        default:
          // A message about the stage you just left does not belong under the next one.
          if (e.type === 'stage') bar.say('');
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
    installTips();
    window.__stageedit = { session, view, flush, save, interact, battle: () => testing, startBattle: startTest, stopBattle: stopTest, align: (how) => inspector.alignSelection(how), warnings: () => warnings };
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
