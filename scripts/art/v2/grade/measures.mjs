// The target measures of plan v2 section 4 (R3 section 3). All run after one shared alignment (align.mjs) on the union of opaque cells.
//   bf1            Boundary F at 1 px (rank 1)
//   partMiou       area-weighted mean part IoU, partMin the smallest part IoU (rank 2)
//   chamferMean/P95  symmetric outline chamfer distance, mean and 95th percentile (rank 3)
//   valueR         Pearson r of the 8x8 luminance maps, interior cells only (rank 4)
//   colorMatch     share of interior cells with a dE00 <= tau match in the 3x3 neighborhood of the other image, mean of both directions (rank 5)
//   paletteEmd     earth mover distance between the two palettes in Lab, ground distance dE00 (rank 6)
//   pck, pckHead   landmark PCK at 0.1 x height (all points) and at 0.05 x height (head points) (rank 7)
//   textureMax     largest per-part absolute difference of the texture density (rank 8)
// Every function takes plain images. The orchestrating function is measureAgainst().
import { align, boundaryF } from './align.mjs';
import { de00Packed, lumaOf, labOfPacked, deltaE00 } from './color.mjs';
import { N, bboxOf, colorCounts, edgeMask, interiorMask, opaqueAt, opaqueMask, packedAt, toCanvas } from './image.mjs';
import { GROUP_NAMES, GROUP_OF_PART, HEAD_POINTS, autoLabel, landmarksOf } from './parts.mjs';

export const TAU = 5; // dE00 tolerance of the neighborhood color match
export const TEXTURE_STEP = 6; // dE00 between two neighbors that counts as a color change in the texture density
export const MIN_PART_CELLS = 6; // a part group smaller than this (in both images) is not scored

// ---------------------------------------------------------------- rank 3: chamfer

function points(mask, w) {
  const out = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) out.push([i % w, Math.floor(i / w)]);
  return out;
}
const nearest = (p, set) => {
  let best = Number.POSITIVE_INFINITY;
  for (const q of set) {
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best) best = d;
  }
  return best;
};
/** Symmetric chamfer between two outline masks: mean of the two directed means, and the 95th percentile of all directed distances. */
export function chamfer(edgeA, edgeB, w) {
  const A = points(edgeA, w);
  const B = points(edgeB, w);
  if (!A.length || !B.length) return { mean: Number.POSITIVE_INFINITY, p95: Number.POSITIVE_INFINITY };
  const dAB = A.map((p) => nearest(p, B));
  const dBA = B.map((p) => nearest(p, A));
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const all = [...dAB, ...dBA].sort((a, b) => a - b);
  const p95 = all[Math.min(all.length - 1, Math.ceil(0.95 * all.length) - 1)];
  return { mean: (mean(dAB) + mean(dBA)) / 2, p95 };
}

// ---------------------------------------------------------------- rank 2: part mIoU

/**
 * Part IoU over the groups. candGroups and refGroups are Array(N*N) of group names or null. Only the cells that are opaque in the
 * union count (a group cell is always opaque). A group absent from both is skipped; a group in only one gets IoU 0.
 */
export function partIou(candGroups, refGroups) {
  const per = {};
  let wsum = 0;
  let acc = 0;
  let min = 1;
  let any = false;
  for (const g of GROUP_NAMES) {
    let inter = 0;
    let uni = 0;
    let nc = 0;
    let nr = 0;
    for (let i = 0; i < candGroups.length; i++) {
      const a = candGroups[i] === g;
      const b = refGroups[i] === g;
      if (a) nc++;
      if (b) nr++;
      if (a && b) inter++;
      if (a || b) uni++;
    }
    if (Math.max(nc, nr) < MIN_PART_CELLS) continue; // tiny or absent in both
    const iou = uni ? inter / uni : 0;
    per[g] = { iou, cand: nc, ref: nr };
    wsum += uni;
    acc += iou * uni;
    min = Math.min(min, iou);
    any = true;
  }
  return { mean: any ? acc / wsum : 0, min: any ? min : 0, per };
}

// ---------------------------------------------------------------- rank 4: value structure

