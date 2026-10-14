/**
 * Dialogue speakers: display name, name color, voice pitch for text blips, portrait key.
 *
 * The data is `speakers.json` (M8a, decision 3 of docs/engine/m8-brief.md; the shape is in docs/engine/m8a-data-format.md). This file is the
 * typed loader, like `enemies.ts`: `checkSpeakers` lists every problem in plain words, `loadSpeakers` throws with that list, and
 * `SPEAKERS` is the same table the old TypeScript file built (`tests/dialogue-data.test.ts` proves it against a frozen copy).
 * `loadSpeakers` also replaces the live table in place, so a tool or Vite's hot update can change a speaker in a running game.
 */
import { isHex, isNum, isObj, isText, KEY_PATTERN, tableJson, unknownFields } from './contentjson';
import speakersJson from './speakers.json' with { type: 'json' };

export interface Speaker {
  name: string;
  color: string;
  /** Blip pitch multiplier. */
  voice: number;
  portrait?: string;
}

const FILE = 'speakers.json';
const FIELDS = ['name', 'color', 'voice', 'portrait'] as const;

/** Everything wrong with a candidate speakers file (empty when it is good to play), one problem per line, each with the file and the speaker. */
export function checkSpeakers(data: unknown): string[] {
  if (!isObj(data) || !isObj(data.speakers)) return [`${FILE}: the file needs a "speakers" object, one record per speaker`];
  const out: string[] = [];
  for (const k of unknownFields(data, ['speakers'])) out.push(`${FILE}: "${k}" is not a field of the file`);
  const entries = Object.entries(data.speakers);
  if (!entries.length) out.push(`${FILE}: the file has no speaker`);
  for (const [id, r] of entries) {
    if (!KEY_PATTERN.test(id)) out.push(`${FILE}: ${id}: a speaker id is lower-case letters, digits and underscores, and starts with a letter`);
    if (!isObj(r)) {
      out.push(`${FILE}: ${id}: must be an object`);
      continue;
    }
    for (const k of unknownFields(r, FIELDS)) out.push(`${FILE}: ${id}.${k} is not a field of a speaker`);
    if (!isText(r.name)) out.push(`${FILE}: ${id}.name must be text`);
    if (!isHex(r.color)) out.push(`${FILE}: ${id}.color must be a color like #ff8a6a`);
    if (!isNum(r.voice) || r.voice <= 0 || r.voice > 4) out.push(`${FILE}: ${id}.voice must be a number above 0 and at most 4`);
    if (r.portrait !== undefined && !isText(r.portrait)) out.push(`${FILE}: ${id}.portrait must be text`);
  }
  return out;
}

/** The speakers file, checked (throws a readable error listing every problem). Pure: it changes nothing live. */
export function parseSpeakers(data: unknown): Record<string, Speaker> {
  const problems = checkSpeakers(data);
  if (problems.length) throw new Error(`${FILE} is not valid:\n - ${problems.join('\n - ')}`);
  const out: Record<string, Speaker> = {};
  for (const [id, r] of Object.entries((data as { speakers: Record<string, Speaker> }).speakers)) {
    out[id] = r.portrait === undefined ? { name: r.name, color: r.color, voice: r.voice } : { name: r.name, color: r.color, voice: r.voice, portrait: r.portrait };
  }
  return out;
}

/** The text of the file for a table: fields in a fixed order, one speaker per line. Loading the result gives the same table back. */
export function saveSpeakers(speakers: Record<string, Speaker>): string {
  const table: Record<string, unknown> = {};
  for (const [id, s] of Object.entries(speakers)) table[id] = { name: s.name, color: s.color, voice: s.voice, ...(s.portrait === undefined ? {} : { portrait: s.portrait }) };
  return tableJson({}, 'speakers', table);
}

/** The live table. Everything that shows a speaker reads this object, so a reload shows at the next box. */
export const SPEAKERS: Record<string, Speaker> = {};

/** Check `data`, then replace the live table with it in place (hot reload). If the data is bad it throws and the live table stays as it was. */
export function loadSpeakers(data: unknown): Record<string, Speaker> {
  const next = parseSpeakers(data);
  for (const k of Object.keys(SPEAKERS)) delete SPEAKERS[k];
  Object.assign(SPEAKERS, next);
  return SPEAKERS;
}

loadSpeakers(speakersJson);

export function speaker(who: string | null): Speaker | null {
  if (!who) return null;
  return SPEAKERS[who] ?? { name: who, color: '#9fd8ff', voice: 1 };
}

// Live updates in dev: an edit of speakers.json reaches a running game without a reload (like fx.json).
if (import.meta.hot) {
  import.meta.hot.accept('./speakers.json', (m) => {
    if (m) loadSpeakers((m as unknown as { default: unknown }).default);
  });
}

