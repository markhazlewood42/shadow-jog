/**
 * The animation editor (dev only, /rigedit.html): Mark poses the crew's battle backs on their
 * skeletons (src/art/rig2/battle.ts). Pick someone and a pose, drag the hand, and the elbow bends
 * by itself (two-bone IK), so an arm can't stretch. Sliders cover the rest (the hand's turn, a
 * weapon's angle, how far it reaches into the screen, the light). Save writes public/art/rig/skeleton.json through
 * the dev server (vite.config.ts `rigEdit`); the game loads it at startup. A note per pose is for
 * Claude to work through in a session ("her fist should end higher, level with her ear").
 *
 * The skeleton's own joints (where the shoulder, elbow and wrist are at rest, and how far each
 * bone's pixels reach) are under "Skeleton setup": set once per character.
 *
 * The turntable (the dial in the canvas's corner, or [ and ]) turns the character to each of the
 * 8 drawn views (public/art/rig/views.json, traced from the picks). Posing works on the back view,
 * the one the battle shows; the others are the drawings, for now.
 */
import { type ArmPose, type BattleRig, KEY_POSES, type KeyPose, type Posed, TILT, arcEnds, defaultBend, poseFrame, poseGlow, project, resetRig } from '../art/rig2/battle';
import { SKELETONS, loadRigData } from '../art/rig2/data';
import { type Traced, decode, renderLayers } from '../art/rig2/rig';

type Pt = [number, number];

/** Editor zoom (art pixels to screen pixels), and the preview's. */
const Z = 4;
const PZ = 2;
const SIZE = 128;
const WHO = ['kit', 'rook', 'hex', 'sable'] as const;
const NAMES: Record<string, string> = { kit: 'Kit', rook: 'Rook', hex: 'Hex', sable: 'Sable' };
/** Each pose in plain words: its name, and what it's for. */
const POSE_HELP: Record<KeyPose, [string, string]> = {
  brace: ['Ready', 'winding up, just before the move'],
  windup: ['Raised', 'the weapon drawn back, just before the strike'],
  strike: ['Strike', 'the hit itself'],
  raise: ['Cast', 'a spell, a program or an item'],
  victory: ['Victory', 'after a won fight'],
};
/** The pose shown faintly behind each one: the one the move comes from (a strike's Raised pose, if it has one). */
const beforeOf = (r: BattleRig, k: KeyPose): KeyPose | null => (k === 'strike' ? (r.poses.windup ? 'windup' : 'brace') : k === 'windup' ? 'brace' : null);
/** The poses a character has to pick from: Raised only for those with one (Rook's two-handed cut). */
const posesOf = (r: BattleRig) => KEY_POSES.filter((k) => k !== 'windup' || r.poses.windup);
/** How each pose plays in the preview: (pose or null for standing, frames held). */
const moveOf = (r: BattleRig, k: KeyPose) =>
  k === 'strike' && r.poses.windup ? ([[null, 30], ['brace', 10], ['windup', 10], ['strike', 26]] as [KeyPose | null, number][]) : MOVE[k];
const MOVE: Record<KeyPose, [KeyPose | null, number][]> = {
  brace: [[null, 40], ['brace', 40]],
  windup: [[null, 30], ['brace', 12], ['windup', 40]],
  strike: [[null, 30], ['brace', 12], ['strike', 22], ['brace', 8]],
  raise: [[null, 30], ['raise', 40]],
  victory: [[null, 40], ['victory', 50]],
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids) if (kid !== null) el.append(kid);
  return el;
}

// ---- State ----------------------------------------------------------------------------------

/** The skeletons being edited (saved ones stay in SKELETONS until Save). */
let work: Record<string, BattleRig> = {};
let who: string = WHO[0];
let pose: KeyPose = 'strike';
let dirty = false;
const undo: string[] = [];
let drag: null | 'hand' | 'elbow' | 'grip' | 'shoulder' | 'restElbow' | 'wrist' | 'arcFrom' | 'arcBend' | 'freeHand' | 'freeElbow' | 'freeShoulder' | 'freeRestElbow' | 'freeWrist' = null;
/** The impact's swept arc as last drawn: where it starts, its bend and where it lands (for the handles). */
let arcShown: { from: Pt; bend: Pt; to: Pt } | null = null;
let setup = false;

const rig = () => work[who] as BattleRig;
const current = (): ArmPose => {
  const r = rig();
  r.poses[pose] ??= { hand: [...r.arm.wrist] as Pt };
  return r.poses[pose] as ArmPose;
};
/** Remember the state before a change (one undo step per drag or slider move). */
function remember(): void {
  undo.push(JSON.stringify(work));
  if (undo.length > 100) undo.shift();
}
function changed(): void {
  dirty = true;
  refresh();
}
/** Redraw after looking at something else (another pose, someone else): nothing to save for it. */
function refresh(): void {
  draw();
  side();
}

function status(text: string, kind: '' | 'bad' | 'good' = ''): void {
  const el = $('status');
  if (!el) return;
  el.textContent = text;
  el.className = kind;
}

