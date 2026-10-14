/**
 * M8a (decision 3 of docs/engine/m8-brief.md, pass line 10): the shops, the speakers and the chapter 1 dialogue are JSON
 * (`src/data/shops.json`, `speakers.json`, `dialogue.json`) behind typed loaders. The proof that nothing changed is a frozen copy
 * of the old values, taken from the old TypeScript before the move (`tests/fixtures/dialogue/old-shops.json` and `old-lines.json`):
 *   - SHOPS and SPEAKERS deep-equal the frozen shops and speakers;
 *   - the chapter 1 scripts, run in 70 scenarios with a fake ScriptApi (`tests/dialogue-record.ts`, `dialogue-scenarios.ts`), open
 *     the same boxes (speaker, text, face, choices) as the old scripts did, branch by branch, and reach every line in the file.
 * Also here: the round trip (load, save, load), a case for each rule of the checkers, the match between the ids in `chapter1.ts` and the
 * ids in `dialogue.json`, the hot reload, and a control (one changed character makes the comparison fail).
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FACES } from '../src/art/portraits';
import {
  checkDialogue, DIALOGUE_FACES, LINES, loadDialogue, parseDialogue, resolveChoice, resolveLine, saveDialogue, slotsOf,
} from '../src/data/dialogue';
import dialogueJson from '../src/data/dialogue.json';
import { ITEMS } from '../src/data/items';
import { checkShops, loadShops, parseShops, SHOP_NOTES, SHOPS, saveShops } from '../src/data/shops';
import shopsJson from '../src/data/shops.json';
import { checkSpeakers, loadSpeakers, parseSpeakers, saveSpeakers, SPEAKERS, speaker } from '../src/data/speakers';
import speakersJson from '../src/data/speakers.json';
import { record, type LineRec } from './dialogue-record';
import { SCENARIOS } from './dialogue-scenarios';
import oldLines from './fixtures/dialogue/old-lines.json';
import oldShops from './fixtures/dialogue/old-shops.json';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const itemIds = Object.keys(ITEMS);
const speakerIds = Object.keys(speakersJson.speakers);
const fileText = (name: string) => readFileSync(`src/data/${name}.json`, 'utf8');
const resolver = (id: string, slots: Record<string, string | number> | undefined, kind: 'line' | 'choose'): LineRec =>
  (kind === 'line' ? resolveLine(id, slots) : resolveChoice(id, slots)) as LineRec;

/** Run every scenario against the live dialogue table and give back what each one opened, and every id it asked for. */
async function runAll(): Promise<{ boxes: Record<string, LineRec[]>; ids: Set<string> }> {
  const boxes: Record<string, LineRec[]> = {};
  const ids = new Set<string>();
  for (const sc of SCENARIOS) {
    const r = record(sc, resolver);
    await sc.run(r.api);
    boxes[sc.name] = r.lines;
    for (const id of r.ids) ids.add(id);
  }
  return { boxes, ids };
}

describe('shops.json and speakers.json give back the old objects', () => {
  it('SHOPS deep-equals the frozen copy of the old shops.ts objects (9 shops)', () => {
    expect(Object.keys(SHOPS)).toHaveLength(9);
    expect(SHOPS).toEqual(oldShops.shops);
  });

  it('SPEAKERS deep-equals the frozen copy (8 speakers), and speaker() answers as before', () => {
    expect(Object.keys(SPEAKERS)).toHaveLength(8);
    expect(SPEAKERS).toEqual(oldShops.speakers);
    expect(speaker(null)).toBeNull();
    expect(speaker('kit')).toEqual(oldShops.speakers.kit);
    expect(speaker('Rustfang Punk')).toEqual({ name: 'Rustfang Punk', color: '#9fd8ff', voice: 1 });
  });

  it('the design notes (code comments before the move) are not part of ShopDef', () => {
    for (const s of Object.values(SHOPS)) expect(s).not.toHaveProperty('note');
    expect(Object.keys(SHOP_NOTES).sort()).toEqual(['fence', 'km_requisition', 'rustyard']);
  });

  it('CONTROL: one changed price-side field fails the comparison (the test can fail)', () => {
    const bent = copy(shopsJson) as unknown as { shops: Record<string, { items: string[]; discount?: { mult: number } }> };
    bent.shops.noodles!.items = ['medkit'];
    expect(parseShops(bent).shops).not.toEqual(oldShops.shops);
    const bent2 = copy(shopsJson) as unknown as { shops: Record<string, { discount?: { mult: number } }> };
    bent2.shops.rustyard!.discount!.mult = 0.75;
    expect(parseShops(bent2).shops).not.toEqual(oldShops.shops);
    const bent3 = copy(speakersJson) as unknown as { speakers: Record<string, { voice: number }> };
    bent3.speakers.kit!.voice += 0.01;
    expect(parseSpeakers(bent3)).not.toEqual(oldShops.speakers);
  });
});

