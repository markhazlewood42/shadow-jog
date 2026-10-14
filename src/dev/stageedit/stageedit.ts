/**
 * The Battle Stage Editor (dev only; page: `/stageedit.html`; built in the Phaser spike `spike/phaser-stage`, on the Shadow Jog Engine since ET task 5).
 *
 * This file wires the pieces together; each piece has its own file:
 *
 *   `session.ts`   the data being edited, selection, undo, "unsaved"   (no page, no Phaser)
 *   `model.ts`     what each edit does to a stage                      (pure functions)
 *   `host.ts`      the real battle stage in the centre                 (the engine's `BattleStageScene` with the HUD on it)
 *   `overlay.ts`   the handles drawn over it                           (SVG)
 *   `interact.ts`  clicking and dragging                               (pointer events)
 *   `inspector.ts` the form on the right                               (DOM)
 *   `panels.ts`    the stage list, palette, JSON pane, status line
 *   `keys.ts`      the keyboard table
 *   `save.ts`      the checks and file format Save shares with the dev server
 *   `rules.ts`     (battlestage) the design's rules, run live: broken ones become warnings (red outline, chip, status line)
 *
 * The idea that keeps it honest (WYSIWYG): the editor never draws a copy of the stage. Every change goes into the
 * session's data; the page then hands the changed stage to the SAME `BattleStageScene` a battle uses (`loadStage`: hot reload,
 * checked first), and the scene repaints the floor, moves the fighters and re-sorts them, and the HUD is drawn again. What you see is the scene.
 * The handles are an overlay on top, and the panels read the session.
 *
 * Saving: Save posts the files that changed to ONE endpoint of the dev server (`serve.ts`, mounted by `vite.config.ts`): the
 * stages, the foot-anchor corrections, the ONE global HUD layout, the facing and the heroes of the 640x360 set. The server
 * checks them together with the modules the game loads them with and writes them all or none, in a stable format; the page then
 * reads the files back through the same loaders and compares, which is the spike's "load the saved stage back" check.
 *
 * Undo is the session's own snapshots (`session.ts`). The scene's `snapshot` and `restore` keep its frame and its figures' state when the
 * scene has to be made again (the axes, the facing or the heroes changed: `host.ts`).
 *
 * Battle Test (the button and Ctrl+Enter, ET task 6): the dialog (`battledialog.ts`) and the fight (`battletest.ts`), which runs the game's own battle over this page's unsaved stage. While a
 * test runs, `testing` is set: the editor's scene is stood aside, `flush` and `redraw` wait, and the page's keys go to the game (Esc comes back).
 */
