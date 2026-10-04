/**
 * The inspector (right-hand panel) of the Battle Stage Editor: a form for whatever is selected, or for the stage
 * itself when nothing is (`docs/TOOLING-UI.md` 3.7), in RPG Maker's Database style: a list of labelled fields.
 *
 * What goes where (Mark's rule, 2026-10-03): the TOP BAR holds view choices (how many enemies to preview, which
 * overlays to show, Battle Test, Save); this panel holds the PROPERTIES of the selected thing, or of the stage and
 * the HUD when nothing is selected. A control lives in one of the two, never both.
 *
 * Every field follows the house pattern of the other tools: a plain-language label with the data name beside it in
 * small monospace, a "?" that explains it for a beginner, a slider paired with a number box for numbers, and a revert
 * arrow that appears when the value differs from where it started: for a HUD box that is the layout PRESET's value
 * (or, for a box this stage overrides, the all-battles value), for everything else the value at the last save. Grey
 * text means inherited, white means changed by hand. With several fighters selected a field whose values differ shows
 * "mixed" until one value is typed for all of them.
 *
 * How it stays in step with the data: the inspector never keeps its own copy. Each field has a `read` that gets its
 * value from the session's current data and a `write` that changes it. A slider drag calls `session.live` on every
 * movement (the stage follows at once) and `session.end` on release (one undo step); a number box or a select is one
 * `session.edit`. When the session reports a change the inspector either re-reads every field (`sync`) or, if what is
 * selected changed, builds the form again (`build`).
 */
import { BG_IDS } from '../../art/battlebg';
import { ENEMIES } from '../../data/enemies';
import { MEMBERS } from '../../data/party';
import type { MemberId } from '../../game/state';
import { checkStages, type PartySlot, resolveStage, SET_KEYS, setSize, type StageEntry } from '../config';
import { applyPreset, HUD_PRESETS, HUD_REGION_NAMES, type HudField, type HudRegionKey, hudOverrides, PRESET_IDS, type PresetId, presetValue, revertField, revertRegion } from '../hudpresets';
import { STAGE_KNOWN } from '../known';
import { PROPORTION_MAX, PROPORTION_MIN } from '../proportions';
import type { StageWarning } from '../rules';
import { type AlignHow, ALIGN_WORDS, alignStatus } from './alignsay';
import { h, tip } from './dom';
import { KEYS, shown } from './keys';
import {
  addRow,
  type AcrossResult,
  alignAcross,
  alignBoxes,
  alignDepth,
  alignEnemies,
  type Box,
  clearOverride,
  copyFromPrevious,
  distributeAcross,
  distributeDepth,
  type EditorData,
  hudNow,
  isOverridden,
  overrideRegion,
  type Reach,
  removeRow,
  revertOverrideField,
  setFloorBottom,
  setHorizon,
  setHudBox,
  setHudField,
  setMirror,
  setProportion,
  setOrder,
  setRowY,
  slotList,
  stageOverrides,
} from './model';
import type { Item, Session } from './session';
import type { ViewState } from './view';
import type { StageScene } from '../stagescene';

/** What the inspector needs from the page around it. */
export interface InspectorHost {
  session: Session;
  view: ViewState;
  scene: () => StageScene;
  /** Say something on the status line. */
  notify: (message: string, bad?: boolean) => void;
  /** Preview another enemy in an enemy slot (browser-only). */
  previewEnemy: (index: number, key: string) => void;
  /** Forget the previewed enemies of the shown group. */
  resetPreview: () => void;
  /** The design rules the shown stage breaks right now (the page works them out from the scene; see `rules.ts`). */
  warnings: () => StageWarning[];
}

/** A value the field could go back to, and where it comes from. */
interface Baseline {
  value: number | string;
  /** "preset": the HUD preset's value. "global": the all-battles HUD value. "saved": the value at the last save. */
  kind: 'preset' | 'global' | 'saved';
}

const BASELINE_WORDS: Record<Baseline['kind'], string> = { preset: 'the preset’s', global: 'the all-battles', saved: 'the saved' };

interface NumSpec {
  label: string;
  /** The data name, shown small beside the label. */
  name?: string;
  /** Plain words for a beginner: what it is and what changes on the stage. Becomes the "?" beside the label. */
  tip?: string;
  min: number;
  max: number;
  step?: number;
  /** Show a slider as well as the number box. */
  slider?: boolean;
  /** `null` means several selected things disagree ("mixed"). */
  read: (d: EditorData) => number | null;
  write: (d: EditorData, v: number) => void;
  baseline?: (d: EditorData) => Baseline | null;
  /** What the undo step is called. */
  undo: string;
  disabled?: boolean;
}

/** The choices of the Align bar. A HUD box reads "back" as top and "front" as bottom. */
export type { AlignHow };

