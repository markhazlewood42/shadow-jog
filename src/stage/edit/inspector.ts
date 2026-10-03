/**
 * The inspector (right-hand panel) of the Battle Stage Editor: a form for whatever is selected, or for the stage
 * itself when nothing is (`docs/TOOLING-UI.md` 3.7), in RPG Maker's Database style: a list of labelled fields.
 *
 * Every field follows the house pattern of the other tools: a plain-language label with the data name beside it in
 * small monospace, a slider paired with a number box for numbers, and a revert arrow that appears when the value
 * differs from where it started: for a HUD box that is the layout PRESET's value (grey text means inherited, white
 * means moved by hand), for everything else the value at the last save. With several fighters selected a field whose
 * values differ shows "mixed" until one value is typed for all of them.
 *
 * How it stays in step with the data: the inspector never keeps its own copy. Each field has a `read` that gets its
 * value from the session's current stage and a `write` that changes it. A slider drag calls `session.live` on every
 * movement and `session.end` on release (one undo step); a number box or a select is one `session.edit`. When the
 * session reports a change the inspector either re-reads every field (`sync`) or, if what is selected changed, builds the form
 * again (`build`).
 */
import { BG_IDS } from '../../art/battlebg';
import { ENEMIES } from '../../data/enemies';
import { MEMBERS } from '../../data/party';
import type { MemberId } from '../../game/state';
import { checkLayout, checkStages, type PartySlot, SET_KEYS, setSize, type StageConfig } from '../config';
import { applyPreset, HUD_PRESETS, HUD_REGION_NAMES, type HudField, type HudRegionKey, hudOverrides, hudValue, PRESET_IDS, type PresetId, presetValue, revertField, revertRegion } from '../hudpresets';
import { STAGE_KNOWN } from '../known';
import { h } from './dom';
import { addRow, alignEnemies, copyFromPrevious, removeRow, setFloorBottom, setHorizon, setHudField, setOrder, setRowY, slotList } from './model';
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
}

/** A value the field could go back to, and where it comes from. */
interface Baseline {
  value: number | string;
  kind: 'preset' | 'saved';
}

