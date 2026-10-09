#!/usr/bin/env node
// Builds the roadmap chart from the one data file, docs/roadmap/roadmap.json.
//   node scripts/gen-roadmap.mjs      writes docs/roadmap/roadmap.svg and docs/roadmap/README.md
// `npm run roadmap` runs it. tests/roadmap.test.ts calls `generate()` and fails when the files on disk differ.
// The output is deterministic: no dates from the clock, no random ids. Plain Node, no dependencies.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'docs', 'roadmap');

export const STATUSES = ['done', 'active', 'next', 'later', 'optional', 'gated'];
export const KINDS = ['milestone', 'task'];
export const NOTE_ORDER_ONLY = 'Order and dependency only. Bar length is not time.';

// ---- layout (SVG units) ----
const MARGIN = 20;
const PITCH = 102; // distance between two columns
const BAR_W = 90;
const BAR_H = 76;
const LANE_TITLE_H = 24;
const LANE_GAP = 14;
const LANE_BLOCK = LANE_TITLE_H + BAR_H + LANE_GAP;
const HEAD_H = 104;
const COLHEAD_H = 22;
const LEGEND_H = 92;
const LABEL_CHARS = 12; // the longest line of a label inside a bar
const GAP = PITCH - BAR_W;

// ---- colors: the dark skin of the repo's other diagrams (docs/diagrams/profile), on a solid page so the image reads in a light or a dark theme ----
const PAPER = '#0d0c1f';
const INK = '#f4f1ff';
const MUTED = '#bfc3e4';
const FAINT = '#8f94bd';
const ACCENT = '#ffcc3d';
const LINE = '#bfc3e4';
const STYLE = {
  done: { fill: '#14382e', stroke: '#4cc38a', text: INK, sub: '#cfeee0', dash: '' },
  active: { fill: ACCENT, stroke: ACCENT, text: '#1a1500', sub: '#1a1500', dash: '' },
  next: { fill: '#16304d', stroke: '#5fb3ff', text: INK, sub: '#d4e8ff', dash: '' },
  later: { fill: '#1c1a3a', stroke: '#7a80c4', text: INK, sub: MUTED, dash: '' },
  optional: { fill: 'none', stroke: FAINT, text: INK, sub: MUTED, dash: '5 4' },
  gated: { fill: '#3a1830', stroke: '#ff7aa8', text: INK, sub: '#ffd0e0', dash: '5 4' },
};
const MEANING = {
  done: 'Done and merged',
  active: 'Being built now',
  next: 'Starts next, or waits for Mark',
  later: 'Planned, in order',
  optional: 'Optional',
  gated: "Needs Mark's go-ahead",
};

const FONT_SANS = "Geist, 'Segoe UI', system-ui, -apple-system, Arial, sans-serif";
const FONT_MONO = "'Geist Mono', ui-monospace, Consolas, 'Courier New', monospace";
const FONT_SERIF = "'Instrument Serif', Georgia, 'Times New Roman', serif";

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- data ----

/** Reads and parses docs/roadmap/roadmap.json. */
export function readData(dir = DIR) {
  return JSON.parse(readFileSync(join(dir, 'roadmap.json'), 'utf8'));
}

/**
 * The problems of the data, as a list of sentences (empty when it is sound). It checks the shape, the known statuses, the lanes,
 * the dependencies (they name real ids and have no cycle), the columns and that every label fits its bar.
 */
