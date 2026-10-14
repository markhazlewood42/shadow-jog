/**
 * Shop inventories.
 *
 * The data is `shops.json` (M8a, decision 3 of docs/engine/m8-brief.md; the shape is in docs/engine/m8a-data-format.md). This file is the
 * typed loader, like `enemies.ts`: `checkShops` lists every problem in plain words, `loadShops` throws with that list, and `SHOPS` is
 * the same table the old TypeScript file built (`tests/dialogue-data.test.ts` proves it against a frozen copy, and `tests/balance.test.ts`
 * and `tests/economy.test.ts` read its prices). The shop id is the key in the file and the `id` of the loaded record.
 * The design notes that were code comments are the `note` of a shop (`SHOP_NOTES`), not part of `ShopDef`.
 * `loadShops` replaces the live tables in place, so a tool or Vite's hot update can change a shop in a running game.
 */
import { inlineJson, isHex, isNum, isObj, isText, KEY_PATTERN, unknownFields } from './contentjson';
import { ITEMS } from './items';
import shopsJson from './shops.json' with { type: 'json' };

export interface ShopDef {
  id: string;
  name: string;
  keeper: string;
  greeting: string;
  thanks: string;
  items: string[];
  accent: string;
  /** Prices times `mult` once `flag` is set (a keeper who remembers what you did). */
  discount?: { flag: string; mult: number } | undefined;
}

/** The loaded file: the shops (as the game always had them) and the design note of each shop that has one. */
export interface LoadedShops {
  shops: Record<string, ShopDef>;
  notes: Record<string, string>;
}

const FILE = 'shops.json';
const FIELDS = ['name', 'keeper', 'accent', 'note', 'discount', 'greeting', 'thanks', 'items'] as const;

/** Everything wrong with a candidate shops file (empty when it is good to play), one problem per line, each with the file, the shop and the field. */
export function checkShops(data: unknown, itemIds: readonly string[]): string[] {
  if (!isObj(data) || !isObj(data.shops)) return [`${FILE}: the file needs a "shops" object, one record per shop`];
  const out: string[] = [];
  for (const k of unknownFields(data, ['shops'])) out.push(`${FILE}: "${k}" is not a field of the file`);
  const entries = Object.entries(data.shops);
  if (!entries.length) out.push(`${FILE}: the file has no shop`);
  for (const [id, r] of entries) {
    if (!KEY_PATTERN.test(id)) out.push(`${FILE}: ${id}: a shop id is lower-case letters, digits and underscores, and starts with a letter`);
    if (!isObj(r)) {
      out.push(`${FILE}: ${id}: must be an object`);
      continue;
    }
    for (const k of unknownFields(r, FIELDS)) out.push(`${FILE}: ${id}.${k} is not a field of a shop`);
    for (const k of ['name', 'keeper', 'greeting', 'thanks'] as const) if (!isText(r[k])) out.push(`${FILE}: ${id}.${k} must be text`);
    if (!isHex(r.accent)) out.push(`${FILE}: ${id}.accent must be a color like #86f08c`);
    if (r.note !== undefined && !isText(r.note)) out.push(`${FILE}: ${id}.note must be text`);
    if (r.discount !== undefined) {
      const d = r.discount;
      if (!isObj(d)) out.push(`${FILE}: ${id}.discount must be an object with a flag and a mult`);
      else {
        for (const k of unknownFields(d, ['flag', 'mult'])) out.push(`${FILE}: ${id}.discount.${k} is not a field of a discount`);
        if (!isText(d.flag)) out.push(`${FILE}: ${id}.discount.flag must be text (the story flag that turns the discount on)`);
        if (!isNum(d.mult) || d.mult <= 0 || d.mult > 1) out.push(`${FILE}: ${id}.discount.mult must be a number above 0 and at most 1 (0.8 is a fifth off)`);
      }
    }
    if (!Array.isArray(r.items) || !r.items.length) out.push(`${FILE}: ${id}.items must be a list with at least one item id`);
    else
      r.items.forEach((item: unknown, i) => {
        if (typeof item !== 'string' || !itemIds.includes(item)) out.push(`${FILE}: ${id}.items[${i}] is "${String(item)}", which is not an item`);
      });
  }
  return out;
}

/** The shops file, checked (throws a readable error listing every problem). Pure: it changes nothing live. */
export function parseShops(data: unknown, itemIds: readonly string[] = Object.keys(ITEMS)): LoadedShops {
  const problems = checkShops(data, itemIds);
  if (problems.length) throw new Error(`${FILE} is not valid:\n - ${problems.join('\n - ')}`);
  const records = (data as { shops: Record<string, Omit<ShopDef, 'id'> & { note?: string }> }).shops;
  const shops: Record<string, ShopDef> = {};
  const notes: Record<string, string> = {};
  for (const [id, r] of Object.entries(records)) {
    shops[id] = { id, name: r.name, keeper: r.keeper, greeting: r.greeting, thanks: r.thanks, items: [...r.items], accent: r.accent };
    if (r.discount) shops[id].discount = { flag: r.discount.flag, mult: r.discount.mult };
    if (r.note) notes[id] = r.note;
  }
  return { shops, notes };
}

/** The text of the file for a loaded table: fields in a fixed order, one field per line, the id as the key. Loading the result gives the same data back. */
export function saveShops(loaded: LoadedShops): string {
  const rows = Object.entries(loaded.shops).map(([id, s]) => {
    const note = loaded.notes[id];
    const fields: [string, unknown][] = [['name', s.name], ['keeper', s.keeper], ['accent', s.accent]];
    if (note) fields.push(['note', note]);
    if (s.discount) fields.push(['discount', { flag: s.discount.flag, mult: s.discount.mult }]);
    fields.push(['greeting', s.greeting], ['thanks', s.thanks], ['items', s.items]);
    return [id, fields] as const;
  });
  // One field per line: a shop is a few lines, and a price or item change is a one-line diff.
  const body = rows
    .map(([id, fields]) => `    ${JSON.stringify(id)}: {\n${fields.map(([k, v]) => `      ${JSON.stringify(k)}: ${inlineJson(v)}`).join(',\n')}\n    }`)
    .join(',\n');
  return `{\n  "shops": {\n${body}\n  }\n}\n`;
}

/** The live tables. `scenes/shop.ts` reads `SHOPS` when a shop opens, so a reload shows at the next visit. */
export const SHOPS: Record<string, ShopDef> = {};
/** The design note of a shop (why it sells what it sells), by shop id. */
export const SHOP_NOTES: Record<string, string> = {};

/** Check `data`, then replace the live tables with it in place (hot reload). If the data is bad it throws and the live tables stay as they were. */
export function loadShops(data: unknown): LoadedShops {
  const next = parseShops(data);
  for (const k of Object.keys(SHOPS)) delete SHOPS[k];
  for (const k of Object.keys(SHOP_NOTES)) delete SHOP_NOTES[k];
  Object.assign(SHOPS, next.shops);
  Object.assign(SHOP_NOTES, next.notes);
  return { shops: SHOPS, notes: SHOP_NOTES };
}

loadShops(shopsJson);

// Live updates in dev: an edit of shops.json reaches a running game without a reload (like fx.json).
if (import.meta.hot) {
  import.meta.hot.accept('./shops.json', (m) => {
    if (m) loadShops((m as unknown as { default: unknown }).default);
  });
}
