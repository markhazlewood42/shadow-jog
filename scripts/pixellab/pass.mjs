// The PixelLab art pass runner: generates the options the review page shows.
//   node scripts/pixellab/pass.mjs <group> [more groups] [--only <asset-id>] [--dry] [-j 4]
// Groups and their recipes live in plan.mjs. Every option is written under
// media/art-pass/assets/<asset>/<option>/ with the asset's meta.json beside it, and the run is
// resumable: a finished option is skipped, and one with a PixelLab id already recorded is picked
// up where it stopped rather than paid for twice.
import { existsSync, writeFileSync } from 'node:fs';
import {
  ROOT, acquire, api, balance, download, ensureAsset, pool, release, readMeta, reserve, saveB64, settle, spend, styleImage, upsertOption, waitCharacter, waitJob,
} from './lib.mjs';
import { GROUPS } from './plan.mjs';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv.splice(i, 2)[1] : null;
};
const only = flag('--only');
const jobs = Number(flag('-j') ?? 10);
const dry = argv.includes('--dry');
const groups = argv.filter((a) => !a.startsWith('--'));
if (!groups.length) {
  console.log(`groups: ${Object.keys(GROUPS).join(', ')}`);
  process.exit(0);
}

const rel = (p) => p.slice(ROOT.length + 1);
const dirOf = (asset, opt) => `${ROOT}/assets/${asset.id}/${opt.id}`;
/** The asset fields meta.json carries (everything but the recipes). */
const baseOf = (a) => {
  const { options, ...rest } = a;
  return rest;
};

// ------------------------------------------------------------------ characters

/** Wait for a job an earlier run started, holding a slot while it runs. */
async function resume(jobIds, cost) {
  if (!jobIds.length) return;
  await acquire(jobIds.length);
  reserve(cost);
  try {
    await Promise.all(jobIds.map((j) => waitJob(j, { timeoutMs: 45 * 60_000 })));
  } finally {
    settle(cost);
    release(jobIds.length);
  }
}

async function createCharacter(asset, opt, rec) {
  if (rec.characterId) {
    if (rec.jobId) await resume([rec.jobId], 0);
    return rec.characterId;
  }
  const body = {
    description: opt.prompt,
    name: `SJ ${asset.id} ${opt.id}`,
    view: opt.view ?? 'low top-down',
    image_size: opt.size,
    n_directions: 8,
    ...(opt.template ? { template_id: opt.template } : {}),
    ...(opt.style ? { style_image: styleImage(opt.style), style_options: opt.styleOptions ?? { color_palette: true, outline: true, detail: true, shading: true } } : {}),
    ...(opt.seed != null ? { seed: opt.seed } : {}),
  };
  const r = await spend(`${asset.id}/${opt.id} character`, opt.cost ?? 8, 'POST', '/create-character-pro-flash', body, 1);
  upsertOption(baseOf(asset), { id: opt.id, characterId: r.character_id, jobId: r.background_job_id, status: 'generating' });
  try {
    if (r.background_job_id) await waitJob(r.background_job_id, { timeoutMs: 45 * 60_000 });
  } finally {
    settle(opt.cost ?? 8);
    release(1);
  }
  return r.character_id;
}

async function rotations(asset, opt, id) {
  const c = await waitCharacter(id);
  const want = opt.keepDirs ?? Object.keys(c.rotation_urls);
  const files = {};
  for (const d of want) {
    const url = c.rotation_urls[d];
    if (!url) continue;
    files[d] = rel(await download(url, `${dirOf(asset, opt)}/${d}.png`));
  }
  return files;
}

/**
 * Ask for every animation the recipe lists that this character doesn't have yet, then download
 * them all. PixelLab sometimes starts fewer directions than asked (when its job slots run short),
 * so a direction that didn't come back is asked for again on its own (a "fill"), and merged in.
 */