import { BG_IDS } from '../../art/battlebg480';
import { ENEMIES } from '../../data/enemies';
import { type AxesFile, checkStageConfig, type FigureBox, loadAxes, loadEntries, loadHud, resolveStage, resolveStages, SET_KEYS, type StageConfig, type StageEntry, type StageFile } from '../../battlestage/config';
import { loadFacing } from '../../battlestage/facing';
import { loadHeroes } from '../../battlestage/proportions';
import { RULE_WHY, type StageWarning, stageWarnings } from '../../battlestage/rules';
import { STAGE_KNOWN } from '../../battlestage/known';
import { H, W } from '../../sje';
import type { Phase } from '../../battlestage/demo';
import type { Figure } from '../../battlestage/figure';
import { bootEditor } from './boot';
import { battleTestDialog } from './battledialog';
import { BattleTest, type BattleTestOptions, forwardKey } from './battletest';
import { formatJson } from './jsonfmt';
import { devicePixelsPerGamePixel, zoomLine } from './zoom';
import { confirmBox, infoBox, promptBox } from './dialog';
import { connectHook, emptyHook, pictureRect } from './hook';
import { byId, h, hideTips, installTips, isTyping } from './dom';
import { type AlignHow, Inspector, setLabel } from './inspector';
import { Interact } from './interact';
import { KEYS, matchKey, MOUSE, shown } from './keys';
import { deleteStage, duplicateStage, hudNow, isOverridden, newStage, nudgeSlots, renameStage, setFloorBottom, setHorizon, setHudBox, setRowY, stepOrder } from './model';
import { type OverlayFigure, overlayMarkup } from './overlay';
import { JsonPane, Palette, setButtons, StageList, StatusBar } from './panels';
import { AXES_FILE, FACING_FILE, formatFacing, formatHeroes, formatHud, HEROES_FILE, HUD_FILE, prepareSave, SET_SCREEN, STAGES_FILE } from './save';
import type { StageHost } from './host';
import { type EditorData, type Item, type Part, sameItem, Session, toggleInSelection } from './session';
import { ViewState } from './view';
import { HUD_REGION_NAMES, HUD_REGIONS } from '../../battlestage/hudpresets';
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
      /** The stage host (the scene that is running, `fighters`, `pick`...). */
      host: StageHost;
      /** Battle Test: the running test (its `status()`, `trace`, `options`), or null. */
      battle: () => BattleTest | null;
      /** Start a Battle Test with these options and no dialog (what the dialog's Start does). Resolves when the fight is on. */
      startBattle: (o: BattleTestOptions) => Promise<void>;
      /** End the running test and return to editing (what Esc does). */
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
const PART_ORDER: readonly Part[] = ['stages', 'hud', 'axes', 'facing', 'heroes'];
const PART_FILE: Record<Part, string> = { stages: STAGES_FILE, hud: HUD_FILE, axes: AXES_FILE, facing: FACING_FILE, heroes: HEROES_FILE };
/** What messages call the files written: the real paths of the parts that changed, or the private scratch copy tests use. */
const fileNames = (parts: readonly Part[]): string => {
  if (scratch) return `scratch copy "${scratch}"`;
  const files = PART_ORDER.filter((p) => parts.includes(p)).map((p) => PART_FILE[p]);
  return files.length > 1 ? `${files.slice(0, -1).join(', ')} and ${files[files.length - 1]}` : (files[0] ?? '');
};
/** The short file names for a tooltip, only for the files that changed: "stages.json, axes.json". */
const shortNames = (parts: readonly Part[]): string => PART_ORDER.filter((p) => parts.includes(p)).map((p) => (PART_FILE[p].split('/').pop() ?? '')).join(', ');

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
  const body = (await res.json()) as { ok: boolean; problems: string[]; stages: string; axes: string; facing: string; heroes: string };
  if (!res.ok || !body.ok) throw new Error(`The dev server could not read the stage files: ${body.problems.join('; ')}`);
  const hudBody = (await hudRes.json()) as { ok: boolean; problems: string[]; hud: string };
  if (!hudRes.ok || !hudBody.ok) throw new Error(`The dev server could not read the HUD file: ${hudBody.problems.join('; ')}`);
  const hud = loadHud(JSON.parse(hudBody.hud), SET_SCREEN);
  const stages = loadEntries(JSON.parse(body.stages), BG_IDS, STAGE_KNOWN);
  const axes = loadAxes(JSON.parse(body.axes));
  const facing = loadFacing(JSON.parse(body.facing));
  const heroes = loadHeroes(JSON.parse(body.heroes));
  return { stages, axes, hud, facing, heroes };
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

  const first = resolveStages(initial.stages, initial.hud)[session.stageId];
  if (!first) throw new Error(`No stage "${session.stageId}" in the stage file`);
  const booted = await bootEditor({
    parent: byId('stage'),
    forceStandIns: query.has('standins'),
    data: { axes: initial.axes, facing: initial.facing, heroes: initial.heroes },
    stage: first,
    // The stage's own enemies for the group on show (the previewed ones are swapped in later).
    enemies: first.demo.rosters[session.setKey] ?? [],
    phase: view.phase,
  });
  const scene = booted.host;
  const sceneNow = (): StageHost => scene;

  connectHook(hook, booted.game, booted.host, booted.standIns, () => start());

  function start(): void {
    // ---------------------------------------------------------------- the pieces
    const centre = byId('centre');
    const svg = byId<SVGSVGElement>('ovsvg');
    const layer = byId('ovlayer');
    const game = booted.game;
    const bar = new StatusBar(session, byId('st-pos'), byId('st-sel'), byId('st-save'), byId('st-msg'));
    say = (t, k) => bar.say(t, k);

    /** The stage as the scene should show it: the saved-to-be data with the global HUD filled in and the previewed enemies swapped in. */
    const previewed = (): StageConfig => {
      const copy = JSON.parse(JSON.stringify(session.resolved)) as StageConfig;
      const roster = view.roster(session.stage, session.setKey);
      copy.demo.rosters[session.setKey] = roster;
      return copy;
    };

    // BATTLE TEST (ET task 6): the fight takes the scene over while it runs; `flush` and `redraw` below wait for it.
    let testing: BattleTest | null = null;
    /** True from the Start click until the fight is on (a second Start in between does nothing). */
    let starting = false;
    let scheduled = false;
    /** The stage whose slots the floor is painted for until the next sync without one: during a fighter drag, the stage as the drag began, so the puddles hold still. */
    let wantFloor: StageConfig | undefined;
    /**
     * Put the scene in step with the session. Batched to one per animation frame, so a fast drag costs one repaint a frame. `floorFrom` freezes the floor's puddles while a
     * fighter is dragged (the spike's behavior); a sync without it, as on drop, lets them settle around where everyone ended up.
     */
    const syncScene = (floorFrom?: StageConfig): void => {
      wantFloor = floorFrom;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(flush);
    };
    function flush(): void {
      scheduled = false;
      // A test owns the scene: the session may change meanwhile (the panels stay live), and `endTest` flushes once the editor's scene is back.
      if (testing || starting) return;
      const stage = previewed();
      try {
        // The axes (the foot anchors), which enemies are mirrored (the Mirror switch) and how tall and broad each hero stands (the Height and Build sliders) are fields of the scene's
        // `BattleStageInit`: when one changed the host makes a new scene on the same stage (`StageHost.setData`), which keeps the frame and the figures' state.
        scene.setData({ axes: session.data.axes, facing: session.data.facing, heroes: session.data.heroes });
        // Hot reload: the changed stage goes into the running scene. `loadStage` checks it first and throws for a stage the file would refuse, so the editor asks the same check
        // beforehand: a stage that is not valid (half edited) leaves the scene on its last good picture, the inspector's checks list what is wrong, and Save refuses it with the words
        // of `prepareSave`. Nothing is shown as an error here: it is the normal state in the middle of an edit.
        if (checkStageConfig(stage, BG_IDS, STAGE_KNOWN).length === 0) scene.setStage(stage, wantFloor);
        scene.setEnemies(stage.demo.rosters[session.setKey] ?? []);
        scene.setPhase(view.phase);
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
      const parent = byId('stage');
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      const k = devicePixelsPerGamePixel(width, height, W, H, dpr);
      const leftW = view.leftOpen ? byId('left').getBoundingClientRect().width : 0;
      const wider = devicePixelsPerGamePixel(width + leftW, height, W, H, dpr);
      const line = zoomLine(k, dpr, wider, view.leftOpen);
      el.title = line.title;
      el.replaceChildren(line.text, ...(line.hint ? [h('span', { class: 'hint' }, line.hint)] : []));
    }
    function redraw(): void {
      // The engine's canvas fills the whole centre and draws the picture at a whole zoom in the middle of it, so the handles sit over the PICTURE, not over the canvas.
      const r = pictureRect(game);
      const c = centre.getBoundingClientRect();
      const scale = r.scale;
      svg.style.left = `${r.x - c.left}px`;
      svg.style.top = `${r.y - c.top}px`;
      svg.style.width = `${r.w}px`;
      svg.style.height = `${r.h}px`;
      if (testing || starting) {
        svg.style.display = 'none';
        return;
      }
      warnings = computeWarnings();
      const handles = view.mode === 'edit' && r.w > 0;
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
    function fighterOf(it: Extract<Item, { kind: 'fighter' | 'anchor' }>): Figure | undefined {
      return scene.fighters.filter((f) => f.side === it.side)[it.index];
    }

    let pointer: { x: number; y: number } | null = null;
    const interact = new Interact({
      session,
      view,
      scene: sceneNow,
      toGame: (x, y) => game.scale.toGame(x, y),
      scale: () => pictureRect(game).scale,
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
    byId('b-test').addEventListener('click', () => void battleTest());
    byId('b-keys').addEventListener('click', () => void showKeys());
    byId('j-copy').addEventListener('click', () => void copyJson());

    /** Show or hide the left panel (remembered per browser). The stage view gets the room back and the stage refits to a whole zoom. */
    function setLeftPanel(open: boolean): void {
      view.leftOpen = open;
      document.body.classList.toggle('left-off', !open);
      view.remember();
      // The stage's parent changed size: let the scale manager measure it again, then draw the handles over the new canvas.
      requestAnimationFrame(() => {
        game.scale.refit();
        redraw();
      });
      bar.say(open ? 'Left panel shown.' : 'Left panel hidden: the stage has more room. Press P or use “Left panel” to bring it back.');
    }
    function setMode(m: 'edit' | 'play'): void {
      view.mode = m;
      if (m === 'play') interact.cancel();
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

    // ---------------------------------------------------------------- Battle Test
    /** The dialog, then the fight (Ctrl+Enter and the Battle Test button). */
    async function battleTest(): Promise<void> {
      if (testing || starting) return;
      const stage = previewed();
      const roster = stage.demo.rosters[session.setKey] ?? [];
      const o = await battleTestDialog({ stage, setKey: session.setKey, roster, unsaved: session.dirty });
      if (o) await startBattle(o);
    }

    /** Stand the editor's scene aside and run the fight on the stage as it is on screen. */
    async function startBattle(o: BattleTestOptions): Promise<void> {
      if (testing || starting) return;
      starting = true;
      interact.cancel();
      const unsaved = session.dirty;
      try {
        testing = await BattleTest.start(game, scene, previewed(), o, unsaved);
      } catch (e) {
        starting = false;
        flush();
        bar.say(`Battle Test could not start: ${e instanceof Error ? e.message : String(e)}`, 'bad');
        return;
      }
      starting = false;
      const running = testing;
      document.body.classList.add('testing');
      redraw();
      bar.say(unsaved ? 'Testing unsaved changes. Esc returns to the editor.' : 'Testing the saved stage. Esc returns to the editor.');
      // The fight ends by itself (a win, a defeat, a flight): the editor comes back and says how it went.
      void running.finished.then((out) => {
        if (testing === running) endTest(out === 'win' ? 'Victory' : out === 'lose' ? 'Defeat' : 'Escaped');
      });
    }

    /** End the test (Esc, or the fight is over): the editor's scene comes back on the session as it is now. The selection and the undo history were never touched. */
    function endTest(how?: string): void {
      const t = testing;
      if (!t) return;
      testing = null;
      t.stop();
      scene.resume();
      document.body.classList.remove('testing');
      game.scale.refit();
      flush();
      bar.say(how ? `Back to editing. The fight ended: ${how}.` : 'Back to editing.');
    }

    // While a test runs the page's keys go to the game's input (Esc is the editor's: it ends the test). A capturing listener, so no editor key sees them.
    for (const type of ['keydown', 'keyup'] as const) {
      document.addEventListener(
        type,
        (e) => {
          if (!testing) return;
          if (e.key === 'Escape') {
            if (type === 'keydown') {
              e.preventDefault();
              e.stopPropagation();
              endTest();
            }
            return;
          }
          if (forwardKey(booted.keys, e)) {
            e.preventDefault();
            e.stopPropagation();
          }
        },
        true,
      );
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
      const body = { stages: session.data.stages, axes: session.data.axes, hud: session.data.hud, facing: session.data.facing, heroes: session.data.heroes, write: dirty };
      // The stages are checked against the HUD that will be on disk afterwards: the new one if the HUD is saved now, else the saved one.
      const made = prepareSave(body, formatHud(session.saved.hud), { screen: SET_SCREEN });
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
        (!written.includes('hud') || formatHud(back.hud) === formatHud(hud)) &&
        (!written.includes('facing') || formatFacing(back.facing) === formatFacing(data.facing)) &&
        (!written.includes('heroes') || formatHeroes(back.heroes) === formatHeroes(data.heroes));
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
      const what = [...(parts.includes('stages') ? [changed.length ? changed.join(' and ') : session.stageId] : []), ...(parts.includes('axes') ? ['the foot anchors'] : []), ...(parts.includes('hud') ? ['the global HUD (hud-640.json, used by every battle)'] : []), ...(parts.includes('facing') ? ['which enemies are mirrored (enemyfacing.json, used by every battle)'] : []), ...(parts.includes('heroes') ? ['the heroes’ proportions (heroes.json, used by every battle)'] : [])];
      const list = what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}` : (what[0] ?? session.stageId);
      const ok = await confirmBox('Revert', `Throw away ${n} change${n === 1 ? '' : 's'} to ${list}? The saved file${what.length > 1 ? 's are' : ' is'} loaded again.`, 'Throw away');
      if (!ok) return;
      try {
        session.load(await loadFiles());
        syncScene();
        bar.say(`Reloaded ${fileNames(PART_ORDER)}; unsaved changes are gone.`);
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
          p('The haze, the shadows and the look of the floor are settings of each stage. A stage holds only its own layout. Anything about a character or the whole game is global and the same in every battle: the HUD, which enemies are mirrored, and how tall and broad each hero stands.'),
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
      const { x: gx, y: gy } = game.scale.toGame(e.clientX, e.clientY);
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
    game.scale.on('resize', redraw);
    new ResizeObserver(redraw).observe(centre);

    installTips();
    window.__stageedit = { session, view, flush, save, interact, host: scene, battle: () => testing, startBattle, stopBattle: () => endTest(), align: (how) => inspector.alignSelection(how), warnings: () => warnings };
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