// ---- Drawing --------------------------------------------------------------------------------

const edit = $<HTMLCanvasElement>('edit');
edit.width = SIZE * Z;
edit.height = SIZE * Z;
const g = edit.getContext('2d') as CanvasRenderingContext2D;
g.imageSmoothingEnabled = false;
let shown: Posed | null = null;

/** The free arm's handles: its hand and its elbow. */
const FREE_HAND = '#ff6ad5';
const FREE_ELBOW = '#ffb3ec';

/** Where the green handle sits: past the wrist along the hand's direction. */
function gripHandle(p: Posed, a: ArmPose): Pt {
  const ang = Math.atan2(p.wrist[1] - p.elbow[1], p.wrist[0] - p.elbow[0]) + ((a.grip ?? 0) * Math.PI) / 180;
  return [p.wrist[0] + Math.cos(ang) * 9, p.wrist[1] + Math.sin(ang) * 9];
}

// ---- Side view ------------------------------------------------------------------------------
// The arm seen from the side: depth across (toward the enemy to the right), height down. Drag the
// hand to reach forward or pull back; the main picture shows what the battle sees.

const sidec = $<HTMLCanvasElement>('sidec');
const sg = sidec.getContext('2d') as CanvasRenderingContext2D;
/** Side-view pixels per art pixel, and where the shoulder sits in it. */
const SZ = 1.6;
const SIDE_O: Pt = [44, 54];
function drawSide(p: Posed | null, a: ArmPose): void {
  sg.clearRect(0, 0, sidec.width, sidec.height);
  const wrap = $('side3d');
  // Hidden, not removed, so the picture beside it doesn't jump.
  wrap.style.visibility = p && !setup && !view ? '' : 'hidden';
  if (!p || setup || view) return;
  const sy = p.shoulder[1];
  const at = (z: number, y: number): Pt => [SIDE_O[0] + z * SZ, SIDE_O[1] + (y - sy) * SZ];
  // The body, side on: a head over a column down to the ground.
  sg.fillStyle = 'rgba(155,150,173,0.35)';
  const [hx, hy] = at(0, sy - 16);
  sg.beginPath();
  sg.arc(hx, hy, 9, 0, Math.PI * 2);
  sg.fill();
  const [bx, by] = at(0, sy - 4);
  sg.fillRect(bx - 6, by, 12, 62 * SZ);
  sg.fillStyle = 'rgba(155,150,173,0.25)';
  sg.fillRect(0, by + 62 * SZ, sidec.width, 1);
  // Which way the enemy is.
  sg.fillStyle = '#6f6a82';
  sg.font = '10px system-ui, sans-serif';
  sg.fillText('enemy →', sidec.width - 46, 12);
  // The arm: shoulder, elbow, wrist, with their depth (none: flat on the screen).
  const e = p.depth?.elbow ?? [p.elbow[0], p.elbow[1], 0];
  const w = p.depth?.wrist ?? [p.wrist[0], p.wrist[1], 0];
  const s = at(0, sy), ep = at(e[2], e[1]), wp = at(w[2], w[1]);
  sg.strokeStyle = 'rgba(255,255,255,0.75)';
  sg.lineWidth = 2;
  sg.beginPath();
  sg.moveTo(...s);
  sg.lineTo(...ep);
  sg.lineTo(...wp);
  sg.stroke();
  const dot = (q: Pt, c: string, r: number) => {
    sg.fillStyle = c;
    sg.beginPath();
    sg.arc(q[0], q[1], r, 0, Math.PI * 2);
    sg.fill();
  };
  dot(s, '#8a86a0', 4);
  dot(ep, '#3fe0f0', 4);
  dot(wp, '#ffa24a', 6);
  // Where the hand was asked to go, if out of reach.
  const asked = at(a.depth ?? 0, a.hand[1]);
  if (Math.hypot(asked[0] - wp[0], asked[1] - wp[1]) > 3) {
    sg.strokeStyle = 'rgba(255,162,74,0.7)';
    sg.lineWidth = 1;
    sg.beginPath();
    sg.arc(asked[0], asked[1], 6, 0, Math.PI * 2);
    sg.stroke();
  }
}
let sideDrag = false;
const sideMove = (e: PointerEvent) => {
  const b = sidec.getBoundingClientRect();
  const mx = ((e.clientX - b.left) / b.width) * sidec.width, my = ((e.clientY - b.top) / b.height) * sidec.height;
  const p = shown;
  if (!p) return;
  const a = current();
  const z = Math.max(-24, Math.min(64, Math.round((mx - SIDE_O[0]) / SZ)));
  a.hand = [a.hand[0], Math.round(p.shoulder[1] + (my - SIDE_O[1]) / SZ)];
  if (z) a.depth = z;
  else delete a.depth;
  changed();
};
sidec.addEventListener('pointerdown', (e) => {
  if (!shown) return;
  remember();
  sideDrag = true;
  sidec.setPointerCapture(e.pointerId);
  sideMove(e);
});
sidec.addEventListener('pointermove', (e) => {
  if (sideDrag) sideMove(e);
});
sidec.addEventListener('pointerup', () => {
  sideDrag = false;
});

