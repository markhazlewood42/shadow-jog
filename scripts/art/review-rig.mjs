// Put the code-drawn characters (rig v2) on the review page (/artreview.html), so Mark can judge
// them like the PixelLab options: walks animating, frames to flag, notes. Each run adds a new
// version as a new option beside the earlier ones (the history stays), with the old code-drawn
// sprite as "Now" (Mark: no PixelLab sprites on the page; it was cluttered).
//   node scripts/art/review-rig.mjs [--label "what changed"]     (the dev server must be running)
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const ROOT = 'media/art-pass';
const CREW = { kit: 'crew.kit/redo1', rook: 'crew.rook/chosen', hex: 'crew.hex/kit', sable: 'crew.sable/kit' };
const PL = { down: 'south', right: 'east', up: 'north', left: 'west' };
const label = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] : 'Rig v2';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
await page.goto('http://localhost:3007/?debug&art=classic');
await page.waitForFunction(() => !!window.__SJ__, null, { timeout: 30_000 });
const POSES = ['idle', 'brace', 'strike', 'cast', 'hurt', 'victory'];
const { shots, battle, npcs, enemies, portraits } = await page.evaluate(async ({ who, POSES }) => {
  await (await import('/src/art/rig2/data.ts')).loadRigData();
  const { buildChar } = await import('/src/art/chars.ts');
  const { battler } = await import('/src/art/battlers.ts');
  const { LOOKS } = await import('/src/data/looks.ts');
  const shots = {};
  const battle = {};
  for (const w of who) {
    const sp = buildChar(LOOKS[w]);
    shots[w] = {};
    for (const d of ['down', 'right', 'up', 'left']) shots[w][d] = { stand: sp.frames[d][0].toDataURL(), walk: (sp.walk?.[d] ?? []).map((c) => c.toDataURL()) };
    // The battle poses, each with the light it throws laid on (as the battle adds it).
    const b = battler(w, LOOKS[w]);
    battle[w] = POSES.map((p) => {
      const c = document.createElement('canvas');
      c.width = b.frames[p].width;
      c.height = b.frames[p].height;
      const g = c.getContext('2d');
      g.drawImage(b.frames[p], 0, 0);
      if (b.glow[p]) {
        g.globalCompositeOperation = 'lighter';
        g.drawImage(b.glow[p], 0, 0);
      }
      return c.toDataURL();
    });
  }
  // Everyone else on the rig: NPCs and townsfolk, straight from their traced frames.
  const { TRACED } = await import('/src/art/rig2/data.ts');
  const { rigSprite } = await import('/src/art/rig2/rig.ts');
  const npcs = {};
  for (const [key, traced] of Object.entries(TRACED)) {
    if (who.includes(key)) continue;
    const sp = rigSprite(traced);
    npcs[key] = {};
    for (const d of ['down', 'right', 'up', 'left']) npcs[key][d] = { stand: sp.frames[d][0].toDataURL(), walk: (sp.walk?.[d] ?? []).map((c) => c.toDataURL()) };
  }
  // Enemies: idle, strike and flinch, each with its glow laid on (as the battle draws it).
  const { ENEMY_TRACED } = await import('/src/art/rig2/data.ts');
  const { enemyArt } = await import('/src/art/enemies.ts');
  const lit = (canvas, glow) => {
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    const g = c.getContext('2d');
    g.drawImage(canvas, 0, 0);
    if (glow) {
      g.globalCompositeOperation = 'lighter';
      g.drawImage(glow, 0, 0);
    }
    return c.toDataURL();
  };
  const enemies = {};
  for (const key of Object.keys(ENEMY_TRACED)) {
    const a = enemyArt(key);
    enemies[key] = [lit(a.canvas, a.glow), a.attack ? lit(a.attack.canvas, a.attack.glow) : null, a.hurt ? lit(a.hurt.canvas, a.hurt.glow) : null];
  }
  // Portraits on their card, as dialogue shows them: every expression, then the neutral face's blink and talk.
  const { PORTRAIT_TRACED } = await import('/src/art/rig2/data.ts');
  const { applyRigPortraits } = await import('/src/art/rig2/portrait.ts');
  // The game's own copy of portraits.ts: after an edit the dev server serves it as portraits.ts?t=…,
  // and a plain import would get a second, empty copy.
  const live = performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname + new URL(e.name).search).find((n) => n.startsWith('/src/art/portraits.ts?'));
  const { getPortrait, FACES } = await import(live ?? '/src/art/portraits.ts');
  applyRigPortraits();
  const portraits = {};
  for (const key of Object.keys(PORTRAIT_TRACED)) {
    portraits[key] = Object.fromEntries(FACES.map((f) => [f, getPortrait(key, f).toDataURL()]));
    portraits[key].blink = getPortrait(key, 'neutral', 'blink').toDataURL();
    portraits[key].talk = getPortrait(key, 'neutral', 'talk').toDataURL();
  }
  return { shots, battle, npcs, enemies, portraits };
}, { who: Object.keys(CREW), POSES });
await browser.close();


