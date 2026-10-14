/**
 * Dialogue text for the story scripts (M8a, decision 3 of docs/engine/m8-brief.md; the shape is in docs/engine/m8a-data-format.md).
 *
 * The words of a conversation are data: `dialogue.json` holds one record per box, keyed by a dotted id such as `rustyard.mags.fork`.
 * Whether and when a box plays stays in the script (`story/chapter1.ts`): `await s.line('rustyard.mags.kept_kit')` or
 * `const pick = await s.choose('rustyard.mags.fork')`. A record holds no logic. Text that needs a live value has a named slot,
 * such as `{unlocked}`, which the script fills: `s.line('hexden.tuned', { unlocked: names })`.
 *
 * This file is the typed loader, like `enemies.ts`. `checkDialogue` lists every problem in plain words (file, id, field), `parseDialogue`
 * and `loadDialogue` throw with that list, and `saveDialogue` writes the file back with a fixed field order, one box per line.
 * `loadDialogue` replaces the live table in place, so a tool or Vite's hot update can change a line in a running game: a box reads its
 * record when it opens, so the next box shows the edit and a box already on screen does not change.
 */
import { isInt, isObj, isText, tableJson, unknownFields } from './contentjson';
import dialogueJson from './dialogue.json' with { type: 'json' };
import { SPEAKERS } from './speakers';

/** One dialogue box. `who` is a speaker id from `speakers.json`, a free name listed in the file's `names`, or null for narration. */
export interface LineDef {
  who: string | null;
  text: string;
  /** Portrait expression (see `FACES`). Only a speaker with a portrait shows one. */
  face?: string;
  /** Put the box at the top of the screen. */
  top?: boolean;
  /** Close by itself after this many frames (cutscene narration). */
  auto?: number;
  /** The options of a question. A line with choices is played with `choose`. */
  choices?: string[];
  /** The choice index that a cancel press returns (default: cancel is ignored). */
  cancel?: number;
}

/** The live values a script gives a line: each `{name}` in the text is replaced by the slot of that name. */
export type LineSlots = Record<string, string | number>;

export interface LoadedDialogue {
  /** Speaker names that are not in `speakers.json` (a thug the story names once), shown in the default color. */
  names: string[];
  lines: Record<string, LineDef>;
}

const FILE = 'dialogue.json';
const FIELDS = ['who', 'face', 'top', 'auto', 'text', 'choices', 'cancel'] as const;
/** A line id: lower-case words joined by dots, at least two (`scene.something`). */
const ID = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
/** A slot: a name of two or more lower-case characters. Text markup is one letter (`{y}`), `{/}` or `{#rrggbb}`, so the two cannot be mixed up. */
const SLOT = /\{([a-z][a-z0-9_]+)\}/g;
/** The portrait expressions (the same list as `FACES` in `art/portraits.ts`; `tests/dialogue-data.test.ts` keeps them equal). */
export const DIALOGUE_FACES: readonly string[] = ['neutral', 'happy', 'angry', 'sad', 'surprised', 'smirk', 'hurt'];
/** The text color codes of `sje/display/font.ts` (`COLOR_CODES`), and the pause code. */
const COLOR_TAGS = ['w', 'y', 'c', 'm', 'r', 'g', 'd', 'o', 'v'];

/** The slot names in a piece of text, in order of appearance, once each. */
export function slotsIn(text: string): string[] {
  return [...new Set([...text.matchAll(SLOT)].map((m) => m[1] ?? ''))];
}

/** The slot names a line uses (in its text and its choices). */
export function slotsOf(def: Pick<LineDef, 'text' | 'choices'>): string[] {
  return [...new Set([def.text, ...(def.choices ?? [])].flatMap(slotsIn))];
}

/** The problems in the text markup of one piece of text: a code that does not exist, or a color left on at the end. */
function markupProblems(text: string): string[] {
  const out: string[] = [];
  let on: string | null = null;
  for (const m of text.matchAll(/\{([^}]*)\}/g)) {
    const tag = m[1] ?? '';
    if (tag === '/') on = null;
    else if (COLOR_TAGS.includes(tag) || /^#[0-9a-fA-F]{6}$/.test(tag)) on = tag;
    else if (tag !== 'p' && !/^[a-z][a-z0-9_]+$/.test(tag)) out.push(`has the text code {${tag}}, which does not exist`);
  }
  if (on) out.push(`leaves {${on}} open: put {/} after the colored words`);
  return out;
}

