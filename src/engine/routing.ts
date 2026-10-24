// Wire geometry: how a wire is drawn from its two pin positions and its bend
// points, automatic orthogonal routing around component bodies, crossings and
// bend-point editing. Pure functions: drawing never changes connectivity —
// wires connect only at their two end pins (see netlist.ts).

import type { WireRoute } from './types';

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface WirePath {
  /** expanded polyline actually drawn */
  pts: Pt[];
  /** for each drawn segment i (pts[i] → pts[i+1]): the control-point gap it belongs to
   *  (gap g lies between control point g-1 and g; gap 0 starts at the source pin) */
  gap: number[];
}

/**
 * Expand control points into the drawn polyline.
 *  - manual:     straight segments through the bend points
 *  - orthogonal: horizontal/vertical segments only (an elbow is added between misaligned points)
 *  - diag45:     each leg goes straight along the major axis, then at 45°
 *  - straight:   one segment pin-to-pin (bend points ignored)
 */
export function expandWire(a: Pt, points: Pt[] | undefined, b: Pt, route: WireRoute = 'manual'): WirePath {
  if (route === 'straight') return { pts: [a, b], gap: [0] };
  const ctl = [a, ...(points ?? []), b];
  const pts: Pt[] = [a];
  const gap: number[] = [];
  for (let i = 1; i < ctl.length; i++) {
    const p = ctl[i - 1];
    const q = ctl[i];
    if (route === 'orthogonal' && p.x !== q.x && p.y !== q.y) {
      // first leg follows the previous segment's direction change: alternate H then V
      const prev = pts.length >= 2 ? pts[pts.length - 2] : null;
      const cameHorizontal = prev ? prev.y === p.y : Math.abs(q.x - p.x) >= Math.abs(q.y - p.y);
      const elbow = cameHorizontal && prev ? { x: p.x, y: q.y } : { x: q.x, y: p.y };
      pts.push(elbow);
      gap.push(i - 1);
    } else if (route === 'diag45' && p.x !== q.x && p.y !== q.y) {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.min(Math.abs(dx), Math.abs(dy));
      const elbow = Math.abs(dx) > Math.abs(dy) ? { x: q.x - Math.sign(dx) * d, y: p.y } : { x: p.x, y: q.y - Math.sign(dy) * d };
      if (elbow.x !== p.x || elbow.y !== p.y) {
        pts.push(elbow);
        gap.push(i - 1);
      }
    }
    pts.push(q);
    gap.push(i - 1);
  }
  return { pts, gap };
}

