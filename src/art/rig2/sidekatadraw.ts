/**
 * Draws Rook's kendo strike frames from the data in `sidekata.ts` (spike `spike/side-battle`, item B-rook-strike).
 *
 * A frame is the body with BOTH arms cut out (the chrome one on the left edge, and the coat sleeve with the bare
 * hand on the right) and the coat filled in behind them, then: the legs set for the stance (`bendLeg`), a crouch
 * or a rise, a lean, the katana laid on the grip, and two arms put back by two-bone IK onto the two fists. The
 * arms are code-drawn limbs (two bands and a fist) with a darker rim, not the turned traced arm: the sleeve is the
 * coat's own colour, so a turned arm vanishes into the torso (day 1's finding), and the rim keeps it apart. Bone
 * lengths are one constant for every frame, so the arm never grows between frames; when a pose asks for a hand
 * further than the arm reaches, the hands stop short (the whole grip is pulled in), the arm doesn't stretch.
 * A frame on the cut gets a smear painted behind the blade: a wedge of the blade's sweep since the last frame.
 *
 * Round 2: the far arm (the coat sleeve on the right) is drawn BEHIND the body, so only its fist shows past the coat and
 * above the head (it was a pale wedge across his face); a pose may be one-handed (`one`: the draw and the sheathe); the
 * contact blade is three pixels across; the frames report where the point and the front foot are (`KATA_MEASURED`).
 */
import { band, katana, solveArm } from './battle';
import { GRIP_GAP, KATA_BONE, KATA_DIMS, KATA_MEASURED, KATA_MEASURED_LOW, KATA_POSES, type KataKey, type KataPose, isContact } from './sidekata';
import type { Layer } from './rig';
import { type Pt, type SideArm, separateArm } from './side';
import { at, bendLeg, clearBox, crouch, dropSpecks, embed, type LegBox, lean, leanAt, rise, topRow } from './sideops';

/** What the kata needs of a crew member (all in base-frame pixels). */
export interface KataInput {
  /** The graded, outline-stripped base frame and its palette (the palette gets a few entries pushed on it). */
  base: Layer;
  pal: string[];
  /** The chrome (lead, screen-left) arm and the coat sleeve on the right: each cut from the base. */
  arm1: SideArm;
  arm2: SideArm;
  /** A pixel of coat, for the upper sleeve's colour. */
  coat: Pt;
  hip: number;
  knee: number;
  chest: number;
  front: { x0: number; x1: number };
  back: { x0: number; x1: number };
  /** A box (base pixels) to clear of the sheathed hilt, and what counts as steel in it. */
  hilt: [number, number, number, number];
  isSteel: (p: number) => boolean;
  /** Skin tones: the bare hand's pixels left on the coat's edge once the arm is cut. */
  isSkin: (p: number) => boolean;
  /** Pads round the base frame, symmetric about the body so a frame of any width stays centred on the same spot. */
  padX: number;
  padT: number;
  /** Outlines and rims a finished frame's layers on a canvas of the given size. */
  render: (layers: Layer[], w: number, h: number) => HTMLCanvasElement;
}

export interface KataFrames {
  frames: Record<KataKey, HTMLCanvasElement>;
  /** The same frames without the smear (what the speed ghosts are cut from). */
  plain: Record<KataKey, HTMLCanvasElement>;
  /** Where each frame's two fists and the blade's point are, in frame pixels (for the lab and the checks). */
  marks: Record<KataKey, { near: Pt; far: Pt; tip: Pt }>;
}

const rad = (d: number): number => (d * Math.PI) / 180;

/** A filled disc of one colour. */
function disc(c: Pt, r: number, col: number): Layer {
  const x0 = Math.floor(c[0] - r - 1);
  const y0 = Math.floor(c[1] - r - 1);
  const n = Math.ceil(2 * r + 3);
  const px = new Int16Array(n * n).fill(-1);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (Math.hypot(x0 + x + 0.5 - c[0], y0 + y + 0.5 - c[1]) <= r) px[y * n + x] = col;
  return { w: n, h: n, ox: x0, oy: y0, px };
}