async function animate(asset, opt, id, rec) {
  const anims = { ...(rec.anims ?? {}) };
  const pending = [];
  // Each animation is waited on as soon as it starts, so its job slots come back when its jobs
  // finish, not when the last of this character's animations has been asked for.
  const waits = [];
  const waitFor = (a, own) => {
    const run = anims[a.name].fillGroup ? anims[a.name].fill : anims[a.name];
    const jobs = run?.jobs ?? [];
    if (!own) return resume(jobs, 0);
    return (async () => {
      try {
        await Promise.all(jobs.map((j) => waitJob(j, { timeoutMs: 45 * 60_000 })));
      } finally {
        settle(run.cost ?? 0);
        release(run.slots ?? a.directions.length);
      }
    })();
  };
  // A character made before this pass (Kit, Rook) may already have the animation: adopt it.
  const existing = opt.characterId ? ((await api('GET', `/characters/${id}`)).animations ?? []) : [];
  const missingOf = (a) => a.directions.filter((d) => !anims[a.name]?.frames?.[d]);
  for (const a of opt.anims ?? []) {
    const cur = anims[a.name];
    const missing = missingOf(a);
    if (!missing.length) continue;
    if (!cur) {
      const had = a.template && existing.find((x) => x.animation_type === a.template && a.directions.every((d) => x.directions.some((y) => y.direction === d)));
      if (had) anims[a.name] = { group: had.animation_group_id, jobs: [], cost: 0 };
    }
    // Nothing started yet, or it came back short: start the directions still missing.
    const fill = !!anims[a.name]?.frames;
    let own = false;
    if (!anims[a.name]?.group || (fill && !anims[a.name].fillGroup)) {
      const cost = a.cost ? Math.ceil((a.cost / a.directions.length) * missing.length) : missing.length;
      const body = {
        character_id: id,
        animation_name: a.name,
        directions: missing,
        ...(a.template ? { mode: 'template', template_animation_id: a.template } : { mode: 'v3', action_description: a.action, frame_count: a.frames ?? 8 }),
      };
      const r = await spend(`${asset.id}/${opt.id} anim ${a.name}${fill ? ` (fill ${missing.join(',')})` : ''}`, cost, 'POST', '/characters/animations', body, missing.length);
      const started = { jobs: r.background_job_ids ?? [], cost, slots: missing.length };
      if (fill) anims[a.name] = { ...anims[a.name], fillGroup: r.animation_group_id, fill: started };
      else anims[a.name] = { group: r.animation_group_id, ...started };
      own = true;
      upsertOption(baseOf(asset), { id: opt.id, anims });
    }
    pending.push(a);
    const w = waitFor(a, own);
    // If a later request throws, this one still finishes (and frees its slots) on its own.
    w.catch(() => {});
    waits.push(w);
  }
  await Promise.all(waits);
  if (!pending.length) return anims;
  const c = await api('GET', `/characters/${id}`);
  for (const a of pending) {
    const cur = anims[a.name];
    const group = cur.fillGroup ?? cur.group;
    const got = (c.animations ?? []).find((x) => x.animation_group_id === group);
    if (!got) throw new Error(`animation ${a.name} missing on ${id}`);
    const frames = { ...(cur.frames ?? {}) };
    for (const d of got.directions) {
      if (!a.directions.includes(d.direction)) continue;
      frames[d.direction] = [];
      for (const [i, url] of d.frames.entries()) frames[d.direction].push(rel(await download(url, `${dirOf(asset, opt)}/${a.name}-${d.direction}-${i}.png`)));
    }
    const { fillGroup, fill, ...rest } = cur;
    anims[a.name] = { ...rest, frames, label: a.label ?? a.name };
    const still = missingOf(a);
    if (still.length) anims[a.name].missing = still;
    else delete anims[a.name].missing;
  }
  return anims;
}

// ------------------------------------------------------------------ images and objects