// ---- Turntable ------------------------------------------------------------------------------

/** The 8 views, clockwise from the back (the battle's), as seen from above with us at the bottom. */
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;
const DIR_NAMES = ['Back', 'Back, turned right', 'Right side', 'Front, turned right', 'Front', 'Front, turned left', 'Left side', 'Back, turned left'];
/** Every crew member's drawing from each side (loaded at start; the game doesn't use these). */
let views: Record<string, Record<string, Traced & { ox: number; oy: number }>> = {};
let view = 0;
const viewCache = new Map<string, HTMLCanvasElement>();
function viewFrame(id: string, d: string): HTMLCanvasElement | null {
  const k = `${id}:${d}`;
  const hit = viewCache.get(k);
  if (hit) return hit;
  const t = views[id]?.[d];
  if (!t) return null;
  const c = renderLayers([{ ...decode(t), ox: t.ox, oy: t.oy }], t.pal, SIZE, SIZE);
  viewCache.set(k, c);
  return c;
}

const dial = $<HTMLCanvasElement>('dialc');
const dg = dial.getContext('2d') as CanvasRenderingContext2D;
function drawDial(): void {
  const s = dial.width, c = s / 2, r = s / 2 - 10;
  dg.clearRect(0, 0, s, s);
  dg.strokeStyle = '#3a3550';
  dg.lineWidth = 2;
  dg.beginPath();
  dg.arc(c, c, r, 0, Math.PI * 2);
  dg.stroke();
  // A tick per view; the ones with a drawing are brighter.
  DIRS.forEach((d, i) => {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    dg.fillStyle = i === view ? '#ffa24a' : views[who]?.[d] ? '#8a86a0' : '#3a3550';
    dg.beginPath();
    dg.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, i === view ? 5 : 3, 0, Math.PI * 2);
    dg.fill();
  });
  // The way the character faces, from the middle.
  const a = (view / 8) * Math.PI * 2 - Math.PI / 2;
  dg.strokeStyle = '#ffa24a';
  dg.lineWidth = 3;
  dg.beginPath();
  dg.moveTo(c, c);
  dg.lineTo(c + Math.cos(a) * (r - 6), c + Math.sin(a) * (r - 6));
  dg.stroke();
  dg.fillStyle = '#e9e6f2';
  dg.beginPath();
  dg.arc(c, c, 4, 0, Math.PI * 2);
  dg.fill();
  // Where we are: below the circle, looking up at the character.
  dg.fillStyle = '#9b96ad';
  dg.beginPath();
  dg.moveTo(c, s - 7);
  dg.lineTo(c - 5, s - 1);
  dg.lineTo(c + 5, s - 1);
  dg.fill();
  const name = $('view-name');
  name.textContent = view ? `${DIR_NAMES[view]}: the drawing (posing is on the back)` : 'Back: the battle’s view, posable';
}
function turn(to: number): void {
  view = ((to % 8) + 8) % 8;
  drawDial();
  draw();
}
let turning = false;
const dialAt = (e: PointerEvent) => {
  const b = dial.getBoundingClientRect();
  const x = e.clientX - b.left - b.width / 2, y = e.clientY - b.top - b.height / 2;
  // Clockwise from straight up, snapped to the nearest view.
  const deg = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
  turn(Math.round(deg / 45));
};
dial.addEventListener('pointerdown', (e) => {
  turning = true;
  dial.setPointerCapture(e.pointerId);
  dialAt(e);
});
dial.addEventListener('pointermove', (e) => {
  if (turning) dialAt(e);
});
dial.addEventListener('pointerup', () => {
  turning = false;
});