interface NumSpec {
  label: string;
  /** The data name, shown small beside the label. */
  name?: string;
  min: number;
  max: number;
  step?: number;
  /** Show a slider as well as the number box. */
  slider?: boolean;
  /** `null` means several selected things disagree ("mixed"). */
  read: (s: StageConfig) => number | null;
  write: (s: StageConfig, v: number) => void;
  baseline?: (s: StageConfig) => Baseline | null;
  /** What the undo step is called. */
  undo: string;
  disabled?: boolean;
  hint?: string;
}

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
    return JSON.stringify([s.stageId, s.setKey, s.selection, st?.rows.length, st?.hud.preset, hudOverrides(st?.hud ?? ({} as never)).length, Object.keys(s.data.stages).length]);
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
    this.sync();
  }

  // ---------------------------------------------------------------- field builders

  private stageNow(): StageConfig {
    return this.session.stage;
  }

  private group(title: string, open: boolean, ...kids: Array<Node | null>): HTMLDetailsElement {
    return h('details', { class: 'grp', ...(open ? { open: true } : {}) }, h('summary', {}, title), ...kids);
  }

  private labelOf(label: string, name?: string, hint?: string): HTMLElement {
    return h('span', { class: 'lab', title: hint ?? '' }, label, name ? h('code', {}, name) : null);
  }

  /** A slider (optional) paired with a number box, and a revert arrow. */
  private num(spec: NumSpec): HTMLElement {
    const session = this.session;
    const step = spec.step ?? 1;
    const box = h('input', { type: 'number', min: spec.min, max: spec.max, step, class: 'num', 'aria-label': spec.label, disabled: !!spec.disabled });
    const range = spec.slider ? h('input', { type: 'range', min: spec.min, max: spec.max, step, class: 'rng', 'aria-label': `${spec.label} slider`, disabled: !!spec.disabled }) : null;
    const revert = h('button', { type: 'button', class: 'rev', title: '', 'aria-label': `Revert ${spec.label}`, onclick: () => this.revertNum(spec) }, '↶');
    const write = (v: number): ((d: { stages: Record<string, StageConfig> }) => void) => (d) => spec.write(d.stages[session.stageId] as StageConfig, v);
    box.addEventListener('change', () => {
      if (box.value === '') return;
      session.edit(spec.undo, write(Number(box.value)));
    });
    if (range) {
      range.addEventListener('input', () => session.live(write(Number(range.value))));
      range.addEventListener('change', () => {
        session.end(spec.undo);
        // Hand the keyboard back to the stage: the arrow keys nudge the selection again, not this slider.
        range.blur();
      });
    }
    this.updaters.push(() => {
      const s = session.data.stages[session.stageId];
      if (!s) return;
      const v = spec.read(s);
      if (v === null) {
        box.value = '';
        box.placeholder = 'mixed';
        if (range) range.value = String(spec.min);
      } else {
        box.value = String(v);
        box.placeholder = '';
        if (range) range.value = String(v);
      }
      const base = spec.baseline ? spec.baseline(s) : this.savedBaseline(spec);
      const differs = base !== null && v !== base.value;
      revert.hidden = !differs;
      revert.title = base ? `Back to ${base.kind === 'preset' ? 'the preset’s' : 'the saved'} value (${base.value})` : '';
      row.classList.toggle('moved', differs);
    });
    const row = h('div', { class: 'field' }, this.labelOf(spec.label, spec.name, spec.hint), range, box, revert);
    return row;
  }

  private savedBaseline(spec: NumSpec): Baseline | null {
    const saved = this.session.savedStage;
    if (!saved) return null;
    try {
      const v = spec.read(saved);
      return v === null ? null : { value: v, kind: 'saved' };
    } catch {
      return null;
    }
  }

  private revertNum(spec: NumSpec): void {
    const s = this.stageNow();
    const base = spec.baseline ? spec.baseline(s) : this.savedBaseline(spec);
    if (!base || typeof base.value !== 'number') return;
    const value = base.value;
    this.session.edit(`Revert ${spec.label}`, (d) => spec.write(d.stages[this.session.stageId] as StageConfig, value));
  }

  private select(label: string, name: string | undefined, options: Array<{ value: string; label: string }>, read: (s: StageConfig) => string | null, write: (s: StageConfig, v: string) => void, undo: string, baseline?: (s: StageConfig) => Baseline | null, onChange?: (value: string) => void): HTMLElement {
    const session = this.session;
    const sel = h('select', { 'aria-label': label }, ...options.map((o) => h('option', { value: o.value }, o.label)));
    const revert = h('button', { type: 'button', class: 'rev', 'aria-label': `Revert ${label}`, onclick: () => {
      const b = baseline?.(this.stageNow());
      if (b) session.edit(`Revert ${label}`, (d) => write(d.stages[session.stageId] as StageConfig, String(b.value)));
    } }, '↶');
    // Most selects are one undo step that writes the value; a few (the preset, the enemy group) do their own thing.
    sel.addEventListener('change', () => {
      if (onChange) onChange(sel.value);
      else session.edit(undo, (d) => write(d.stages[session.stageId] as StageConfig, sel.value));
      sel.blur();
    });
    const row = h('div', { class: 'field' }, this.labelOf(label, name), sel, revert);
    this.updaters.push(() => {
      const s = session.data.stages[session.stageId];
      if (!s) return;
      const v = read(s);
      if (v === null) {
        if (!sel.querySelector('option[value=""]')) sel.prepend(h('option', { value: '' }, 'mixed'));
        sel.value = '';
      } else {
        sel.querySelector('option[value=""]')?.remove();
        sel.value = v;
      }
      const b = baseline?.(s) ?? null;
      const differs = !!b && v !== String(b.value);
      revert.hidden = !differs;
      revert.title = b ? `Back to ${b.kind === 'preset' ? 'the preset’s' : 'the saved'} value (${b.value})` : '';
      row.classList.toggle('moved', differs);
    });
    return row;
  }

  private text(label: string, name: string | undefined, read: (s: StageConfig) => string, write: (s: StageConfig, v: string) => void, undo: string, multiline = false, placeholder = ''): HTMLElement {
    const session = this.session;
    const input = multiline ? h('textarea', { rows: 3, placeholder, 'aria-label': label, spellcheck: 'false' }) : h('input', { type: 'text', placeholder, 'aria-label': label, spellcheck: 'false' });
    input.addEventListener('change', () => session.edit(undo, (d) => write(d.stages[session.stageId] as StageConfig, input.value)));
    this.updaters.push(() => {
      const s = session.data.stages[session.stageId];
      if (s && document.activeElement !== input) input.value = read(s);
    });
    return h('div', { class: multiline ? 'field col' : 'field' }, this.labelOf(label, name), input);
  }

  private readonly(label: string, name: string | undefined, read: (s: StageConfig) => string, hint?: string): HTMLElement {
    const out = h('span', { class: 'ro' });
    this.updaters.push(() => {
      const s = this.session.data.stages[this.session.stageId];
      if (s) out.textContent = read(s);
    });
    return h('div', { class: 'field' }, this.labelOf(label, name, hint), out);
  }

  private button(label: string, onclick: () => void, title = '', klass = ''): HTMLButtonElement {
    return h('button', { type: 'button', class: klass, title, onclick }, label);
  }

  // ---------------------------------------------------------------- the stage (nothing selected, or a ground handle)

  private checks(): HTMLElement {
    const box = h('div', { class: 'checks' });
    this.updaters.push(() => {
      const s = this.session.data.stages[this.session.stageId];
      if (!s) return;
      const problems = checkStages({ [s.id]: s }, BG_IDS, STAGE_KNOWN);
      const warnings = checkLayout(s);
      box.replaceChildren(
        ...problems.map((p) => h('div', { class: 'bad' }, `Will not save: ${p.replace(/^stage "[^"]*" ?/, '')}`)),
        ...warnings.map((w) => h('div', { class: 'warn' }, `Design rule: ${w}`)),
      );
      box.hidden = !problems.length && !warnings.length;
    });
    return box;
  }

  private stageForm(focus: Item | undefined): void {
    const s0 = this.stageNow();
    const setNames = SET_KEYS.map((k) => ({ value: k, label: setLabel(k) }));
    const focusCls = (kind: Item['kind']): string => (focus?.kind === kind ? 'focus' : '');
    const rowsBox = h('div', { class: `rows ${focusCls('row')}` });
    const rowCount = s0.rows.length;
    for (let i = 0; i < rowCount; i++) {
      rowsBox.append(
        this.num({
          label: `Row ${i + 1}${i === 0 ? ' (back)' : i === rowCount - 1 ? ' (front)' : ''}`,
          name: `rows[${i}].y`,
          min: 0,
          max: 270,
          read: (s) => s.rows[i]?.y ?? null,
          write: (s, v) => void setRowY(s, i, v),
          undo: `Move row ${i + 1}`,
        }),
      );
      if (s0.depthTint)
        rowsBox.append(
          this.num({
            label: '  haze',
            name: `depthTint.amounts[${i}]`,
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
            why = addRow(d.stages[this.session.stageId] as StageConfig);
          });
          if (why) this.host.notify(why, true);
        }, 'Add a depth row in front of the others'),
        this.button('Remove front row', () => {
          let why: string | null = null;
          this.session.edit('Remove a row', (d) => {
            const st = d.stages[this.session.stageId] as StageConfig;
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
        this.text('Name', 'name', (s) => s.name, (s, v) => {
            s.name = v.trim() || s.name;
          }, 'Rename the stage'),
        this.readonly('Id', 'id', (s) => s.id, 'Change the id with Rename in the stage list'),
        this.text('Note for Claude', 'note', (s) => s.note ?? '', (s, v) => {
            if (v.trim()) s.note = v;
            else delete s.note;
          }, 'Edit the note', true, 'What do you want from this stage? A later Claude session reads this.'),
      ),
      this.group(
        'Battleback',
        false,
        this.select('Backdrop picture', 'backdrop.id', BG_IDS.map((id) => ({ value: id, label: id })), (s) => s.backdrop.id, (s, v) => {
            s.backdrop.id = v;
          }, 'Change the backdrop picture', () => (this.session.savedStage ? { value: this.session.savedStage.backdrop.id, kind: 'saved' } : null)),
        this.readonly('Mode', 'backdrop.mode', (s) => (s.backdrop.mode === 'reproject' ? 'old picture moved to the horizon' : 'a painted back wall')),
        this.readonly('Foreground', 'backdrop.foreground', (s) => (s.backdrop.foreground ? s.backdrop.foreground.id : 'none (this stage has no foreground layer)')),
        this.readonly('Ambient', 'backdrop.ambient', (s) => s.backdrop.ambient ?? 'none'),
      ),
      h(
        'div',
        { class: `grpwrap ${focusCls('horizon')} ${focusCls('floor')}` },
        this.group(
          'Ground',
          true,
          this.num({
            label: 'Horizon',
            name: 'backdrop.horizonY',
            hint: 'Where the wall meets the floor. Moves the floor top and, on the street, the skyline with it.',
            min: 40,
            max: 160,
            slider: true,
            read: (s) => s.backdrop.horizonY,
            write: (s, v) => void setHorizon(s, v),
            undo: 'Move the horizon',
          }),
          this.readonly('Floor top', 'floor.y0', (s) => String(s.floor.y0), 'Always the horizon'),
          this.num({
            label: 'Floor bottom',
            name: 'floor.y1',
            hint: 'The lowest line anyone may stand on.',
            min: 150,
            max: 270,
            slider: true,
            read: (s) => s.floor.y1,
            write: (s, v) => void setFloorBottom(s, v),
            undo: 'Move the floor bottom',
          }),
        ),
      ),
      this.group('Depth rows', true, rowsBox),
      this.group(
        'Shadows',
        false,
        this.num({ label: 'Width share', name: 'shadow.widthScale', min: 0.1, max: 2, step: 0.05, slider: true, read: (s) => s.shadow.widthScale, write: (s, v) => {
            s.shadow.widthScale = v;
          }, undo: 'Shadow width share' }),
        this.num({ label: 'Smallest', name: 'shadow.minW', min: 2, max: 100, read: (s) => s.shadow.minW, write: (s, v) => {
            s.shadow.minW = v;
          }, undo: 'Shadow smallest width' }),
        this.num({ label: 'Largest', name: 'shadow.maxW', min: 2, max: 100, read: (s) => s.shadow.maxW, write: (s, v) => {
            s.shadow.maxW = v;
          }, undo: 'Shadow largest width' }),
        this.num({ label: 'How flat', name: 'shadow.aspect', hint: 'Width divided by height', min: 1, max: 10, step: 0.5, slider: true, read: (s) => s.shadow.aspect, write: (s, v) => {
            s.shadow.aspect = v;
          }, undo: 'Shadow flatness' }),
        this.num({ label: 'Strength', name: 'shadow.alpha', min: 0, max: 1, step: 0.05, slider: true, read: (s) => s.shadow.alpha, write: (s, v) => {
            s.shadow.alpha = v;
          }, undo: 'Shadow strength' }),
      ),
      this.hudGroup(),
      this.group(
        'Formation',
        true,
        this.select('Enemies shown', 'enemySets', setNames, () => this.session.setKey, () => {}, '', undefined, (v) => this.session.showSet(v)),
        h(
          'div',
          { class: 'btns' },
          this.button('Align', () => this.alignNow(), 'Re-lay this group evenly across the rows (one undo step)'),
          this.button('Copy from n−1', () => this.copyPrevNow(), 'Start this group from the one with one fewer enemy, then add the extra slot'),
          this.button('Reset preview', () => this.host.resetPreview(), 'Put back the stage’s own demo enemies in this group'),
        ),
      ),
    );
  }

  private alignNow(): void {
    const key = this.session.setKey;
    this.session.edit(`Align enemies (${setLabel(key)})`, (d) => alignEnemies(d.stages[this.session.stageId] as StageConfig, key));
    this.host.notify(`Aligned the ${setLabel(key)} group.`);
  }

  private copyPrevNow(): void {
    const key = this.session.setKey;
    let why: string | null = null;
    this.session.edit(`Copy group from n−1 (${setLabel(key)})`, (d) => {
      why = copyFromPrevious(d.stages[this.session.stageId] as StageConfig, key);
    });
    if (why) this.host.notify(why, true);
    else this.host.notify(`Started the ${setLabel(key)} group from the smaller one.`);
  }

  // ---------------------------------------------------------------- HUD

  private hudGroup(): HTMLElement {
    const session = this.session;
    const list = h('div', { class: 'ovr' });
    const about = h('div', { class: 'hint' });
    this.updaters.push(() => {
      const s = session.data.stages[session.stageId];
      if (!s) return;
      about.textContent = HUD_PRESETS[s.hud.preset].about;
      const moved = hudOverrides(s.hud);
      list.replaceChildren(
        moved.length
          ? h('div', { class: 'hint' }, `${moved.length} value${moved.length === 1 ? '' : 's'} moved by hand on this stage (shown in white; the arrow puts one back):`)
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
              onclick: () => session.edit(`Revert ${HUD_REGION_NAMES[o.region]} ${o.field}`, (d) => revertField((d.stages[session.stageId] as StageConfig).hud, o.region, o.field)),
            }, '↶'),
          ),
        ),
        ...(moved.length ? [h('div', { class: 'btns' }, this.button('Clear all moved values', () => this.applyPresetNow(s.hud.preset, true), 'Put every box back to the preset'))] : []),
      );
    });
    const preset = this.select('Layout preset', 'hud.preset', PRESET_IDS.map((id) => ({ value: id, label: HUD_PRESETS[id].name })), (s) => s.hud.preset, () => {}, '', undefined, (v) => this.applyPresetNow(v as PresetId, false));
    return this.group('HUD layout', true, preset, about, list);
  }

  /** Switch the stage's HUD preset (one undo step); boxes moved by hand keep their place unless `clear` is set. */
  applyPresetNow(id: PresetId, clear: boolean): void {
    const session = this.session;
    let kept: HudRegionKey[] = [];
    session.edit(clear ? 'Clear HUD overrides' : `HUD preset: ${HUD_PRESETS[id].name}`, (d) => {
      kept = applyPreset((d.stages[session.stageId] as StageConfig).hud, id, clear);
    });
    if (clear) this.host.notify('Every HUD box is back at the preset’s place.');
    else this.host.notify(kept.length ? `HUD preset: ${HUD_PRESETS[id].name}. Kept ${kept.length} box${kept.length === 1 ? '' : 'es'} you had moved (${kept.map((k) => HUD_REGION_NAMES[k]).join(', ')}).` : `HUD preset: ${HUD_PRESETS[id].name}.`);
  }

  private hudForm(regions: HudRegionKey[]): void {
    const session = this.session;
    const names = regions.map((r) => HUD_REGION_NAMES[r]).join(', ');
    const numField = (field: Exclude<HudField, 'show' | 'opacity'>, label: string, max: number): HTMLElement =>
      this.num({
        label,
        name: field,
        min: 0,
        max,
        slider: false,
        read: (s) => same(regions.map((r) => Number(hudValue(s.hud, r, field)))),
        write: (s, v) => {
          for (const r of regions) setHudField(s, r, field, v);
        },
        baseline: (s) => {
          const vals = regions.map((r) => presetValue(s.hud.preset, r, field));
          return vals.every((v) => v === vals[0]) ? { value: vals[0] as number, kind: 'preset' } : null;
        },
        undo: `HUD ${names} ${field}`,
      });
    this.root.append(
      this.checks(),
      this.group(
        `HUD box: ${names}`,
        true,
        h('div', { class: 'hint' }, 'Drag the box on the stage, or its corners to resize. Values in white are moved by hand; grey ones come from the preset.'),
        numField('x', 'Left', 480),
        numField('y', 'Top', 270),
        numField('w', 'Width', 480),
        numField('h', 'Height', 270),
        this.select(
          'Shows',
          'show',
          [
            { value: 'always', label: 'always' },
            { value: 'input', label: 'while choosing' },
            { value: 'action', label: 'while an action plays' },
            { value: 'never', label: 'never' },
          ],
          (s) => same(regions.map((r) => String(hudValue(s.hud, r, 'show')))),
          (s, v) => {
            for (const r of regions) setHudField(s, r, 'show', v);
          },
          `HUD ${names} show`,
          (s) => {
            const vals = regions.map((r) => presetValue(s.hud.preset, r, 'show'));
            return vals.every((v) => v === vals[0]) ? { value: vals[0] as string, kind: 'preset' } : null;
          },
        ),
        this.num({
          label: 'Opacity',
          name: 'opacity',
          min: 0,
          max: 1,
          step: 0.05,
          slider: true,
          read: (s) => same(regions.map((r) => Number(hudValue(s.hud, r, 'opacity')))),
          write: (s, v) => {
            for (const r of regions) setHudField(s, r, 'opacity', v);
          },
          baseline: (s) => {
            const vals = regions.map((r) => presetValue(s.hud.preset, r, 'opacity'));
            return vals.every((v) => v === vals[0]) ? { value: vals[0] as number, kind: 'preset' } : null;
          },
          undo: `HUD ${names} opacity`,
        }),
        h('div', { class: 'btns' }, this.button('Revert box to preset', () => session.edit(`Revert ${names}`, (d) => {
          for (const r of regions) revertRegion((d.stages[session.stageId] as StageConfig).hud, r);
        }), 'Put every value of this box back to the preset')),
      ),
    );
  }

  // ---------------------------------------------------------------- fighters and their foot anchors

  private slotForm(items: Array<Extract<Item, { kind: 'fighter' }>>): void {
    const session = this.session;
    const side = items[0]?.side ?? 'party';
    const idx = items.map((i) => i.index);
    const rows = this.stageNow().rows.length;
    const slotsOf = (s: StageConfig): PartySlot[] => idx.flatMap((i) => slotList(s, side, session.setKey)[i] ?? []);
    const title = this.slotTitle(side, idx);
    const writeAll = (s: StageConfig, fn: (q: PartySlot) => void): void => slotsOf(s).forEach(fn);
    const rowOptions = Array.from({ length: rows }, (_, i) => ({ value: String(i), label: `${i + 1}${i === 0 ? ' (back)' : i === rows - 1 ? ' (front)' : ''}` }));
    const sx = side === 'party' ? { min: 0, max: 239 } : { min: 240, max: 480 };

    const pieces: Array<Node | null> = [
      this.checks(),
      this.group(
        title,
        true,
        this.select('Row', 'row', rowOptions, (s) => same(slotsOf(s).map((q) => String(q.row))), (s, v) =>
            writeAll(s, (q) => {
              q.row = Number(v);
            }), `Move ${title} to another row`),
        this.num({ label: 'Across', name: 'x', hint: 'Where the feet stand, left to right', ...sx, slider: true, read: (s) => same(slotsOf(s).map((q) => q.x)), write: (s, v) =>
            writeAll(s, (q) => {
              q.x = v;
            }), undo: `Move ${title} sideways` }),
        this.num({ label: 'Nudge from row', name: 'dy', hint: 'A small up-or-down offset from the row line (usually 0)', min: -8, max: 8, read: (s) => same(slotsOf(s).map((q) => q.dy ?? 0)), write: (s, v) =>
            writeAll(s, (q) => {
              if (v === 0) delete q.dy;
              else q.dy = v;
            }), undo: `Nudge ${title}` }),
        this.readonly('Feet at y', undefined, (s) => same(slotsOf(s).map((q) => (s.rows[q.row]?.y ?? 0) + (q.dy ?? 0)))?.toString() ?? 'mixed', 'Worked out from the row; it is not stored'),
        h(
          'div',
          { class: 'field' },
          this.labelOf('Draw order', 'order', 'Who covers whom when two fighters on one row overlap'),
          h(
            'div',
            { class: 'seg' },
            ...([['Auto', 0], ['Forward', 1], ['Back', -1]] as const).map(([label, v]) =>
              h('button', { type: 'button', class: 'segb', 'data-order': String(v), onclick: () => session.edit(`${label === 'Auto' ? 'Automatic' : label} draw order for ${title}`, (d) => {
                  for (const i of idx) setOrder(d.stages[session.stageId] as StageConfig, side, session.setKey, i, v);
                }) }, label),
            ),
          ),
        ),
      ),
    ];
    this.updaters.push(() => {
      const s = session.data.stages[session.stageId];
      if (!s) return;
      const orders = slotsOf(s).map((q) => q.order ?? 0);
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
      this.root.append(this.group('Who is standing here', true, h('div', { class: 'field' }, this.labelOf('Enemy', 'preview'), pick), h('div', { class: 'hint' }, 'A preview choice, kept in this browser. The stage stores places, not people.')));
    }
    if (items.length === 1) {
      const i = idx[0] ?? 0;
      this.root.append(this.anchorGroup(side, i));
    }
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
    const field = (axis: 'x' | 'y', label: string): HTMLElement => {
      const box = h('input', { type: 'number', min: -16, max: 16, step: 1, class: 'num', 'aria-label': `Foot anchor ${axis}` });
      const revert = h('button', { type: 'button', class: 'rev', 'aria-label': `Revert foot anchor ${axis}`, title: 'Back to the measured foot', onclick: () => this.setShift(axis, 0) }, '↶');
      box.addEventListener('change', () => this.setShift(axis, Number(box.value)));
      const row = h('div', { class: 'field' }, this.labelOf(label, `axes.${axis}`), h('span', { class: 'ro measured' }), box, revert);
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
    return this.group('Foot anchor', true, h('div', { class: 'hint' }, 'The crosshair marks the point this sprite stands on. Turn on “Anchors” in the toolbar to see every figure’s.'), field('x', 'Across'), field('y', 'Down'), pad);
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

