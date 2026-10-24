// Circuit image export. The whole circuit (not just the visible viewport) is
// rendered off-screen with the same part drawings as the workspace, written out
// as a standalone SVG (stylesheet embedded) and rasterised for PNG/PDF.
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import CSS from '../ui/styles.css?raw';
import { getPart, hasPart } from '../engine/parts';
import { PI5_HEADER } from '../engine/pi5';
import { pathD, type Pt } from '../engine/routing';
import type { ComponentInstance, ProjectDoc } from '../engine/types';
import { sim } from '../state/engine';
import { compBounds, viewOf } from '../state/store';
import { CompNode, ZoneBoxes, circuitBounds, wirePaths } from '../ui/Workspace';
import { pinText } from './report';

export interface ImageOptions {
  background: 'white' | 'dark' | 'transparent';
  scope: 'all' | 'selected';
  grid: boolean;
  labels: boolean;
  /** raster scale for PNG/PDF (1 = one pixel per workspace unit) */
  scale: number;
}

export const DEFAULT_IMAGE: ImageOptions = { background: 'white', scope: 'all', grid: false, labels: true, scale: 2 };

export interface CircuitSvg {
  svg: string;
  width: number;
  height: number;
  components: number;
  wires: number;
}

const PAD = 40;
const BG = { white: '#ffffff', dark: '#11171d', transparent: 'none' };

// Interaction-only styling is switched off in exported images.
const EXPORT_CSS = `
.comp-hit,.wire-hit,.wire-handle,.wire-ctl,.lock-badge,.marquee{display:none}
.pin,.hole,.comp{cursor:default}
.x-tag{font:600 7px var(--sans);paint-order:stroke;stroke-width:2.5px;stroke-linejoin:round}
.x-name{font:700 10px var(--sans);paint-order:stroke;stroke-width:3px;stroke-linejoin:round}
.x-id{font:500 8px var(--mono)}
.x-foot{font:500 10px var(--sans)}
`;

function selectedDoc(doc: ProjectDoc, opts: ImageOptions, selection: string[]) {
  if (opts.scope !== 'selected' || !selection.length) return { components: doc.components, wires: doc.wires };
  const ids = new Set(selection);
  return { components: doc.components.filter((c) => ids.has(c.id)), wires: doc.wires.filter((w) => ids.has(w.from.comp) && ids.has(w.to.comp)) };
}

/** point `d` units along a polyline from its start */
function along(pts: Pt[], d: number): Pt {
  let left = d;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l >= left && l > 0) return { x: a.x + ((b.x - a.x) * left) / l, y: a.y + ((b.y - a.y) * left) / l };
    left -= l;
  }
  return pts[pts.length - 1];
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const polyLength = (pts: Pt[]) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);

/**
 * Pin-name tags at both ends of every wire. Each tag slides along its own wire
 * until it no longer overlaps another tag or a component name (greedy, Pi ends
 * first because the 40-pin header is the densest spot).
 */
function placeTags(paths: ReturnType<typeof wirePaths>, byId: Map<string, ComponentInstance>, comps: ComponentInstance[], tag: (c: ComponentInstance, pin: string) => string) {
  const placed: Box[] = comps
    .filter((c) => c.type !== 'breadboard' && !c.hideLabel)
    .map((c) => {
      const bb = compBounds(c);
      const cx = (bb.x0 + bb.x1) / 2;
      return { x0: cx - 60, y0: bb.y0 - 28, x1: cx + 60, y1: bb.y0 - 2 };
    });
  const hit = (b: Box) => placed.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);
  const ends = paths.flatMap(({ wire, pts }) =>
    (
      [
        [wire.from, pts],
        [wire.to, [...pts].reverse()],
      ] as const
    ).map(([end, p], i) => ({ key: `${wire.id}-${i}`, end, p: p as Pt[], c: byId.get(end.comp), dim: wire.color === '#2b2b2b' })),
  );
  ends.sort((a, b) => Number(b.c?.type === 'rpi5') - Number(a.c?.type === 'rpi5'));
  const out: { key: string; x: number; y: number; text: string; pin: string; dim: boolean }[] = [];
  for (const e of ends) {
    if (!e.c || e.c.type === 'breadboard') continue;
    const text = tag(e.c, e.end.pin);
    const w = text.length * 3.9 + 4;
    const len = polyLength(e.p);
    const box = (d: number) => {
      const at = along(e.p, d);
      return { at, b: { x0: at.x + 1, y0: at.y - 11, x1: at.x + 3 + w, y1: at.y - 1 } };
    };
    let best = box(Math.min(e.c.type === 'rpi5' ? 26 : 18, len / 2));
    for (let d = e.c.type === 'rpi5' ? 26 : 18; d < len * 0.45; d += 5) {
      const cand = box(d);
      if (!hit(cand.b)) {
        best = cand;
        break;
      }
    }
    placed.push(best.b);
    out.push({ key: e.key, x: best.at.x + 3, y: best.at.y - 3, text, pin: `${e.end.comp}:${e.end.pin}`, dim: e.dim });
  }
  return out;
}

