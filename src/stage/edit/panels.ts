/**
 * The Battle Stage Editor's side panels and status line (Phaser spike `spike/phaser-stage`): the stage list, the
 * "who's standing here" palette, the JSON pane and the status bar. Each is a small class that draws from the
 * session and calls back into the page for anything that changes data, so none of them owns a copy of the truth.
 */
import { ENEMIES } from '../../data/enemies';
import { MEMBERS } from '../../data/party';
import type { MemberId } from '../../game/state';
import { formatJson } from '../../tools/jsonfmt';
import { changedLines } from '../../tools/linediff';
import { SET_KEYS } from '../config';
import { h } from './dom';
import { formatHud } from './save';
import type { Item, Session } from './session';
import type { ViewState } from './view';
import type { StageScene } from '../stagescene';

// ------------------------------------------------------------------ the stage list

export interface ListActions {
  onPick: (id: string) => void;
  onNew: () => void;
  onDuplicate: () => void;
  onChangeId: () => void;
  onDelete: () => void;
}

/** The left-hand list of stages, with a search box and New / Duplicate / Change id / Delete (`docs/TOOLING-UI.md` 2.4). The stage's name is edited in the inspector, the only place for it. */
export class StageList {
  private filter = '';

  constructor(
    private readonly session: Session,
    private readonly ul: HTMLElement,
    find: HTMLInputElement,
    actions: ListActions,
    buttons: { new: HTMLElement; dup: HTMLElement; ren: HTMLElement; del: HTMLElement },
  ) {
    find.addEventListener('input', () => {
      this.filter = find.value.trim().toLowerCase();
      this.render();
    });
    this.ul.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest('li');
      if (li?.dataset.id) actions.onPick(li.dataset.id);
    });
    buttons.new.addEventListener('click', actions.onNew);
    buttons.dup.addEventListener('click', actions.onDuplicate);
    buttons.ren.addEventListener('click', actions.onChangeId);
    buttons.del.addEventListener('click', actions.onDelete);
  }

  render(): void {
    const { stages } = this.session.data;
    const items = Object.values(stages).filter((s) => !this.filter || s.id.includes(this.filter) || s.name.toLowerCase().includes(this.filter));
    this.ul.replaceChildren(
      ...items.map((s) => h('li', { 'data-id': s.id, class: s.id === this.session.stageId ? 'on' : '', title: s.note ?? '' }, h('span', {}, s.name), h('code', {}, s.id))),
    );
    if (!items.length) this.ul.append(h('li', { style: { cursor: 'default' } }, h('span', { class: 'hint' }, 'No stage matches')));
  }
}

// ------------------------------------------------------------------ who's standing here

/**
 * The explorer panel, "Who's standing here": the four heroes and every enemy. A plain click on a row SELECTS the slot
 * (or slots) that fighter stands in on the stage, for a hero and for an enemy alike; Shift+click or Ctrl+click ADDS the
 * row to the selection (or takes it out if it is already in), the way Figma's layers do, so "align to each other"
 * works from the panel as well as from the stage. An enemy that is not standing on this stage has no slot to select, and
 * the status line says so.
 *
 * Choosing which enemy TYPE stands in a slot is a separate, explicit act so it can never be mixed up with selecting:
 * the small "+" button on an enemy's row puts that enemy in the selected slot (or in E1 when no enemy slot is
 * selected), and dragging the row onto a slot on the stage does the same for that slot. It is a preview only.
 */