function draw(): void {
  const r = rig();
  const a = current();
  g.clearRect(0, 0, edit.width, edit.height);
  // A grid every 8 art pixels, for judging heights.
  g.fillStyle = 'rgba(255,255,255,0.035)';
  for (let x = 0; x < SIZE; x += 8) g.fillRect(x * Z, 0, 1, edit.height);
  for (let y = 0; y < SIZE; y += 8) g.fillRect(0, y * Z, edit.width, 1);
  // Turned away from the back: the drawing for that side, nothing to pose.
  if (view) {
    shown = null;
    drawSide(null, a);
    const f = viewFrame(who, DIRS[view] ?? 'north');
    if (f) g.drawImage(f, 0, 0, edit.width, edit.height);
    return;
  }
  const before = beforeOf(r, pose);
  if (($<HTMLInputElement>('onion')).checked) {
    const b = poseFrame(who, before ? (r.poses[before] ?? null) : null, r);
    if (b) {
      g.globalAlpha = 0.28;
      g.drawImage(b.frame, 0, 0, edit.width, edit.height);
      g.globalAlpha = 1;
    }
  }
  const p = poseFrame(who, setup ? null : a, r);
  shown = p;
  drawSide(p, a);
  if (!p) {
    status(`No traced frame for ${NAMES[who] ?? who}.`, 'bad');
    return;
  }
  g.drawImage(p.frame, 0, 0, edit.width, edit.height);
  arcShown = null;
  if (!setup) {
    const from = poseFrame(who, before ? (r.poses[before] ?? null) : null, r);
    if (from && a.light === 'impact') {
      const ends = arcEnds(a, p, from);
      const start = a.arc?.from ?? ends.from;
      arcShown = { from: [...start] as Pt, bend: [...(a.arc?.bend ?? defaultBend(start, ends.to))] as Pt, to: [...ends.to] as Pt };
    }
    const glow = from && poseGlow(r, a, p, from);
    if (glow) {
      g.globalCompositeOperation = 'lighter';
      g.drawImage(glow, 0, 0, edit.width, edit.height);
      g.globalCompositeOperation = 'source-over';
    }
  }
  if (!($<HTMLInputElement>('joints')).checked && !setup) return;
  const S = (q: readonly [number, number]): Pt => [q[0] * Z, q[1] * Z];
  const dot = (q: readonly [number, number], color: string, rad: number) => {
    const [x, y] = S(q);
    g.fillStyle = '#0d0c14';
    g.beginPath();
    g.arc(x, y, rad + 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  };
  const line = (q: readonly [number, number], t: readonly [number, number], color: string) => {
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(...S(q));
    g.lineTo(...S(t));
    g.stroke();
  };
  if (setup) {
    // The rest joints, and the boxes the arm's and the hand's pixels are taken from.
    const box = (b: readonly number[], color: string) => {
      g.strokeStyle = color;
      g.setLineDash([6, 4]);
      g.strokeRect((b[0] ?? 0) * Z, (b[1] ?? 0) * Z, ((b[2] ?? 0) - (b[0] ?? 0)) * Z, ((b[3] ?? 0) - (b[1] ?? 0)) * Z);
      g.setLineDash([]);
    };
    box(r.arm.box, 'rgba(255,255,255,0.4)');
    for (const b of r.arm.more ?? []) box(b, 'rgba(255,255,255,0.4)');
    box(r.arm.hand, 'rgba(255,162,74,0.6)');
    line(r.arm.shoulder, r.arm.elbow, 'rgba(255,255,255,0.7)');
    line(r.arm.elbow, r.arm.wrist, 'rgba(255,255,255,0.7)');
    dot(r.arm.shoulder, '#8a86a0', 6);
    dot(r.arm.elbow, '#3fe0f0', 6);
    dot(r.arm.wrist, '#ffa24a', 7);
    // The free arm, in pink.
    const f = r.free?.arm;
    if (f) {
      for (const b of [f.box, ...(f.more ?? [])]) box(b, 'rgba(255,106,213,0.45)');
      box(f.hand, 'rgba(255,106,213,0.8)');
      line(f.shoulder, f.elbow, 'rgba(255,179,236,0.7)');
      line(f.elbow, f.wrist, 'rgba(255,179,236,0.7)');
      dot(f.shoulder, '#8a86a0', 6);
      dot(f.elbow, FREE_ELBOW, 6);
      dot(f.wrist, FREE_HAND, 7);
    }
    return;
  }
  // While the hand is dragged, how far the arm reaches.
  if (drag === 'hand') {
    const reach = (Math.hypot(r.arm.elbow[0] - r.arm.shoulder[0], r.arm.elbow[1] - r.arm.shoulder[1]) + Math.hypot(r.arm.wrist[0] - r.arm.elbow[0], r.arm.wrist[1] - r.arm.elbow[1])) * (a.length ?? 1);
    g.strokeStyle = 'rgba(255,162,74,0.35)';
    g.setLineDash([5, 5]);
    g.beginPath();
    g.arc(p.shoulder[0] * Z, p.shoulder[1] * Z, reach * Z, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  // The free arm (the same in every pose), in pink.
  if (p.free) {
    line(p.free.shoulder, p.free.elbow, 'rgba(255,179,236,0.6)');
    line(p.free.elbow, p.free.wrist, 'rgba(255,179,236,0.6)');
    dot(p.free.shoulder, '#8a86a0', 4);
    dot(p.free.elbow, FREE_ELBOW, 5);
    dot(p.free.wrist, FREE_HAND, 7);
  }
  line(p.shoulder, p.elbow, 'rgba(255,255,255,0.6)');
  line(p.elbow, p.wrist, 'rgba(255,255,255,0.6)');
  const gh = gripHandle(p, a);
  line(p.wrist, gh, 'rgba(98,224,106,0.6)');
  dot(p.shoulder, '#8a86a0', 5);
  dot(p.elbow, '#3fe0f0', 6);
  dot(gh, '#62e06a', 5);
  dot(p.wrist, '#ffa24a', 8);
  // The swept arc's handles: where it starts (a ring) and the point it bends toward (a dot), with
  // a faint guide through them.
  if (arcShown) {
    const { from: af, bend: ab, to: at } = arcShown;
    g.strokeStyle = 'rgba(255,224,122,0.45)';
    g.setLineDash([4, 4]);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(...S(af));
    g.lineTo(...S(ab));
    g.lineTo(...S(at));
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = '#ffe07a';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(af[0] * Z, af[1] * Z, 7, 0, Math.PI * 2);
    g.stroke();
    dot(ab, '#ffe07a', 5);
  }
  // Where the hand was asked to go, when it's out of reach (as seen, with its depth).
  const asked = project([a.hand[0], a.hand[1], a.depth ?? 0]);
  if (Math.hypot(asked[0] - p.wrist[0], asked[1] - p.wrist[1]) > 1.5) {
    g.strokeStyle = 'rgba(255,162,74,0.7)';
    g.beginPath();
    g.arc(asked[0] * Z, asked[1] * Z, 7, 0, Math.PI * 2);
    g.stroke();
  }
}

// ---- Dragging -------------------------------------------------------------------------------

const toArt = (e: PointerEvent): Pt => {
  const b = edit.getBoundingClientRect();
  return [((e.clientX - b.left) / b.width) * SIZE, ((e.clientY - b.top) / b.height) * SIZE];
};
const near = (q: readonly [number, number], m: Pt) => Math.hypot(q[0] - m[0], q[1] - m[1]) <= 12 / Z + 1;

edit.addEventListener('pointerdown', (e) => {
  if (view && !setup) {
    status('Posing works on the back view: turn the dial back to the top (or press [ / ]).');
    return;
  }
  const m = toArt(e);
  const r = rig();
  const p = shown;
  const f = r.free?.arm;
  if (setup)
    drag = near(r.arm.wrist, m) ? 'wrist' : near(r.arm.elbow, m) ? 'restElbow' : near(r.arm.shoulder, m) ? 'shoulder'
      : f && near(f.wrist, m) ? 'freeWrist' : f && near(f.elbow, m) ? 'freeRestElbow' : f && near(f.shoulder, m) ? 'freeShoulder' : null;
  else if (p)
    drag = arcShown && near(arcShown.from, m) ? 'arcFrom' : arcShown && near(arcShown.bend, m) ? 'arcBend' : near(p.wrist, m) ? 'hand' : near(gripHandle(p, current()), m) ? 'grip' : near(p.elbow, m) ? 'elbow'
      : p.free && near(p.free.wrist, m) ? 'freeHand' : p.free && near(p.free.elbow, m) ? 'freeElbow' : null;
  if (drag === 'freeHand' && current().both) {
    status('In this pose the free hand holds the sword’s grip: move the sword hand (orange) instead.');
    drag = null;
    return;
  }
  // Anywhere else on the figure moves the hand there (the easiest thing to do).
  if (!drag && !setup) drag = 'hand';
  if (!drag) return;
  remember();
  edit.setPointerCapture(e.pointerId);
  move(m);
});
edit.addEventListener('pointermove', (e) => {
  if (drag) move(toArt(e));
});
const stop = () => {
  if (!drag) return;
  drag = null;
  draw();
};
edit.addEventListener('pointerup', stop);
edit.addEventListener('pointercancel', stop);

function move(m: Pt): void {
  const r = rig();
  const a = current();
  const round = (q: Pt): Pt => [Math.round(q[0]), Math.round(q[1])];
  switch (drag) {
    case 'hand':
      // The hand goes where it's dropped as seen; with depth, its spot is that before the lift.
      a.hand = [Math.round(m[0]), Math.round(m[1] + (a.depth ?? 0) * TILT)];
      break;
    case 'elbow':
    case 'freeElbow': {
      // Which side of the shoulder-to-hand line the pointer is on picks the bend.
      const p = drag === 'elbow' ? shown : shown?.free;
      const pa = drag === 'elbow' ? a : r.free?.pose;
      if (!p || !pa) break;
      const side = Math.sign((p.wrist[0] - p.shoulder[0]) * (m[1] - p.shoulder[1]) - (p.wrist[1] - p.shoulder[1]) * (m[0] - p.shoulder[0]));
      const now = Math.sign((p.wrist[0] - p.shoulder[0]) * (p.elbow[1] - p.shoulder[1]) - (p.wrist[1] - p.shoulder[1]) * (p.elbow[0] - p.shoulder[0]));
      if (!side || !now || side === now) break;
      // Holding the grip, the free arm's bend is this pose's own.
      if (drag === 'freeElbow' && a.both) opt(a, 'freeFlip', !a.freeFlip);
      else opt(pa, 'flip', !pa.flip);
      break;
    }
    case 'freeHand': {
      const fp = r.free?.pose;
      if (fp) fp.hand = [Math.round(m[0]), Math.round(m[1] + (fp.depth ?? 0) * TILT)];
      break;
    }
    case 'freeShoulder':
    case 'freeRestElbow':
    case 'freeWrist': {
      const f = r.free?.arm;
      if (!f) break;
      if (drag === 'freeShoulder') f.shoulder = round(m);
      else if (drag === 'freeRestElbow') f.elbow = round(m);
      else f.wrist = round(m);
      break;
    }
    case 'grip': {
      const p = shown;
      if (!p) break;
      const fore = Math.atan2(p.wrist[1] - p.elbow[1], p.wrist[0] - p.elbow[0]);
      let deg = Math.round(((Math.atan2(m[1] - p.wrist[1], m[0] - p.wrist[0]) - fore) * 180) / Math.PI);
      deg = ((deg + 540) % 360) - 180;
      a.grip = deg;
      break;
    }
    case 'shoulder':
      r.arm.shoulder = round(m);
      break;
    case 'restElbow':
      r.arm.elbow = round(m);
      break;
    case 'wrist':
      r.arm.wrist = round(m);
      break;
    case 'arcFrom':
    case 'arcBend': {
      // The arc becomes the pose's own once a handle moves (until "Reset the arc").
      if (!arcShown) break;
      const arc = a.arc ?? { from: arcShown.from, bend: arcShown.bend };
      a.arc = drag === 'arcFrom' ? { ...arc, from: round(m) } : { ...arc, bend: round(m) };
      break;
    }
  }
  changed();
}

// Arrow keys nudge the hand a pixel; Ctrl+Z undoes.
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    doUndo();
    return;
  }
  // [ and ] turn the character a view at a time.
  if (e.key === '[' || e.key === ']') {
    turn(view + (e.key === ']' ? 1 : -1));
    return;
  }
  const d: Record<string, Pt> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const step = d[e.key];
  if (!step || setup) return;
  e.preventDefault();
  remember();
  const a = current();
  a.hand = [a.hand[0] + step[0], a.hand[1] + step[1]];
  changed();
});