export function validate(data) {
  const problems = [];
  const lanes = Array.isArray(data.lanes) ? data.lanes : [];
  const items = Array.isArray(data.items) ? data.items : [];
  if (typeof data.updated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.updated)) problems.push('"updated" must be a date like 2026-10-09.');
  if (lanes.length === 0) problems.push('"lanes" must be a list with at least one lane.');
  if (items.length === 0) problems.push('"items" must be a list with at least one item.');
  const laneIds = new Set();
  for (const lane of lanes) {
    if (typeof lane.id !== 'string' || typeof lane.title !== 'string') problems.push(`A lane needs an "id" and a "title": ${JSON.stringify(lane)}.`);
    else if (laneIds.has(lane.id)) problems.push(`Lane id "${lane.id}" is used twice.`);
    laneIds.add(lane.id);
  }
  const ids = new Set();
  for (const item of items) {
    const where = `Item "${item.id}"`;
    if (typeof item.id !== 'string' || item.id === '') {
      problems.push(`An item has no id: ${JSON.stringify(item)}.`);
      continue;
    }
    if (ids.has(item.id)) problems.push(`${where} appears twice.`);
    ids.add(item.id);
    if (typeof item.label !== 'string' || item.label === '') problems.push(`${where} has no label.`);
    if (!laneIds.has(item.lane)) problems.push(`${where} is in lane "${item.lane}", which does not exist.`);
    if (!STATUSES.includes(item.status)) problems.push(`${where} has status "${item.status}". Use one of: ${STATUSES.join(', ')}.`);
    if (item.kind !== undefined && !KINDS.includes(item.kind)) problems.push(`${where} has kind "${item.kind}". Use one of: ${KINDS.join(', ')}.`);
    if (!Array.isArray(item.after)) problems.push(`${where} needs "after", a list of ids (it can be empty).`);
    if (typeof item.notes !== 'string' || item.notes === '') problems.push(`${where} needs "notes".`);
    if (item.column !== undefined && !(Number.isInteger(item.column) && item.column >= 0)) problems.push(`${where} has a "column" that is not a whole number from 0.`);
    const shown = tagOf(item);
    if (shown.length > 10) problems.push(`${where} has a tag "${shown}" longer than 10 characters.`);
    if (typeof item.label === 'string' && wrap(item.label) === null) problems.push(`${where} has a label that does not fit two lines of ${LABEL_CHARS} characters.`);
  }
  if (problems.length > 0) return problems;
  for (const item of items) {
    for (const dep of item.after) if (!ids.has(dep)) problems.push(`Item "${item.id}" comes after "${dep}", which does not exist.`);
  }
  if (problems.length > 0) return problems;
  const cycle = findCycle(items);
  if (cycle !== null) problems.push(`The dependencies have a cycle: ${cycle.join(' -> ')}.`);
  if (problems.length > 0) return problems;
  const columns = columnsOf(items);
  const taken = new Map();
  for (const item of items) {
    const needed = Math.max(-1, ...item.after.map((dep) => columns.get(dep))) + 1;
    if (item.column !== undefined && item.column < needed) problems.push(`Item "${item.id}" is in column ${item.column}, but its dependencies need column ${needed} or later.`);
    const key = `${item.lane}:${columns.get(item.id)}`;
    if (taken.has(key)) problems.push(`Items "${taken.get(key)}" and "${item.id}" are in the same lane and column. Move one with "column".`);
    taken.set(key, item.id);
  }
  return problems;
}

/** A dependency cycle as a list of ids, or null. */
function findCycle(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const state = new Map(); // 1 = on the path, 2 = done
  const path = [];
  const visit = (id) => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...path.slice(path.indexOf(id)), id];
    state.set(id, 1);
    path.push(id);
    for (const dep of byId.get(id).after) {
      const found = visit(dep);
      if (found !== null) return found;
    }
    path.pop();
    state.set(id, 2);
    return null;
  };
  for (const item of items) {
    const found = visit(item.id);
    if (found !== null) return found;
  }
  return null;
}

/** The column of each item: the explicit "column" when it has one, else one after its latest dependency, else 0. Needs data without a cycle. */
export function columnsOf(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const memo = new Map();
  const columnOf = (id) => {
    if (memo.has(id)) return memo.get(id);
    const item = byId.get(id);
    const needed = Math.max(-1, ...item.after.map(columnOf)) + 1;
    const column = item.column ?? needed;
    memo.set(id, column);
    return column;
  };
  for (const item of items) columnOf(item.id);
  return memo;
}

const tagOf = (item) => item.tag ?? item.id;

/** Splits a label into at most two lines of LABEL_CHARS characters, on spaces. Null when it does not fit. */
function wrap(label) {
  const words = label.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if (word.length > LABEL_CHARS) return null;
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= LABEL_CHARS) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines.length <= 2 ? lines : null;
}

// ---- the svg ----

function headline(data) {
  const pick = (status) => data.items.filter((item) => item.kind === 'milestone' && item.status === status);
  const name = (item) => `${item.id} ${item.label}`;
  const active = pick('active');
  const next = pick('next');
  const now = active.length > 0 ? active.map(name).join(' and ') : 'no milestone';
  const parts = [`Now: ${now}.`];
  if (next.length > 0) parts.push(`Next: ${next.map(name).join(' and ')}.`);
  return parts.join(' ');
}

