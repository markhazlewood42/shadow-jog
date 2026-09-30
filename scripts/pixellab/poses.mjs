// Key poses for the crew's battle sprites, by inpainting: PixelLab redraws only a masked area of the
// standing back view ("the arm, raised overhead") and keeps every other pixel exactly, so the
// character can't drift the way its full animations did (Mark's review, 2026-09-30). The game shows
// one still per battle pose and does the motion in code, Phantasy Star IV style.
//   node scripts/pixellab/poses.mjs <member> [--tries 2]      e.g. kit
// Writes assets/battle.<member>/<option>/pose-<name>-<n>.png and records them on the option as
// `poses: { name: [files] }`. The review page shows them under the battle sprite (hover to see one
// big, click to flag a bad one); ?art=review uses the first unflagged try for each pose.
import { chromium } from '@playwright/test';
import { ROOT, image, readMeta, saveB64, settle, spend, upsertOption, waitJob, release } from './lib.mjs';

/**
 * Per member: which option's sprite, and for each pose the masked rectangles [x, y, w, h] on the
 * 128x128 back view (white = redraw) and what to draw there. From behind, the right arm is on the
 * screen's right.
 */
const MEMBERS = {
  kit: {
    option: 'house',
    who: 'a girl street brawler with a long dark ponytail, red-orange cropped jacket, dark navy pants, white hand wraps',
    poses: {
      raise: {
        rects: [[76, 0, 36, 50], [72, 48, 24, 42]],
        does: 'raises her right arm straight up overhead with an open hand, as if calling up a spell',
      },
      strike: {
        rects: [[72, 0, 44, 50], [72, 48, 26, 42]],
        does: 'throws a hard punch with her right arm, fist driven forward and up away from the viewer at head height, elbow bent out to the side',
      },
    },
  },
};

const argv = process.argv.slice(2);
const who = argv[0];
const tries = Number(argv.includes('--tries') ? argv[argv.indexOf('--tries') + 1] : 2);
const m = MEMBERS[who];
if (!m) {
  console.log(`members: ${Object.keys(MEMBERS).join(', ')}`);
  process.exit(1);
}
const assetId = `battle.${who}`;
const base = `${ROOT}/assets/${assetId}/${m.option}/north.png`;

/** A black-and-white mask PNG (base64) the size of the sprite, white inside `rects`. */
async function masks() {
  const b = await chromium.launch({ channel: 'msedge' });
  const p = await b.newPage();
  const out = await p.evaluate((poses) => {
    const r = {};
    for (const [name, pose] of Object.entries(poses)) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#000000';
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#ffffff';
      for (const [x, y, w, h] of pose.rects) g.fillRect(x, y, w, h);
      r[name] = c.toDataURL('image/png').split(',')[1];
    }
    return r;
  }, m.poses);
  await b.close();
  return out;
}

const mask = await masks();
const rel = (path) => path.slice(ROOT.length + 1);
const meta = readMeta(assetId);
const opt = meta?.options.find((o) => o.id === m.option);
if (!opt) throw new Error(`no ${assetId}/${m.option}`);
const poses = { ...(opt.poses ?? {}) };
const jobs = [];
for (const [name, pose] of Object.entries(m.poses)) {
  for (let n = (poses[name]?.length ?? 0) + 1; n <= tries; n++) {
    const body = {
      image: image(base),
      mask_image: { type: 'base64', base64: mask[name], format: 'png' },
      description: `16-bit JRPG battle sprite seen from behind: ${m.who}; she ${pose.does}. Same character, same colours, bold black outline.`,
      no_background: true,
      output_method: 'Modify current layer',
      seed: n * 101,
    };
    jobs.push(
      (async () => {
        const r = await spend(`${assetId}/${m.option} pose ${name} #${n}`, 6, 'POST', '/inpaint-image-pro-flash', body, 1);
        try {
          const job = await waitJob(r.background_job_id);
          const lr = job.last_response ?? {};
          const img = lr.images?.[0]?.base64 ?? lr.image?.base64 ?? (typeof lr.image === 'string' ? lr.image : null);
          const path = `${ROOT}/assets/${assetId}/${m.option}/pose-${name}-${n}.png`;
          if (img) saveB64(img, path);
          else if (lr.image_url) {
            const res = await fetch(lr.image_url);
            saveB64(Buffer.from(await res.arrayBuffer()).toString('base64'), path);
          } else throw new Error(`no image in ${Object.keys(lr).join(',')}`);
          (poses[name] ??= []).push(rel(path));
          console.log(`  ok ${name} #${n}`);
        } finally {
          settle(6);
          release(1);
        }
      })().catch((e) => console.log(`  ! ${name} #${n}: ${e.message}`)),
    );
  }
}
await Promise.all(jobs);
for (const list of Object.values(poses)) list.sort();
upsertOption({ id: assetId }, { id: m.option, poses });
console.log(JSON.stringify(poses));