/** The point `t` of the way from `s` out to `p`, no further than `r` from `s`. */
function within(s: Pt, p: Pt, r: number): Pt {
  const d = Math.hypot(p[0] - s[0], p[1] - s[1]);
  return d <= r ? p : [s[0] + ((p[0] - s[0]) * r) / d, s[1] + ((p[1] - s[1]) * r) / d];
}

/**
 * Paint the blade's sweep (from angle `a0` to `a1`, unwrapped degrees, round `pivot`) onto a canvas as a CRESCENT: a band along the
 * path the point travelled, `KATA_SMEAR_MAX` px thick at the leading edge (where the blade is now) and tapering to nothing where
 * it was, so it is one solid moon-shaped arc with no hook or flag past the point. Three tones across its thickness (a pale rim on
 * the point's side, steel, a deep steel on the hand's side), the leading edge brightest; `hot` (the blow itself) paints the leading
 * edge pure white. It is drawn behind the blade, which keeps its own white edge and dark spine and so stays the brightest line.
 */
export const KATA_SMEAR_MAX = 11;
function paintSmear(g: CanvasRenderingContext2D, w: number, h: number, pivot: Pt, a0: number, a1: number, rOut: number, kind: 'fan' | 'arc', hot: boolean): void {
  const mid = (a0 + a1) / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - pivot[0];
      const dy = y + 0.5 - pivot[1];
      const r = Math.hypot(dx, dy);
      if (r > rOut + 0.3) continue;
      // The pixel's angle, brought into the same turn as the sweep (the blow crosses 180 degrees).
      let th = (Math.atan2(dy, dx) * 180) / Math.PI;
      th += 360 * Math.round((mid - th) / 360);
      // 0 at the old blade, 1 at the new one.
      const s = (th - a0) / (a1 - a0);
      if (s < 0 || s > 1) continue;
      // A fan fills the wedge between the two blade angles from near the hands out to the point (a share of the blade that grows toward the new blade); an arc is only the band at the point's radius.
      const thick = kind === 'fan' ? 1 + rOut * 0.9 * s ** 1.5 : 1.5 + (KATA_SMEAR_MAX - 1.5) * s ** 1.1;
      const depth = (rOut - r) / thick;
      if (depth > 1) continue;
      const lead = s > 0.88;
      const rim = rOut - r < 1.8;
            g.fillStyle = kind === 'fan' ? (rim ? (hot ? '#ffffff' : '#eaf3ff') : lead ? '#dce9fb' : s > 0.55 ? '#b9cde9' : '#8aa5cc') : depth < 0.22 ? (hot && (lead || s > 0.7) ? '#ffffff' : '#eaf3ff') : depth < 0.55 ? (lead ? '#dce9fb' : '#b9cde9') : lead ? '#a9c0e0' : '#7d99c3';
      g.fillRect(x, y, 1, 1);
    }
}

