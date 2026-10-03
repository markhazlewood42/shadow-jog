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
  onRename: () => void;
  onDelete: () => void;
}

/** The left-hand list of stages, with a search box and New / Duplicate / Rename / Delete (`docs/TOOLING-UI.md` 2.4). */
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
    buttons.ren.addEventListener('click', actions.onRename);
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
 * The explorer panel, "Who's standing here": the four heroes (click selects the slot they stand in) and every enemy
 * (double-click or drag to preview one in a slot). It fills the height of the left sidebar and scrolls inside itself,
 * the way a design tool's layers panel does.
 */
export class Palette {
  constructor(
    private readonly session: Session,
    private readonly view: ViewState,
    private readonly scene: () => StageScene,
    private readonly heroes: HTMLElement,
    private readonly enemies: HTMLElement,
    private readonly actions: { select: (item: Item) => void; apply: (enemy: string) => void },
  ) {
    enemies.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest('li');
      if (!li?.dataset.key) return;
      this.view.paletteEnemy = li.dataset.key;
      this.renderEnemies();
    });
    enemies.addEventListener('dblclick', (e) => {
      const li = (e.target as HTMLElement).closest('li');
      if (li?.dataset.key) this.actions.apply(li.dataset.key);
    });
    enemies.addEventListener('dragstart', (e) => {
      const li = (e.target as HTMLElement).closest('li');
      if (!li?.dataset.key || !e.dataTransfer) return;
      e.dataTransfer.setData('text/plain', li.dataset.key);
      e.dataTransfer.effectAllowed = 'copy';
    });
    heroes.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest('li');
      if (li?.dataset.index) this.actions.select({ kind: 'fighter', side: 'party', index: Number(li.dataset.index) });
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
    this.enemies.replaceChildren(
      ...Object.values(ENEMIES).map((e) =>
        h('li', { 'data-key': e.id, draggable: 'true', class: this.view.paletteEnemy === e.id ? 'on' : '', title: standing.has(e.id) ? 'Standing on the stage now' : '' }, h('span', { class: 'dot', style: { background: e.boss ? '#ffd35a' : '#ff6ad5' } }), h('span', {}, e.name), h('small', {}, standing.has(e.id) ? 'here' : e.boss ? 'boss' : '')),
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
    const key = `${now.length}:${[...changed].join(',')}:${JSON.stringify(s.data.axes)}:${JSON.stringify(s.saved.axes)}:${hudNow === hudSaved ? '' : hudNow}`;
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
    this.text.replaceChildren(...nodes);
    const total = changed.size + hudChanged;
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