describe('dialogue.json gives the old boxes (chapter 1, every scenario)', () => {
  it('the frozen run is what it says: 70 scenarios, 309 boxes, all 224 call sites of the old script reached', () => {
    expect(Object.keys(oldLines.scenarios)).toHaveLength(70);
    expect(Object.values(oldLines.scenarios).flat()).toHaveLength(309);
    expect(oldLines.sites).toBe(224);
    expect(SCENARIOS.map((s) => s.name)).toEqual(Object.keys(oldLines.scenarios));
  });

  it('every box of every scenario equals the old one: same speaker, text, face, choices, cancel', async () => {
    const { boxes } = await runAll();
    for (const [name, old] of Object.entries(oldLines.scenarios)) expect(boxes[name], name).toEqual(old);
    console.info(`dialogue-data: ${Object.values(boxes).flat().length} boxes in ${Object.keys(boxes).length} scenarios equal the frozen ones; ${Object.keys(SHOPS).length} shops, ${Object.keys(SPEAKERS).length} speakers, ${Object.keys(LINES).length} lines in the file`);
  });

  it('the scenarios reach every line of the file (so the comparison above leaves no line unchecked)', async () => {
    const { ids } = await runAll();
    expect([...Object.keys(LINES)].filter((id) => !ids.has(id))).toEqual([]);
  });

  it('CONTROL: one character changed in one line makes the comparison fail (the test can fail)', async () => {
    const bent = copy(dialogueJson) as unknown as { lines: Record<string, { text: string }> };
    bent.lines['rustyard.mags.fork']!.text = bent.lines['rustyard.mags.fork']!.text.replace('150', '151');
    try {
      loadDialogue(bent);
      const { boxes } = await runAll();
      const wrong = Object.entries(oldLines.scenarios).filter(([name, old]) => JSON.stringify(boxes[name]) !== JSON.stringify(old)).map(([name]) => name);
      expect(wrong.length).toBeGreaterThan(0);
      expect(wrong).toContain('mags_take');
    } finally {
      loadDialogue(dialogueJson);
    }
    const { boxes } = await runAll();
    expect(boxes.mags_take).toEqual(oldLines.scenarios.mags_take);
  });
});

/** The calls `s.line(...)` and `s.choose(...)` in a source text (comments dropped): the ids named in the first argument, and the slot names of the second. */
function scriptCalls(src: string): { kind: string; ids: string[]; slots: string[]; at: number }[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out: { kind: string; ids: string[]; slots: string[]; at: number }[] = [];
  for (const m of code.matchAll(/\bs\.(line|choose)\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const args: string[] = [];
    let depth = 0;
    let start = open + 1;
    for (let i = open; i < code.length; i++) {
      const c = code[i]!;
      if (c === "'" || c === '"' || c === '`') {
        for (i++; i < code.length && code[i] !== c; i++) if (code[i] === '\\') i++;
      } else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) {
        depth--;
        if (depth === 0) {
          args.push(code.slice(start, i));
          break;
        }
      } else if (c === ',' && depth === 1) {
        args.push(code.slice(start, i));
        start = i + 1;
      }
    }
    const first = args[0] ?? '';
    const ids = [...first.matchAll(/'([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)'/g)].map((x) => x[1] ?? '');
    const obj = (args[1] ?? '').trim();
    const slots: string[] = [];
    if (obj.startsWith('{')) {
      let d = 0;
      let st = 1;
      const parts: string[] = [];
      for (let i = 0; i < obj.length; i++) {
        const c = obj[i]!;
        if ('([{'.includes(c)) d++;
        else if (')]}'.includes(c)) {
          d--;
          if (d === 0) {
            parts.push(obj.slice(st, i));
            break;
          }
        } else if (c === ',' && d === 1) {
          parts.push(obj.slice(st, i));
          st = i + 1;
        }
      }
      for (const p of parts) {
        const key = /^\s*(\w+)\s*(?::|$)/.exec(p);
        if (key?.[1]) slots.push(key[1]);
      }
    }
    out.push({ kind: m[1] ?? '', ids, slots, at: code.slice(0, open).split('\n').length });
  }
  return out;
}