/** The PNG out of a finished Pro Flash job (base64 in last_response, or a URL). */
async function jobImage(job, path) {
  const lr = job.last_response ?? {};
  // Map objects answer with the PNG's base64 as a bare string.
  if (typeof lr.image === 'string') return saveB64(lr.image, path);
  const img = lr.images?.[0] ?? lr.image ?? lr.quantized_images?.[0];
  if (img?.base64) return saveB64(img.base64, path);
  if (lr.image_url) return download(lr.image_url, path);
  throw new Error(`no image in job ${job.id}: ${Object.keys(lr).join(',')}`);
}

async function createImage(asset, opt, rec) {
  let jobId = rec.jobId;
  const cost = opt.cost ?? 5;
  if (!jobId) {
    const body = {
      description: opt.prompt,
      image_size: opt.size,
      no_background: opt.noBackground ?? true,
      ...(opt.style ? { style_image: styleImage(opt.style), style_options: opt.styleOptions ?? { color_palette: true, outline: true, detail: true, shading: true } } : {}),
      ...(opt.seed != null ? { seed: opt.seed } : {}),
    };
    const r = await spend(`${asset.id}/${opt.id} image`, cost, 'POST', '/create-image-pro-flash', body, 1);
    jobId = r.background_job_id;
    upsertOption(baseOf(asset), { id: opt.id, jobId, status: 'generating' });
  } else await acquire(1);
  try {
    const job = await waitJob(jobId, { timeoutMs: 45 * 60_000 });
    return { image: rel(await jobImage(job, `${dirOf(asset, opt)}/image.png`)) };
  } finally {
    settle(cost);
    release(1);
  }
}

// ------------------------------------------------------------------ tilesets and map objects

