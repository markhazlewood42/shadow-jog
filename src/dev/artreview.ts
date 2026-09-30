/**
 * The art-pass review page (dev only: /artreview.html on the dev server). Shows every asset the
 * PixelLab pass generated (scripts/pixellab/) next to the game's current art, at the same screen
 * scale, with animations playing. Mark marks each option Best / Good / No, leaves notes, and can
 * try his picks in the game (?art=review). Everything saves to media/art-pass/review.json through
 * the dev server's /__artpass endpoint (vite.config.ts), which the next generation round reads.
 */

// A module (not a script), so its names don't collide with the DOM's globals (window.status).
export {};

type Verdict = 'best' | 'good' | 'no';
interface Current {
  file: string;
  label: string;
  /** Screen pixels per art pixel (today's battle art is drawn at 2x). */
  scale: number;
}
interface Anim {
  label?: string;
  frames?: Record<string, string[]>;
}
interface Option {
  id: string;
  label?: string;
  recipe?: string;
  kind?: 'character' | 'image' | 'tileset' | 'mapobject';
  status?: string;
  error?: string | null;
  scale?: number;
  showDir?: string;
  rotations?: Record<string, string>;
  anims?: Record<string, Anim>;
  image?: string;
  tiles?: { file: string; corners?: Record<string, string> | null }[];
}
interface Asset {
  id: string;
  category: string;
  title: string;
  kind: string;
  note?: string;
  map?: string;
  current?: Current[];
  options: Option[];
}
interface OptionReview {
  verdict?: Verdict | null;
  note?: string;
}
interface Review {
  assets: Record<string, { note?: string; options?: Record<string, OptionReview> }>;
}
interface Data {
  assets: Asset[];
  review: Review;
  spend: { requests: number; estimated: number; balance: { generations: number; at: string } | null };
}

const ROOT = '/media/art-pass/';
const CATEGORY_ORDER = ['Crew · field', 'Crew · battle', 'Enemies', 'Bosses', 'Portraits', 'Named NPCs', 'Townsfolk', 'Terrain', 'Props'];
const DIRS = ['south', 'east', 'north', 'west'];
const DIR_LABEL: Record<string, string> = { south: 'down', east: 'right', north: 'up', west: 'left' };

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const k of kids) if (k != null) el.append(k);
  return el;
}

// ------------------------------------------------------------------ view settings (per viewer)

const prefs = { zoom: 3, bg: 'dark', show: 'all' };
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem('artreview.prefs') ?? '{}'));
} catch {
  // Private window or blocked storage: defaults are fine.
}
function savePrefs(): void {
  try {
    localStorage.setItem('artreview.prefs', JSON.stringify(prefs));
  } catch {
    // Not important.
  }
}

// ------------------------------------------------------------------ images and animation

const images = new Map<string, Promise<HTMLImageElement>>();
function load(path: string): Promise<HTMLImageElement> {
  let p = images.get(path);
  if (!p) {
    p = new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error(`couldn't load ${path}`));
      img.src = ROOT + path;
    });
    images.set(path, p);
  }
  return p;
}

interface Player {
  canvas: HTMLCanvasElement;
  frames: HTMLImageElement[];
  fps: number;
  scale: number;
  shown: number;
  visible: boolean;
}
const players = new Set<Player>();
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) for (const p of players) if (p.canvas === e.target) p.visible = e.isIntersecting;
});

function paint(p: Player, i: number): void {
  const img = p.frames[i];
  if (!img) return;
  const g = p.canvas.getContext('2d');
  if (!g) return;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, p.canvas.width, p.canvas.height);
  g.drawImage(img, 0, 0, img.width * p.scale, img.height * p.scale);
  p.shown = i;
}

/** A canvas showing `paths` (one still, or an animation at `fps`) at `scale` screen px per art px. */
function sprite(paths: string[], scale: number, fps = 8): HTMLCanvasElement {
  const canvas = h('canvas');
  const s = scale * prefs.zoom;
  Promise.all(paths.map(load)).then(
    (frames) => {
      const w = Math.max(...frames.map((f) => f.width));
      const hgt = Math.max(...frames.map((f) => f.height));
      canvas.width = w * s;
      canvas.height = hgt * s;
      const p: Player = { canvas, frames, fps, scale: s, shown: -1, visible: true };
      paint(p, 0);
      if (frames.length > 1) {
        players.add(p);
        seen.observe(canvas);
      }
    },
    () => {
      canvas.width = 48;
      canvas.height = 16;
      canvas.title = `missing: ${paths[0]}`;
    },
  );
  return canvas;
}