/** Mean luminance of the interior cells in each 4 x 4 block: Array(64) of number or null. */
export function valueGrid(img, block = 4) {
  const inter = interiorMask(img);
  const n = N / block;
  const sum = new Float64Array(n * n);
  const cnt = new Int32Array(n * n);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (!inter[y * img.w + x]) continue;
      const i = (y * img.w + x) * 4;
      const k = Math.floor(y / block) * n + Math.floor(x / block);
      sum[k] += lumaOf(img.data[i], img.data[i + 1], img.data[i + 2]);
      cnt[k]++;
    }
  return Array.from({ length: n * n }, (_, k) => (cnt[k] ? sum[k] / cnt[k] : null));
}
const level = (v) => (v < 85 ? 0 : v < 170 ? 1 : 2);
/** Pearson r and the 3-level agreement over the blocks that both images have. */
export function valueStructure(a, b) {
  const ga = valueGrid(a);
  const gb = valueGrid(b);
  const xs = [];
  const ys = [];
  for (let k = 0; k < ga.length; k++)
    if (ga[k] !== null && gb[k] !== null) {
      xs.push(ga[k]);
      ys.push(gb[k]);
    }
  if (xs.length < 6) return { r: 0, agree3: 0, blocks: xs.length };
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  const agree3 = xs.filter((v, i) => level(v) === level(ys[i])).length / xs.length;
  return { r, agree3, blocks: xs.length };
}

// ---------------------------------------------------------------- rank 5: neighborhood color match

/** Share of the interior cells of A that have a cell of B in the 3x3 neighborhood within tau dE00 (B interior cells only). */
export function neighborhoodShare(a, b, tau = TAU) {
  const ia = interiorMask(a);
  const ib = interiorMask(b);
  let n = 0;
  let hit = 0;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (!ia[y * a.w + x]) continue;
      n++;
      const p = packedAt(a, x, y);
      let best = Number.POSITIVE_INFINITY;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const X = x + i;
          const Y = y + j;
          if (X < 0 || Y < 0 || X >= N || Y >= N || !ib[Y * b.w + X]) continue;
          const d = de00Packed(p, packedAt(b, X, Y));
          if (d < best) best = d;
        }
      if (best <= tau) hit++;
    }
  return n ? hit / n : 0;
}
export function colorMatch(cand, ref, tau = TAU) {
  const c2r = neighborhoodShare(cand, ref, tau);
  const r2c = neighborhoodShare(ref, cand, tau);
  return { mean: (c2r + r2c) / 2, candToRef: c2r, refToCand: r2c };
}

// ---------------------------------------------------------------- rank 6: palette EMD