async function createTileset(asset, opt, rec) {
  let id = rec.tilesetId;
  const cost = opt.cost ?? 20;
  if (!id) {
    const r = await spend(`${asset.id}/${opt.id} tileset`, cost, 'POST', '/create-tileset', opt.body, 1);
    id = r.tileset_id ?? r.id;
    upsertOption(baseOf(asset), { id: opt.id, tilesetId: id, jobId: r.background_job_id, status: 'generating' });
    rec.jobId = r.background_job_id;
  } else await acquire(1);
  try {
    if (rec.jobId) await waitJob(rec.jobId, { timeoutMs: 30 * 60_000 });
    let t;
    for (let i = 0; i < 120; i++) {
      t = await api('GET', `/tilesets/${id}`);
      if ((t.tileset ?? t).tiles?.length || t.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    const ts = t.tileset ?? t;
    const tiles = [];
    for (const [i, tile] of (ts.tiles ?? []).entries()) {
      const path = `${dirOf(asset, opt)}/tile-${i}.png`;
      if (tile.image?.base64) saveB64(tile.image.base64, path);
      else if (tile.image_url ?? tile.url) await download(tile.image_url ?? tile.url, path);
      else continue;
      tiles.push({ file: rel(path), corners: tile.corners ?? null, name: tile.name ?? null });
    }
    if (!tiles.length) throw new Error(`tileset ${id}: no tiles (${Object.keys(ts).join(',')})`);
    return { tiles };
  } finally {
    settle(cost);
    release(1);
  }
}

async function createMapObject(asset, opt, rec) {
  let jobId = rec.jobId;
  const cost = opt.cost ?? 5;
  if (!jobId) {
    const r = await spend(`${asset.id}/${opt.id} map object`, cost, 'POST', '/map-objects', { description: opt.prompt, image_size: opt.size, view: opt.view ?? 'high top-down', ...(opt.body ?? {}) }, 1);
    jobId = r.background_job_id;
    upsertOption(baseOf(asset), { id: opt.id, jobId, objectId: r.object_id, status: 'generating' });
  } else await acquire(1);
  try {
    const job = await waitJob(jobId, { timeoutMs: 45 * 60_000 });
    return { image: rel(await jobImage(job, `${dirOf(asset, opt)}/image.png`)) };
  } finally {
    settle(cost);
    release(1);
  }
}

// ------------------------------------------------------------------ one option

async function runOption(asset, opt) {
  const rec = readMeta(asset.id)?.options.find((o) => o.id === opt.id) ?? {};
  const wantAnims = (opt.anims ?? []).map((a) => a.name);
  const doneAnims = (opt.anims ?? []).every((a) => a.directions.every((d) => rec.anims?.[a.name]?.frames?.[d]));
  if (rec.status === 'done' && doneAnims) return 'skip';
  if (dry) {
    console.log(`  would make ${asset.id}/${opt.id} (${opt.kind}, ~${opt.cost ?? '?'} + anims ${wantAnims.join(',') || '-'})`);
    return 'dry';
  }
  const t0 = Date.now();
  const card = { id: opt.id, label: opt.label, recipe: opt.recipe, kind: opt.kind, scale: opt.scale ?? 1 };
  upsertOption(baseOf(asset), { ...card, status: 'generating', error: null });
  try {
    let out = {};
    if (opt.kind === 'character') {
      const id = opt.characterId ?? (await createCharacter(asset, opt, rec));
      upsertOption(baseOf(asset), { id: opt.id, characterId: id });
      const rot = rec.rotations && existsSync(`${ROOT}/${Object.values(rec.rotations)[0]}`) ? rec.rotations : await rotations(asset, opt, id);
      upsertOption(baseOf(asset), { id: opt.id, rotations: rot });
      out = { rotations: rot, anims: await animate(asset, opt, id, rec) };
    } else if (opt.kind === 'image') out = await createImage(asset, opt, rec);
    else if (opt.kind === 'tileset') out = await createTileset(asset, opt, rec);
    else if (opt.kind === 'mapobject') out = await createMapObject(asset, opt, rec);
    else throw new Error(`unknown kind ${opt.kind}`);
    upsertOption(baseOf(asset), { ...card, ...out, status: 'done', secs: Math.round((Date.now() - t0) / 1000) });
    console.log(`  ok ${asset.id}/${opt.id} (${Math.round((Date.now() - t0) / 1000)} s)`);
    return 'ok';
  } catch (e) {
    const patch = { id: opt.id, status: e.budget ? 'budget' : 'failed', error: String(e.message ?? e).slice(0, 500) };
    // A job PixelLab failed (it says "heavy load, try again") is dead: forget it, so the next run
    // starts a fresh one instead of waiting on this one again.
    if (e.jobFailed) {
      const now = readMeta(asset.id)?.options.find((o) => o.id === opt.id) ?? {};
      if (now.jobId === e.jobFailed) Object.assign(patch, { jobId: null, characterId: null, rotations: null });
      const anims = { ...(now.anims ?? {}) };
      for (const [k, v] of Object.entries(anims)) if (v.jobs?.includes(e.jobFailed)) delete anims[k];
      patch.anims = anims;
    }
    upsertOption(baseOf(asset), patch);
    throw e;
  }
}

// ------------------------------------------------------------------ main

const assets = groups.flatMap((g) => {
  if (!GROUPS[g]) throw new Error(`no group ${g}`);
  return GROUPS[g]();
});
const picks = only ? only.split(',') : null;
const todo = assets.filter((a) => !picks || picks.some((p) => a.id === p || a.id.startsWith(`${p}.`)));
const work = todo.flatMap((a) => a.options.map((o) => ({ id: `${a.id}/${o.id}`, asset: a, opt: o })));
// Record every asset (with its current art) first, so the review page lists it even before its options land.
if (!dry) for (const a of todo) ensureAsset(baseOf(a));
console.log(`${work.length} options across ${todo.length} assets; balance ${await balance()}`);
const { errors } = await pool(work, jobs, (w) => runOption(w.asset, w.opt));
const left = await balance();
writeFileSync(`${ROOT}/balance.json`, JSON.stringify({ generations: left, at: new Date().toISOString() }));
console.log(`finished: ${work.length - errors.length} ok, ${errors.length} failed; balance ${left}`);
process.exit(errors.length ? 1 : 0);
