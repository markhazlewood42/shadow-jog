// PixelLab REST client for the art pass (https://api.pixellab.ai/v2; spec: /v2/openapi.json).
// The API key comes from .env.local (PIXELLAB_API_KEY; git-ignored) and is never printed.
//
// Every paid call goes through `spend()`: it checks the balance first and refuses to go below
// FLOOR generations (Mark's cap for this pass: half the month's 2,000), and it records what was
// asked for and what was charged in media/art-pass/ledger.jsonl.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const API = 'https://api.pixellab.ai/v2';
export const ROOT = 'media/art-pass';
/** Never let the balance fall below this many generations. */
export const FLOOR = Number(process.env.ARTPASS_FLOOR ?? 1000);

function key() {
  const env = readFileSync('.env.local', 'utf8');
  const m = env.match(/PIXELLAB_API_KEY=([^\r\n]+)/);
  if (!m) throw new Error('PIXELLAB_API_KEY missing from .env.local');
  return m[1].trim();
}
const KEY = key();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tier 1 allows 8 background jobs at once (an animation is one job per direction). Callers take
// slots before starting jobs and give them back when the jobs finish, so we never hit the limit;
// a 429 for it anyway (jobs left running by an earlier run) just waits its turn.
export const MAX_SLOTS = Number(process.env.ARTPASS_SLOTS ?? 8);
let used = 0;
const waiting = [];
export async function acquire(n) {
  while (used + n > MAX_SLOTS) await new Promise((r) => waiting.push(r));
  used += n;
}
export function release(n) {
  used = Math.max(0, used - n);
  for (const r of waiting.splice(0)) r();
}

/** One API call, with retries on rate limits and server errors. Returns parsed JSON. */
export async function api(method, path, body, { retries = 5 } = {}) {
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      if (attempt >= retries) throw e;
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : {};
    if (res.status === 429 && text.includes('concurrent') && Date.now() - t0 < 60 * 60_000) {
      attempt--;
      await sleep(15_000);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(3000 * 2 ** attempt);
      continue;
    }
    const err = new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 600)}`);
    err.status = res.status;
    throw err;
  }
}

export async function balance() {
  const b = await api('GET', '/balance');
  return b.subscription?.generations ?? 0;
}

// PixelLab charges when a job finishes, so the balance lags what's in flight: `reserved` holds the
// estimates of jobs started but not yet finished, and the guard counts them as spent.
let reserved = 0;
export const reserve = (n) => {
  reserved += n;
};
export const settle = (n) => {
  reserved = Math.max(0, reserved - n);
};

/** Stop before a job that could take the balance below FLOOR. */
export async function guard(estimate, what) {
  const left = (await balance()) - reserved;
  if (left - estimate < FLOOR) {
    const e = new Error(`budget: ${what} (~${estimate}) would take the balance from ${left} below ${FLOOR}`);
    e.budget = true;
    throw e;
  }
  return left;
}

export function ledger(entry) {
  mkdirSync(ROOT, { recursive: true });
  appendFileSync(`${ROOT}/ledger.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

/**
 * A paid call: take `slots` job slots, guard the budget, call, record. `estimate` is the expected
 * generation cost. The caller settles the estimate and releases the slots when its jobs finish.
 */
export async function spend(what, estimate, method, path, body, slots = 1) {
  await acquire(slots);
  let before;
  let res;
  try {
    before = await guard(estimate, what);
    reserve(estimate);
    try {
      res = await api(method, path, body);
    } catch (e) {
      settle(estimate);
      throw e;
    }
  } catch (e) {
    release(slots);
    throw e;
  }
  ledger({ what, estimate, path, before, charged: res.usage?.generations ?? null, ids: pickIds(res) });
  return res;
}

function pickIds(r) {
  const out = {};
  for (const k of ['character_id', 'background_job_id', 'background_job_ids', 'animation_group_id', 'object_id', 'tileset_id', 'job_id']) if (r?.[k]) out[k] = r[k];
  return out;
}

/** Poll a background job until it completes. Returns the job (with last_response). */
export async function waitJob(id, { timeoutMs = 15 * 60_000, every = 4000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const j = await api('GET', `/background-jobs/${id}`);
    if (j.status === 'completed') return j;
    if (j.status === 'failed') {
      const e = new Error(`job ${id} failed: ${String(j.last_response?.error ?? JSON.stringify(j.last_response ?? j)).slice(0, 300)}`);
      e.jobFailed = id;
      throw e;
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`job ${id} timed out`);
    await sleep(every);
  }
}

/** Poll a character until its rotations are ready. */
export async function waitCharacter(id, { timeoutMs = 45 * 60_000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const c = await api('GET', `/characters/${id}`);
    if (c.status === 'completed' && c.rotation_urls) return c;
    if (c.status === 'failed') throw new Error(`character ${id} failed`);
    if (Date.now() - t0 > timeoutMs) throw new Error(`character ${id} timed out`);
    await sleep(5000);
  }
}

export async function download(url, path) {
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      writeFileSync(path, Buffer.from(await res.arrayBuffer()));
      return path;
    }
    if (attempt >= 4) throw new Error(`download ${url} -> ${res.status}`);
    await sleep(2000 * 2 ** attempt);
  }
}

export function saveB64(b64, path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(b64, 'base64'));
  return path;
}

export const b64 = (path) => readFileSync(path).toString('base64');

/** A PNG's size, read from its header. */
export function pngSize(path) {
  const b = readFileSync(path);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** The style-image block Pro Flash takes: a PNG to copy palette, outline, detail and shading from. */
export function styleImage(path, usage = 'Match this sprite’s pixel-art style: palette, outline, shading and level of detail.') {
  return { image: { type: 'base64', base64: b64(path), format: 'png' }, size: pngSize(path), usage_description: usage };
}

export const image = (path) => ({ type: 'base64', base64: b64(path), format: 'png' });

// ------------------------------------------------------------------ the review manifest
// Each asset keeps its own meta.json (no shared file to race on); the review page's dev endpoint
// gathers them. meta: { id, category, title, note, current: [paths], options: [{ id, label, ... }] }
export function assetDir(id) {
  return `${ROOT}/assets/${id}`;
}

export function readMeta(id) {
  const p = `${assetDir(id)}/meta.json`;
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

export function writeMeta(meta) {
  mkdirSync(assetDir(meta.id), { recursive: true });
  writeFileSync(`${assetDir(meta.id)}/meta.json`, JSON.stringify(meta, null, 1));
}

/** Record an asset (and its current art) with no options yet, so the review page lists it early. */
export function ensureAsset(base) {
  const meta = readMeta(base.id);
  writeMeta(meta ? { ...meta, ...base, options: meta.options } : { ...base, options: [] });
}

/** Add or replace one option on an asset (creating the asset entry if needed). */
export function upsertOption(base, option) {
  const meta = readMeta(base.id) ?? { ...base, options: [] };
  Object.assign(meta, { ...base, options: meta.options });
  const i = meta.options.findIndex((o) => o.id === option.id);
  if (i >= 0) meta.options[i] = { ...meta.options[i], ...option };
  else meta.options.push(option);
  writeMeta(meta);
  return meta;
}

/** Run `fn` over `items`, at most `n` at a time. Failures are collected, not thrown. */
export async function pool(items, n, fn) {
  const results = [];
  const errors = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        try {
          results.push(await fn(item));
        } catch (e) {
          errors.push({ item, error: e.message ?? String(e) });
          console.log(`  ! ${typeof item === 'string' ? item : item.id ?? ''}: ${e.message ?? e}`);
          if (e.budget) break;
        }
      }
    }),
  );
  return { results, errors };
}
