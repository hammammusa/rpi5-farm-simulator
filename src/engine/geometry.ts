import type { ComponentInstance, PinDef, Rotation } from './types';

export const GRID = 10;

export function snap(v: number, g = GRID) {
  return Math.round(v / g) * g;
}

/** Rotation pivot is the grid point nearest the body centre, so pins stay on-grid after rotating. */
export function pivotOf(w: number, h: number) {
  return { x: snap(w / 2), y: snap(h / 2) };
}

export function rotatePoint(px: number, py: number, rot: Rotation, cx: number, cy: number) {
  const dx = px - cx;
  const dy = py - cy;
  switch (rot) {
    case 90:
      return { x: cx - dy, y: cy + dx };
    case 180:
      return { x: cx - dx, y: cy - dy };
    case 270:
      return { x: cx + dy, y: cy - dx };
    default:
      return { x: px, y: py };
  }
}

export function pinWorld(c: ComponentInstance, p: PinDef, w: number, h: number) {
  const pv = pivotOf(w, h);
  const r = rotatePoint(p.x, p.y, c.rotation, pv.x, pv.y);
  return { x: c.x + r.x, y: c.y + r.y };
}

export function boundsOf(c: ComponentInstance, w: number, h: number) {
  const pv = pivotOf(w, h);
  const corners = [
    rotatePoint(0, 0, c.rotation, pv.x, pv.y),
    rotatePoint(w, 0, c.rotation, pv.x, pv.y),
    rotatePoint(0, h, c.rotation, pv.x, pv.y),
    rotatePoint(w, h, c.rotation, pv.x, pv.y),
  ];
  const xs = corners.map((p) => p.x + c.x);
  const ys = corners.map((p) => p.y + c.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
