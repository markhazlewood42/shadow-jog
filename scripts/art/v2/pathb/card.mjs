// Path B structure card: the text fields a writer reads for one facing (yaw, head center column, face axis column, eye cells or "no face",
// light vector, part layout per row, fold strokes with start point and direction, carried item cells).
import { LEVEL_NAMES, lightMap } from './maps.mjs';
import { SIZE, cellOf, resolve } from './sheet.mjs';

/** Guide rows for a facing: the same rows for every facing (R2, T2), by name. */
export const guideRows = (data) => ({ ...data.character.rows });

/** Contiguous runs of one part in each row: [{ y, spans: [{ part, x0, x1 }] }]. */
export function partLayout(sheet) {
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    const spans = [];
    for (let x = 0; x < SIZE; x++) {
      const p = sheet.labels[y * SIZE + x];
      if (!p) continue;
      const last = spans[spans.length - 1];
      if (last && last.part === p && last.x1 === x - 1) last.x1 = x;
      else spans.push({ part: p, x0: x, x1: x });
    }
    if (spans.length) rows.push({ y, spans });
  }
  return rows;
}

/** 4-connected components of one part, as lists of cell indexes. */
export function components(sheet, part) {
  const set = new Set(sheet.parts[part] ?? []);
  const seen = new Set();
  const out = [];
  for (const start of [...set].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const comp = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const i = stack.pop();
      comp.push(i);
      const [x, y] = cellOf(i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * SIZE + nx;
        if (nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE && set.has(j) && !seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
    out.push(comp.sort((a, b) => a - b));
  }
  return out;
}

/**
 * Fold strokes (R2, T15): at most data.checks.maxFoldsPerPanel per panel. A stroke starts at a support point (a row of the panel, on the side away from the light)
 * and runs in dir for len cells, kept inside the panel. Specs are in data.character.folds[part].
 */
export function foldStrokes(data, sheet) {
  const L = data.character.light.vector;
  const strokes = [];
  for (const [part, specs] of Object.entries(data.character.folds)) {
    components(sheet, part).forEach((comp, pi) => {
      const set = new Set(comp);
      const ys = comp.map((i) => cellOf(i)[1]);
      const top = Math.min(...ys);
      specs.forEach((spec) => {
        const row = spec.support === 'top' ? top : Math.round(resolve(spec.support, sheet.anchors));
        const inRow = comp.filter((i) => cellOf(i)[1] === row);
        if (!inRow.length) return;
        // away from the light: the largest x for a light with a negative x component
        const startI = inRow.reduce((best, i) => (cellOf(i)[0] * -Math.sign(L[0]) > cellOf(best)[0] * -Math.sign(L[0]) ? i : best), inRow[0]);
        const [sx, sy] = cellOf(startI);
        const cells = [];
        for (let k = 0; k < spec.len; k++) {
          const x = sx + spec.dir[0] * k;
          const y = sy + spec.dir[1] * k;
          if (!set.has(y * SIZE + x)) break;
          cells.push([x, y]);
        }
        strokes.push({ panel: `${part}#${pi}`, part, start: [sx, sy], dir: spec.dir, cells, side: 'away from the light' });
      });
    });
  }
  return strokes;
}

/** The structure card of one facing, as data. */
export function buildCard(data, sheet) {
  const f = data.facings[sheet.facing] ?? data.facings[sheet.mirroredFrom];
  const lenses = (sheet.parts.lenses ?? []).map(cellOf);
  const itemCells = data.character.itemParts.flatMap((p) => (sheet.parts[p] ?? []).map((i) => ({ part: p, cell: cellOf(i) })));
  const light = lightMap(data, sheet);
  const perRow = partLayout(sheet).map((r) => ({
    y: r.y,
    spans: r.spans.map((s) => {
      const counts = [0, 0, 0, 0];
      for (let x = s.x0; x <= s.x1; x++) counts[light[r.y * SIZE + x] ?? 0]++;
      const level = counts.indexOf(Math.max(...counts));
      return { ...s, mainLight: LEVEL_NAMES[level] };
    }),
  }));
  const mirrored = Boolean(sheet.mirroredFrom);
  return {
    facing: sheet.facing,
    yaw: mirrored ? -data.facings[sheet.mirroredFrom].yaw : f.yaw,
    headCenterCol: sheet.anchors.head,
    faceAxisCol: sheet.anchors.face,
    eyes: lenses.length ? { rows: [...new Set(lenses.map(([, y]) => y))].sort((a, b) => a - b), cells: lenses } : 'no face',
    lightVector: data.character.light.vector,
    lightSide: data.character.light.side,
    guideRows: guideRows(data),
    partLayout: perRow,
    folds: foldStrokes(data, sheet).map((s) => ({ panel: s.panel, start: s.start, dir: s.dir, cells: s.cells, side: s.side })),
    item: {
      side: mirrored ? `${f.itemSide === 'left' ? 'right' : 'left'} (mirror: redraw the item, it must stay on the same shoulder of the character)` : f.itemSide,
      cells: itemCells,
    },
    outlineRule: '1 px, near-black, unbroken around the silhouette; seam cells use near-black too (selout by light level)',
    mirrored,
  };
}

const span = (s) => `${s.part}${s.x0 === s.x1 ? s.x0 : `${s.x0}-${s.x1}`}`;
/** The card as plain text for a writer kit. */
export function cardText(card) {
  const L = [];
  L.push(`FACING ${card.facing}  yaw ${card.yaw} deg${card.mirrored ? ' (mirror)' : ''}`);
  L.push(`head center column ${card.headCenterCol}   face axis column ${card.faceAxisCol}`);
  L.push(card.eyes === 'no face' ? 'eye cells: no face' : `eye cells: rows ${card.eyes.rows.join(',')}, ${card.eyes.cells.length} cells: ${card.eyes.cells.map(([x, y]) => `${x},${y}`).join(' ')}`);
  L.push(`light vector (${card.lightVector.join(', ')})  ${card.lightSide}`);
  L.push(`guide rows ${Object.entries(card.guideRows).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  L.push('part layout per row (x0-x1 per part, main light level):');
  for (const r of card.partLayout) L.push(`  y${r.y}: ${r.spans.map((s) => `${span(s)}/${s.mainLight}`).join(' ')}`);
  L.push(card.folds.length ? 'fold strokes (start, direction, cells):' : 'fold strokes: none');
  for (const s of card.folds) L.push(`  ${s.panel} start ${s.start.join(',')} dir ${s.dir.join(',')} ${s.cells.map(([x, y]) => `${x},${y}`).join(' ')} (${s.side})`);
  L.push(`carried item (katana) side ${card.item.side}: ${card.item.cells.map((c) => `${c.part}:${c.cell.join(',')}`).join(' ')}`);
  L.push(`outline: ${card.outlineRule}`);
  return `${L.join('\n')}\n`;
}