export function buildKata(inp: KataInput): KataFrames {
  const { base, pal } = inp;
  const W = base.w + 2 * inp.padX;
  const H = inp.padT + base.h + 1;
  const P = (p: Pt): Pt => [p[0] + inp.padX, p[1] + inp.padT];

  // Both arms cut out and the coat filled in behind them.
  const s1 = separateArm(base, inp.arm1, pal);
  const s2 = separateArm(s1.body, inp.arm2, pal);
  const coatCol = at(base, Math.floor(inp.coat[0]), Math.floor(inp.coat[1]));
  // The chrome forearm: a cool steel blue ramp (lit, shade), so it breaks clearly from the olive sleeve above it.
  for (const hex of ['#c3d2e6', '#6b819f']) if (!pal.includes(hex)) pal.push(hex);
  const chrome = pal.indexOf('#c3d2e6');
  const chromeHand = s1.skinCol;
  const hand = s2.skinCol;
  // Colours for the arms: the coat's two tones, a dark rim, the chrome's two tones.
  const rgb = (i: number): number => Number.parseInt((pal[i] ?? '#000000').slice(1), 16);
  const darker = (i: number, k: number): number => {
    const n = rgb(i);
    pal.push(`#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('')}`);
    return pal.length - 1;
  };
  const coatShade = darker(coatCol, 0.7);
  const rim = darker(coatCol, 0.32);
  const chromeShade = pal.indexOf('#6b819f');
  const handShade = darker(hand, 0.7);

  // The torso with its arms gone, and the sheathed hilt taken off the back while the sword is out.
  // The bare hand's own pixels that the capsule left at the coat's edge become coat.
  const clean: Layer = { ...s2.body, px: s2.body.px.slice() };
  for (let y = 0; y < clean.h; y++) for (let x = 0; x < clean.w; x++) if (inp.isSkin(clean.px[y * clean.w + x] ?? -1) && x >= inp.arm2.shoulder[0] - 3 && y > inp.arm2.shoulder[1]) clean.px[y * clean.w + x] = coatCol;
  const trunk0 = embed(clean, W, H, inp.padX, inp.padT);
  const trunk = clearBox(trunk0, inp.hilt[0] + inp.padX, inp.hilt[1] + inp.padT, inp.hilt[2] + inp.padX, inp.hilt[3] + inp.padT, inp.isSteel);
  const hip = inp.hip + inp.padT;
  const chest = inp.chest + inp.padT;
  const top = topRow(trunk);
  const legBox = (l: { x0: number; x1: number }): LegBox => ({ x0: l.x0 + inp.padX, x1: l.x1 + inp.padX, hip, knee: inp.knee + inp.padT });
  const L = legBox(inp.front);
  const R = legBox(inp.back);

  const frames = {} as Record<KataKey, HTMLCanvasElement>;
  const plain = {} as Record<KataKey, HTMLCanvasElement>;
  const marks = {} as KataFrames['marks'];
  // Steel and its lights, in the palette for the katana (the contact blade's white edge and dark spine).
  for (const hex of ['#ffffff', '#f2f1f4', '#9fa0a9', '#4b4e63']) if (!pal.includes(hex)) pal.push(hex);
  for (const key of Object.keys(KATA_POSES) as KataKey[]) {
    const pose: KataPose = KATA_POSES[key];
    // Legs first (their rows are below the hip), then the crouch or rise, then the lean.
    let body = bendLeg(trunk, L, pose.front.lift, pose.front.dx);
    body = bendLeg(body, R, pose.back.lift, pose.back.dx);
    body = dropSpecks(body, 4);
    if (pose.crouch) body = crouch(body, chest, pose.crouch);
    if (pose.rise) body = rise(body, chest, pose.rise);
    body = lean(body, hip, pose.lean);

    // The shoulders follow the lean and the crouch; the near one also turns toward the enemy.
    const shoulder = (a: SideArm, turn: number): Pt => {
      const s = P(a.shoulder);
      return [s[0] + leanAt(Math.round(s[1]), hip, top, pose.lean) - turn, s[1] + (s[1] < chest ? pose.crouch - pose.rise : 0)];
    };
    const S1 = shoulder(inp.arm1, 0);
    const S2 = shoulder(inp.arm2, pose.twist);
    const u: Pt = [Math.cos(rad(pose.deg)), Math.sin(rad(pose.deg))];
    // The grip: the forward fist F and the one behind it G, pulled in until both arms reach them.
    const reach = 2 * KATA_BONE - 0.2;
    let F: Pt;
    let G: Pt;
    if (pose.one) {
      // Drawing or sheathing: the far hand on the hilt, the lead hand hanging.
      G = within(S2, [S2[0] + pose.grip[0], S2[1] + pose.grip[1]], reach);
      F = within(S1, [S1[0] + pose.one.off[0], S1[1] + pose.one.off[1]], reach);
    } else {
      F = [S1[0] + pose.grip[0], S1[1] + pose.grip[1]];
      G = [F[0] - u[0] * GRIP_GAP, F[1] - u[1] * GRIP_GAP];
      for (let i = 0; i < 3; i++) {
        F = within(S1, F, reach);
        G = [F[0] - u[0] * GRIP_GAP, F[1] - u[1] * GRIP_GAP];
        const G2 = within(S2, G, reach);
        F = [G2[0] + u[0] * GRIP_GAP, G2[1] + u[1] * GRIP_GAP];
        G = G2;
      }
    }
    // Three pixels of blade at the blow and the cut that leads to it (a white edge, the steel, a dark spine).
    const k = katana(G, pose.deg, pal, { ...KATA_DIMS, tip: pose.one?.blade ?? KATA_DIMS.tip, spine: isContact(key) || key.startsWith('swing') });

    // An arm: the elbow below the line from shoulder to fist (the lower of the two answers). The bands and the fist come apart, so the far arm can go behind the body and its fist stay on top.
    const arm = (S: Pt, T: Pt, upper: [number, number], fore: [number, number], fist: [number, number], rimmed: boolean): { bands: Layer[]; fist: Layer[] } => {
      const a = solveArm(S, KATA_BONE, KATA_BONE, T, 1);
      const b = solveArm(S, KATA_BONE, KATA_BONE, T, -1);
      const e = a.elbow[1] > b.elbow[1] ? a : b;
      // The sleeve's cuff: the coat's olive carries a third of the way down the forearm, and a disc at the elbow joins the two bones, so the steel arm reads as one limb with the sleeve.
      const cuffEnd: Pt = [e.elbow[0] + (e.wrist[0] - e.elbow[0]) * 0.34, e.elbow[1] + (e.wrist[1] - e.elbow[1]) * 0.34];
      return {
        bands: [
          ...(rimmed ? [band(S, e.elbow, 4.8, rim, rim), band(e.elbow, e.wrist, 4.2, rim, rim)] : []),
          band(S, e.elbow, 3.4, upper[0], upper[1], true),
          band(e.elbow, e.wrist, 3, fore[0], fore[1], true),
          ...(rimmed ? [band(e.elbow, cuffEnd, 3.6, upper[0], upper[1], true), disc(e.elbow, 2.1, upper[0])] : []),
        ],
        fist: [disc(e.wrist, 2.9, rim), disc(e.wrist, 2.2, fist[0]), disc([e.wrist[0] - 0.5, e.wrist[1] + 0.4], 1.1, fist[1])],
      };
    };
    const far = arm(S2, G, [coatCol, coatShade], [coatCol, coatShade], [hand, handShade], false);
    const lead = arm(S1, F, [coatCol, coatShade], [chrome, chromeShade], [chromeHand, chromeShade], true);
    const layers = [...far.bands, body, k.layer, ...far.fist, ...lead.bands, ...lead.fist];
    const out = inp.render(layers, W, H);

    plain[key] = out;
    let frame = out;
    if (pose.smear) {
      // The smear goes behind everything: paint it first, then the frame over it.
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      if (g) {
        const mid: Pt = [(F[0] + G[0]) / 2, (F[1] + G[1]) / 2];
        paintSmear(g, W, H, mid, pose.smear[0], pose.smear[1], (KATA_DIMS.tip - GRIP_GAP / 2) * 0.93, pose.smear[2] ?? 'arc', key === 'contact0' || key === 'contact0Low');
        g.drawImage(out, 0, 0);
        frame = c;
      }
    }
    frames[key] = frame;
    marks[key] = { near: G, far: F, tip: k.tip };
    if (key === 'contact' || key === 'contactLow') {
      // What the contact frame measured, for the engine to stop the lunge by (art pixels from the frame's centre).
      const m = key === 'contact' ? KATA_MEASURED : KATA_MEASURED_LOW;
      m.tipReach = W / 2 - k.tip[0];
      m.tipUp = H - k.tip[1];
      m.footDx = (L.x0 + L.x1) / 2 + pose.front.dx - W / 2;
    }
  }
  return { frames, plain, marks };
}