/** Everything wrong with a candidate dialogue file (empty when it is good to play), one problem per line, each with the file, the line id and the field. */
export function checkDialogue(data: unknown, speakerIds: readonly string[]): string[] {
  if (!isObj(data) || !isObj(data.lines)) return [`${FILE}: the file needs a "lines" object, one record per dialogue box`];
  const out: string[] = [];
  for (const k of unknownFields(data, ['names', 'lines'])) out.push(`${FILE}: "${k}" is not a field of the file`);
  const names: string[] = [];
  if (data.names !== undefined) {
    if (!Array.isArray(data.names)) out.push(`${FILE}: names must be a list of speaker names`);
    else
      data.names.forEach((n: unknown, i) => {
        if (!isText(n)) out.push(`${FILE}: names[${i}] must be text`);
        else if (speakerIds.includes(n)) out.push(`${FILE}: names[${i}] "${n}" is also a speaker id (use it as who, without listing it)`);
        else if (names.includes(n)) out.push(`${FILE}: names[${i}] "${n}" is listed twice`);
        else names.push(n);
      });
  }
  const entries = Object.entries(data.lines);
  if (!entries.length) out.push(`${FILE}: the file has no line`);
  for (const [id, r] of entries) {
    if (!ID.test(id)) out.push(`${FILE}: ${id}: a line id is lower-case words joined by dots, like rustyard.mags.fork`);
    if (!isObj(r)) {
      out.push(`${FILE}: ${id}: must be an object`);
      continue;
    }
    for (const k of unknownFields(r, FIELDS)) out.push(`${FILE}: ${id}.${k} is not a field of a line`);
    const known = typeof r.who === 'string' && speakerIds.includes(r.who);
    if (r.who === undefined) out.push(`${FILE}: ${id}.who is missing (a speaker id, a name from "names", or null for narration)`);
    else if (r.who !== null && !(typeof r.who === 'string' && (known || names.includes(r.who))))
      out.push(`${FILE}: ${id}.who is ${JSON.stringify(r.who)}, which is no speaker (add it to speakers.json, or to "names" for a one-off name)`);
    if (!isText(r.text)) out.push(`${FILE}: ${id}.text must be text`);
    else for (const p of markupProblems(r.text)) out.push(`${FILE}: ${id}.text ${p}`);
    if (r.face !== undefined) {
      if (typeof r.face !== 'string' || !DIALOGUE_FACES.includes(r.face)) out.push(`${FILE}: ${id}.face must be one of ${DIALOGUE_FACES.join(', ')}`);
      else if (!known) out.push(`${FILE}: ${id}.face has no effect: only a speaker from speakers.json shows a portrait`);
    }
    if (r.top !== undefined && typeof r.top !== 'boolean') out.push(`${FILE}: ${id}.top must be true or false`);
    if (r.auto !== undefined && (!isInt(r.auto) || r.auto < 1)) out.push(`${FILE}: ${id}.auto must be a whole number of frames, 1 or more`);
    if (r.choices === undefined) {
      if (r.cancel !== undefined) out.push(`${FILE}: ${id}.cancel needs choices`);
    } else if (!Array.isArray(r.choices) || !r.choices.length) out.push(`${FILE}: ${id}.choices must be a list with at least one choice`);
    else {
      r.choices.forEach((c: unknown, i) => {
        if (!isText(c)) out.push(`${FILE}: ${id}.choices[${i}] must be text`);
        else for (const p of markupProblems(c)) out.push(`${FILE}: ${id}.choices[${i}] ${p}`);
      });
      if (r.auto !== undefined) out.push(`${FILE}: ${id}.auto cannot be used with choices (a question waits for the player)`);
      if (r.cancel !== undefined && (!isInt(r.cancel) || r.cancel < 0 || r.cancel >= r.choices.length))
        out.push(`${FILE}: ${id}.cancel is ${JSON.stringify(r.cancel)}, but there are ${r.choices.length} choices (use 0 to ${r.choices.length - 1})`);
    }
  }
  return out;
}