function doUndo(): void {
  const last = undo.pop();
  if (!last) return;
  work = JSON.parse(last);
  changed();
}

// ---- Side panel: the pose's settings, notes, save -------------------------------------------

/** Set a pose's optional field, or drop it when it's off (0, false, none), so saved poses stay short. */
function opt<K extends keyof ArmPose>(a: ArmPose, k: K, v: ArmPose[K] | undefined): void {
  if (v === undefined || v === 0 || v === false) delete a[k];
  else a[k] = v;
}

function slider(label: string, value: number, min: number, max: number, set: (v: number) => void, hint?: string): HTMLElement {
  const out = h('output', {}, String(value));
  const input = h('input', { type: 'range', min, max, step: 1, value });
  input.addEventListener('pointerdown', remember);
  input.addEventListener('keydown', remember);
  input.addEventListener('input', () => {
    set(Number(input.value));
    out.textContent = input.value;
    dirty = true;
    draw();
  });
  return h('div', {}, h('div', { class: 'row' }, h('label', {}, label), input, out), hint ? h('p', { class: 'hint' }, hint) : null);
}

function choice<T extends string>(label: string, value: T, options: [T, string][], set: (v: T) => void): HTMLElement {
  const sel = h('select', {}, ...options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
  sel.addEventListener('change', () => {
    remember();
    set(sel.value as T);
    changed();
  });
  return h('div', { class: 'row' }, h('label', {}, label), sel);
}

function check(label: string, value: boolean, set: (v: boolean) => void): HTMLElement {
  const box = h('input', { type: 'checkbox', checked: value });
  box.addEventListener('change', () => {
    remember();
    set(box.checked);
    changed();
  });
  return h('div', { class: 'row' }, h('label', {}, box, ` ${label}`));
}

function side(): void {
  const el = $('side');
  const r = rig();
  const a = current();
  const [name, what] = POSE_HELP[pose];
  const note = h('textarea', { placeholder: 'What’s wrong with this pose, in your own words. Claude reads these and fixes them: “the fist should end higher, level with her ear”, “the sword looks too short”.' }, r.notes?.[pose] ?? '');
  note.addEventListener('input', () => {
    r.notes ??= {};
    if (note.value.trim()) r.notes[pose] = note.value;
    else delete r.notes[pose];
    dirty = true;
  });
  const kids: (HTMLElement | null)[] = [
    h('h2', {}, `${NAMES[who]}: ${name}`),
    h('p', { class: 'hint' }, `This pose is ${what}.`),
  ];
  if (setup) {
    kids.push(
      h('p', { class: 'hint' }, `Skeleton setup: drag the joints to where the shoulder, elbow and wrist are in the standing frame. The dashed boxes are where the arm’s and the hand’s pixels come from. Every pose of this character changes with it.${r.free ? ' The pink ones are the free arm’s.' : ''}`),
      slider('Upper arm reach', r.arm.reach[0], 0, 8, (v) => (r.arm.reach[0] = v), '0: the upper arm is drawn as a sleeve (when it’s hidden under hair or a coat)'),
      slider('Forearm reach', r.arm.reach[1], 0, 8, (v) => (r.arm.reach[1] = v), 'How far from the bone its pixels go'),
      slider('Sleeve width', r.arm.width, 2, 10, (v) => (r.arm.width = v)),
    );
    const f = r.free?.arm;
    if (f) kids.push(slider('Free arm’s sleeve width', f.width, 2, 10, (v) => (f.width = v)));
  } else {
    kids.push(
      check('Bend the elbow the other way', !!a.flip, (v) => opt(a, 'flip', v)),
      slider('Turn the hand', a.grip ?? 0, -180, 180, (v) => opt(a, 'grip', v), 'The hand and what it holds, at the wrist'),
    );
    if (r.arm.open)
      kids.push(choice('Hand', a.shape ?? 'fist', [['fist', 'Fist'], ['open', 'Open, fingers out']], (v) => opt(a, 'shape', v === 'open' ? v : undefined)));
    if (a.weapon) kids.push(slider(`${a.weapon.kind === 'katana' ? 'Sword' : 'Pistol'} angle`, a.weapon.angle, -180, 180, (v) => {
          if (a.weapon) a.weapon.angle = v;
        }));
    if (a.weapon && r.free) {
      kids.push(check('Both hands on the sword', !!a.both, (v) => opt(a, 'both', v)));
      if (a.both)
        kids.push(
          check('Free arm: bend its elbow the other way', !!a.freeFlip, (v) => opt(a, 'freeFlip', v)),
          check('Free arm behind the body', !!a.freeBehind, (v) => opt(a, 'freeBehind', v)),
        );
    }
    kids.push(
      slider('Arm length (%)', Math.round((a.length ?? 1) * 100), 100, 170, (v) => opt(a, 'length', v === 100 ? undefined : v / 100), 'Longer than traced, for an arm raised overhead or reaching across behind the body (a longer arm is drawn as sleeves)'),
      slider('Reach forward', a.depth ?? 0, -24, 64, (v) => opt(a, 'depth', v), 'How far the hand reaches into the screen, toward the enemy (or drag in the side view beside the picture)'),
      check('Arm behind the body', !!a.behind, (v) => opt(a, 'behind', v)),
      choice('Light', a.light ?? 'none', [['none', 'None'], ['spark', 'Spark'], ['impact', 'Impact (with swept arc)'], ['shot', 'Muzzle flash']], (v) => opt(a, 'light', v === 'none' ? undefined : v)),
    );
    if (a.light)
      kids.push(choice('Light at', a.lightAt ?? 'hand', [['hand', 'The hand'], ['tip', 'The tip (blade, muzzle)'], ['top', 'The top (a staff’s head)']], (v) => (a.lightAt = v)));
    if (a.light === 'impact')
      kids.push(
        h('p', { class: 'hint' }, 'The swept arc: drag the yellow ring (where it starts) and the yellow dot (which way it bends) on the picture.'),
        a.arc
          ? h('div', { class: 'buttons' }, h('button', { onclick: () => { remember(); delete a.arc; changed(); } }, 'Reset the arc'))
          : null,
      );
  }
  const fp = r.free?.pose;
  if (!setup && fp)
    kids.push(
      h('hr'),
      h('h2', {}, 'Free arm (every pose)'),
      h('p', { class: 'hint' }, a.both ? 'In this pose both hands are on the sword: the pink hand holds its grip. Its own pose (below) is for the poses with one hand on the sword.' : 'Drag the pink dot to place the other hand: it’s the same in every pose with one hand on the sword, out for balance. Standing, the arm hangs as drawn.'),
      check('Bend its elbow the other way', !!fp.flip, (v) => opt(fp, 'flip', v)),
      slider('Turn its hand', fp.grip ?? 0, -180, 180, (v) => opt(fp, 'grip', v)),
      check('Behind the body', !!fp.behind, (v) => opt(fp, 'behind', v)),
    );
  const st = r.stance;
  if (!setup && st)
    kids.push(
      h('hr'),
      h('h2', {}, 'Stance (every pose)'),
      slider('Bend the knees', st.sink, 0, 6, (v) => (st.sink = v), 'How much lower the body stands, over the legs (the feet stay put)'),
      slider('Feet apart', st.spread, 0, 6, (v) => (st.spread = v), 'How far each foot moves out, the shins leaning out from the knees'),
      slider('Right foot forward', st.stagger ?? 0, 0, 6, (v) => {
        if (v) st.stagger = v;
        else delete st.stagger;
      }, 'A fencer’s stance: the right foot a step toward the enemy'),
    );
  kids.push(h('hr'), h('h2', {}, 'Note for Claude'), note);
  const save = h('button', { class: 'primary', onclick: () => void doSave() }, 'Save');
  const undoBtn = h('button', { onclick: doUndo }, 'Undo');
  const reset = h(
    'button',
    {
      onclick: () => {
        const saved = SKELETONS[who];
        if (!saved) return;
        remember();
        work[who] = structuredClone(saved);
        changed();
      },
    },
    `Revert ${NAMES[who]}`,
  );
  const setupBtn = h(
    'button',
    {
      onclick: () => {
        setup = !setup;
        refresh();
      },
    },
    setup ? 'Back to posing' : 'Skeleton setup…',
  );
  kids.push(h('div', { class: 'buttons' }, save, undoBtn, reset, setupBtn), h('div', { id: 'status' }));
  el.replaceChildren(...kids.filter((k): k is HTMLElement => !!k));
  if (dirty) status('Unsaved changes.');
}

async function doSave(): Promise<void> {
  status('Saving…');
  try {
    const res = await fetch('/__rig/skeleton', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(work) });
    const out = (await res.json().catch(() => ({ ok: false, problem: `the dev server answered ${res.status}` }))) as { ok: boolean; problem?: string };
    if (!out.ok) {
      status(`Not saved: ${out.problem ?? 'unknown problem'}`, 'bad');
      return;
    }
    for (const k of Object.keys(SKELETONS)) delete SKELETONS[k];
    Object.assign(SKELETONS, structuredClone(work));
    resetRig();
    dirty = false;
    status('Saved. Reload the game to see it in battle.', 'good');
  } catch (e) {
    status(`Not saved: the dev server didn’t answer (${e instanceof Error ? e.message : String(e)}). Is npm run dev running?`, 'bad');
  }
}