export function buildSvg(data) {
  const { lanes, items } = data;
  const columns = columnsOf(items);
  const columnCount = Math.max(...columns.values()) + 1;
  const width = MARGIN * 2 + (columnCount - 1) * PITCH + BAR_W;
  const lanesTop = HEAD_H + COLHEAD_H;
  const height = lanesTop + lanes.length * LANE_BLOCK + LEGEND_H;
  const laneIndex = new Map(lanes.map((lane, i) => [lane.id, i]));
  const laneTop = (i) => lanesTop + i * LANE_BLOCK;
  const box = new Map();
  for (const item of items) {
    const i = laneIndex.get(item.lane);
    const x = MARGIN + columns.get(item.id) * PITCH;
    const y = laneTop(i) + LANE_TITLE_H;
    box.set(item.id, { x, y, cy: y + BAR_H / 2, lane: i, column: columns.get(item.id) });
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  const out = [];
  const add = (line) => out.push(line);

  const title = 'Shadow Jog roadmap';
  const desc =
    `${NOTE_ORDER_ONLY} ${headline(data)} Items in the same column can run in parallel. ` +
    lanes
      .map((lane) => {
        const inLane = items.filter((item) => item.lane === lane.id).sort((a, b) => columns.get(a.id) - columns.get(b.id));
        return `${lane.title}: ${inLane.map((item) => `${item.id} ${item.label} (${item.status})`).join(', ')}.`;
      })
      .join(' ');

  add(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="roadmap-title roadmap-desc">`);
  add(`  <title id="roadmap-title">${esc(title)}</title>`);
  add(`  <desc id="roadmap-desc">${esc(desc)}</desc>`);
  add('  <defs>');
  add(`    <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse"><polygon points="0 0, 8 3, 0 6" fill="${LINE}"/></marker>`);
  add('  </defs>');
  add(`  <rect width="${width}" height="${height}" fill="${PAPER}"/>`);

  // Header
  add(`  <text x="${MARGIN}" y="46" fill="${INK}" font-size="26" font-style="italic" font-family="${FONT_SERIF}">${esc(headline(data))}</text>`);
  add(`  <text x="${MARGIN}" y="72" fill="${ACCENT}" font-size="14" font-weight="600" font-family="${FONT_MONO}">${esc(NOTE_ORDER_ONLY)}</text>`);
  add(
    `  <text x="${MARGIN}" y="92" fill="${FAINT}" font-size="11" font-family="${FONT_MONO}" letter-spacing="0.06em">${esc(
      `READ LEFT TO RIGHT. A COLUMN IS A STEP IN THE ORDER. ITEMS IN ONE COLUMN CAN RUN IN PARALLEL. DATA UPDATED ${data.updated}.`,
    )}</text>`,
  );

  // Column guides and step numbers
  for (let c = 0; c < columnCount; c++) {
    const x = MARGIN + c * PITCH;
    if (c % 2 === 0) add(`  <rect x="${x - GAP / 2}" y="${lanesTop}" width="${PITCH}" height="${lanes.length * LANE_BLOCK}" fill="#ffffff" fill-opacity="0.025"/>`);
    add(`  <text x="${x + BAR_W / 2}" y="${HEAD_H + 12}" fill="${FAINT}" font-size="10" text-anchor="middle" font-family="${FONT_MONO}" letter-spacing="0.08em">STEP ${c + 1}</text>`);
  }

  // Lane titles and rules
  lanes.forEach((lane, i) => {
    const top = laneTop(i);
    add(`  <line x1="${MARGIN}" y1="${top - LANE_GAP / 2}" x2="${width - MARGIN}" y2="${top - LANE_GAP / 2}" stroke="#7a80c4" stroke-opacity="0.28"/>`);
    add(`  <text x="${MARGIN}" y="${top + 14}" fill="${FAINT}" font-size="11" font-family="${FONT_MONO}" letter-spacing="0.12em">${esc(lane.title.toUpperCase())}</text>`);
  });

  // Dependency arrows (drawn before the bars)
  for (const item of items) {
    const to = box.get(item.id);
    for (const depId of item.after) {
      const from = box.get(depId);
      const dep = byId.get(depId);
      const sx = from.x + BAR_W;
      const tx = to.x;
      const dash = dep.status === 'optional' || item.status === 'optional' ? ' stroke-dasharray="4 3"' : '';
      let d;
      if (to.column === from.column + 1 && to.lane === from.lane) {
        d = `M ${sx} ${from.cy} H ${tx}`;
      } else if (to.column === from.column + 1) {
        const gx = tx - GAP / 2;
        d = `M ${sx} ${from.cy} H ${gx} V ${to.cy} H ${tx}`;
      } else {
        // A longer jump runs along the gutter between two lanes, so it never crosses a bar.
        const gutter = to.lane < from.lane ? laneTop(from.lane) - LANE_GAP / 2 : laneTop(from.lane) + LANE_BLOCK - LANE_GAP / 2;
        const out0 = sx + GAP / 2;
        const gx = tx - GAP / 2;
        d = `M ${sx} ${from.cy} H ${out0} V ${gutter} H ${gx} V ${to.cy} H ${tx}`;
      }
      add(`  <path d="${d}" fill="none" stroke="${LINE}" stroke-width="1.2"${dash} marker-end="url(#arrow)"/>`);
    }
  }

  // Bars
  for (const item of items) {
    const b = box.get(item.id);
    const s = STYLE[item.status];
    const lines = wrap(item.label);
    const dash = s.dash === '' ? '' : ` stroke-dasharray="${s.dash}"`;
    const strokeWidth = item.status === 'active' ? 2 : 1.2;
    add(`  <g id="item-${esc(item.id.replace(/[^A-Za-z0-9]+/g, '-'))}">`);
    add(`    <title>${esc(`${item.id} ${item.label}: ${item.status}. ${item.notes}`)}</title>`);
    add(`    <rect x="${b.x}" y="${b.y}" width="${BAR_W}" height="${BAR_H}" rx="6" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${strokeWidth}"${dash}/>`);
    add(`    <text x="${b.x + 8}" y="${b.y + 19}" fill="${s.text}" font-size="14" font-weight="700" font-family="${FONT_MONO}">${esc(tagOf(item))}</text>`);
    lines.forEach((line, i) => {
      add(`    <text x="${b.x + 8}" y="${b.y + 37 + i * 14}" fill="${s.text}" font-size="12" font-family="${FONT_SANS}">${esc(line)}</text>`);
    });
    add(`    <text x="${b.x + 8}" y="${b.y + BAR_H - 7}" fill="${s.sub}" font-size="9.5" font-weight="600" font-family="${FONT_MONO}" letter-spacing="0.1em">${item.status.toUpperCase()}</text>`);
    add('  </g>');
  }

  // Legend
  const legendTop = lanesTop + lanes.length * LANE_BLOCK + 10;
  add(`  <line x1="${MARGIN}" y1="${legendTop - 6}" x2="${width - MARGIN}" y2="${legendTop - 6}" stroke="#7a80c4" stroke-opacity="0.28"/>`);
  add(`  <text x="${MARGIN}" y="${legendTop + 12}" fill="${FAINT}" font-size="11" font-family="${FONT_MONO}" letter-spacing="0.12em">LEGEND</text>`);
  const perRow = 4;
  const cellW = (width - MARGIN * 2) / perRow;
  const cellAt = (i) => ({ x: MARGIN + (i % perRow) * cellW, y: legendTop + 24 + Math.floor(i / perRow) * 28 });
  STATUSES.forEach((status, i) => {
    const { x, y } = cellAt(i);
    const s = STYLE[status];
    const dash = s.dash === '' ? '' : ` stroke-dasharray="${s.dash}"`;
    add(`  <rect x="${x}" y="${y}" width="34" height="18" rx="4" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.2"${dash}/>`);
    add(`  <text x="${x + 44}" y="${y + 13}" fill="${INK}" font-size="12" font-family="${FONT_SANS}"><tspan font-family="${FONT_MONO}" font-weight="600">${status.toUpperCase()}</tspan>  ${esc(MEANING[status])}</text>`);
  });
  const arrowCell = cellAt(STATUSES.length);
  add(`  <path d="M ${arrowCell.x} ${arrowCell.y + 9} H ${arrowCell.x + 34}" fill="none" stroke="${LINE}" stroke-width="1.2" marker-end="url(#arrow)"/>`);
  add(`  <text x="${arrowCell.x + 44}" y="${arrowCell.y + 13}" fill="${INK}" font-size="12" font-family="${FONT_SANS}">Comes after (dashed: optional)</text>`);
  add('</svg>');
  return `${out.join('\n')}\n`;
}

// ---- the README ----

const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function buildReadme(data) {
  const { lanes, items } = data;
  const columns = columnsOf(items);
  const laneTitle = new Map(lanes.map((lane) => [lane.id, lane.title]));
  const sorted = lanes.flatMap((lane) =>
    items.filter((item) => item.lane === lane.id).sort((a, b) => columns.get(a.id) - columns.get(b.id) || a.id.localeCompare(b.id)),
  );
  const alt = `The roadmap as a Gantt-style chart. ${NOTE_ORDER_ONLY} ${headline(data)} The table below lists the same items.`;
  const rows = sorted.map((item) => {
    const where = [item.branch === undefined ? '' : `branch \`${item.branch}\``, item.pr === undefined ? '' : `PR ${item.pr}`].filter((x) => x !== '').join(', ');
    return `| ${cell(`${item.id} ${item.label}`)} | ${cell(laneTitle.get(item.lane))} | ${columns.get(item.id) + 1} | ${item.status} | ${cell(item.after.length === 0 ? 'none' : item.after.join(', '))} | ${cell(where === '' ? 'none' : where)} | ${cell(item.notes)} |`;
  });
  return `---
type: reference
title: Shadow Jog roadmap
project: shadow-jog
created: 2026-10-09
updated: ${data.updated}
tags: [roadmap, planning]
---

<!-- Generated by scripts/gen-roadmap.mjs from docs/roadmap/roadmap.json. Do not edit by hand. Run \`npm run roadmap\`. -->

# Shadow Jog roadmap

${headline(data)}

**${NOTE_ORDER_ONLY}** Mark wants no hour or day estimates. A column is a step in the order. Items in the same column can run in parallel.

![${alt}](roadmap.svg)

*Source: [roadmap.json](roadmap.json). The chart is [roadmap.svg](roadmap.svg).*

## The same data as a table

| Item | Lane | Step | Status | Comes after | Where | Notes |
|---|---|---|---|---|---|---|
${rows.join('\n')}

Statuses: ${STATUSES.map((status) => `**${status}** (${MEANING[status].toLowerCase()})`).join(', ')}.

## How to update

1. Edit \`docs/roadmap/roadmap.json\`. It is the only source. Never edit \`roadmap.svg\` or this file by hand.
2. Run \`npm run roadmap\`. It rewrites \`roadmap.svg\` and this file.
3. Run \`npm run check\`. The test \`tests/roadmap.test.ts\` fails when the generated files are out of date.

Do this in every status update. A milestone item uses the same id as its row in the table of \`docs/engine/migration.md\` section 2 (\`M0\`, \`M1b\`, \`Pre-M0\`). The \`milestone:\` key in the frontmatter of \`status.md\` must name the milestone item whose status is \`active\`.

Item fields:

| Field | Meaning |
|---|---|
| \`id\` | A unique name. A milestone uses its id from \`migration.md\`. |
| \`kind\` | \`milestone\` for a row of that table. Leave it out for anything else. |
| \`label\` | The name on the bar: two lines of 13 characters at most. |
| \`tag\` | Optional. The short first line on the bar. The default is the id. 10 characters at most. |
| \`lane\` | The id of a lane in \`lanes\`. |
| \`status\` | One of ${STATUSES.map((status) => `\`${status}\``).join(', ')}. |
| \`after\` | The ids this item waits for. It sets the column: one after the latest one. A list can be empty. |
| \`column\` | Optional. Puts the item in a later column than its dependencies need. Counts from 0. |
| \`branch\`, \`pr\` | Optional. Where the work is. |
| \`notes\` | One or two short sentences. |
`;
}

// ---- main ----

/** Reads the data, checks it and builds both files. Throws with every problem when the data is not sound. */
export function generate(dir = DIR) {
  const data = readData(dir);
  const problems = validate(data);
  if (problems.length > 0) throw new Error(`docs/roadmap/roadmap.json has problems:\n- ${problems.join('\n- ')}`);
  return { svg: buildSvg(data), readme: buildReadme(data) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { svg, readme } = generate();
    writeFileSync(join(DIR, 'roadmap.svg'), svg);
    writeFileSync(join(DIR, 'README.md'), readme);
    console.log('Wrote docs/roadmap/roadmap.svg and docs/roadmap/README.md');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