/** Weighted k-means in Lab. items: [{ lab, w }]. Deterministic: farthest-point start from the heaviest color. */
function kmeans(items, k) {
  if (items.length <= k) return items.map((it) => ({ lab: it.lab, w: it.w }));
  const centers = [items.reduce((a, b) => (b.w > a.w ? b : a)).lab];
  while (centers.length < k) {
    let best = null;
    let bd = -1;
    for (const it of items) {
      const d = Math.min(...centers.map((c) => deltaE00(it.lab, c)));
      if (d > bd) {
        bd = d;
        best = it;
      }
    }
    centers.push(best.lab);
  }
  let assign = new Array(items.length).fill(0);
  for (let iter = 0; iter < 20; iter++) {
    assign = items.map((it) => {
      let bi = 0;
      let bd = Number.POSITIVE_INFINITY;
      centers.forEach((c, i) => {
        const d = deltaE00(it.lab, c);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      return bi;
    });
    let moved = false;
    centers.forEach((c, i) => {
      let sw = 0;
      const s = [0, 0, 0];
      items.forEach((it, j) => {
        if (assign[j] !== i) return;
        sw += it.w;
        for (let t = 0; t < 3; t++) s[t] += it.lab[t] * it.w;
      });
      if (!sw) return;
      const nc = s.map((v) => v / sw);
      if (nc.some((v, t) => Math.abs(v - c[t]) > 1e-6)) moved = true;
      centers[i] = nc;
    });
    if (!moved) break;
  }
  const out = centers.map((c) => ({ lab: c, w: 0 }));
  items.forEach((it, j) => {
    out[assign[j]].w += it.w;
  });
  return out.filter((o) => o.w > 0);
}

/** Palette signature of an image: up to k Lab clusters with the cell share as weight. */
export function signature(img, k = 16) {
  const items = [...colorCounts(img)].map(([p, w]) => ({ lab: labOfPacked(p), w }));
  const total = items.reduce((s, it) => s + it.w, 0) || 1;
  return kmeans(
    items.map((it) => ({ lab: it.lab, w: it.w / total })),
    k,
  );
}

/** Earth mover distance between two signatures (total weight 1 each) with dE00 as ground distance. Min-cost flow on integer units. */
export function emd(sigA, sigB) {
  const U = 2000;
  const toUnits = (sig) => {
    const raw = sig.map((s) => s.w * U);
    const base = raw.map(Math.floor);
    let rest = U - base.reduce((s, v) => s + v, 0);
    const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
    for (const [, i] of order) {
      if (rest <= 0) break;
      base[i]++;
      rest--;
    }
    return base;
  };
  const a = toUnits(sigA);
  const b = toUnits(sigB);
  const n = a.length;
  const m = b.length;
  // Nodes: 0 source, 1..n supply, n+1..n+m demand, n+m+1 sink.
  const S = 0;
  const T = n + m + 1;
  const edges = [];
  const g = Array.from({ length: n + m + 2 }, () => []);
  const add = (u, v, cap, cost) => {
    g[u].push(edges.length);
    edges.push({ u, v, cap, cost });
    g[v].push(edges.length);
    edges.push({ u: v, v: u, cap: 0, cost: -cost });
  };
  for (let i = 0; i < n; i++) add(S, 1 + i, a[i], 0);
  for (let j = 0; j < m; j++) add(1 + n + j, T, b[j], 0);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) add(1 + i, 1 + n + j, U, deltaE00(sigA[i].lab, sigB[j].lab));
  let flow = 0;
  let cost = 0;
  while (flow < U) {
    const dist = new Array(n + m + 2).fill(Number.POSITIVE_INFINITY);
    const prev = new Array(n + m + 2).fill(-1);
    dist[S] = 0;
    for (let round = 0; round < n + m + 2; round++) {
      let changed = false;
      for (let e = 0; e < edges.length; e++) {
        const ed = edges[e];
        if (ed.cap > 0 && dist[ed.u] + ed.cost < dist[ed.v] - 1e-12) {
          dist[ed.v] = dist[ed.u] + ed.cost;
          prev[ed.v] = e;
          changed = true;
        }
      }
      if (!changed) break;
    }
    if (prev[T] < 0) break;
    let push = U - flow;
    for (let v = T; v !== S; v = edges[prev[v]].u) push = Math.min(push, edges[prev[v]].cap);
    for (let v = T; v !== S; v = edges[prev[v]].u) {
      edges[prev[v]].cap -= push;
      edges[prev[v] ^ 1].cap += push;
    }
    flow += push;
    cost += push * dist[T];
  }
  return cost / U;
}

/** Palette EMD between two images, in dE00 units. */
export const paletteEmd = (a, b, k = 16) => emd(signature(a, k), signature(b, k));

// ---------------------------------------------------------------- rank 7: landmark PCK

/**
 * PCK of the candidate landmarks against the target landmarks. A target point counts as hit when the candidate has a point of the same name
 * within alpha x height. Returns { pck, pckHead, missing, dist }.
 */
export function pck(candLm, refLm, height, { alpha = 0.1, headAlpha = 0.05 } = {}) {
  const names = Object.keys(refLm);
  const dist = {};
  const missing = [];
  let hit = 0;
  let hh = 0;
  let nh = 0;
  for (const name of names) {
    const c = candLm[name];
    const r = refLm[name];
    const d = c ? Math.hypot(c[0] - r[0], c[1] - r[1]) : Number.POSITIVE_INFINITY;
    dist[name] = d;
    if (d <= alpha * height) hit++;
    else missing.push(name);
    if (HEAD_POINTS.includes(name)) {
      nh++;
      if (d <= headAlpha * height) hh++;
    }
  }
  return { pck: names.length ? hit / names.length : 1, pckHead: nh ? hh / nh : 1, missing, dist, points: names.length };
}

// ---------------------------------------------------------------- rank 8: texture density

/** Texture density per group: color changes (dE00 at or above the step) between right and lower neighbors of the same group, per cell of the group. */
export function textureDensity(img, groups, step = TEXTURE_STEP) {
  const out = {};
  for (const g of GROUP_NAMES) {
    let cells = 0;
    let changes = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (groups[y * N + x] !== g) continue;
        cells++;
        const p = packedAt(img, x, y);
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const X = x + dx;
          const Y = y + dy;
          if (X < N && Y < N && groups[Y * N + X] === g && de00Packed(p, packedAt(img, X, Y)) >= step) changes++;
        }
      }
    out[g] = { cells, density: cells ? changes / cells : 0 };
  }
  return out;
}
export function textureDiff(dc, dr) {
  const per = {};
  let max = 0;
  let sum = 0;
  let n = 0;
  for (const g of GROUP_NAMES) {
    const c = dc[g];
    const r = dr[g];
    if (Math.max(c.cells, r.cells) < MIN_PART_CELLS) continue;
    const d = Math.abs(c.density - r.density);
    per[g] = { cand: c.density, ref: r.density, diff: d };
    max = Math.max(max, d);
    sum += d;
    n++;
  }
  return { max, mean: n ? sum / n : 0, per };
}