function ExportCircuit({ doc, opts, selection, date }: { doc: ProjectDoc; opts: ImageOptions; selection: string[]; date: string }) {
  const { components, wires } = selectedDoc(doc, opts, selection);
  const comps = components.filter((c) => hasPart(c.type));
  const paths = wirePaths({ components: comps, wires });
  const b = circuitBounds(comps, paths);
  const x0 = Math.floor(b.x0 - PAD);
  const y0 = Math.floor(b.y0 - PAD);
  const foot = opts.labels ? 24 : 0;
  const w = Math.ceil(b.x1 - b.x0 + 2 * PAD);
  const h = Math.ceil(b.y1 - b.y0 + 2 * PAD + foot);
  const dark = opts.background === 'dark';
  const vs = { ...viewOf(doc), showNames: false, showGpioNumbers: opts.labels };
  const inserted = new Set(sim.net.insertions.map((i) => `${i.board}:${i.hole}`));
  const ordered = [...comps.filter((c) => c.type === 'breadboard'), ...comps.filter((c) => c.type !== 'breadboard')];
  const byId = new Map(comps.map((c) => [c.id, c]));
  const halo = dark ? '#11171d' : '#ffffff';
  const ink = dark ? '#e6edf3' : '#1c2630';
  const tag = (c: ComponentInstance | undefined, pin: string) => {
    if (!c) return pin;
    if (c.type === 'rpi5') {
      const hp = PI5_HEADER[Number(pin.slice(1)) - 1];
      return hp ? `${hp.name} · ${hp.physical}` : pin;
    }
    return pinText(c, pin);
  };
  const tags = opts.labels ? placeTags(paths, byId, comps, tag) : [];
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`${x0} ${y0} ${w} ${h}`} width={w} height={h} data-theme={dark ? 'dark' : 'light'} className={`pins-${vs.pinShape}`}>
      <title>{doc.name}</title>
      <style>{CSS + EXPORT_CSS}</style>
      <defs>
        <pattern id="xgrid" width={vs.gridSize} height={vs.gridSize} patternUnits="userSpaceOnUse">
          <circle cx={1} cy={1} r={0.9} fill={dark ? '#2a343f' : '#d3dae1'} />
        </pattern>
      </defs>
      {opts.background !== 'transparent' && <rect x={x0} y={y0} width={w} height={h} fill={BG[opts.background]} data-export="background" />}
      {opts.grid && <rect x={x0} y={y0} width={w} height={h} fill="url(#xgrid)" data-export="grid" />}
      <ZoneBoxes zones={doc.zones} comps={comps} />
      {ordered.map((c) => (
        <CompNode key={c.id} c={{ ...c, locked: false }} sel={false} running={false} hl={null} inserted={inserted} vs={vs} ver={sim.version} />
      ))}
      {paths.map(({ wire: wr, pts }) => {
        const width = wr.width ?? vs.wireWidth;
        return (
          <g key={wr.id} className="wire" data-export-wire={wr.id} data-color={wr.color}>
            <path d={pathD(pts)} className="wire-shadow" style={{ strokeWidth: width + 2 }} />
            <path d={pathD(pts)} stroke={wr.color} className="wire-line" style={{ strokeWidth: width }} />
            <circle cx={pts[0].x} cy={pts[0].y} r={Math.max(2, width * 0.75)} fill={wr.color} />
            <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={Math.max(2, width * 0.75)} fill={wr.color} />
          </g>
        );
      })}
      {tags.map((g) => (
        <text key={g.key} x={g.x} y={g.y} className="x-tag" fill={g.dim && dark ? '#bbb' : ink} stroke={halo} data-export-pin={g.pin}>
          {g.text}
        </text>
      ))}
      {opts.labels &&
        comps
          .filter((c) => c.type !== 'breadboard' && !c.hideLabel)
          .map((c) => {
            const bb = compBounds(c);
            const m = getPart(c.type);
            const name = c.label || (c.type === 'rpi5' ? m.name : m.short ?? m.name);
            return (
              <g key={`n-${c.id}`} data-export-name={c.id}>
                <text x={(bb.x0 + bb.x1) / 2} y={bb.y0 - 16} textAnchor="middle" className="x-name" fill={dark ? '#7ee0b8' : '#0d6b4c'} stroke={halo}>
                  {name}
                </text>
                <text x={(bb.x0 + bb.x1) / 2} y={bb.y0 - 6} textAnchor="middle" className="x-id" fill={dark ? '#9fb0c0' : '#5d6b78'}>
                  {c.id}
                </text>
              </g>
            );
          })}
      {opts.labels && (
        <text x={x0 + 12} y={y0 + h - 10} className="x-foot" fill={dark ? '#9fb0c0' : '#5d6b78'}>
          {`${doc.name} · ${comps.length} components · ${paths.length} wires · ${date} · Raspberry Pi 5 Virtual Electronics & Smart Farming Simulator`}
        </text>
      )}
    </svg>
  );
}

