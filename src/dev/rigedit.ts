/**
 * The animation editor (dev only, /rigedit.html): Mark poses the crew's battle backs on their
 * skeletons (src/art/rig2/battle.ts). Pick someone and a pose, drag the hand, and the elbow bends
 * by itself (two-bone IK), so an arm can't stretch. Sliders cover the rest (the hand's turn, a
 * weapon's angle, a lean, a crouch, the light). Save writes public/art/rig/skeleton.json through
 * the dev server (vite.config.ts `rigEdit`); the game loads it at startup. A note per pose is for
 * Claude to work through in a session ("her fist should end higher, level with her ear").
 *
 * The skeleton's own joints (where the shoulder, elbow and wrist are at rest, and how far each
 * bone's pixels reach) are under "Skeleton setup": set once per character.
 */
import { type ArmPose, type BattleRig, KEY_POSES, type KeyPose, type Posed, poseFrame, poseGlow, resetRig } from '../art/rig2/battle';
import { SKELETONS, loadRigData } from '../art/rig2/data';

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
  strike: ['Strike', 'the hit itself'],
  raise: ['Cast', 'a spell, a program or an item'],
  victory: ['Victory', 'after a won fight'],
};
/** The pose shown faintly behind each one: the one the move comes from. */
const BEFORE: Record<KeyPose, KeyPose | null> = { brace: null, strike: 'brace', raise: null, victory: null };
/** How each pose plays in the preview: (pose or null for standing, frames held). */
const MOVE: Record<KeyPose, [KeyPose | null, number][]> = {
  brace: [[null, 40], ['brace', 40]],
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
let drag: null | 'hand' | 'elbow' | 'grip' | 'shoulder' | 'restElbow' | 'wrist' = null;
let setup = false;
/** "Ask Claude": which model, whether it's working (and since when), and its last answer. */
let model: 'sonnet' | 'opus' = 'sonnet';
let askingSince = 0;
let claudeSaid: string | null = null;

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

/** Where the green handle sits: past the wrist along the hand's direction. */
function gripHandle(p: Posed, a: ArmPose): Pt {
  const ang = Math.atan2(p.wrist[1] - p.elbow[1], p.wrist[0] - p.elbow[0]) + ((a.grip ?? 0) * Math.PI) / 180;
  return [p.wrist[0] + Math.cos(ang) * 9, p.wrist[1] + Math.sin(ang) * 9];
}

function draw(): void {
  const r = rig();
  const a = current();
  g.clearRect(0, 0, edit.width, edit.height);
  // A grid every 8 art pixels, for judging heights.
  g.fillStyle = 'rgba(255,255,255,0.035)';
  for (let x = 0; x < SIZE; x += 8) g.fillRect(x * Z, 0, 1, edit.height);
  for (let y = 0; y < SIZE; y += 8) g.fillRect(0, y * Z, edit.width, 1);
  const before = BEFORE[pose];
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
  if (!p) {
    status(`No traced frame for ${NAMES[who] ?? who}.`, 'bad');
    return;
  }
  g.drawImage(p.frame, 0, 0, edit.width, edit.height);
  if (!setup) {
    const from = poseFrame(who, before ? (r.poses[before] ?? null) : null, r);
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
    box(r.arm.hand, 'rgba(255,162,74,0.6)');
    line(r.arm.shoulder, r.arm.elbow, 'rgba(255,255,255,0.7)');
    line(r.arm.elbow, r.arm.wrist, 'rgba(255,255,255,0.7)');
    dot(r.arm.shoulder, '#8a86a0', 6);
    dot(r.arm.elbow, '#3fe0f0', 6);
    dot(r.arm.wrist, '#ffa24a', 7);
    return;
  }
  // While the hand is dragged, how far the arm reaches.
  if (drag === 'hand') {
    const reach = Math.hypot(r.arm.elbow[0] - r.arm.shoulder[0], r.arm.elbow[1] - r.arm.shoulder[1]) + Math.hypot(r.arm.wrist[0] - r.arm.elbow[0], r.arm.wrist[1] - r.arm.elbow[1]);
    g.strokeStyle = 'rgba(255,162,74,0.35)';
    g.setLineDash([5, 5]);
    g.beginPath();
    g.arc(p.shoulder[0] * Z, p.shoulder[1] * Z, reach * Z, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  line(p.shoulder, p.elbow, 'rgba(255,255,255,0.6)');
  line(p.elbow, p.wrist, 'rgba(255,255,255,0.6)');
  const gh = gripHandle(p, a);
  line(p.wrist, gh, 'rgba(98,224,106,0.6)');
  dot(p.shoulder, '#8a86a0', 5);
  dot(p.elbow, '#3fe0f0', 6);
  dot(gh, '#62e06a', 5);
  dot(p.wrist, '#ffa24a', 8);
  // Where the hand was asked to go, when it's out of reach.
  if (Math.hypot(a.hand[0] - p.wrist[0], a.hand[1] - p.wrist[1]) > 1.5) {
    g.strokeStyle = 'rgba(255,162,74,0.7)';
    g.beginPath();
    g.arc(a.hand[0] * Z, a.hand[1] * Z, 7, 0, Math.PI * 2);
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
  const m = toArt(e);
  const r = rig();
  const p = shown;
  if (setup) drag = near(r.arm.wrist, m) ? 'wrist' : near(r.arm.elbow, m) ? 'restElbow' : near(r.arm.shoulder, m) ? 'shoulder' : null;
  else if (p) drag = near(p.wrist, m) ? 'hand' : near(gripHandle(p, current()), m) ? 'grip' : near(p.elbow, m) ? 'elbow' : null;
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
      a.hand = round(m);
      break;
    case 'elbow': {
      // Which side of the shoulder-to-hand line the pointer is on picks the bend.
      const p = shown;
      if (!p) break;
      const side = Math.sign((p.wrist[0] - p.shoulder[0]) * (m[1] - p.shoulder[1]) - (p.wrist[1] - p.shoulder[1]) * (m[0] - p.shoulder[0]));
      const now = Math.sign((p.wrist[0] - p.shoulder[0]) * (p.elbow[1] - p.shoulder[1]) - (p.wrist[1] - p.shoulder[1]) * (p.elbow[0] - p.shoulder[0]));
      if (side && now && side !== now) a.flip = !a.flip;
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
      h('p', { class: 'hint' }, 'Skeleton setup: drag the joints to where the shoulder, elbow and wrist are in the standing frame. The dashed boxes are where the arm’s and the hand’s pixels come from. Every pose of this character changes with it.'),
      slider('Upper arm reach', r.arm.reach[0], 0, 8, (v) => (r.arm.reach[0] = v), '0: the upper arm is drawn as a sleeve (when it’s hidden under hair or a coat)'),
      slider('Forearm reach', r.arm.reach[1], 0, 8, (v) => (r.arm.reach[1] = v), 'How far from the bone its pixels go'),
      slider('Sleeve width', r.arm.width, 2, 10, (v) => (r.arm.width = v)),
    );
  } else {
    kids.push(
      check('Bend the elbow the other way', !!a.flip, (v) => opt(a, 'flip', v)),
      slider('Turn the hand', a.grip ?? 0, -180, 180, (v) => opt(a, 'grip', v), 'The hand and what it holds, at the wrist'),
    );
    if (a.weapon) kids.push(slider(`${a.weapon.kind === 'katana' ? 'Sword' : 'Pistol'} angle`, a.weapon.angle, -180, 180, (v) => {
          if (a.weapon) a.weapon.angle = v;
        }));
    kids.push(
      slider('Lean the body', a.lean ?? 0, -12, 12, (v) => opt(a, 'lean', v), 'Tips the whole figure about the feet'),
      slider('Crouch', a.drop ?? 0, 0, 8, (v) => opt(a, 'drop', v)),
      check('Arm behind the body', !!a.behind, (v) => opt(a, 'behind', v)),
      choice('Light', a.light ?? 'none', [['none', 'None'], ['spark', 'Spark'], ['impact', 'Impact (with swept arc)'], ['shot', 'Muzzle flash']], (v) => opt(a, 'light', v === 'none' ? undefined : v)),
    );
    if (a.light)
      kids.push(choice('Light at', a.lightAt ?? 'hand', [['hand', 'The hand'], ['tip', 'The tip (blade, muzzle)'], ['top', 'The top (a staff’s head)']], (v) => (a.lightAt = v)));
  }
  kids.push(h('hr'), h('h2', {}, 'Note for Claude'), note);
  if (!setup) {
    const pickModel = h('select', {}, h('option', { value: 'sonnet', selected: model === 'sonnet' }, 'Quick (Sonnet)'), h('option', { value: 'opus', selected: model === 'opus' }, 'Careful (Opus)'));
    pickModel.addEventListener('change', () => {
      model = pickModel.value === 'opus' ? 'opus' : 'sonnet';
    });
    const ask = h('button', { class: 'primary', disabled: askingSince > 0, onclick: () => void askClaude(note.value) }, askingSince ? 'Claude is looking…' : 'Ask Claude to fix it');
    kids.push(h('div', { class: 'buttons' }, ask, pickModel), h('p', { class: 'hint' }, 'Claude looks at the pose and your note and changes the pose (Undo puts it back). It takes about 10–60 seconds and uses your Claude plan.'));
    if (claudeSaid)
      kids.push(
        h('div', { class: 'panel', style: 'border-color: var(--grip); margin-top: 8px' }, h('h2', {}, 'Claude'), h('p', { style: 'margin: 0 0 6px' }, claudeSaid), h('div', { class: 'buttons' }, h('button', { onclick: () => dismiss(false) }, 'Keep it'), h('button', { onclick: () => dismiss(true) }, 'Undo Claude’s change'))),
      );
  }
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
        changed();
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

// ---- Ask Claude -----------------------------------------------------------------------------

/** A pose drawn for Claude: 4x, on a grid every 8 pixels with its coordinates, joints marked. */
function annotated(a: ArmPose | null, marks: boolean): string | null {
  const r = rig();
  const p = poseFrame(who, a, r);
  if (!p) return null;
  const c = h('canvas', { width: SIZE * Z, height: SIZE * Z });
  const x = c.getContext('2d');
  if (!x) return null;
  x.imageSmoothingEnabled = false;
  x.fillStyle = '#221f2e';
  x.fillRect(0, 0, c.width, c.height);
  x.font = '11px sans-serif';
  for (let k = 0; k <= SIZE; k += 8) {
    x.fillStyle = k % 32 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.14)';
    x.fillRect(k * Z, 0, 1, c.height);
    x.fillRect(0, k * Z, c.width, 1);
    if (k % 16 === 0 && k < SIZE) {
      x.fillStyle = 'rgba(255,255,255,0.6)';
      x.fillText(String(k), k * Z + 2, 11);
      x.fillText(String(k), 2, k * Z + 11);
    }
  }
  x.drawImage(p.frame, 0, 0, c.width, c.height);
  if (marks)
    for (const [q, color] of [[p.shoulder, '#8a86a0'], [p.elbow, '#3fe0f0'], [p.wrist, '#ffa24a']] as const) {
      x.fillStyle = color;
      x.beginPath();
      x.arc(q[0] * Z, q[1] * Z, 6, 0, Math.PI * 2);
      x.fill();
    }
  return c.toDataURL('image/png');
}

/** Only the pose fields the game knows, with sensible values (Claude's answer is checked, not trusted). */
function cleanPose(raw: unknown, was: ArmPose): ArmPose {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : undefined);
  const hand = Array.isArray(o.hand) ? o.hand : [];
  const out: ArmPose = { hand: [num(hand[0], -20, SIZE + 20) ?? was.hand[0], num(hand[1], -20, SIZE + 20) ?? was.hand[1]] };
  opt(out, 'flip', o.flip === true);
  opt(out, 'grip', num(o.grip, -180, 180));
  opt(out, 'lean', num(o.lean, -12, 12));
  opt(out, 'drop', num(o.drop, 0, 8));
  opt(out, 'behind', o.behind === true);
  const w = o.weapon as { kind?: unknown; angle?: unknown } | undefined;
  if (was.weapon) out.weapon = { kind: was.weapon.kind, angle: num(w?.angle, -180, 180) ?? was.weapon.angle };
  if (o.light === 'spark' || o.light === 'impact' || o.light === 'shot') out.light = o.light;
  if (o.lightAt === 'hand' || o.lightAt === 'tip' || o.lightAt === 'top') out.lightAt = o.lightAt;
  return out;
}

/** Close Claude's answer, keeping its change or undoing it. */
function dismiss(undoIt: boolean): void {
  claudeSaid = null;
  if (undoIt) doUndo();
  else side();
}

async function askClaude(note: string): Promise<void> {
  if (!note.trim()) {
    status('Write what’s wrong in the note first, in your own words.', 'bad');
    return;
  }
  const r = rig();
  const a = current();
  const p = poseFrame(who, a, r);
  const before = BEFORE[pose];
  const now = annotated(a, true);
  if (!p || !now) return;
  const dist = (u: readonly number[], v: readonly number[]) => Math.hypot((u[0] ?? 0) - (v[0] ?? 0), (u[1] ?? 0) - (v[1] ?? 0));
  askingSince = Date.now();
  claudeSaid = null;
  side();
  const tick = setInterval(() => status(`Claude is looking at it… ${Math.round((Date.now() - askingSince) / 1000)} s`), 1000);
  try {
    const res = await fetch('/__rig/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        who: NAMES[who] ?? who,
        poseName: POSE_HELP[pose][0],
        poseHelp: POSE_HELP[pose][1],
        note,
        pose: a,
        arm: r.arm,
        joints: { shoulder: p.shoulder, elbow: p.elbow, wrist: p.wrist, tip: p.tip, upper: dist(r.arm.shoulder, r.arm.elbow), fore: dist(r.arm.elbow, r.arm.wrist) },
        images: { now, before: before ? annotated(r.poses[before] ?? null, false) : null },
        model,
      }),
    });
    const out = (await res.json().catch(() => ({ ok: false, problem: `the dev server answered ${res.status}` }))) as { ok: boolean; problem?: string; pose?: unknown; say?: string };
    if (!out.ok) {
      status(`Claude couldn’t help this time: ${out.problem ?? 'unknown problem'}`, 'bad');
      return;
    }
    remember();
    r.poses[pose] = cleanPose(out.pose, a);
    claudeSaid = out.say ?? 'Done.';
    dirty = true;
    draw();
    pickers();
  } catch (e) {
    status(`Couldn’t reach the dev server (${e instanceof Error ? e.message : String(e)}). Is npm run dev running?`, 'bad');
  } finally {
    clearInterval(tick);
    askingSince = 0;
    side();
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
            pickers();
            changed();
          },
        },
        thumb(id, null),
        h('span', {}, NAMES[id] ?? id),
      ),
    ),
  );
  $('pose').replaceChildren(
    ...KEY_POSES.map((k) =>
      h(
        'button',
        {
          class: k === pose ? 'on' : '',
          onclick: () => {
            pose = k;
            pickers();
            changed();
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
  const steps = MOVE[pose];
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
    const before = at && BEFORE[at];
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

loadRigData()
  .then(() => {
    work = structuredClone(SKELETONS);
    if (!work[who]) who = Object.keys(work)[0] ?? who;
    pickers();
    draw();
    side();
    requestAnimationFrame(play);
  })
  .catch((e: unknown) => {
    $('side').replaceChildren(h('p', { id: 'status', class: 'bad' }, `Couldn’t load the skeletons: ${e instanceof Error ? e.message : String(e)}`));
  });