export class Palette {
  constructor(
    private readonly session: Session,
    private readonly scene: () => StageScene,
    private readonly heroes: HTMLElement,
    private readonly enemies: HTMLElement,
    private readonly actions: { select: (items: Item[], additive: boolean) => void; apply: (enemy: string) => void; say: (text: string) => void },
  ) {
    enemies.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const li = target.closest('li');
      if (!li?.dataset.key) return;
      const name = ENEMIES[li.dataset.key]?.name ?? li.dataset.key;
      // The "+" button: put this enemy type in the selected slot. It never changes the selection.
      if (target.closest('.pal-add')) {
        this.actions.apply(li.dataset.key);
        return;
      }
      // A click selects the slot(s) this enemy stands in on the stage; Shift/Ctrl+click adds them (or takes them out).
      const slots = this.scene().enemies.flatMap((key, index) => (key === li.dataset.key ? [{ kind: 'fighter', side: 'enemy', index } as Item] : []));
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!slots.length) {
        this.actions.say(`${name} is not standing on this stage${additive ? ', so there is no slot to add to the selection' : ', so there is no slot to select'}. Press the “+” on its row to put it in the selected slot.`);
        return;
      }
      this.actions.select(slots, additive);
    });
    enemies.addEventListener('dragstart', (e) => {
      const li = (e.target as HTMLElement).closest('li');
      if (!li?.dataset.key || !e.dataTransfer) return;
      e.dataTransfer.setData('text/plain', li.dataset.key);
      e.dataTransfer.effectAllowed = 'copy';
    });
    heroes.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest('li');
      if (li?.dataset.index) this.actions.select([{ kind: 'fighter', side: 'party', index: Number(li.dataset.index) }], e.shiftKey || e.ctrlKey || e.metaKey);
    });
  }

  render(): void {
    const sc = this.scene();
    const party = sc.fighters.filter((f) => f.side === 'party');
    const sel = new Set(this.session.selectedFighters('party'));
    this.heroes.replaceChildren(
      ...party.map((f, i) =>
        h('li', { 'data-index': String(i), class: sel.has(i) ? 'on' : '' }, h('span', { class: 'dot', style: { background: '#ffa24a' } }), h('span', {}, MEMBERS[f.id as MemberId]?.name ?? f.name), h('small', {}, `P${i + 1}`)),
      ),
    );
    this.renderEnemies();
  }

  private renderEnemies(): void {
    const standing = new Set(this.scene().enemies);
    // The enemies whose slot is selected on the stage get an orange outline here too.
    const selected = new Set(this.session.selectedFighters('enemy').flatMap((i) => this.scene().enemies[i] ?? []));
    this.enemies.replaceChildren(
      ...Object.values(ENEMIES).map((e) =>
        h(
          'li',
          { 'data-key': e.id, draggable: 'true', class: selected.has(e.id) ? 'sel' : '', title: standing.has(e.id) ? 'Standing on the stage now. Click selects its slot. Shift+click or Ctrl+click adds its slot to the selection. Drag it onto a slot to preview it there.' : 'Not standing on this stage. Drag it onto a slot, or press + to put it in the selected slot.' },
          h('span', { class: 'dot', style: { background: e.boss ? '#ffd35a' : '#ff6ad5' } }),
          h('span', {}, e.name),
          h('small', {}, standing.has(e.id) ? 'here' : e.boss ? 'boss' : ''),
          h('button', { type: 'button', class: 'pal-add', title: `Put ${e.name} in the selected enemy slot (E1 if none is selected). A preview only. You can also drag this row onto a slot on the stage.`, 'aria-label': `Put ${e.name} in the selected enemy slot` }, '+'),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ JSON pane

/**
 * A read-only view of the stage as it will be saved, with the lines the last gesture changed highlighted
 * (`docs/TOOLING-UI.md` 3.4 "Text view"): so Mark can see exactly what a drag did. During a drag it follows live.
 */
export class JsonPane {
  private lastText = '';
  private lastChanged = '';

  constructor(
    private readonly session: Session,
    private readonly view: ViewState,
    private readonly pane: HTMLElement,
    private readonly text: HTMLElement,
    private readonly title: HTMLElement,
    private readonly sub: HTMLElement,
  ) {}

  /** Redraw (cheap enough to run on every drag step; does nothing while hidden). */
  render(): void {
    this.pane.hidden = !this.view.jsonOpen;
    if (!this.view.jsonOpen) return;
    const s = this.session;
    const now = formatJson(s.stage);
    const before = s.openGestureText ?? s.change?.before ?? null;
    const changed = before !== null && before !== now ? new Set(changedLines(before, now)) : new Set<number>();
    const hudNow = formatHud(s.data.hud);
    const hudSaved = formatHud(s.savedHud);
    // Enemies whose mirror setting differs from the last save (the facing file is long, so only these entries are shown).
    const mirrorChanged = Object.keys(s.data.facing).filter((k) => JSON.stringify(s.data.facing[k]) !== JSON.stringify(s.saved.facing[k]));
    // Heroes whose proportions differ from the last save (the heroes file is global, like the HUD and the facing file).
    const heroChanged = Object.keys(s.data.heroes).filter((k) => JSON.stringify(s.data.heroes[k]) !== JSON.stringify(s.saved.heroes[k]));
    const key = `${now.length}:${[...changed].join(',')}:${JSON.stringify(s.data.axes)}:${JSON.stringify(s.saved.axes)}:${hudNow === hudSaved ? '' : hudNow}:${mirrorChanged.map((k) => `${k}=${s.data.facing[k]?.mirror}`).join(',')}:${heroChanged.map((k) => `${k}=${JSON.stringify(s.data.heroes[k])}`).join(',')}`;
    if (key === this.lastChanged && now === this.lastText) return;
    this.lastText = now;
    this.lastChanged = key;
    this.title.textContent = `src/data/stages.json › ${s.stageId}`;
    const lines = now.replace(/\n$/, '').split('\n');
    const nodes = lines.map((l, i) => h('span', { class: changed.has(i) ? 'ln chg' : 'ln' }, l || ' '));
    const axes = Object.entries(s.data.axes).filter(([, v]) => v.x !== 0 || v.y !== 0);
    if (axes.length) {
      nodes.push(h('span', { class: 'ln', style: { color: '#9b96ad', marginTop: '8px' } }, '// src/data/axes.json'));
      const axText = formatJson(Object.fromEntries(axes)).replace(/\n$/, '');
      // Only the lines that differ from the last save are lit: a correction saved earlier is shown, but not as a change.
      const savedAx = formatJson(Object.fromEntries(Object.entries(s.saved.axes).filter(([, v]) => v.x !== 0 || v.y !== 0))).replace(/\n$/, '');
      const litAx = new Set(changedLines(savedAx, axText));
      for (const [i, l] of axText.split('\n').entries()) nodes.push(h('span', { class: litAx.has(i) ? 'ln chg' : 'ln' }, l));
    }
    // The all-battles HUD is its own file: show it, with the lines changed since the last save lit, only while it differs.
    let hudChanged = 0;
    if (hudNow !== hudSaved) {
      const lit = new Set(changedLines(hudSaved, hudNow));
      hudChanged = lit.size;
      nodes.push(h('span', { class: 'ln', style: { color: '#9b96ad', marginTop: '8px' } }, '// src/data/hud.json (the HUD for every battle)'));
      const hudLines = hudNow.replace(/\n$/, '').split('\n');
      for (const [i, l] of hudLines.entries()) nodes.push(h('span', { class: lit.has(i) ? 'ln chg' : 'ln' }, l || ' '));
    }
    // Which enemies are mirrored is its own file too: show the entries that changed, lit, while they differ from the last save.
    let facingChanged = 0;
    if (mirrorChanged.length) {
      nodes.push(h('span', { class: 'ln', style: { color: '#9b96ad', marginTop: '8px' } }, '// src/data/enemyfacing.json (which enemies are mirrored, for every battle)'));
      for (const k of mirrorChanged) {
        const entry = s.data.facing[k];
        if (!entry) continue;
        const before = s.saved.facing[k];
        const lit = new Set(before ? changedLines(formatJson({ [k]: before }), formatJson({ [k]: entry })) : []);
        const text = formatJson({ [k]: entry }).replace(/\n$/, '');
        for (const [i, l] of text.split('\n').entries()) nodes.push(h('span', { class: lit.has(i) || !before ? 'ln chg' : 'ln' }, l || ' '));
        facingChanged += lit.size;
      }
    }
    // How tall and broad each hero stands is a global file too: show the heroes that changed, lit.
    let heroesChanged = 0;
    if (heroChanged.length) {
      nodes.push(h('span', { class: 'ln', style: { color: '#9b96ad', marginTop: '8px' } }, '// src/data/heroes.json (how tall and broad each hero stands, for every battle)'));
      for (const k of heroChanged) {
        const entry = s.data.heroes[k];
        if (!entry) continue;
        const before = s.saved.heroes[k];
        const lit = new Set(before ? changedLines(formatJson({ [k]: before }), formatJson({ [k]: entry })) : []);
        const text = formatJson({ [k]: entry }).replace(/\n$/, '');
        for (const [i, l] of text.split('\n').entries()) nodes.push(h('span', { class: lit.has(i) || !before ? 'ln chg' : 'ln' }, l || ' '));
        heroesChanged += lit.size;
      }
    }
    this.text.replaceChildren(...nodes);
    const total = changed.size + hudChanged + facingChanged + heroesChanged;
    this.sub.textContent = total ? `${total} line${total === 1 ? '' : 's'} changed${s.change?.label ? ` · ${s.change.label}` : ''}` : s.change?.label ? `Last change: ${s.change.label}` : 'Nothing changed yet. Drag something and the lines it changes light up here.';
    const first = this.text.querySelector<HTMLElement>('.ln.chg');
    if (first) {
      const top = first.offsetTop - this.text.clientHeight / 3;
      this.text.scrollTop = Math.max(0, top);
    }
  }
}

// ------------------------------------------------------------------ status line

/** The bottom line: the pointer in game pixels and what is under it, what is selected, whether there are unsaved changes, and the last message. */
export class StatusBar {
  private message = '';

  constructor(
    private readonly session: Session,
    private readonly pos: HTMLElement,
    private readonly sel: HTMLElement,
    private readonly save: HTMLElement,
    private readonly msg: HTMLElement,
  ) {}

  say(text: string, kind: '' | 'bad' | 'good' = ''): void {
    this.message = text;
    this.msg.textContent = text;
    this.msg.className = `msg ${kind}`;
  }

  get last(): string {
    return this.message;
  }

  pointer(p: { x: number; y: number } | null, under: string): void {
    this.pos.textContent = p ? `x ${Math.round(p.x)}  y ${Math.round(p.y)}${under ? `  ·  ${under}` : ''}` : 'x –  y –';
  }

  update(describe: (it: Item) => string): void {
    const n = this.session.selection.length;
    const first = this.session.selection[0];
    this.sel.textContent = n === 0 ? 'Nothing selected' : n === 1 && first ? describe(first) : `${n} selected`;
    const dirty = this.session.dirty;
    this.save.textContent = dirty ? `Unsaved changes (${this.session.changeCount})` : 'Saved';
    this.save.className = dirty ? 'unsaved' : '';
  }
}

/** The segmented buttons for the enemy group ("1" to "6", "B", "B+1", "B+2"). */
export function setButtons(seg: HTMLElement, onPick: (key: string) => void): void {
  seg.replaceChildren(
    ...SET_KEYS.map((k) => h('button', { type: 'button', 'data-set': k, title: k.startsWith('boss') ? `A boss${k === 'boss' ? ' alone' : ` with ${k.slice(5)} helper${k === 'boss+1' ? '' : 's'}`}` : `${k} enem${k === '1' ? 'y' : 'ies'}`, onclick: () => onPick(k) }, k === 'boss' ? 'B' : k.startsWith('boss+') ? `B+${k.slice(5)}` : k)),
  );
}