/** A version's frames, as one string: a new version that equals the last is dropped. */
const framesIn = (dir) => (existsSync(dir) ? readdirSync(dir).sort().map((f) => f + readFileSync(`${dir}/${f}`).toString('base64')).join('|') : null);
/** Keep a just-written version only if it differs from the one before; true if kept. */
const keepIfChanged = (meta, version) => {
  const prev = meta.options.at(-1);
  const dir = `${ROOT}/assets/${meta.id}/${version}`;
  if (prev && framesIn(`${ROOT}/assets/${meta.id}/${prev.id}`) === framesIn(dir)) {
    rmSync(dir, { recursive: true });
    return false;
  }
  return true;
};
const save = (path, url) => {
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  writeFileSync(path, Buffer.from(url.split(',')[1], 'base64'));
  return path.slice(ROOT.length + 1);
};
for (const [who, frames] of Object.entries(shots)) {
  const id = `rig.${who}`;
  const metaPath = `${ROOT}/assets/${id}/meta.json`;
  const meta = existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, 'utf8'))
    : {
        id,
        category: 'Rig v2 · crew',
        title: `${who[0].toUpperCase()}${who.slice(1)} (code-drawn)`,
        kind: 'field',
        note: 'Drawn in code by rig v2: standing frames traced from your PixelLab pick, then walks, outline and colours by code (consistent by construction). Each version is a new option; the older ones stay for comparison. Flag frames and leave notes like any other asset.',
        current: [
          { file: `current/char/${who}.png`, label: 'Now: the old code-drawn sprite', scale: 1 },
        ],
        options: [],
      };
  const version = `v${meta.options.length + 1}`;
  const dir = `${ROOT}/assets/${id}/${version}`;
  const rotations = {};
  const walk = {};
  for (const [d, f] of Object.entries(frames)) {
    rotations[PL[d]] = save(`${dir}/${PL[d]}.png`, f.stand);
    walk[PL[d]] = f.walk.map((w, i) => save(`${dir}/walk-${PL[d]}-${i}.png`, w));
  }
  if (keepIfChanged(meta, version)) meta.options.push({ id: version, kind: 'character', status: 'done', label: `${label} (${version})`, recipe: `rig v2 · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, scale: 1, rotations, anims: { walk: { label: 'Walk', frames: walk } } });
  writeFileSync(metaPath, JSON.stringify(meta, null, 1));
  console.log(`${id}: ${version}`);
}

// The battle backs: the poses as one strip (hover to hold one, click to flag it).
const BATTLE_PICK = { kit: 'battle.kit/house', rook: 'battle.rook/house', hex: 'battle.hex/plain', sable: 'battle.sable/house' };
for (const [who, frames] of Object.entries(battle)) {
  const id = `rig.battle.${who}`;
  const metaPath = `${ROOT}/assets/${id}/meta.json`;
  const meta = existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, 'utf8'))
    : {
        id,
        category: 'Rig v2 · battle',
        title: `${who[0].toUpperCase()}${who.slice(1)} in battle (code-drawn)`,
        kind: 'battler',
        note: 'Seen from behind. Traced from your pick (Kit: her fighting stance); every pose is code: the moving hand or staff, a forearm drawn to it, weapons drawn in code, the hit tipping back, and the light each pose throws. Poses, in order: idle, wind-up, strike, cast, hurt, victory. Hover the strip to hold one; click to flag it.',
        current: [
          { file: `current/battler/${who}-idle.png`, label: 'Now: the old code-drawn back', scale: 2 },
        ],
        options: [],
      };
  const version = `v${meta.options.length + 1}`;
  const dir = `${ROOT}/assets/${id}/${version}`;
  const files = frames.map((f, i) => save(`${dir}/pose-${POSES[i]}.png`, f));
  if (keepIfChanged(meta, version)) meta.options.push({ id: version, kind: 'character', status: 'done', label: `${label} (${version})`, recipe: `rig v2 battle · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, scale: 1, showDir: 'north', rotations: { north: files[0] }, anims: { poses: { label: 'Poses', frames: { north: files } } } });
  writeFileSync(metaPath, JSON.stringify(meta, null, 1));
  console.log(`${id}: ${version}`);
}