// ---- Pickers --------------------------------------------------------------------------------

function pickers(): void {
  const thumb = (id: string, p: ArmPose | null) => {
    // The middle of the canvas, where the figure stands (its edges are room for raised arms).
    const c = h('canvas', { width: 80, height: 120, style: 'width: 32px; height: 48px' });
    const f = poseFrame(id, p, work[id]);
    if (f) c.getContext('2d')?.drawImage(f.frame, 24, 4, 80, 120, 0, 0, 80, 120);
    return c;
  };
  $('who').replaceChildren(
    ...WHO.filter((id) => work[id]).map((id) =>
      h(
        'button',
        {
          class: id === who ? 'on' : '',
          onclick: () => {
            who = id;
            if (!posesOf(rig()).includes(pose)) pose = 'strike';
            pickers();
            drawDial();
            refresh();
          },
        },
        thumb(id, null),
        h('span', {}, NAMES[id] ?? id),
      ),
    ),
  );
  $('pose').replaceChildren(
    ...posesOf(rig()).map((k) =>
      h(
        'button',
        {
          class: k === pose ? 'on' : '',
          onclick: () => {
            pose = k;
            pickers();
            refresh();
          },
        },
        thumb(who, rig().poses[k] ?? null),
        h('span', {}, POSE_HELP[k][0], h('small', {}, POSE_HELP[k][1])),
      ),
    ),
  );
}