/** The dialogue file, checked (throws a readable error listing every problem). Pure: it changes nothing live. */
export function parseDialogue(data: unknown, speakerIds: readonly string[] = Object.keys(SPEAKERS)): LoadedDialogue {
  const problems = checkDialogue(data, speakerIds);
  if (problems.length) throw new Error(`${FILE} is not valid:\n - ${problems.join('\n - ')}`);
  const file = data as { names?: string[]; lines: Record<string, LineDef> };
  const lines: Record<string, LineDef> = {};
  for (const [id, r] of Object.entries(file.lines)) {
    const def: LineDef = { who: r.who, text: r.text };
    if (r.face !== undefined) def.face = r.face;
    if (r.top !== undefined) def.top = r.top;
    if (r.auto !== undefined) def.auto = r.auto;
    if (r.choices !== undefined) def.choices = [...r.choices];
    if (r.cancel !== undefined) def.cancel = r.cancel;
    lines[id] = def;
  }
  return { names: [...(file.names ?? [])], lines };
}

/** The text of the file for a loaded table: fields in a fixed order, one box per line, so a diff shows only the boxes that changed. Loading the result gives the same data back. */
export function saveDialogue(d: LoadedDialogue): string {
  const lines: Record<string, unknown> = {};
  for (const [id, l] of Object.entries(d.lines)) {
    lines[id] = {
      who: l.who,
      ...(l.face === undefined ? {} : { face: l.face }),
      ...(l.top === undefined ? {} : { top: l.top }),
      ...(l.auto === undefined ? {} : { auto: l.auto }),
      text: l.text,
      ...(l.choices === undefined ? {} : { choices: l.choices }),
      ...(l.cancel === undefined ? {} : { cancel: l.cancel }),
    };
  }
  return tableJson({ names: d.names }, 'lines', lines);
}

/** The live table. A script's `s.line(id)` reads it when the box opens. */
export const LINES: Record<string, LineDef> = {};
/** The free speaker names the live table allows. */
export const NAMES: string[] = [];

/** Check `data`, then replace the live table with it in place (hot reload). If the data is bad it throws and the live table stays as it was. */
export function loadDialogue(data: unknown): LoadedDialogue {
  const next = parseDialogue(data);
  for (const k of Object.keys(LINES)) delete LINES[k];
  NAMES.length = 0;
  Object.assign(LINES, next.lines);
  NAMES.push(...next.names);
  return { names: NAMES, lines: LINES };
}

loadDialogue(dialogueJson);

/** A box as `DialogScene` is given it: the record with its slots filled. */
export type ResolvedLine = LineDef;

function lineDef(id: string): LineDef {
  const def = LINES[id];
  if (!def) throw new Error(`${FILE}: there is no line "${id}" (a story script asked for it)`);
  return def;
}

/** `text` with each `{name}` replaced by its slot. A slot the line needs but the script did not give, or one the script gave that the line does not use, is an error. */
function fill(text: string, slots: LineSlots, where: string): string {
  return text.replace(SLOT, (_m, name: string) => {
    const v = slots[name];
    if (v === undefined) throw new Error(`${FILE}: ${where} needs the slot {${name}}, but the script did not give it`);
    return String(v);
  });
}

function resolve(id: string, slots: LineSlots | undefined, wantChoices: boolean): ResolvedLine {
  const def = lineDef(id);
  if (wantChoices && !def.choices) throw new Error(`${FILE}: ${id} has no choices, so the script cannot use choose() on it`);
  if (!wantChoices && def.choices) throw new Error(`${FILE}: ${id} has choices, so the script must use choose() on it`);
  const given = slots ?? {};
  for (const name of Object.keys(given)) if (!slotsOf(def).includes(name)) throw new Error(`${FILE}: ${id}: the script gave the slot {${name}}, which the line does not use`);
  const out: ResolvedLine = { ...def, text: fill(def.text, given, `${id}.text`) };
  if (def.choices) out.choices = def.choices.map((c, i) => fill(c, given, `${id}.choices[${i}]`));
  return out;
}

/** The box for `s.line(id, slots)`: a line without choices. */
export function resolveLine(id: string, slots?: LineSlots): ResolvedLine {
  return resolve(id, slots, false);
}

/** The box for `s.choose(id, slots)`: a line with choices. */
export function resolveChoice(id: string, slots?: LineSlots): ResolvedLine {
  return resolve(id, slots, true);
}

// Live updates in dev: an edit of dialogue.json reaches a running game without a reload (like fx.json).
if (import.meta.hot) {
  import.meta.hot.accept('./dialogue.json', (m) => {
    if (m) loadDialogue((m as unknown as { default: unknown }).default);
  });
}