// NPCs and townsfolk: one asset each, beside the old sprite and the PixelLab pick it was traced from.
for (const [key, frames] of Object.entries(npcs)) {
  const slug = key.replace(':', '-').replace(/\./g, '-');
  const id = `rig.npc.${slug}`;
  const asset = key.startsWith('map:') ? `npc.${key.slice(4).replace('.', '-')}` : key.startsWith('pool:') ? `town.${String(Number(key.slice(5)) + 1).padStart(2, '0')}` : `npc.${key}`;
  const old = key.startsWith('map:') ? `current/char/${key.slice(4)}.png` : key.startsWith('pool:') ? `current/char/lantern_row.p${(Number(key.slice(5)) % 8) + 1}.png` : `current/char/${key}.png`;
  const pickMeta = existsSync(`${ROOT}/assets/${asset}/meta.json`) ? JSON.parse(readFileSync(`${ROOT}/assets/${asset}/meta.json`, 'utf8')) : null;
  const metaPath = `${ROOT}/assets/${id}/meta.json`;
  const meta = existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, 'utf8'))
    : {
        id,
        category: key.startsWith('pool:') ? 'Rig v2 · townsfolk' : 'Rig v2 · NPCs',
        title: `${pickMeta?.title ?? key} (code-drawn)`,
        kind: 'field',
        note: 'Traced from the PixelLab standing frames; the walk is the rig’s (so the glitches you flagged in PixelLab’s walks are gone). Flag frames and leave notes as usual.',
        current: [
          { file: old, label: 'Now: the old code-drawn sprite', scale: 1 },
        ],
        options: [],
      };
  const version = `v${meta.options.length + 1}`;
  const dir = `${ROOT}/assets/${id}/${version}`;
  const rotations = {};
  const walk = {};
  for (const [d, f] of Object.entries(frames)) {
    rotations[PL[d]] = save(`${dir}/${PL[d]}.png`, f.stand);
    walk[PL[d]] = f.walk.map((w, i) => save(`${dir}/walk-${PL[d]}-${i}.png`, w));
  }
  if (keepIfChanged(meta, version)) meta.options.push({ id: version, kind: 'character', status: 'done', label: `${label} (${version})`, recipe: `rig v2 · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, scale: 1, rotations, anims: { walk: { label: 'Walk', frames: walk } } });
  writeFileSync(metaPath, JSON.stringify(meta, null, 1));
}
console.log(`NPCs and townsfolk: ${Object.keys(npcs).length}`);

// Enemies: the three frames as one strip, beside the old code-drawn enemy.
const ENEMY_POSES = ['idle', 'strike', 'flinch'];
// The enemy each traced sprite stands for (the inverse of ENEMY_SPRITE in trace.mjs): the old art is filed by enemy.
const ENEMY_OF = { medic: 'rustfang_medic', punk: 'rustfang_punk', slinger: 'rustfang_slinger', rat: 'glowrat', hound: 'scrap_hound', drone: 'street_drone', wisp: 'smog_wisp', brute: 'knuckles', ghoul: 'sewer_ghoul', crab: 'rust_crab', maint: 'maint_drone', shade: 'drowned_shade', eel: 'gutter_eel', lurker: 'lurker', sentinel: 'km_sentinel', turret: 'sentry_turret', arcanist: 'km_arcanist', hunter: 'hunter_drone', bound: 'bound_spirit', warden: 'warden', warden_spirit: 'warden_spirit' };
for (const [key, frames] of Object.entries(enemies)) {
  const id = `rig.enemy.${key}`;
  const metaPath = `${ROOT}/assets/${id}/meta.json`;
  const old = readdirSync(`${ROOT}/current/enemy`).find((f) => f.replace('.png', '') === ENEMY_OF[key]);
  const meta = existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, 'utf8'))
    : {
        id,
        category: 'Rig v2 · enemies',
        title: `${ENEMY_OF[key] ?? key} (code-drawn)`,
        kind: 'battler',
        note: 'Traced from the redraw you picked; the strike (a lean in) and the flinch (tipped back) are code, and the battle adds its own lunge, shake and flash on top. Bright parts glow. Frames, in order: idle, strike, flinch. Hover the strip to hold one; click to flag it.',
        current: old ? [{ file: `current/enemy/${old}`, label: 'Now: the old code-drawn enemy', scale: 1 }] : [],
        options: [],
      };
  const version = `v${meta.options.length + 1}`;
  const dir = `${ROOT}/assets/${id}/${version}`;
  const files = frames.flatMap((f, i) => (f ? [save(`${dir}/pose-${ENEMY_POSES[i]}.png`, f)] : []));
  if (keepIfChanged(meta, version)) meta.options.push({ id: version, kind: 'character', status: 'done', label: `${label} (${version})`, recipe: `rig v2 enemy · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, scale: 1, showDir: 'south', rotations: { south: files[0] }, anims: { poses: { label: 'Poses', frames: { south: files } } } });
  writeFileSync(metaPath, JSON.stringify(meta, null, 1));
}
console.log(`Enemies: ${Object.keys(enemies).length}`);

