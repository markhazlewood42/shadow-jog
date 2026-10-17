// Path B: 2D construction sheets per facing (the fallback if the 3D proxy cannot fit). One import for the tests and the CLI.
import { createHash } from 'node:crypto';
import { cardText, buildCard } from './card.mjs';
import { checkDistinct, checkMirrorAgree, fitReport, givenLabels, templateChecks } from './check.mjs';
import { lightMap, outlineMap } from './maps.mjs';
import { buildSheet, loadData, mirrorSheet } from './sheet.mjs';
import { sharesByBox } from './shares.mjs';

export * from './sheet.mjs';
export * from './maps.mjs';
export * from './card.mjs';
export * from './check.mjs';
export * from './shares.mjs';

/** The five facings the sheets draw; the mirrors give the other three. */
export const FACINGS = ['s', 'se', 'e', 'ne', 'n'];
export const MIRRORS = { se: 'sw', e: 'w', ne: 'nw' };

/** Everything for one sheet: maps, card, checks. */
export function outputsOf(data, sheet, given) {
  const light = lightMap(data, sheet);
  const outline = outlineMap(data, sheet);
  const card = buildCard(data, sheet);
  return { sheet, light, outline, card, checks: templateChecks(data, sheet, given, card, light, outline) };
}

/** Build all five facings and the three mirrors, with the set checks and the S3 shares. */
export function buildAll(data = loadData(), given = givenLabels()) {
  const facings = {};
  for (const f of FACINGS) facings[f] = outputsOf(data, buildSheet(data, f), given);
  const mirrors = {};
  for (const [from, to] of Object.entries(MIRRORS)) mirrors[to] = outputsOf(data, mirrorSheet(facings[from].sheet, to), given);
  const sheets = Object.fromEntries(FACINGS.map((f) => [f, facings[f].sheet]));
  const setChecks = [checkMirrorAgree(data, facings.s.sheet, facings.se.sheet), checkDistinct(data, sheets)];
  const sources = [{ name: 'given', labels: given }];
  const shares = Object.fromEntries(Object.entries({ ...facings, ...mirrors }).map(([f, o]) => [f, sharesByBox(data, o.sheet, sources)]));
  return { facings, mirrors, setChecks, shares, fit: fitReport(data, facings.se.sheet, given) };
}

/** A hash of every output that a writer would read, for the determinism test. */
export function digest(all) {
  const h = createHash('sha256');
  for (const [name, o] of Object.entries({ ...all.facings, ...all.mirrors })) {
    h.update(name);
    h.update(o.sheet.labels.map((p) => p ?? '-').join(','));
    h.update(Buffer.from(o.light));
    h.update(Buffer.from(o.outline));
    h.update(cardText(o.card));
  }
  return h.digest('hex');
}
export * from './render.mjs';