// ---- Preview --------------------------------------------------------------------------------

const preview = $<HTMLCanvasElement>('preview');
preview.width = SIZE * PZ;
preview.height = SIZE * PZ;
const pg = preview.getContext('2d') as CanvasRenderingContext2D;
pg.imageSmoothingEnabled = false;
let tick = 0;
function play(): void {
  tick++;
  const steps = moveOf(rig(), pose);
  const total = steps.reduce((n, [, f]) => n + f, 0);
  let t = tick % total;
  let at: KeyPose | null = null;
  for (const [k, f] of steps) {
    if (t < f) {
      at = k;
      break;
    }
    t -= f;
  }
  const r = rig();
  const a = at ? (r.poses[at] ?? null) : null;
  const p = poseFrame(who, a, r);
  pg.clearRect(0, 0, preview.width, preview.height);
  if (p) {
    pg.drawImage(p.frame, 0, 0, preview.width, preview.height);
    const before = at && beforeOf(r, at);
    const from = poseFrame(who, before ? (r.poses[before] ?? null) : null, r);
    const glow = a && from ? poseGlow(r, a, p, from) : undefined;
    if (glow) {
      pg.globalCompositeOperation = 'lighter';
      pg.drawImage(glow, 0, 0, preview.width, preview.height);
      pg.globalCompositeOperation = 'source-over';
    }
  }
  requestAnimationFrame(play);
}

// ---- Start ----------------------------------------------------------------------------------

$<HTMLInputElement>('onion').addEventListener('change', draw);
$<HTMLInputElement>('joints').addEventListener('change', draw);
window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

// The turntable's views: the editor works without them (the dial then has only the back).
fetch('art/rig/views.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`views.json: ${r.status}`))))
  .then((v: typeof views) => {
    views = v;
    drawDial();
  })
  .catch((e: unknown) => status(`The turntable’s views didn’t load (${e instanceof Error ? e.message : String(e)}); only the back is shown.`, 'bad'));

loadRigData()
  .then(() => {
    work = structuredClone(SKELETONS);
    drawDial();
    if (!work[who]) who = Object.keys(work)[0] ?? who;
    pickers();
    draw();
    side();
    requestAnimationFrame(play);
  })
  .catch((e: unknown) => {
    $('side').replaceChildren(h('p', { id: 'status', class: 'bad' }, `Couldn’t load the skeletons: ${e instanceof Error ? e.message : String(e)}`));
  });