// Portraits: the neutral face, with every expression (and its blink and talk) as a strip to flag.
for (const [key, faces] of Object.entries(portraits)) {
  const id = `rig.portrait.${key}`;
  const metaPath = `${ROOT}/assets/${id}/meta.json`;
  const meta = existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, 'utf8'))
    : {
        id,
        category: 'Rig v2 · portraits',
        title: `${key[0].toUpperCase()}${key.slice(1)} (code-drawn)`,
        kind: 'portrait',
        note: 'Traced from your portrait pick, with the expressions the art pass redrew for it; the ones it didn’t make are drawn in code (eyes and mouth moved a pixel or two). New: a blink and a talking mouth, which dialogue plays while a line types (the last two in the strip). Click a face to flag it.',
        current: [{ file: `current/portrait/${key}.png`, label: 'Now: the old code-drawn portrait', scale: 1 }],
        options: [],
      };
  const version = `v${meta.options.length + 1}`;
  const dir = `${ROOT}/assets/${id}/${version}`;
  const files = Object.fromEntries(Object.entries(faces).map(([f, url]) => [f, save(`${dir}/face-${f}.png`, url)]));
  const { neutral, ...rest } = files;
  if (keepIfChanged(meta, version)) meta.options.push({ id: version, kind: 'image', status: 'done', label: `${label} (${version})`, recipe: `rig v2 portrait · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, scale: 1, image: neutral, faces: rest });
  writeFileSync(metaPath, JSON.stringify(meta, null, 1));
}
console.log(`Portraits: ${Object.keys(portraits).length}`);