function tick(t: number): void {
  for (const p of players) {
    if (!p.visible || !p.canvas.isConnected) continue;
    const i = Math.floor((t / 1000) * p.fps) % p.frames.length;
    if (i !== p.shown) paint(p, i);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ------------------------------------------------------------------ the review file

let data: Data | null = null;
let saveTimer = 0;
const status = { text: 'Loading…', error: '' };

function renderStatus(): void {
  const el = $('status');
  el.textContent = '';
  if (status.error) el.append(h('span', { class: 'err' }, status.error), h('br'));
  el.append(status.text);
}

function reviewOf(assetId: string): { note?: string; options?: Record<string, OptionReview> } {
  if (!data) throw new Error('no data');
  let r = data.review.assets[assetId];
  if (!r) {
    r = {};
    data.review.assets[assetId] = r;
  }
  return r;
}

function optReview(assetId: string, optId: string): OptionReview {
  const r = reviewOf(assetId);
  if (!r.options) r.options = {};
  let o = r.options[optId];
  if (!o) {
    o = {};
    r.options[optId] = o;
  }
  return o;
}

function save(): void {
  clearTimeout(saveTimer);
  status.text = 'Saving…';
  renderStatus();
  saveTimer = window.setTimeout(async () => {
    if (!data) return;
    try {
      const res = await fetch('/__artpass/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data.review) });
      const body = (await res.json()) as { ok: boolean; problem?: string };
      if (!body.ok) throw new Error(body.problem ?? `HTTP ${res.status}`);
      status.error = '';
      status.text = `Saved ${new Date().toLocaleTimeString()} · ${summary()}`;
    } catch (e) {
      status.error = `Not saved: ${e instanceof Error ? e.message : String(e)}. Your choices are still on the page; try again.`;
      status.text = summary();
    }
    renderStatus();
    renderNav();
  }, 500);
}

function decided(a: Asset): boolean {
  const r = data?.review.assets[a.id];
  return !!r && Object.values(r.options ?? {}).some((o) => o.verdict === 'best');
}

function summary(): string {
  if (!data) return '';
  const n = data.assets.length;
  const opts = data.assets.reduce((k, a) => k + a.options.filter((o) => o.status === 'done').length, 0);
  const d = data.assets.filter(decided).length;
  const bal = data.spend.balance ? ` · PixelLab balance ${data.spend.balance.generations}` : '';
  return `${n} assets · ${opts} options ready · ${d} picked${bal}`;
}

// ------------------------------------------------------------------ option viewers

function cell(canvas: HTMLCanvasElement, label: string): HTMLElement {
  return h('div', { class: 'cell' }, canvas, h('span', {}, label));
}

function stage(...kids: HTMLElement[]): HTMLElement {
  return h('div', { class: `stage ${prefs.bg}` }, ...kids);
}

function characterView(a: Asset, o: Option): HTMLElement {
  const scale = o.scale ?? 1;
  const rot = o.rotations ?? {};
  const anims = Object.entries(o.anims ?? {}).filter(([, v]) => v.frames);
  if (a.kind === 'battler') {
    // One direction (from behind), with a chip per animation.
    const dir = o.showDir ?? 'north';
    const box = stage();
    const chips = h('div', { class: 'chips' });
    const show = (name: string | null) => {
      box.textContent = '';
      const frames = name ? o.anims?.[name]?.frames?.[dir] : null;
      box.append(cell(sprite(frames ?? [rot[dir] ?? Object.values(rot)[0] ?? ''], scale, 10), name ? (o.anims?.[name]?.label ?? name) : 'standing'));
      if (rot.south) box.append(cell(sprite([rot.south], scale / 2), 'front (½)'));
      for (const c of chips.children) c.setAttribute('aria-pressed', String((c as HTMLElement).dataset.name === (name ?? '')));
    };
    for (const [name, v] of [['', { label: 'Standing' }] as const, ...anims]) {
      const b = h('button', { class: 'chip', 'data-name': name }, v.label ?? name);
      b.onclick = () => show(name || null);
      chips.append(b);
    }
    show(anims.find(([n]) => n === 'idle') ? 'idle' : null);
    return h('div', {}, box, chips);
  }
  // Field sprites: the four facings, walking if there's a walk cycle.
  const walk = o.anims?.walk?.frames;
  const box = stage();
  for (const d of DIRS) {
    const frames = walk?.[d] ?? (rot[d] ? [rot[d]] : null);
    if (frames) box.append(cell(sprite(frames, scale, 7), DIR_LABEL[d] ?? d));
  }
  const still = stage();
  for (const d of DIRS) if (rot[d]) still.append(cell(sprite([rot[d]], scale), DIR_LABEL[d] ?? d));
  return walk ? h('div', {}, box, h('div', { style: 'height:6px' }), still) : box;
}

/**
 * A sample patch of ground laid from a Wang tileset: a grid of corner values (the upper terrain in
 * a couple of blobs), and in each cell the tile whose four corners match. This is how a map would
 * use the set, so it shows whether the tiles join up.
 */
function wangPatch(o: Option, cols = 14, rows = 9): HTMLCanvasElement {
  const canvas = h('canvas');
  const tiles = o.tiles ?? [];
  const s = (o.scale ?? 1) * prefs.zoom;
  const upper = (x: number, y: number) => {
    const a = Math.hypot((x - cols * 0.3) / 3.2, (y - rows * 0.45) / 2.6);
    const b = Math.hypot((x - cols * 0.75) / 2.4, (y - rows * 0.6) / 3.4);
    return Math.min(a, b) < 1 || y === 0;
  };
  Promise.all(tiles.map((t) => load(t.file))).then(
    (imgs) => {
      const size = imgs[0]?.width ?? 16;
      canvas.width = cols * size * s;
      canvas.height = rows * size * s;
      const g = canvas.getContext('2d');
      if (!g) return;
      g.imageSmoothingEnabled = false;
      const byCorners = new Map<string, HTMLImageElement>();
      tiles.forEach((t, i) => {
        const c = t.corners;
        const img = imgs[i];
        if (c && img) byCorners.set(`${c.NW}${c.NE}${c.SW}${c.SE}`, img);
      });
      const v = (x: number, y: number) => (upper(x, y) ? 'upper' : 'lower');
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const img = byCorners.get(`${v(x, y)}${v(x + 1, y)}${v(x, y + 1)}${v(x + 1, y + 1)}`);
          if (img) g.drawImage(img, x * size * s, y * size * s, size * s, size * s);
        }
    },
    () => {
      canvas.title = 'tiles missing';
    },
  );
  return canvas;
}

function tilesetView(o: Option): HTMLElement {
  const tiles = o.tiles ?? [];
  const grid = stage(...tiles.map((t) => sprite([t.file], o.scale ?? 1)));
  grid.style.gap = '2px';
  return h('div', {}, stage(cell(wangPatch(o), 'laid out as a map would use it')), h('div', { style: 'height:6px' }), grid);
}

function optionBody(a: Asset, o: Option): HTMLElement {
  if (o.status !== 'done') {
    if (o.status === 'failed' || o.status === 'budget') return h('div', { class: 'failed' }, `Didn’t generate: ${o.error ?? 'unknown error'}`);
    return h('div', { class: 'pending' }, 'Generating… (Refresh to check)');
  }
  if (o.kind === 'character') return characterView(a, o);
  if (o.kind === 'tileset') return tilesetView(o);
  if (o.image) return stage(sprite([o.image], o.scale ?? 1));
  return h('div', { class: 'failed' }, 'Nothing to show');
}

// ------------------------------------------------------------------ try in game

/** The game URL that shows this asset with `optIds` swapped in (src/dev/artswap.ts). */
function tryUrl(a: Asset, picks: string[]): string {
  const q = new URLSearchParams({ debug: '', art: 'review', try: picks.join(',') });
  if (a.kind === 'enemy') {
    q.set('scene', 'battle');
    q.set('enemies', [a.id.split('.')[1], a.id.split('.')[1]].join(','));
    if (a.category === 'Bosses') {
      q.set('enemies', a.id.split('.')[1] ?? '');
      q.set('boss', '');
    }
  } else if (a.kind === 'battler') q.set('scene', 'battle');
  else if (a.kind === 'portrait') q.set('scene', 'portraits');
  else if (a.kind === 'field' || a.kind === 'npc') {
    q.set('scene', 'field');
    q.set('map', a.map ?? 'lantern_row');
  }
  return `/?${q.toString().replace(/=(&|$)/g, '$1')}`;
}
const TRYABLE = new Set(['field', 'npc', 'battler', 'enemy', 'portrait']);

// ------------------------------------------------------------------ the page

function optionFigure(a: Asset, o: Option): HTMLElement {
  const rev = optReview(a.id, o.id);
  const fig = h('figure', { 'data-verdict': rev.verdict ?? '' });
  const verdicts = h('div', { class: 'verdicts' });
  const labels: [Verdict, string, string][] = [
    ['best', '★ Best', 'The one to use (one per asset)'],
    ['good', '✓ Good', 'Would work; keep it in mind'],
    ['no', '✗ No', 'Not this one'],
  ];
  for (const [v, text, title] of labels) {
    const b = h('button', { 'data-v': v, title, 'aria-pressed': String(rev.verdict === v) }, text);
    b.onclick = () => {
      const next = rev.verdict === v ? null : v;
      // One Best per asset: a previous Best becomes Good.
      if (next === 'best') for (const other of a.options) if (other.id !== o.id && optReview(a.id, other.id).verdict === 'best') optReview(a.id, other.id).verdict = 'good';
      rev.verdict = next;
      save();
      rerenderAsset(a);
    };
    verdicts.append(b);
  }
  if (TRYABLE.has(a.kind) && o.status === 'done') {
    const t = h('a', { class: 'chip try', href: tryUrl(a, [`${a.id}/${o.id}`]), target: '_blank', rel: 'noopener', title: 'Open the game with this one swapped in' }, 'Try ↗');
    verdicts.append(t);
  }
  const note = h('input', { class: 'optnote', placeholder: 'Note on this one…', value: rev.note ?? '' });
  note.oninput = () => {
    rev.note = note.value;
    save();
  };
  fig.append(optionBody(a, o), h('figcaption', {}, h('b', {}, o.label ?? o.id), o.recipe ? ` · ${o.recipe}` : ''), verdicts, note);
  return fig;
}

function assetArticle(a: Asset): HTMLElement {
  const art = h('article', { id: a.id, class: decided(a) ? 'decided' : '' });
  art.append(h('h3', {}, a.title, h('small', {}, a.id)));
  if (a.note) art.append(h('p', { class: 'note' }, a.note));
  const row = h('div', { class: 'row' });
  if (a.current?.length) {
    const cur = h('figure', { class: 'current' });
    const box = stage(...a.current.map((c) => cell(sprite([c.file], c.scale), c.label.replace(/^Now:?\s*/, '') || 'now')));
    cur.append(box, h('figcaption', {}, h('b', {}, 'Now'), ' · the game today, same scale'));
    row.append(cur);
  }
  for (const o of a.options) row.append(optionFigure(a, o));
  art.append(row);
  const note = h('textarea', { placeholder: `Notes on ${a.title} overall (what works, what to change, what to try next)…` });
  note.value = reviewOf(a.id).note ?? '';
  note.oninput = () => {
    reviewOf(a.id).note = note.value;
    save();
  };
  art.append(note);
  return art;
}

function rerenderAsset(a: Asset): void {
  const old = document.getElementById(a.id);
  if (old) old.replaceWith(assetArticle(a));
}

function visible(a: Asset): boolean {
  if (prefs.show === 'open') return !decided(a);
  if (prefs.show === 'picked') return decided(a);
  return true;
}

function categories(): [string, Asset[]][] {
  const by = new Map<string, Asset[]>();
  for (const a of data?.assets ?? []) by.set(a.category, [...(by.get(a.category) ?? []), a]);
  const rank = (c: string) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : 99);
  return [...by.entries()].sort((x, y) => rank(x[0]) - rank(y[0]));
}

function renderNav(): void {
  const nav = $('nav');
  nav.textContent = '';
  for (const [cat, list] of categories()) {
    nav.append(h('h2', {}, cat));
    for (const a of list) {
      const link = h('a', { href: `#${a.id}`, class: decided(a) ? 'done' : '' }, a.title, h('span', { class: 'n' }, decided(a) ? '★' : `${a.options.filter((o) => o.status === 'done').length}`));
      nav.append(link);
    }
  }
}

function renderMain(): void {
  players.clear();
  const main = $('main');
  main.textContent = '';
  main.append(
    h(
      'p',
      { class: 'intro' },
      'Each row is one asset: ',
      h('b', {}, 'Now'),
      ' is the game today; the rest are PixelLab options at the same screen scale. Mark one ',
      h('b', {}, '★ Best'),
      ' per asset, ',
      h('b', {}, '✓ Good'),
      ' for fallbacks, ',
      h('b', {}, '✗ No'),
      ' for misses, and say why in the notes. It all saves as you go. ',
      h('b', {}, 'Try ↗'),
      ' opens the game with that option swapped in; ',
      h('b', {}, 'Try picks in game'),
      ' swaps in every Best.',
    ),
  );
  for (const [cat, list] of categories()) {
    const shown = list.filter(visible);
    if (!shown.length) continue;
    const sec = h('section', {}, h('h2', {}, cat));
    for (const a of shown) sec.append(assetArticle(a));
    main.append(sec);
  }
  if (!data?.assets.length) main.append(h('p', { class: 'intro' }, 'Nothing generated yet. Run scripts/pixellab/pass.mjs.'));
}

function controls(): void {
  const mk = (groupId: string, key: 'zoom' | 'bg' | 'show', values: [string | number, string][]) => {
    const g = $(groupId);
    for (const el of [...g.querySelectorAll('button')]) el.remove();
    for (const [v, label] of values) {
      const b = h('button', { class: 'chip', 'aria-pressed': String(prefs[key] === v) }, label);
      b.onclick = () => {
        (prefs as Record<string, string | number>)[key] = v;
        savePrefs();
        controls();
        renderMain();
      };
      g.append(b);
    }
  };
  mk('zoom', 'zoom', [
    [2, '2x'],
    [3, '3x'],
    [4, '4x'],
  ]);
  mk('bgs', 'bg', [
    ['dark', 'Dark'],
    ['mid', 'Mid'],
    ['light', 'Light'],
  ]);
  mk('show', 'show', [
    ['all', 'All'],
    ['open', 'Not picked'],
    ['picked', 'Picked'],
  ]);
}

let first = true;
async function refresh(): Promise<void> {
  try {
    const res = await fetch('/__artpass/data', { cache: 'no-store' });
    const body = (await res.json()) as Data & { ok: boolean; problem?: string };
    if (!body.ok) throw new Error(body.problem ?? `HTTP ${res.status}`);
    // Keep choices made on this page since the last save.
    const mine = data?.review;
    data = body;
    if (mine) data.review = mine;
    if (!data.review.assets) data.review.assets = {};
    status.error = '';
    status.text = summary();
  } catch (e) {
    status.error = `Couldn’t load the art pass: ${e instanceof Error ? e.message : String(e)}. Is the dev server running (npm run dev)?`;
  }
  renderStatus();
  renderNav();
  const y = window.scrollY;
  renderMain();
  // Keep the place on a refresh; on first load, go to the #asset in the address.
  if (first && location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  else window.scrollTo(0, y);
  first = false;
  const picks = (data?.assets ?? []).flatMap((a) => a.options.filter((o) => optReview(a.id, o.id).verdict === 'best').map((o) => `${a.id}/${o.id}`));
  const t = $<HTMLAnchorElement>('trypicks');
  t.href = picks.length ? `/?debug&art=review&try=${picks.join(',')}` : '/?debug&art=review';
}

$('reload').onclick = () => void refresh();
controls();
void refresh();