// ---------------------------------------------------------------- the whole set

/** Clear every cell whose part group is not in the list. Returns { img, labels }. */
export function maskGroups(img, labels, keep) {
  const out = { w: img.w, h: img.h, data: new Uint8Array(img.data) };
  const lab = [...labels];
  for (let i = 0; i < lab.length; i++) {
    const g = lab[i] ? GROUP_OF_PART[lab[i]] : null;
    if (!g || !keep.includes(g)) {
      out.data.fill(0, i * 4, i * 4 + 4);
      lab[i] = null;
    }
  }
  return { img: out, labels: lab };
}

const groupsOf = (labels) => labels.map((p) => (p ? (GROUP_OF_PART[p] ?? null) : null));

/**
 * All target measures of one candidate against one target.
 * cand: image (32x32). target: { img, labels } (outline already recolored). opts.candLabels: label grid of the candidate (default: the automatic labeler).
 * opts.anchor and opts.align pass to align(). Returns { transform, measures, detail }.
 */
export function measureAgainst(cand, target, { candLabels = null, anchor = 'bbox', tau = TAU, groupsOnly = null } = {}) {
  let c = toCanvas(cand, N);
  let labels = candLabels ?? autoLabel(c);
  const t = align(c, { img: target.img, labels: target.labels }, { anchor });
  let refImg = t.ref.img;
  let refLabels = t.ref.labels ?? new Array(N * N).fill(null);
  if (groupsOnly) {
    // Part by part: after the alignment on the whole figure, keep only the listed part groups in both images.
    const m = maskGroups(c, labels, groupsOnly);
    c = m.img;
    labels = m.labels;
    const tm = maskGroups(refImg, refLabels, groupsOnly);
    refImg = tm.img;
    refLabels = tm.labels;
  }
  const refGroups = groupsOf(refLabels);
  const candGroups = groupsOf(labels);
  const bf = boundaryF(edgeMask(c), edgeMask(refImg), N, N);
  const part = partIou(candGroups, refGroups);
  const ch = chamfer(edgeMask(c), edgeMask(refImg), N);
  const val = valueStructure(c, refImg);
  const cm = colorMatch(c, refImg, tau);
  const emdv = paletteEmd(c, refImg);
  const H = t.ref.box ? t.ref.box.y1 - t.ref.box.y0 + 1 : 31;
  const pk = pck(landmarksOf(labels, N, N), landmarksOf(refLabels, N, N), H);
  const tex = textureDiff(textureDensity(c, candGroups), textureDensity(refImg, refGroups));
  const union = opaqueMask(c).reduce((s, v, i) => s + (v || opaqueAt(refImg, i % N, Math.floor(i / N)) ? 1 : 0), 0);
  return {
    transform: { s: t.s, dx: t.dx, dy: t.dy },
    measures: {
      bf1: bf.f,
      partMiou: part.mean,
      partMin: part.min,
      chamferMean: ch.mean,
      chamferP95: ch.p95,
      valueR: val.r,
      colorMatch: cm.mean,
      paletteEmd: emdv,
      pck: pk.pck,
      pckHead: pk.pckHead,
      textureMax: tex.max,
    },
    detail: { bf, part: part.per, valueBlocks: val.blocks, agree3: val.agree3, colorMatch: cm, pckMissing: pk.missing, pckDist: pk.dist, texture: tex.per, unionCells: union, candBox: bboxOf(c) },
  };
}
