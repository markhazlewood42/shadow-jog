// Portrait expressions by inpainting: PixelLab redraws only the face (brows, eyes, mouth) of Mark's
// picked portrait for each expression the story uses, so hair, clothes and the drawing around it
// stay exactly as he picked them. The dialogue asks for neutral, happy, sad, angry, surprised, smirk
// and hurt (the battle screen shows hurt and happy); only the ones each speaker uses are made.
//   node scripts/pixellab/expressions.mjs <speaker...>        e.g. kit hex sable dutch
// Writes assets/portrait.<key>/<option>/face-<expression>.png and records `faces` on the option.
import { chromium } from '@playwright/test';
import { ROOT, image, readMeta, release, saveB64, settle, spend, upsertOption, waitJob } from './lib.mjs';

const LOOK = {
  happy: 'smiling warmly, eyes bright and a little crinkled',
  sad: 'sad, brows raised in the middle, eyes lowered, mouth turned down',
  angry: 'angry, brows drawn down hard, eyes narrowed, mouth tight with teeth showing',
  surprised: 'surprised, eyes wide open, brows raised high, mouth open in a small O',
  smirk: 'smirking, one corner of the mouth raised, one brow up, eyes half-lidded',
  hurt: 'in pain, eyes squeezed shut, teeth gritted, brows knotted',
};

/**
 * Per speaker: the picked option, who they are (for the prompt), the face box to redraw
 * [x, y, w, h] on the 48x48 portrait, and the expressions the game uses for them (counted from the
 * story, combos and the battle screen on 2026-09-30).
 */
const SPEAKERS = {
  kit: { option: 'faithful', who: 'a 19-year-old woman with warm brown skin and a dark plum-black ponytail', box: [10, 17, 23, 19], faces: ['happy', 'sad', 'angry', 'surprised', 'smirk', 'hurt'] },
  hex: { option: 'faithful', who: 'a 34-year-old dwarf woman with pale peach skin, teal hair and goggles on her forehead', box: [11, 19, 26, 15], faces: ['happy', 'sad', 'angry', 'surprised', 'smirk', 'hurt'] },
  sable: { option: 'faithful', who: 'a 24-year-old orc with grey-green skin, two small tusks, long off-white hair and gold eyes', box: [12, 18, 25, 14], faces: ['happy', 'sad', 'angry', 'surprised', 'hurt'] },
  dutch: { option: 'faithful', who: 'a big bearded man with dark brown skin and a thick black beard', box: [12, 18, 25, 14], faces: ['happy', 'smirk'] },
};

const want = process.argv.slice(2);
if (!want.length || want.some((w) => !SPEAKERS[w])) {
  console.log(`speakers: ${Object.keys(SPEAKERS).join(', ')}`);
  process.exit(1);
}

// One mask per speaker: white inside the face box.
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
const masks = await page.evaluate((boxes) => {
  const out = {};
  for (const [k, [x, y, w, h]] of Object.entries(boxes)) {
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 48;
    const g = c.getContext('2d');
    g.fillStyle = '#000000';
    g.fillRect(0, 0, 48, 48);
    g.fillStyle = '#ffffff';
    g.fillRect(x, y, w, h);
    out[k] = c.toDataURL('image/png').split(',')[1];
  }
  return out;
}, Object.fromEntries(want.map((k) => [k, SPEAKERS[k].box])));
await browser.close();

const jobs = [];
for (const key of want) {
  const sp = SPEAKERS[key];
  const assetId = `portrait.${key}`;
  const opt = readMeta(assetId)?.options.find((o) => o.id === sp.option);
  if (!opt?.image) {
    console.log(`  ! ${assetId}/${sp.option}: no image`);
    continue;
  }
  const faces = { ...(opt.faces ?? {}) };
  for (const face of sp.faces) {
    if (faces[face]) continue;
    const body = {
      image: image(`${ROOT}/${opt.image}`),
      mask_image: { type: 'base64', base64: masks[key], format: 'png' },
      description: `16-bit JRPG dialogue portrait of ${sp.who}, ${LOOK[face]}. Same character, same colours, same art style, dark outline.`,
      no_background: true,
      output_method: 'Modify current layer',
      seed: 7,
    };
    jobs.push(
      (async () => {
        const r = await spend(`${assetId}/${sp.option} face ${face}`, 5, 'POST', '/inpaint-image-pro-flash', body, 1);
        try {
          const job = await waitJob(r.background_job_id);
          const lr = job.last_response ?? {};
          const b64 = lr.images?.[0]?.base64 ?? lr.image?.base64 ?? (typeof lr.image === 'string' ? lr.image : null);
          const path = `${ROOT}/assets/${assetId}/${sp.option}/face-${face}.png`;
          if (b64) saveB64(b64, path);
          else if (lr.image_url) saveB64(Buffer.from(await (await fetch(lr.image_url)).arrayBuffer()).toString('base64'), path);
          else throw new Error(`no image in ${Object.keys(lr).join(',')}`);
          faces[face] = path.slice(ROOT.length + 1);
          // Recorded as each lands, so a stopped run keeps what it paid for.
          upsertOption({ id: assetId }, { id: sp.option, faces });
          console.log(`  ok ${key} ${face}`);
        } finally {
          settle(5);
          release(1);
        }
      })().catch((e) => console.log(`  ! ${key} ${face}: ${e.message}`)),
    );
  }
}
await Promise.all(jobs);
console.log('done');