/** Standalone SVG of the circuit (whole circuit or the selection). */
export function renderCircuitSvg(doc: ProjectDoc, opts: ImageOptions, selection: string[] = [], date = new Date().toISOString().slice(0, 10)): CircuitSvg {
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => root.render(<ExportCircuit doc={doc} opts={opts} selection={selection} date={date} />));
  // XMLSerializer (not innerHTML) so the result is well-formed XML (entities, namespaces)
  let svg = new XMLSerializer().serializeToString(host.firstElementChild!);
  root.unmount();
  // live HTML inside the Nextion part cannot be part of a standalone image
  svg = svg.replace(/<foreignObject([^>]*)>[\s\S]*?<\/foreignObject>/g, (_m, attrs: string) => {
    const g = (k: string) => Number(new RegExp(`${k}="([\\d.]+)"`).exec(attrs)?.[1] ?? 0);
    return `<rect x="${g('x')}" y="${g('y')}" width="${g('width')}" height="${g('height')}" fill="#1d2a36"/><text x="${g('x') + g('width') / 2}" y="${g('y') + g('height') / 2}" fill="#9fb0c0" font-size="10" text-anchor="middle">Nextion screen</text>`;
  });
  const vb = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg)!;
  const { components, wires } = selectedDoc(doc, opts, selection);
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`, width: Number(vb[3]), height: Number(vb[4]), components: components.length, wires: wires.length };
}

/** Largest raster scale that stays inside browser canvas limits. */
export function safeScale(w: number, h: number, scale: number) {
  return Math.max(0.1, Math.min(scale, 16000 / w, 16000 / h, Math.sqrt(120e6 / (w * h))));
}

/** Rasterise a standalone SVG into a canvas at `scale` (vector-sharp, not a screenshot). */
export async function svgToCanvas(c: CircuitSvg, scale: number, background?: string): Promise<HTMLCanvasElement> {
  const s = safeScale(c.width, c.height, scale);
  const W = Math.round(c.width * s);
  const H = Math.round(c.height * s);
  const sized = c.svg.replace(/<svg([^>]*?) width="[\d.]+" height="[\d.]+"/, `<svg$1 width="${W}" height="${H}"`);
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.drawImage(img, 0, 0, W, H);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function circuitPng(c: CircuitSvg, scale: number): Promise<Blob> {
  const canvas = await svgToCanvas(c, scale);
  return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
}