export function pathD(pts: Pt[]) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${round(p.x)} ${round(p.y)}`).join(' ');
}

const round = (v: number) => Math.round(v * 100) / 100;

export function segDistance(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Index of the control-point gap nearest to `p` (where a new bend point should be inserted). */
export function nearestGap(path: WirePath, p: Pt): { gap: number; dist: number } {
  let best = { gap: 0, dist: Infinity };
  for (let i = 0; i + 1 < path.pts.length; i++) {
    const d = segDistance(p, path.pts[i], path.pts[i + 1]);
    if (d < best.dist) best = { gap: path.gap[i], dist: d };
  }
  return best;
}

/** New control-point list with a bend point inserted at `p` on the nearest segment. */
export function insertBend(a: Pt, points: Pt[] | undefined, b: Pt, route: WireRoute, p: Pt): Pt[] {
  const pts = (points ?? []).slice();
  const { gap } = nearestGap(expandWire(a, pts, b, route === 'straight' ? 'manual' : route), p);
  pts.splice(gap, 0, p);
  return pts;
}

/** New control-point list without the bend point nearest to `p` (or `index` when given). */
export function removeBend(points: Pt[] | undefined, p: Pt, index?: number): Pt[] {
  const pts = (points ?? []).slice();
  if (!pts.length) return pts;
  let k = index ?? -1;
  if (k < 0) {
    let best = Infinity;
    pts.forEach((q, i) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < best) {
        best = d;
        k = i;
      }
    });
  }
  pts.splice(k, 1);
  return pts;
}

/** Drop control points that lie on the straight line between their neighbours. */
export function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (out.length && out[out.length - 1].x === p.x && out[out.length - 1].y === p.y) continue;
    while (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (Math.abs(cross) < 1e-9) out.pop();
      else break;
    }
    out.push(p);
  }
  return out;
}

/**
 * Orthogonal auto-route on a grid with A*. Component bodies are soft obstacles
 * (high cost, not forbidden) so a route always exists; the components owning the
 * two end pins are cheaper to cross because their pins sit inside their bodies.
 * Returns the bend points (without the end pins).
 */
export function autoRoute(a: Pt, b: Pt, obstacles: Rect[], own: Rect[] = [], opts: { grid?: number; margin?: number } = {}): Pt[] {
  const g = opts.grid ?? 10;
  const margin = opts.margin ?? 160;
  const sx = Math.round(a.x / g);
  const sy = Math.round(a.y / g);
  const tx = Math.round(b.x / g);
  const ty = Math.round(b.y / g);
  const minX = Math.min(sx, tx) - Math.ceil(margin / g);
  const maxX = Math.max(sx, tx) + Math.ceil(margin / g);
  const minY = Math.min(sy, ty) - Math.ceil(margin / g);
  const maxY = Math.max(sy, ty) + Math.ceil(margin / g);
  const W = maxX - minX + 1;
  const H = maxY - minY + 1;
  if (W * H > 250_000) return [];
  // cell cost map
  const cost = new Float32Array(W * H).fill(1);
  const mark = (r: Rect, c: number, pad: number) => {
    const x0 = Math.max(minX, Math.floor((r.x0 - pad) / g));
    const x1 = Math.min(maxX, Math.ceil((r.x1 + pad) / g));
    const y0 = Math.max(minY, Math.floor((r.y0 - pad) / g));
    const y1 = Math.min(maxY, Math.ceil((r.y1 + pad) / g));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = (y - minY) * W + (x - minX);
      cost[i] = Math.max(cost[i], c);
    }
  };
  for (const r of obstacles) mark(r, 40, 5);
  for (const r of own) mark(r, 4, 0);
  // A* over (cell, direction) so turns can be penalised
  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const N = W * H * 4;
  const gScore = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const heap: [number, number][] = [];
  const push = (f: number, s: number) => {
    heap.push([f, s]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const h = (x: number, y: number) => Math.abs(x - tx) + Math.abs(y - ty);
  const cell = (x: number, y: number) => (y - minY) * W + (x - minX);
  for (let d = 0; d < 4; d++) {
    const s = cell(sx, sy) * 4 + d;
    gScore[s] = 0;
    push(h(sx, sy), s);
  }
  let goal = -1;
  let guard = 0;
  while (heap.length && guard++ < 400_000) {
    const [, s] = pop();
    const c = s >> 2;
    const d = s & 3;
    const x = (c % W) + minX;
    const y = Math.floor(c / W) + minY;
    if (x === tx && y === ty) {
      goal = s;
      break;
    }
    for (let nd = 0; nd < 4; nd++) {
      const nx = x + DIRS[nd][0];
      const ny = y + DIRS[nd][1];
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
      const nc = cell(nx, ny);
      const turn = nd === d ? 0 : 3;
      const ng = gScore[s] + cost[nc] + turn;
      const ns = nc * 4 + nd;
      if (ng < gScore[ns]) {
        gScore[ns] = ng;
        from[ns] = s;
        push(ng + h(nx, ny), ns);
      }
    }
  }
  if (goal < 0) return [];
  const cells: Pt[] = [];
  for (let s = goal; s >= 0; s = from[s]) {
    const c = s >> 2;
    cells.push({ x: ((c % W) + minX) * g, y: (Math.floor(c / W) + minY) * g });
  }
  cells.reverse();
  // the grid start/end may be off the exact pin position by < g/2: keep the pins exact
  const full = simplify([a, ...cells, b]);
  return full.slice(1, -1);
}

/** Intersection point of two segments (proper crossing, not touching at ends). */
export function segIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  const eps = 1e-3;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

/** Visual crossings between different wires (these are NOT electrical connections). */
export function findCrossings(paths: { id: string; pts: Pt[] }[], limit = 2000): { x: number; y: number; a: string; b: string }[] {
  const out: { x: number; y: number; a: string; b: string }[] = [];
  const boxes = paths.map((p) => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const q of p.pts) {
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
    }
    return { x0, y0, x1, y1 };
  });
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++) {
      const A = boxes[i];
      const B = boxes[j];
      if (A.x1 < B.x0 || B.x1 < A.x0 || A.y1 < B.y0 || B.y1 < A.y0) continue;
      const pa = paths[i].pts;
      const pb = paths[j].pts;
      for (let s = 0; s + 1 < pa.length; s++)
        for (let t = 0; t + 1 < pb.length; t++) {
          const x = segIntersect(pa[s], pa[s + 1], pb[t], pb[t + 1]);
          if (x) {
            out.push({ ...x, a: paths[i].id, b: paths[j].id });
            if (out.length >= limit) return out;
          }
        }
    }
  return out;
}

export function rectsOverlap(a: Rect, b: Rect) {
  return !(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0);
}
