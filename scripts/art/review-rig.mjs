// Put the code-drawn characters (rig v2) on the review page (/artreview.html), so Mark can judge
// them like the PixelLab options: walks animating, frames to flag, notes. Each run adds a new
// version as a new option beside the earlier ones (the history stays), with the old code-drawn
// sprite and his PixelLab pick as "Now" for comparison.
//   node scripts/art/review-rig.mjs [--label "what changed"]     (the dev server must be running)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const { shots, battle } = await page.evaluate(async ({ who, POSES }) => {
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
  return { shots, battle };
}, { who: Object.keys(CREW), POSES });
await browser.close();

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
          { file: `assets/${CREW[who]}/south.png`, label: 'Now: your PixelLab pick', scale: 1 },
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
  meta.options.push({ id: version, kind: 'character', status: 'done', label: `${label} (${version})`, recipe: `rig v2 · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, scale: 1, rotations, anims: { walk: { label: 'Walk', frames: walk } } });
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
          { file: `assets/${BATTLE_PICK[who]}/north.png`, label: 'Now: your PixelLab pick', scale: 1 },
        ],
        options: [],
      };
  const version = `v${meta.options.length + 1}`;
  const dir = `${ROOT}/assets/${id}/${version}`;
  const files = frames.map((f, i) => save(`${dir}/pose-${POSES[i]}.png`, f));
  meta.options.push({ id: version, kind: 'character', status: 'done', label: `${label} (${version})`, recipe: `rig v2 battle · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, scale: 1, showDir: 'north', rotations: { north: files[0] }, anims: { poses: { label: 'Poses', frames: { north: files } } } });
  writeFileSync(metaPath, JSON.stringify(meta, null, 1));
  console.log(`${id}: ${version}`);
}