export class Inspector {
  private readonly updaters: Array<() => void> = [];
  private signature = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly host: InspectorHost,
  ) {}

  private get session(): Session {
    return this.host.session;
  }

  // ---------------------------------------------------------------- when to rebuild and when to re-read

  /** Called on every session change. */
  refresh(): void {
    const sig = this.signatureNow();
    if (sig !== this.signature) this.build();
    else this.sync();
  }

  /** Re-read every field from the data (cheap; runs on every drag step). */
  sync(): void {
    for (const u of this.updaters) u();
  }

  private signatureNow(): string {
    const s = this.session;
    const st = s.data.stages[s.stageId];
    const hudSel = s.selection.flatMap((i) => (i.kind === 'hud' ? [`${i.region}:${st ? isOverridden(st, i.region) : ''}`] : []));
    return JSON.stringify([s.stageId, s.setKey, s.selection, st?.rows.length, s.data.hud.preset, hudOverrides(s.data.hud).length, stageOverrides(s.data, s.stageId).length, hudSel, Object.keys(s.data.stages).length]);
  }

  /** Build the form for the current selection. */
  build(): void {
    this.signature = this.signatureNow();
    this.updaters.length = 0;
    this.root.replaceChildren();
    const sel = this.session.selection;
    const first = sel[0];
    const fighters = sel.filter((i): i is Extract<Item, { kind: 'fighter' }> => i.kind === 'fighter');
    if (first && fighters.length === sel.length && fighters.length > 0) this.slotForm(fighters);
    else if (first?.kind === 'anchor') this.anchorForm(first);
    else if (first && sel.every((i) => i.kind === 'hud')) this.hudForm(sel.flatMap((i) => (i.kind === 'hud' ? [i.region] : [])));
    else this.stageForm(first);
    // Settings of the stage itself (the haze, the shadows) show only while nothing is selected: a button at the top gets back to them.
    if (first)
      this.root.prepend(
        h(
          'div',
          { class: 'stagebar' },
          h('button', { type: 'button', class: 'stagebtn', id: 'stage-settings', title: 'Deselect, and show the settings of the stage itself: haze, shadows, floor look, rows (Esc does the same)', onclick: () => this.session.select([]) }, 'Stage settings'),
          h('span', { class: 'hint' }, 'Haze, shadows and the floor are here.'),
        ),
      );
    this.sync();
  }

  // ---------------------------------------------------------------- field builders

  /** The stage being edited, inside a copy of the data (what a `write` receives). */
  private stageIn(d: EditorData): StageEntry {
    const s = d.stages[this.session.stageId];
    if (!s) throw new Error(`No stage "${this.session.stageId}"`);
    return s;
  }

  private group(title: string, open: boolean, ...kids: Array<Node | null>): HTMLDetailsElement {
    return h('details', { class: 'grp', ...(open ? { open: true } : {}) }, h('summary', {}, title), ...kids);
  }

  /** A group whose title carries a "?" (the "?" sits outside the clickable summary line's text so it does not fold the group). */
  private groupTip(title: string, open: boolean, help: string, ...kids: Array<Node | null>): HTMLDetailsElement {
    return h('details', { class: 'grp', ...(open ? { open: true } : {}) }, h('summary', {}, title, tip(help)), ...kids);
  }

  private labelOf(label: string, name?: string, help?: string): HTMLElement {
    return h('span', { class: 'lab' }, h('span', { class: 'l' }, label, help ? tip(help) : null), name ? h('code', {}, name) : null);
  }

  /** A slider (optional) paired with a number box, and a revert arrow. */
  private num(spec: NumSpec): HTMLElement {
    const session = this.session;
    const step = spec.step ?? 1;
    const box = h('input', { type: 'number', min: spec.min, max: spec.max, step, class: 'num', 'aria-label': spec.label, disabled: !!spec.disabled });
    const range = spec.slider ? h('input', { type: 'range', min: spec.min, max: spec.max, step, class: 'rng', 'aria-label': `${spec.label} slider`, disabled: !!spec.disabled }) : null;
    const revert = h('button', { type: 'button', class: 'rev', title: '', 'aria-label': `Revert ${spec.label}`, onclick: () => this.revertNum(spec) }, '↶');
    const write = (v: number) => (d: EditorData): void => spec.write(d, v);
    box.addEventListener('change', () => {
      if (box.value === '') return;
      session.edit(spec.undo, write(Number(box.value)));
    });
    if (range) {
      // While the slider is dragged every movement changes the data AND the stage (the stage repaints at once); letting go is the one undo step.
      range.addEventListener('input', () => session.live(write(Number(range.value)), { scene: true }));
      range.addEventListener('change', () => {
        session.end(spec.undo);
        // Hand the keyboard back to the stage: the arrow keys nudge the selection again, not this slider.
        range.blur();
      });
    }
    this.updaters.push(() => {
      const d = session.data;
      if (!d.stages[session.stageId]) return;
      const v = spec.read(d);
      // Several things selected with different values: the box says "mixed" in full and the slider is greyed out
      // (it has no one value to show). Typing a number sets all of them; the slider comes back once they agree.
      row.classList.toggle('mixed', v === null);
      if (v === null) {
        box.value = '';
        box.placeholder = 'mixed';
        if (range) {
          range.value = String(spec.min);
          range.disabled = true;
        }
      } else {
        box.value = String(v);
        box.placeholder = '';
        if (range) {
          range.value = String(v);
          range.disabled = !!spec.disabled;
        }
      }
      const base = spec.baseline ? spec.baseline(d) : this.savedBaseline(spec);
      const differs = base !== null && v !== base.value;
      revert.hidden = !differs;
      revert.title = base ? `Back to ${BASELINE_WORDS[base.kind]} value (${base.value})` : '';
      row.classList.toggle('moved', differs);
    });
    const row = h('div', { class: 'field' }, this.labelOf(spec.label, spec.name, spec.tip), range, box, revert);
    return row;
  }

  private savedBaseline(spec: NumSpec): Baseline | null {
    try {
      const v = spec.read(this.session.saved);
      return v === null ? null : { value: v, kind: 'saved' };
    } catch {
      return null;
    }
  }

  private revertNum(spec: NumSpec): void {
    const base = spec.baseline ? spec.baseline(this.session.data) : this.savedBaseline(spec);
    if (!base || typeof base.value !== 'number') return;
    const value = base.value;
    this.session.edit(`Revert ${spec.label}`, (d) => spec.write(d, value));
  }

  private select(
    label: string,
    name: string | undefined,
    help: string | undefined,
    options: Array<{ value: string; label: string }>,
    read: (d: EditorData) => string | null,
    write: (d: EditorData, v: string) => void,
    undo: string,
    baseline?: (d: EditorData) => Baseline | null,
    onChange?: (value: string) => void,
  ): HTMLElement {
    const session = this.session;
    const sel = h('select', { 'aria-label': label }, ...options.map((o) => h('option', { value: o.value }, o.label)));
    const revert = h('button', { type: 'button', class: 'rev', 'aria-label': `Revert ${label}`, onclick: () => {
      const b = baseline?.(session.data);
      if (b) session.edit(`Revert ${label}`, (d) => write(d, String(b.value)));
    } }, '↶');
    // Most selects are one undo step that writes the value; a few (the preset) do their own thing.
    sel.addEventListener('change', () => {
      if (onChange) onChange(sel.value);
      else session.edit(undo, (d) => write(d, sel.value));
      sel.blur();
    });
    const row = h('div', { class: 'field' }, this.labelOf(label, name, help), sel, revert);
    this.updaters.push(() => {
      const d = session.data;
      if (!d.stages[session.stageId]) return;
      const v = read(d);
      if (v === null) {
        if (!sel.querySelector('option[value=""]')) sel.prepend(h('option', { value: '' }, 'mixed'));
        sel.value = '';
      } else {
        sel.querySelector('option[value=""]')?.remove();
        sel.value = v;
      }
      const b = baseline?.(d) ?? null;
      const differs = !!b && v !== String(b.value);
      revert.hidden = !differs;
      revert.title = b ? `Back to ${BASELINE_WORDS[b.kind]} value (${b.value})` : '';
      row.classList.toggle('moved', differs);
    });
    return row;
  }

  private text(label: string, name: string | undefined, help: string | undefined, read: (s: StageEntry) => string, write: (s: StageEntry, v: string) => void, undo: string, multiline = false, placeholder = ''): HTMLElement {
    const session = this.session;
    const input = multiline ? h('textarea', { rows: 3, placeholder, 'aria-label': label, spellcheck: 'false' }) : h('input', { type: 'text', placeholder, 'aria-label': label, spellcheck: 'false' });
    input.addEventListener('change', () => session.edit(undo, (d) => write(this.stageIn(d), input.value)));
    this.updaters.push(() => {
      const s = session.data.stages[session.stageId];
      if (s && document.activeElement !== input) input.value = read(s);
    });
    return h('div', { class: multiline ? 'field col' : 'field' }, this.labelOf(label, name, help), input);
  }

  private readonly(label: string, name: string | undefined, help: string | undefined, read: (s: StageEntry) => string): HTMLElement {
    const out = h('span', { class: 'ro' });
    this.updaters.push(() => {
      const s = this.session.data.stages[this.session.stageId];
      if (s) out.textContent = read(s);
    });
    return h('div', { class: 'field' }, this.labelOf(label, name, help), out);
  }

  private button(label: string, onclick: () => void, title = '', klass = ''): HTMLButtonElement {
    return h('button', { type: 'button', class: klass, title, onclick }, label);
  }

  /** A number field on the stage itself (the field functions get the stage inside the data). */
  private stageNum(spec: Omit<NumSpec, 'read' | 'write'> & { read: (s: StageEntry) => number | null; write: (s: StageEntry, v: number) => void }): HTMLElement {
    return this.num({ ...spec, read: (d) => spec.read(d.stages[this.session.stageId] as StageEntry), write: (d, v) => spec.write(this.stageIn(d), v) });
  }

  // ---------------------------------------------------------------- the stage (nothing selected, or a ground handle)

  private checks(): HTMLElement {
    const box = h('div', { class: 'checks' });
    this.updaters.push(() => {
      const d = this.session.data;
      const s = d.stages[this.session.stageId];
      if (!s) return;
      const problems = checkStages({ [s.id]: s }, BG_IDS, STAGE_KNOWN);
      // The design's rules (`rules.ts`) for this stage: the stage-wide ones, and the figure ones for the enemy count on show. Warnings never stop a save.
      const warnings = this.host.warnings().filter((w) => w.setKey === null || w.setKey === this.session.setKey);
      box.replaceChildren(
        ...problems.map((p) => h('div', { class: 'bad' }, `Will not save: ${p.replace(/^stage "[^"]*" ?/, '')}`)),
        ...warnings.map((w) => h('div', { class: 'warn' }, `Design rule${w.setKey ? ` (${setLabel(w.setKey)})` : ''}: ${w.text}`)),
      );
      box.hidden = !problems.length && !warnings.length;
    });
    return box;
  }

  private stageForm(focus: Item | undefined): void {
    const s0 = this.session.stage;
    const focusCls = (kind: Item['kind']): string => (focus?.kind === kind ? 'focus' : '');
    const rowsBox = h('div', { class: `rows ${focusCls('row')}` });
    const rowCount = s0.rows.length;
    for (let i = 0; i < rowCount; i++) {
      rowsBox.append(
        this.stageNum({
          label: `Row ${i + 1}${i === 0 ? ' (back)' : i === rowCount - 1 ? ' (front)' : ''}`,
          name: `rows[${i}].y`,
          tip: 'How far down the screen this row is. A bigger number sits lower and closer to you. You can also drag the white line on the stage.',
          min: 0,
          max: 270,
          read: (s) => s.rows[i]?.y ?? null,
          write: (s, v) => void setRowY(s, i, v),
          undo: `Move row ${i + 1}`,
        }),
      );
      if (s0.depthTint)
        rowsBox.append(
          this.stageNum({
            label: `Haze, row ${i + 1}`,
            name: `depthTint.amounts[${i}]`,
            tip: 'Fades the fighters on this row toward the sky colour. Back rows look paler and farther away. Raise it and you will see them wash out.',
            min: 0,
            max: 0.15,
            step: 0.01,
            slider: true,
            read: (s) => s.depthTint?.amounts[i] ?? 0,
            write: (s, v) => {
              if (s.depthTint) s.depthTint.amounts[i] = Math.round(v * 100) / 100;
            },
            undo: `Haze of row ${i + 1}`,
          }),
        );
    }
    rowsBox.append(
      h(
        'div',
        { class: 'btns' },
        this.button('Add row', () => {
          let why: string | null = null;
          this.session.edit('Add a row', (d) => {
            why = addRow(this.stageIn(d));
          });
          if (why) this.host.notify(why, true);
        }, 'Add a depth row in front of the others'),
        this.button('Remove front row', () => {
          let why: string | null = null;
          this.session.edit('Remove a row', (d) => {
            const st = this.stageIn(d);
            why = removeRow(st, st.rows.length - 1);
          });
          if (why) this.host.notify(why, true);
        }, 'Remove the front row (refused while someone stands on it)'),
      ),
    );

    this.root.append(
      this.checks(),
      this.group(
        'Basics',
        true,
        this.text('Name', 'name', undefined, (s) => s.name, (s, v) => {
            s.name = v.trim() || s.name;
          }, 'Rename the stage'),
        this.readonly('Id', 'id', 'The short name other files use for this stage. Change it with “Change id” in the stage list. The Name above is the only place to change the name.', (s) => s.id),
        this.text('Note for Claude', 'note', 'A message for the next Claude session. Write what you want from this stage, for example “make the sewer gloomier”.', (s) => s.note ?? '', (s, v) => {
            if (v.trim()) s.note = v;
            else delete s.note;
          }, 'Edit the note', true, 'What do you want from this stage? A later Claude session reads this.'),
      ),
      this.groupTip(
        'Battleback',
        false,
        'The pictures behind the fighters. RPG Maker calls the background a battleback.',
        this.select('Backdrop picture', 'backdrop.id', 'The painted picture behind the fighters: sky, walls and buildings. Pick another one to swap the whole background.', BG_IDS.map((id) => ({ value: id, label: id })), (d) => this.stageIn(d).backdrop.id, (d, v) => {
            this.stageIn(d).backdrop.id = v;
          }, 'Change the backdrop picture', () => {
            const b = this.session.saved.stages[this.session.stageId]?.backdrop.id;
            return b ? { value: b, kind: 'saved' } : null;
          }),
        this.readonly('How it is placed', 'backdrop.mode', '“Old picture moved to the horizon” slides an existing backdrop up or down to meet the floor. “A painted back wall” draws a new wall instead.', (s) => (s.backdrop.mode === 'reproject' ? 'old picture moved to the horizon' : 'a painted back wall')),
        this.readonly('Foreground', 'backdrop.foreground', 'A picture drawn in front of the fighters, like railings at the edge of the screen. No stage uses one yet.', (s) => (s.backdrop.foreground ? s.backdrop.foreground.id : 'none')),
        this.readonly('Weather', 'backdrop.ambient', 'Moving extras such as rain or drips. They are not drawn yet.', (s) => s.backdrop.ambient ?? 'none'),
      ),
      h(
        'div',
        { class: `grpwrap ${focusCls('horizon')} ${focusCls('floor')}` },
        this.group(
          'Ground',
          true,
          this.stageNum({
            label: 'Horizon',
            name: 'backdrop.horizonY',
            tip: 'The line where the back wall meets the floor. Drag it up and the floor gets taller. Drag it down and the wall gets taller. It is also the top of the floor.',
            min: 40,
            max: 160,
            slider: true,
            read: (s) => s.backdrop.horizonY,
            write: (s, v) => void setHorizon(s, v),
            undo: 'Move the horizon',
          }),
          this.stageNum({
            label: 'Floor bottom',
            name: 'floor.y1',
            tip: 'The lowest line anyone can stand on. The menu covers the strip below it.',
            min: 150,
            max: 270,
            slider: true,
            read: (s) => s.floor.y1,
            write: (s, v) => void setFloorBottom(s, v),
            undo: 'Move the floor bottom',
          }),
        ),
      ),
      this.groupTip('Depth rows', true, 'Rows run from the back (the top of the floor) to the front (the bottom). A fighter stands on one row. Fighters on lower rows are drawn over those behind. This is what makes the stage look deep.', rowsBox),
      this.groupTip(
        'Shadows',
        false,
        'The dark oval under each fighter’s feet. It makes them look planted on the floor.',
        this.stageNum({ label: 'Shadow width', name: 'shadow.widthScale', tip: 'How wide each shadow is, compared with the fighter. 1 means as wide as the fighter. Lower it and every shadow shrinks.', min: 0.1, max: 2, step: 0.05, slider: true, read: (s) => s.shadow.widthScale, write: (s, v) => {
            s.shadow.widthScale = v;
          }, undo: 'Shadow width' }),
        this.stageNum({ label: 'Narrowest', name: 'shadow.minW', tip: 'No shadow gets narrower than this many pixels, even under a small fighter.', min: 2, max: 100, read: (s) => s.shadow.minW, write: (s, v) => {
            s.shadow.minW = v;
          }, undo: 'Shadow narrowest' }),
        this.stageNum({ label: 'Widest', name: 'shadow.maxW', tip: 'No shadow gets wider than this many pixels, even under a big fighter.', min: 2, max: 100, read: (s) => s.shadow.maxW, write: (s, v) => {
            s.shadow.maxW = v;
          }, undo: 'Shadow widest' }),
        this.stageNum({ label: 'Flatness', name: 'shadow.aspect', tip: 'How squashed the shadow oval is. A low number is round. A high number is thin and flat. Raise it and the shadows flatten.', min: 1, max: 10, step: 0.5, slider: true, read: (s) => s.shadow.aspect, write: (s, v) => {
            s.shadow.aspect = v;
          }, undo: 'Shadow flatness' }),
        this.stageNum({ label: 'Darkness', name: 'shadow.alpha', tip: 'How dark the shadow is. 0 is invisible. 1 is solid black.', min: 0, max: 1, step: 0.05, slider: true, read: (s) => s.shadow.alpha, write: (s, v) => {
            s.shadow.alpha = v;
          }, undo: 'Shadow darkness' }),
      ),
      this.floorLook(s0),
      this.hudGroup(),
      this.groupTip(
        'Enemy positions',
        true,
        'Where the enemies stand. Each enemy count has its own layout, so a fight with three enemies looks planned and not squeezed. Choose the count with “Enemies” in the top bar.',
        h('div', { class: 'hint', id: 'formation-now' }),
        h(
          'div',
          { class: 'btns' },
          this.button('Lay out evenly', () => this.layOutNow(), 'Spread this group evenly across the rows (RPG Maker calls this Align). One undo step.'),
          this.button('Copy from one fewer enemy', () => this.copyPrevNow(), 'Start this group from the group with one fewer enemy, then add the extra slot'),
          this.button('Put back the demo enemies', () => this.host.resetPreview(), 'Show the stage’s own demo enemies in this group again (you swapped some for a preview)'),
        ),
      ),
    );
    this.updaters.push(() => {
      const now = this.root.querySelector('#formation-now');
      if (now) now.textContent = `Showing the layout for ${setLabel(this.session.setKey)}.`;
    });
  }

  /** The floor's own look: puddles, far fade and neon glow (only the parts this stage has). */
  private floorLook(s0: StageEntry): HTMLElement {
    const kids: Array<Node | null> = [];
    if (s0.floor.reflections)
      kids.push(
        this.stageNum({ label: 'Puddles', name: 'floor.reflections.count', tip: 'How many shiny puddles lie on the floor. They mirror the neon lights and never sit under a fighter. Change it and puddles appear or vanish.', min: 0, max: 20, slider: true, read: (s) => s.floor.reflections?.count ?? 0, write: (s, v) => {
            if (s.floor.reflections) s.floor.reflections.count = v;
          }, undo: 'Puddle count' }),
      );
    if (s0.floor.haze)
      kids.push(
        this.stageNum({ label: 'Far fade', name: 'floor.haze.amount', tip: 'Fades the far end of the floor toward the sky colour, so the floor melts into the distance. Raise it and the floor near the horizon gets hazier.', min: 0, max: 1, step: 0.05, slider: true, read: (s) => s.floor.haze?.amount ?? 0, write: (s, v) => {
            if (s.floor.haze) s.floor.haze.amount = v;
          }, undo: 'Floor far fade' }),
      );
    if (s0.floor.neonSpill)
      kids.push(
        this.stageNum({ label: 'Neon glow', name: 'floor.neonSpill.strength', tip: 'How strongly the bright lights of the backdrop spill onto the floor just below the horizon. Raise it and the glow gets stronger.', min: 0, max: 1, step: 0.05, slider: true, read: (s) => s.floor.neonSpill?.strength ?? 0, write: (s, v) => {
            if (s.floor.neonSpill) s.floor.neonSpill.strength = v;
          }, undo: 'Floor neon glow' }),
      );
    return this.groupTip('Floor look', false, 'How the painted floor looks. These do not change where anyone can stand.', ...kids);
  }

  private layOutNow(): void {
    const key = this.session.setKey;
    this.session.edit(`Lay out evenly (${setLabel(key)})`, (d) => alignEnemies(this.stageIn(d), key));
    this.host.notify(`Laid out the ${setLabel(key)} group evenly.`);
  }

  private copyPrevNow(): void {
    const key = this.session.setKey;
    let why: string | null = null;
    this.session.edit(`Copy group from one fewer enemy (${setLabel(key)})`, (d) => {
      why = copyFromPrevious(this.stageIn(d), key);
    });
    if (why) this.host.notify(why, true);
    else this.host.notify(`Started the ${setLabel(key)} group from the group with one fewer enemy.`);
  }

  // ---------------------------------------------------------------- HUD: one layout for every battle, a few boxes overridden per stage

  private hudGroup(): HTMLElement {
    const session = this.session;
    const list = h('div', { class: 'ovr' });
    const here = h('div', { class: 'ovr' });
    const about = h('div', { class: 'hint' });
    this.updaters.push(() => {
      const d = session.data;
      if (!d.stages[session.stageId]) return;
      about.textContent = HUD_PRESETS[d.hud.preset].about;
      const moved = hudOverrides(d.hud);
      list.replaceChildren(
        moved.length
          ? h('div', { class: 'hint' }, `${moved.length} value${moved.length === 1 ? '' : 's'} moved by hand (white; the arrow puts one back):`)
          : h('div', { class: 'hint' }, 'Every box is where the preset puts it (grey).'),
        ...moved.map((o) =>
          h(
            'div',
            { class: 'ovr-row' },
            h('span', {}, `${HUD_REGION_NAMES[o.region]} › ${o.field}`),
            h('span', { class: 'v' }, `${o.inherited} → ${o.value}`),
            h('button', {
              type: 'button',
              class: 'rev',
              title: `Back to the preset’s value (${o.inherited})`,
              onclick: () => session.edit(`Revert ${HUD_REGION_NAMES[o.region]} ${o.field}`, (data) => revertField(data.hud, o.region, o.field)),
            }, '↶'),
          ),
        ),
        ...(moved.length ? [h('div', { class: 'btns' }, this.button('Clear all moved values', () => this.applyPresetNow(d.hud.preset, true), 'Put every box back to the preset'))] : []),
      );
      const over = stageOverrides(d, session.stageId);
      const regions = [...new Set(over.map((o) => o.region))];
      const marked = (Object.keys(d.stages[session.stageId]?.hud ?? {}) as HudRegionKey[]).filter((r) => !regions.includes(r));
      here.replaceChildren(
        over.length || marked.length
          ? h('div', { class: 'hint' }, `On this stage only (${[...regions, ...marked].map((r) => HUD_REGION_NAMES[r]).join(', ')}). The arrow goes back to the all-battles value:`)
          : h('div', { class: 'hint' }, 'This stage uses the all-battles HUD as it is. To change one box on this stage only, select the box and turn on “Different on this stage”.'),
        ...over.map((o) =>
          h(
            'div',
            { class: 'ovr-row' },
            h('span', {}, `${HUD_REGION_NAMES[o.region]} › ${o.field}`),
            h('span', { class: 'v' }, `${o.global} → ${o.value}`),
            h('button', {
              type: 'button',
              class: 'rev',
              title: `Back to the all-battles value (${o.global})`,
              onclick: () => session.edit(`Revert ${HUD_REGION_NAMES[o.region]} ${o.field} on this stage`, (data) => revertOverrideField(data, session.stageId, o.region, o.field)),
            }, '↶'),
          ),
        ),
        ...(over.length || marked.length
          ? [h('div', { class: 'btns' }, this.button('Use the all-battles HUD here', () => session.edit('Clear this stage’s HUD overrides', (data) => {
              for (const r of [...regions, ...marked]) clearOverride(data, session.stageId, r);
            }), 'Take away every box this stage overrides'))]
          : []),
      );
    });
    const preset = this.select(
      'Layout preset',
      'hud.preset',
      'A ready-made arrangement of the battle boxes (menu, party, turn order). Pick one as a starting point. Boxes you moved by hand keep their place.',
      PRESET_IDS.map((id) => ({ value: id, label: HUD_PRESETS[id].name })),
      (d) => d.hud.preset,
      () => {},
      '',
      undefined,
      (v) => this.applyPresetNow(v as PresetId, false),
    );
    return this.groupTip(
      'HUD layout · all battles',
      true,
      'The HUD is the menu and the numbers drawn over a battle. There is ONE layout for every battle on every stage. Click a HUD box on the stage to move it. A stage can override single boxes when it needs to.',
      preset,
      about,
      list,
      h('div', { class: 'sub' }, 'This stage'),
      here,
    );
  }

  /** Switch the global HUD preset (one undo step); boxes moved by hand keep their place unless `clear` is set. */
  applyPresetNow(id: PresetId, clear: boolean): void {
    const session = this.session;
    let kept: HudRegionKey[] = [];
    session.edit(clear ? 'Clear HUD moves' : `HUD preset: ${HUD_PRESETS[id].name}`, (d) => {
      kept = applyPreset(d.hud, id, clear);
    });
    if (clear) this.host.notify('Every HUD box is back at the preset’s place (in every battle).');
    else this.host.notify(kept.length ? `HUD preset: ${HUD_PRESETS[id].name}. Kept ${kept.length} box${kept.length === 1 ? '' : 'es'} you had moved (${kept.map((k) => HUD_REGION_NAMES[k]).join(', ')}). It applies to every battle.` : `HUD preset: ${HUD_PRESETS[id].name}. It applies to every battle.`);
  }

  private hudForm(regions: HudRegionKey[]): void {
    const session = this.session;
    const names = regions.map((r) => HUD_REGION_NAMES[r]).join(', ');
    const overriddenFlags = (d: EditorData): boolean[] => regions.map((r) => isOverridden(this.stageIn(d), r));
    const globalValue = (d: EditorData, r: HudRegionKey, field: HudField): number | string => {
      const v = (d.hud[r] as unknown as Record<string, number | string | undefined>)[field];
      return v ?? (field === 'opacity' ? 1 : 0);
    };
    /** Where a box's fields go back to: the all-battles value when this stage overrides the box, else the preset's. */
    const baselineOf = (field: HudField) => (d: EditorData): Baseline | null => {
      const flags = overriddenFlags(d);
      const vals = regions.map((r, i) => (flags[i] ? globalValue(d, r, field) : presetValue(d.hud.preset, r, field)));
      if (!vals.every((v) => v === vals[0]) || flags.some((f) => f !== flags[0])) return null;
      return { value: vals[0] as number | string, kind: flags[0] ? 'global' : 'preset' };
    };
    const numField = (field: Exclude<HudField, 'show' | 'opacity'>, label: string, max: number): HTMLElement =>
      this.num({
        label,
        name: field,
        min: 0,
        max,
        slider: false,
        read: (d) => same(regions.map((r) => Number(hudNow(d, session.stageId, r, field)))),
        write: (d, v) => {
          for (const r of regions) setHudField(d, session.stageId, r, field, v);
        },
        baseline: (d) => {
          const b = baselineOf(field)(d);
          return b && typeof b.value === 'number' ? b : null;
        },
        undo: `HUD ${names} ${field}`,
      });

    // "Different on this stage": the scope of every edit to these boxes.
    const scope = h('input', { type: 'checkbox', id: 'hud-scope', 'aria-label': 'Different on this stage' });
    const scopeHint = h('div', { class: 'hint' });
    scope.addEventListener('change', () => {
      const on = scope.checked;
      session.edit(on ? `Override ${names} on this stage` : `Use the all-battles ${names}`, (d) => {
        for (const r of regions) (on ? overrideRegion : clearOverride)(d, session.stageId, r);
      });
      this.host.notify(on ? `${names}: this stage now has its own copy. Changes to it stay on this stage.` : `${names}: back to the all-battles box. Changes to it show on every stage.`);
    });
    this.updaters.push(() => {
      const flags = overriddenFlags(session.data);
      const all = flags.every(Boolean);
      const none = flags.every((f) => !f);
      scope.checked = all;
      scope.indeterminate = !all && !none;
      scopeHint.textContent = all ? 'Changes to this box stay on this stage. Every other stage keeps the all-battles box.' : none ? 'Changes to this box show in EVERY battle on every stage.' : 'Some of the selected boxes are different on this stage and some are not.';
    });
    const scopeRow = h(
      'div',
      { class: 'field scope' },
      h('label', { class: 'lab', for: 'hud-scope' }, h('span', { class: 'l' }, 'Different on this stage', tip('Off: the box is the same in every battle, so a change moves it on every stage. On: this stage gets its own copy and other stages keep theirs. Use it when a big boss covers a box.')), h('code', {}, `stages.json › hud.${regions[0] ?? 'box'}`)),
      scope,
    );

    // One button, two meanings: on a box this stage overrides it goes back to the all-battles box, otherwise back to the preset.
    const revertAll = this.button('Revert box to preset', () => session.edit(`Revert ${names}`, (d) => {
      for (const r of regions) {
        if (isOverridden(this.stageIn(d), r)) clearOverride(d, session.stageId, r);
        else revertRegion(d.hud, r);
      }
    }));
    this.updaters.push(() => {
      const all = overriddenFlags(session.data).every(Boolean);
      revertAll.textContent = all ? 'Use the all-battles box' : 'Revert box to preset';
      revertAll.title = all ? 'Take away this stage’s own copy: the box follows the all-battles layout again' : 'Put every value of this box back to the HUD preset’s (in every battle)';
    });

    this.root.append(
      this.checks(),
      this.alignGroup('hud', regions.length >= 3),
      this.group(
        `HUD box: ${names}`,
        true,
        h('div', { class: 'hint' }, 'Drag the box on the stage, or its corners to resize. White values were changed by hand. Grey ones come from the preset.'),
        scopeRow,
        scopeHint,
        numField('x', 'Left', 480),
        numField('y', 'Top', 270),
        numField('w', 'Width', 480),
        numField('h', 'Height', 270),
        this.select(
          'Shows',
          'show',
          'When the box is on the screen: always, while the player picks an action, while an action plays, or never.',
          [
            { value: 'always', label: 'always' },
            { value: 'input', label: 'while choosing' },
            { value: 'action', label: 'while an action plays' },
            { value: 'never', label: 'never' },
          ],
          (d) => same(regions.map((r) => String(hudNow(d, session.stageId, r, 'show')))),
          (d, v) => {
            for (const r of regions) setHudField(d, session.stageId, r, 'show', v);
          },
          `HUD ${names} show`,
          (d) => {
            const b = baselineOf('show')(d);
            return b && typeof b.value === 'string' ? b : null;
          },
        ),
        this.num({
          label: 'Opacity',
          name: 'opacity',
          tip: 'How see-through the box is. 1 is solid. Lower shows more of the stage behind it.',
          min: 0,
          max: 1,
          step: 0.05,
          slider: true,
          read: (d) => same(regions.map((r) => Number(hudNow(d, session.stageId, r, 'opacity')))),
          write: (d, v) => {
            for (const r of regions) setHudField(d, session.stageId, r, 'opacity', v);
          },
          baseline: (d) => {
            const b = baselineOf('opacity')(d);
            return b && typeof b.value === 'number' ? b : null;
          },
          undo: `HUD ${names} opacity`,
        }),
        h('div', { class: 'btns' }, revertAll),
      ),
    );
  }

  // ---------------------------------------------------------------- align (a design tool's Align bar)

  /**
   * The Align bar. One thing selected lines up with the stage; two or more line up with each other (and with three or
   * more, they can also be spread out evenly). A fighter's choices are about depth ("Back", "Middle", "Front");
   * a HUD box's are "Top", "Middle", "Bottom".
   */
  private alignGroup(kind: 'fighter' | 'hud', canSpread: boolean): HTMLElement {
    const hud = kind === 'hud';
    // The key shown in each tooltip comes from the one key table, so it can never disagree with what the key does.
    const KEY_ID: Record<AlignHow, string> = { left: 'alignLeft', centre: 'alignCentre', right: 'alignRight', back: 'alignBack', middle: 'alignMiddle', front: 'alignFront', spreadAcross: 'spreadAcross', spreadDepth: 'spreadDepth' };
    const btn = (how: AlignHow, label: string, title: string): HTMLButtonElement => {
      const key = shown(KEYS.find((k) => k.id === KEY_ID[how])?.combos[0] ?? '');
      return h('button', { type: 'button', class: 'alb', 'data-align': how, title: `${title} (key ${key})`, 'aria-label': `${label}: ${title}`, onclick: () => this.alignSelection(how) }, label);
    };
    return this.groupTip(
      'Align',
      true,
      hud
        ? 'Line up with the screen, or with each other. With one box selected it lines up with the screen. With two or more it lines up with each other.'
        : 'Line up the selected fighters with one click. One fighter lines up with the stage, and stays on its own half: heroes on the left, enemies on the right. Two or more line up with each other.',
      h(
        'div',
        { class: 'alignbar' },
        h('div', { class: 'seg' }, btn('left', 'Left', 'Line up the left edges'), btn('centre', 'Centre', 'Line up the centres'), btn('right', 'Right', 'Line up the right edges')),
        h(
          'div',
          { class: 'seg' },
          btn('back', hud ? 'Top' : 'Back', hud ? 'Line up the top edges' : 'Move to the back row'),
          btn('middle', 'Middle', hud ? 'Line up the middles' : 'Move to the middle row'),
          btn('front', hud ? 'Bottom' : 'Front', hud ? 'Line up the bottom edges' : 'Move to the front row'),
        ),
        canSpread ? h('div', { class: 'seg' }, btn('spreadAcross', 'Spread across', 'Even gaps from left to right'), btn('spreadDepth', hud ? 'Spread down' : 'Spread rows', hud ? 'Even gaps from top to bottom' : 'Even steps from back to front')) : null,
      ),
    );
  }

  /**
   * Line up the selection (the Align bar and the single-letter Align keys call this). Returns false, after saying why on the status
   * line, when nothing alignable is selected. One undo step.
   */
  alignSelection(how: AlignHow): boolean {
    const session = this.session;
    const sel = session.selection;
    const fighters = sel.flatMap((i) => (i.kind === 'fighter' ? [i] : []));
    const huds = sel.flatMap((i) => (i.kind === 'hud' ? [i.region] : []));
    if (fighters.length && fighters.length === sel.length) return this.alignFighters(fighters, how);
    if (huds.length && huds.length === sel.length) return this.alignHud(huds, how);
    this.host.notify('Select a fighter or a HUD box first, then align it. Shift+click adds more.', true);
    return false;
  }

  /**
   * Where the OTHER side stands, so Align can keep the design's 55 px gap between the sides (`standingRange`): for heroes the drawn left
   * edge of the nearest enemy of ANY enemy group of this stage (the rule is checked for each), for enemies the drawn right edge of the
   * farthest hero. Undefined when it cannot be measured (a stage that is half edited), and Align then uses the side's own range.
   */
  private opposingEdge(side: 'party' | 'enemy'): number | undefined {
    const scene = this.host.scene();
    try {
      if (side === 'enemy') {
        const rights = scene.fighters.filter((f) => f.side === 'party').map((f) => scene.boxOf(f).right);
        return rights.length ? Math.max(...rights) : undefined;
      }
      const cfg = resolveStage(this.session.stage, this.session.data.hud);
      const lefts = SET_KEYS.flatMap((key) => (cfg.enemySets[key] ? scene.figureBoxesFor(cfg, key, this.host.view.roster(this.session.stage, key)).filter((b) => b.side === 'enemy').map((b) => b.left) : []));
      return lefts.length ? Math.min(...lefts) : undefined;
    } catch {
      return undefined;
    }
  }

  private alignFighters(items: Array<Extract<Item, { kind: 'fighter' }>>, how: AlignHow): boolean {
    const session = this.session;
    const side = items[0]?.side ?? 'party';
    const idx = items.map((i) => i.index);
    const scene = this.host.scene();
    const mates = scene.fighters.filter((f) => f.side === side);
    // The size of EVERY fighter of the side, not only the selected ones: a fighter that is not selected never moves, and the others keep clear of it.
    const reach: Record<number, Reach> = {};
    mates.forEach((f, i) => {
      const b = scene.boxOf(f);
      reach[i] = { left: Math.max(0, f.x - b.left), right: Math.max(0, b.right - f.x) };
    });
    const many = idx.length > 1;
    if ((how === 'spreadAcross' || how === 'spreadDepth') && idx.length < 3) {
      this.host.notify('Spreading needs three or more fighters. Shift+click to add more.', true);
      return false;
    }
    const who = many ? `${idx.length} ${side === 'party' ? 'heroes' : 'enemies'}` : (mates[idx[0] ?? 0]?.name ?? 'fighter');
    const against = this.opposingEdge(side);
    let result: AcrossResult | null = null;
    session.edit(`Align ${who} ${ALIGN_WORDS[how]}`, (d) => {
      const st = this.stageIn(d);
      if (how === 'left' || how === 'centre' || how === 'right') result = alignAcross(st, side, session.setKey, idx, how, reach, against);
      else if (how === 'back' || how === 'middle' || how === 'front') result = alignDepth(st, side, session.setKey, idx, how, reach, against);
      else if (how === 'spreadAcross') distributeAcross(st, side, session.setKey, idx, reach);
      else distributeDepth(st, side, session.setKey, idx);
    });
    // One fighter lines up with its side's standing range; several line up with each other.
    const say = alignStatus({ how, who, side, result: result as AcrossResult | null, acrossOne: !many && (how === 'left' || how === 'centre' || how === 'right') });
    this.host.notify(say.text, say.bad);
    return true;
  }

  private alignHud(regions: HudRegionKey[], how: AlignHow): boolean {
    const session = this.session;
    if ((how === 'spreadAcross' || how === 'spreadDepth') && regions.length < 3) {
      this.host.notify('Spreading needs three or more boxes. Shift+click to add more.', true);
      return false;
    }
    const boxes: Partial<Record<HudRegionKey, Box>> = {};
    for (const r of regions) {
      const n = (f: 'x' | 'y' | 'w' | 'h'): number => Number(hudNow(session.data, session.stageId, r, f));
      boxes[r] = { x: n('x'), y: n('y'), w: n('w'), h: n('h') };
    }
    const mapped = { left: 'left', centre: 'centre', right: 'right', back: 'top', middle: 'middle', front: 'bottom', spreadAcross: 'spreadAcross', spreadDepth: 'spreadDown' } as const;
    const moved = alignBoxes(boxes, mapped[how]);
    const names = regions.map((r) => HUD_REGION_NAMES[r]).join(', ');
    session.edit(`Align ${names}`, (d) => {
      for (const [r, to] of Object.entries(moved) as Array<[HudRegionKey, { x: number; y: number }]>) setHudBox(d, session.stageId, r, to);
    });
    const here = regions.every((r) => isOverridden(session.stage, r)) ? 'on this stage' : 'in every battle';
    this.host.notify(`Aligned ${names} (${here}).`);
    return true;
  }

  // ---------------------------------------------------------------- fighters and their foot anchors

  private slotForm(items: Array<Extract<Item, { kind: 'fighter' }>>): void {
    const session = this.session;
    const side = items[0]?.side ?? 'party';
    const idx = items.map((i) => i.index);
    const rows = this.session.stage.rows.length;
    const slotsOf = (d: EditorData): PartySlot[] => idx.flatMap((i) => slotList(this.stageIn(d), side, session.setKey)[i] ?? []);
    const title = this.slotTitle(side, idx);
    const writeAll = (d: EditorData, fn: (q: PartySlot) => void): void => slotsOf(d).forEach(fn);
    const rowOptions = Array.from({ length: rows }, (_, i) => ({ value: String(i), label: `${i + 1}${i === 0 ? ' (back)' : i === rows - 1 ? ' (front)' : ''}` }));
    const sx = side === 'party' ? { min: 0, max: 239 } : { min: 240, max: 480 };

    const pieces: Array<Node | null> = [
      this.checks(),
      this.alignGroup('fighter', idx.length >= 3),
      this.group(
        title,
        true,
        this.select('Row', 'row', 'Which row this fighter stands on. Back is the top of the floor. Front is the bottom. Fighters on a lower row are drawn over those behind.', rowOptions, (d) => same(slotsOf(d).map((q) => String(q.row))), (d, v) =>
            writeAll(d, (q) => {
              q.row = Number(v);
            }), `Move ${title} to another row`),
        this.num({ label: 'Across', name: 'x', tip: 'Where the feet stand, from the left edge of the screen to the right. You can also drag the fighter.', ...sx, slider: true, read: (d) => same(slotsOf(d).map((q) => q.x)), write: (d, v) =>
            writeAll(d, (q) => {
              q.x = v;
            }), undo: `Move ${title} sideways` }),
        this.num({ label: 'Small up or down', name: 'dy', tip: 'Moves the feet a few pixels up or down from the row line. It is usually 0.', min: -8, max: 8, read: (d) => same(slotsOf(d).map((q) => q.dy ?? 0)), write: (d, v) =>
            writeAll(d, (q) => {
              if (v === 0) delete q.dy;
              else q.dy = v;
            }), undo: `Nudge ${title}` }),
        this.readonlyData('Feet at y', undefined, 'Worked out from the row. It is not stored.', (d) => same(slotsOf(d).map((q) => (this.stageIn(d).rows[q.row]?.y ?? 0) + (q.dy ?? 0)))?.toString() ?? 'mixed'),
        h(
          'div',
          { class: 'field' },
          this.labelOf('Draw order', 'order', 'Who is drawn on top when fighters on one row overlap. Auto puts the one nearer the middle in front. Forward or Back overrides that.'),
          h(
            'div',
            { class: 'seg' },
            ...([['Auto', 0], ['Forward', 1], ['Back', -1]] as const).map(([label, v]) =>
              h('button', { type: 'button', class: 'segb', 'data-order': String(v), onclick: () => session.edit(`${label === 'Auto' ? 'Automatic' : label} draw order for ${title}`, (d) => {
                  for (const i of idx) setOrder(this.stageIn(d), side, session.setKey, i, v);
                }) }, label),
            ),
          ),
        ),
      ),
    ];
    this.updaters.push(() => {
      const d = session.data;
      if (!d.stages[session.stageId]) return;
      const orders = slotsOf(d).map((q) => q.order ?? 0);
      for (const b of this.root.querySelectorAll<HTMLElement>('.segb')) b.classList.toggle('on', orders.every((o) => String(o) === b.dataset.order));
    });
    this.root.append(...pieces.filter((p): p is Node => p !== null));

    if (side === 'enemy' && items.length === 1) {
      const i = idx[0] ?? 0;
      const options = Object.values(ENEMIES).map((e) => ({ value: e.id, label: `${e.name}${e.boss ? ' (boss)' : ''}` }));
      const pick = h('select', { 'aria-label': 'Standing here (preview)' }, ...options.map((o) => h('option', { value: o.value }, o.label)));
      this.updaters.push(() => {
        const key = this.host.scene().enemies[i];
        if (key && document.activeElement !== pick) pick.value = key;
      });
      pick.addEventListener('change', () => this.host.previewEnemy(i, pick.value));
      this.root.append(this.group('Who is standing here', true, h('div', { class: 'field' }, this.labelOf('Enemy', 'preview', 'Which enemy is shown in this slot while you edit. It is only a preview in this browser. The stage keeps places, not people.'), pick)));
    }
    if (side === 'enemy' && items.length === 1) this.root.append(this.facingGroup(idx[0] ?? 0));
    if (side === 'party' && items.length === 1) this.root.append(this.proportionsGroup(idx[0] ?? 0));
    if (items.length === 1) {
      const i = idx[0] ?? 0;
      this.root.append(this.anchorGroup(side, i));
    }
  }

  /**
   * "Mirror (face the heroes)": flips the picture of the enemy standing in this slot left-to-right so it looks at the heroes.
   * It edits the enemy's SPRITE (`enemyfacing.json`), so every appearance of that enemy changes with it, here and on every
   * stage. One undo step, a revert arrow back to the saved value, and Save writes the file with the others.
   */
  private facingGroup(index: number): HTMLElement {
    const session = this.session;
    const fighter = () => this.host.scene().fighters.filter((f) => f.side === 'enemy')[index];
    const key = (): string => fighter()?.axisKey ?? '';
    const box = h('input', { type: 'checkbox', id: 'enemy-mirror', 'aria-label': 'Mirror (face the heroes)' });
    const revert = h('button', { type: 'button', class: 'rev', 'aria-label': 'Revert Mirror', onclick: () => {
      const saved = session.saved.facing[key()]?.mirror;
      if (saved !== undefined) session.edit(`Revert Mirror of ${fighter()?.name ?? key()}`, (d) => setMirror(d, key(), saved));
    } }, '↶');
    const hint = h('div', { class: 'hint' });
    box.addEventListener('change', () => {
      const f = fighter();
      const on = box.checked;
      session.edit(`${on ? 'Mirror' : 'Unmirror'} ${f?.name ?? key()}`, (d) => setMirror(d, key(), on));
      this.host.notify(`${f?.name ?? 'The enemy'} ${on ? 'is now mirrored' : 'is no longer mirrored'}. This changes every place it stands. Save to keep it.`);
    });
    const row = h('div', { class: 'field scope mirror' }, h('label', { class: 'lab', for: 'enemy-mirror' }, h('span', { class: 'l' }, 'Mirror (face the heroes)', tip("Flips this enemy's picture left-to-right so it looks at the heroes. Mirroring also flips details like logos or which hand holds a weapon.")), h('code', {}, 'enemyfacing.json')), box, revert);
    this.updaters.push(() => {
      const k = key();
      const entry = session.data.facing[k];
      const saved = session.saved.facing[k]?.mirror;
      box.checked = entry?.mirror === true;
      const differs = saved !== undefined && saved !== box.checked;
      revert.hidden = !differs;
      revert.title = saved === undefined ? '' : `Back to the saved value (${saved ? 'mirrored' : 'not mirrored'})`;
      row.classList.toggle('moved', differs);
      const f = fighter();
      hint.textContent = entry ? `${entry.note} It applies to every ${f?.name ?? 'enemy'} on every stage.` : '';
    });
    return this.group('Facing', true, row, hint);
  }

  /**
   * "Proportions · this hero, all battles": how tall (Height) and how broad (Build) the selected hero stands in EVERY battle.
   * Like the HUD, this is global: it edits `heroes.json`, not the stage, and no stage can override it. The sliders preview live
   * (the scene bakes the hero again on every step: whole rows and columns of pixels, never a stretch, see `proportions.ts`),
   * a drag is one undo step, each has a revert arrow back to the saved number, and Save writes the file with the others.
   */
  private proportionsGroup(index: number): HTMLElement {
    const fighter = () => this.host.scene().fighters.filter((f) => f.side === 'party')[index];
    const id = (): string => fighter()?.axisKey ?? '';
    const name = (): string => fighter()?.name ?? id();
    const read = (key: 'height' | 'build') => (d: EditorData): number | null => d.heroes[id()]?.[key] ?? null;
    const slider = (key: 'height' | 'build', label: string, help: string): HTMLElement =>
      this.num({
        label,
        name: `heroes.json › ${id()}.${key}`,
        tip: help,
        min: PROPORTION_MIN,
        max: PROPORTION_MAX,
        step: 0.01,
        slider: true,
        read: read(key),
        write: (d, v) => setProportion(d, id(), key, Math.round(v * 100) / 100),
        undo: `${label} of ${name()}`,
      });
    const now = h('div', { class: 'hint' });
    this.updaters.push(() => {
      const size = this.host.scene().heroSize(id());
      now.textContent = size ? `${name()} is ${size.drawn.h} px tall and ${size.drawn.w} px wide as drawn. In battle: ${size.now.h} px tall, ${size.now.w} px wide. Every battle uses this, on every stage.` : '';
    });
    return this.groupTip(
      'Proportions · this hero, all battles',
      true,
      'Adds or removes whole rows and columns of pixels in the body, so the pixel art stays crisp. The head stays the same size.',
      slider('height', 'Height', 'How tall this hero stands. 1 is the picture as drawn, 0.8 is a fifth shorter, 1.2 a fifth taller. The head and the feet are never changed.'),
      slider('build', 'Build', 'How broad this hero stands. 1 is as drawn. Higher is broader through the body and shoulders; lower is slimmer. Arms and weapons keep their shape.'),
      now,
    );
  }

  /** A read-only line whose text comes from the whole data (the stage and the HUD). */
  private readonlyData(label: string, name: string | undefined, help: string | undefined, read: (d: EditorData) => string): HTMLElement {
    const out = h('span', { class: 'ro' });
    this.updaters.push(() => {
      const d = this.session.data;
      if (d.stages[this.session.stageId]) out.textContent = read(d);
    });
    return h('div', { class: 'field' }, this.labelOf(label, name, help), out);
  }

  private slotTitle(side: 'party' | 'enemy', idx: number[]): string {
    const scene = this.host.scene();
    const fighters = scene.fighters.filter((f) => f.side === side);
    if (idx.length > 1) return `${idx.length} ${side === 'party' ? 'heroes' : 'enemies'}`;
    const i = idx[0] ?? 0;
    const f = fighters[i];
    if (side === 'party') {
      const id = (f?.id ?? '') as MemberId;
      return `Party ${i + 1} · ${MEMBERS[id]?.name ?? f?.name ?? ''}`;
    }
    const n = setSize(this.session.setKey);
    return `Enemy ${i + 1} of ${n} · ${f?.name ?? ''}`;
  }

  /** The foot anchor of the sprite standing in a slot: measured (grey) or corrected (white), with a revert arrow and 1 px nudges. */
  private anchorGroup(side: 'party' | 'enemy', index: number): HTMLElement {
    const session = this.session;
    const fighter = (): { axisKey: string; measured: { foot: { x: number; y: number } } } | undefined => this.host.scene().fighters.filter((f) => f.side === side)[index];
    const key = (): string => fighter()?.axisKey ?? '';
    const field = (axis: 'x' | 'y', label: string, help: string): HTMLElement => {
      const box = h('input', { type: 'number', min: -16, max: 16, step: 1, class: 'num', 'aria-label': `Foot anchor ${axis}` });
      const revert = h('button', { type: 'button', class: 'rev', 'aria-label': `Revert foot anchor ${axis}`, title: 'Back to the measured foot', onclick: () => this.setShift(axis, 0) }, '↶');
      box.addEventListener('change', () => this.setShift(axis, Number(box.value)));
      const row = h('div', { class: 'field' }, this.labelOf(label, `axes.${axis}`, help), h('span', { class: 'ro measured' }), box, revert);
      this.updaters.push(() => {
        const sh = session.data.axes[key()] ?? { x: 0, y: 0 };
        const f = fighter();
        box.value = String(sh[axis]);
        const measured = f?.measured.foot[axis] ?? 0;
        const ro = row.querySelector('.measured');
        if (ro) ro.textContent = `measured ${measured}`;
        revert.hidden = sh[axis] === 0;
        row.classList.toggle('moved', sh[axis] !== 0);
      });
      return row;
    };
    const pad = h(
      'div',
      { class: 'pad' },
      this.button('↑', () => this.nudgeShift(0, -1), 'Move the foot point up 1 px (the figure sinks 1 px)'),
      this.button('←', () => this.nudgeShift(-1, 0), 'Move the foot point left 1 px (the figure moves right)'),
      this.button('↓', () => this.nudgeShift(0, 1), 'Move the foot point down 1 px (the figure rises 1 px)'),
      this.button('→', () => this.nudgeShift(1, 0), 'Move the foot point right 1 px (the figure moves left)'),
    );
    return this.groupTip(
      'Foot anchor',
      true,
      'The spot on the picture that touches the floor. If a fighter floats or sinks a little, nudge it here. Turn on “Anchors” in the top bar to see the spot on the stage.',
      field('x', 'Across', 'Moves the touching spot left or right inside the picture. The fighter slides the other way.'),
      field('y', 'Down', 'Moves the touching spot up or down inside the picture. The fighter moves the other way.'),
      pad,
    );
  }

  private anchorForm(item: Extract<Item, { kind: 'anchor' }>): void {
    this.root.append(this.checks(), this.anchorGroup(item.side, item.index));
  }

  /** The sprite whose foot anchor is being edited: the one in the selected slot. */
  private anchorTarget(): { key: string } | null {
    const it = this.session.selection[0];
    if (!it || (it.kind !== 'fighter' && it.kind !== 'anchor')) return null;
    const f = this.host.scene().fighters.filter((x) => x.side === it.side)[it.index];
    return f ? { key: f.axisKey } : null;
  }

  private setShift(axis: 'x' | 'y', value: number): void {
    const t = this.anchorTarget();
    if (!t) return;
    this.session.edit(`Foot anchor of ${t.key}`, (d) => {
      const cur = d.axes[t.key] ?? { x: 0, y: 0 };
      d.axes[t.key] = { ...cur, [axis]: Math.max(-16, Math.min(16, Math.round(value))) };
    });
  }

  /** Move the foot anchor of the selected sprite by whole pixels (the crosshair's arrow keys and buttons). */
  nudgeShift(dx: number, dy: number): void {
    const t = this.anchorTarget();
    if (!t) return;
    this.session.edit(`Foot anchor of ${t.key}`, (d) => {
      const cur = d.axes[t.key] ?? { x: 0, y: 0 };
      d.axes[t.key] = { x: Math.max(-16, Math.min(16, cur.x + dx)), y: Math.max(-16, Math.min(16, cur.y + dy)) };
    });
  }
}

/** Every value equal -> that value, else null ("mixed"). */
function same<T>(values: T[]): T | null {
  const first = values[0];
  return first !== undefined && values.every((v) => v === first) ? first : null;
}

export function setLabel(key: string): string {
  if (key === 'boss') return 'Boss alone';
  if (key.startsWith('boss+')) return `Boss + ${key.slice(5)}`;
  return `${key} enem${key === '1' ? 'y' : 'ies'}`;
}