describe('chapter1.ts and dialogue.json name the same lines', () => {
  const calls = scriptCalls(readFileSync('src/story/chapter1.ts', 'utf8'));
  const used = new Set(calls.flatMap((c) => c.ids));

  it('finds the calls (a scan that reads nothing proves nothing): 211 plain, 12 with a live value or a branch', () => {
    expect(calls.length).toBeGreaterThanOrEqual(220);
    expect(used.size).toBe(Object.keys(LINES).length);
  });

  it('every id the script uses is in the file (none missing)', () => {
    expect([...used].filter((id) => !(id in LINES))).toEqual([]);
  });

  it('every id in the file is used by the script (none orphaned)', () => {
    expect(Object.keys(LINES).filter((id) => !used.has(id))).toEqual([]);
  });

  it('a question is played with choose and a statement with line; a call gives exactly the slots its text needs', () => {
    const wrong: string[] = [];
    for (const c of calls) {
      for (const id of c.ids) {
        const def = LINES[id];
        if (!def) continue;
        if ((c.kind === 'choose') !== (def.choices !== undefined)) wrong.push(`chapter1.ts:${c.at} ${c.kind}(${id})`);
        // A call with several ids (a branch in the first argument) shares one slot object only when the lines use the same slots.
        if ([...slotsOf(def)].sort().join() !== [...c.slots].sort().join()) wrong.push(`chapter1.ts:${c.at} ${id}: the text has slots {${slotsOf(def).join(', ')}}, the call gives {${c.slots.join(', ')}}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('the files round trip (load, save, load gives the same data)', () => {
  it('dialogue.json: save(load(file)) is the file, and loading it again gives equal data', () => {
    const loaded = parseDialogue(dialogueJson);
    const text = saveDialogue(loaded);
    expect(text).toBe(fileText('dialogue'));
    expect(parseDialogue(JSON.parse(text))).toEqual(loaded);
    // Key order is kept, so a diff shows only real edits.
    expect(Object.keys(JSON.parse(text).lines)).toEqual(Object.keys(dialogueJson.lines));
  });

  it('shops.json: save(load(file)) is the file (notes and discount included), and loading it again gives equal data', () => {
    const loaded = parseShops(shopsJson);
    const text = saveShops(loaded);
    expect(text).toBe(fileText('shops'));
    expect(parseShops(JSON.parse(text))).toEqual(loaded);
    expect(Object.keys(JSON.parse(text).shops)).toEqual(Object.keys(shopsJson.shops));
  });

  it('speakers.json: save(load(file)) is the file, and loading it again gives equal data', () => {
    const loaded = parseSpeakers(speakersJson);
    const text = saveSpeakers(loaded);
    expect(text).toBe(fileText('speakers'));
    expect(parseSpeakers(JSON.parse(text))).toEqual(loaded);
  });

  it('an edit survives a round trip and changes only its own line of the file', () => {
    const loaded = parseDialogue(dialogueJson);
    loaded.lines['intro.rook.1']!.text = 'Up. Dutch called twice.';
    const before = fileText('dialogue').split('\n');
    const after = saveDialogue(loaded).split('\n');
    expect(after).toHaveLength(before.length);
    expect(after.filter((l, i) => l !== before[i])).toHaveLength(1);
    expect(parseDialogue(JSON.parse(saveDialogue(loaded)))).toEqual(loaded);
  });
});

describe('checkDialogue says what is wrong, with the file, the line id and the field', () => {
  const bad = (edit: (lines: Record<string, Record<string, unknown>>, file: Record<string, unknown>) => void): string => {
    const d = copy(dialogueJson) as unknown as { lines: Record<string, Record<string, unknown>> };
    edit(d.lines, d as unknown as Record<string, unknown>);
    return checkDialogue(d, speakerIds).join('\n');
  };

  it('the shipped file has no problem', () => {
    expect(checkDialogue(dialogueJson, speakerIds)).toEqual([]);
    expect(checkShops(shopsJson, itemIds)).toEqual([]);
    expect(checkSpeakers(speakersJson)).toEqual([]);
  });

  it('a field, a speaker, text, markup, face, position, choices, cancel: each bad edit is named', () => {
    const fork = 'rustyard.mags.fork';
    expect(bad((l) => { l['intro.rook.1']!.speling = 1; })).toContain('dialogue.json: intro.rook.1.speling is not a field of a line');
    expect(bad((l) => { l['intro.rook.1']!.who = 'ghost'; })).toContain('dialogue.json: intro.rook.1.who is "ghost", which is no speaker');
    expect(bad((l) => { delete l['intro.rook.1']!.who; })).toContain('dialogue.json: intro.rook.1.who is missing');
    expect(bad((l) => { l['intro.rook.1']!.text = ' '; })).toContain('dialogue.json: intro.rook.1.text must be text');
    expect(bad((l) => { l['intro.rook.1']!.text = 'a {y}yellow word'; })).toContain('dialogue.json: intro.rook.1.text leaves {y} open');
    expect(bad((l) => { l['intro.rook.1']!.text = 'a {q}word{/}'; })).toContain('the text code {q}, which does not exist');
    expect(bad((l) => { l['intro.kit.1']!.face = 'sleepy'; })).toContain('dialogue.json: intro.kit.1.face must be one of');
    expect(bad((l) => { l['intro.narrate.1']!.face = 'happy'; })).toContain('dialogue.json: intro.narrate.1.face has no effect');
    expect(bad((l) => { l['intro.rook.1']!.top = 'yes'; })).toContain('dialogue.json: intro.rook.1.top must be true or false');
    expect(bad((l) => { l['intro.rook.1']!.auto = 0; })).toContain('dialogue.json: intro.rook.1.auto must be a whole number of frames');
    expect(bad((l) => { l[fork]!.choices = []; })).toContain('dialogue.json: rustyard.mags.fork.choices must be a list with at least one choice');
    expect(bad((l) => { l[fork]!.choices = ['Take it', '']; })).toContain('dialogue.json: rustyard.mags.fork.choices[1] must be text');
    expect(bad((l) => { l[fork]!.cancel = 5; })).toContain('dialogue.json: rustyard.mags.fork.cancel is 5, but there are 2 choices');
    expect(bad((l) => { l['intro.rook.1']!.cancel = 0; })).toContain('dialogue.json: intro.rook.1.cancel needs choices');
    expect(bad((l) => { l[fork]!.auto = 30; })).toContain('dialogue.json: rustyard.mags.fork.auto cannot be used with choices');
  });

  it('a line id must be dotted lower-case words, and the file must have the right shape', () => {
    expect(bad((l) => { l.Intro = { who: null, text: 'x' }; })).toContain('dialogue.json: Intro: a line id is lower-case words joined by dots');
    expect(bad((l) => { l.intro = { who: null, text: 'x' }; })).toContain('dialogue.json: intro: a line id');
    expect(bad((_l, f) => { f.extra = 1; })).toContain('dialogue.json: "extra" is not a field of the file');
    expect(checkDialogue({}, speakerIds)).toEqual(['dialogue.json: the file needs a "lines" object, one record per dialogue box']);
    expect(checkDialogue({ lines: {} }, speakerIds)).toContain('dialogue.json: the file has no line');
  });

  it('free speaker names: allowed when listed in "names"; a bad list is rejected', () => {
    const d = copy(dialogueJson) as unknown as { names: unknown; lines: Record<string, Record<string, unknown>> };
    d.lines['intro.rook.1']!.who = 'Mystery Voice';
    expect(checkDialogue(d, speakerIds).join('\n')).toContain('intro.rook.1.who is "Mystery Voice", which is no speaker');
    d.names = [...(dialogueJson.names), 'Mystery Voice'];
    expect(checkDialogue(d, speakerIds)).toEqual([]);
    d.names = ['Rustfang Punk', 'Rustfang Punk'];
    expect(checkDialogue(d, speakerIds).join('\n')).toContain('names[1] "Rustfang Punk" is listed twice');
    d.names = ['kit'];
    expect(checkDialogue(d, speakerIds).join('\n')).toContain('names[0] "kit" is also a speaker id');
    d.names = 'no';
    expect(checkDialogue(d, speakerIds).join('\n')).toContain('names must be a list');
  });

  it('loadDialogue throws with the list, parseDialogue changes nothing, and a bad hot reload leaves the live table as it was', () => {
    const d = copy(dialogueJson) as unknown as { lines: Record<string, Record<string, unknown>> };
    d.lines['intro.rook.1']!.who = 'ghost';
    expect(() => parseDialogue(d)).toThrow(/dialogue\.json is not valid:\n - dialogue\.json: intro\.rook\.1\.who/);
    const before = JSON.stringify(LINES);
    expect(() => loadDialogue(d)).toThrow(/dialogue\.json is not valid/);
    expect(JSON.stringify(LINES)).toBe(before);
  });

  it('FACES: the checker’s list equals the portrait painter’s', () => {
    expect([...DIALOGUE_FACES]).toEqual([...FACES]);
  });
});

describe('checkShops and checkSpeakers say what is wrong', () => {
  const badShop = (edit: (s: Record<string, Record<string, unknown>>, f: Record<string, unknown>) => void): string => {
    const d = copy(shopsJson) as unknown as { shops: Record<string, Record<string, unknown>> };
    edit(d.shops, d as unknown as Record<string, unknown>);
    return checkShops(d, itemIds).join('\n');
  };
  const badSpeaker = (edit: (s: Record<string, Record<string, unknown>>, f: Record<string, unknown>) => void): string => {
    const d = copy(speakersJson) as unknown as { speakers: Record<string, Record<string, unknown>> };
    edit(d.speakers, d as unknown as Record<string, unknown>);
    return checkSpeakers(d).join('\n');
  };

  it('shops: field, text, color, note, discount, items', () => {
    expect(badShop((s) => { s.noodles!.speling = 1; })).toContain('shops.json: noodles.speling is not a field of a shop');
    expect(badShop((s) => { s.noodles!.name = ''; })).toContain('shops.json: noodles.name must be text');
    expect(badShop((s) => { s.noodles!.accent = 'orange'; })).toContain('shops.json: noodles.accent must be a color');
    expect(badShop((s) => { s.noodles!.note = 4; })).toContain('shops.json: noodles.note must be text');
    expect(badShop((s) => { s.rustyard!.discount = { flag: 'camp_kept', mult: 1.5 }; })).toContain('shops.json: rustyard.discount.mult must be a number above 0 and at most 1');
    expect(badShop((s) => { s.rustyard!.discount = { flag: 'camp_kept', mult: 0 }; })).toContain('rustyard.discount.mult');
    expect(badShop((s) => { s.rustyard!.discount = { flag: '', mult: 0.8 }; })).toContain('shops.json: rustyard.discount.flag must be text');
    expect(badShop((s) => { s.rustyard!.discount = { flag: 'a', mult: 0.8, extra: 1 }; })).toContain('rustyard.discount.extra is not a field of a discount');
    expect(badShop((s) => { s.noodles!.items = ['noodlez']; })).toContain('shops.json: noodles.items[0] is "noodlez", which is not an item');
    expect(badShop((s) => { s.noodles!.items = []; })).toContain('shops.json: noodles.items must be a list with at least one item id');
    expect(badShop((s) => { s.Bad = { ...s.noodles }; })).toContain('shops.json: Bad: a shop id');
    expect(badShop((_s, f) => { f.extra = 1; })).toContain('shops.json: "extra" is not a field of the file');
    expect(checkShops({}, itemIds)).toEqual(['shops.json: the file needs a "shops" object, one record per shop']);
    expect(() => parseShops({ shops: { a: {} } })).toThrow(/shops\.json is not valid/);
  });

  it('speakers: field, text, color, voice, portrait', () => {
    expect(badSpeaker((s) => { s.kit!.speling = 1; })).toContain('speakers.json: kit.speling is not a field of a speaker');
    expect(badSpeaker((s) => { s.kit!.name = ' '; })).toContain('speakers.json: kit.name must be text');
    expect(badSpeaker((s) => { s.kit!.color = 'red'; })).toContain('speakers.json: kit.color must be a color');
    expect(badSpeaker((s) => { s.kit!.voice = 0; })).toContain('speakers.json: kit.voice must be a number above 0');
    expect(badSpeaker((s) => { s.kit!.portrait = ''; })).toContain('speakers.json: kit.portrait must be text');
    expect(badSpeaker((s) => { s.Kit = { ...s.kit }; })).toContain('speakers.json: Kit: a speaker id');
    expect(checkSpeakers({})).toEqual(['speakers.json: the file needs a "speakers" object, one record per speaker']);
    expect(() => parseSpeakers({ speakers: { a: {} } })).toThrow(/speakers\.json is not valid/);
  });
});

describe('resolving a line at play time', () => {
  it('fills the slots, and says what is wrong when a script and the file disagree', () => {
    expect(resolveLine('pump.open', { intake: 'Intake 2', psi: 30 }).text).toBe('Intake 2, open. The gauge sits steady at {c}30 psi{/}.');
    expect(resolveChoice('relay.cycle', { relay: 'Relay A', emitters: 'x' })).toMatchObject({ choices: ['Cycle the relay', 'Leave it'], cancel: 1 });
    expect(() => resolveLine('no.such.line')).toThrow('dialogue.json: there is no line "no.such.line"');
    expect(() => resolveLine('pump.open', { intake: 'Intake 2' })).toThrow('dialogue.json: pump.open.text needs the slot {psi}');
    expect(() => resolveLine('pump.open', { intake: 'a', psi: 1, extra: 2 })).toThrow('dialogue.json: pump.open: the script gave the slot {extra}');
    expect(() => resolveLine('rustyard.mags.fork')).toThrow('dialogue.json: rustyard.mags.fork has choices, so the script must use choose()');
    expect(() => resolveChoice('intro.rook.1')).toThrow('dialogue.json: intro.rook.1 has no choices');
  });

  it('a slot value that holds markup or a dollar sign is put in as it is', () => {
    expect(resolveLine('hexden.tuned', { unlocked: 'A{/} and {y}B$&' }).text).toBe('Rook’s chrome is re-tuned: {y}A{/} and {y}B$&{/} are back, and his wound costs him less.');
  });
});

describe('hot reload: the loaders replace the live tables in place', () => {
  it('an edited line shows at the next box, an edited shop at the next visit, an edited speaker at the next box; a bad file changes nothing', () => {
    const table = LINES;
    const edited = copy(dialogueJson) as unknown as { lines: Record<string, { text: string }> };
    edited.lines['intro.rook.1']!.text = 'Up. Dutch called. Twice.';
    const shops = copy(shopsJson) as unknown as { shops: Record<string, { items: string[] }> };
    shops.shops.noodles!.items = ['medkit', 'neurotab'];
    const sp = copy(speakersJson) as unknown as { speakers: Record<string, { voice: number }> };
    sp.speakers.rook!.voice = 0.8;
    try {
      loadDialogue(edited);
      loadShops(shops);
      loadSpeakers(sp);
      expect(LINES).toBe(table);
      expect(resolveLine('intro.rook.1').text).toBe('Up. Dutch called. Twice.');
      expect(SHOPS.noodles!.items).toEqual(['medkit', 'neurotab']);
      expect(speaker('rook')!.voice).toBe(0.8);
      expect(() => loadShops({ shops: {} })).toThrow(/shops\.json is not valid/);
      expect(SHOPS.noodles!.items).toEqual(['medkit', 'neurotab']);
    } finally {
      loadDialogue(dialogueJson);
      loadShops(shopsJson);
      loadSpeakers(speakersJson);
    }
    expect(resolveLine('intro.rook.1').text).toBe('Up. Dutch called.');
    expect(SHOPS).toEqual(oldShops.shops);
    expect(SPEAKERS).toEqual(oldShops.speakers);
  });
});
