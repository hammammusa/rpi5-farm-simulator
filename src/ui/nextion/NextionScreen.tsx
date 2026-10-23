// Renders a Nextion page from the device's live runtime state (or the design
// when the display is unpowered/not placed). Touches go to the device model,
// which sends 0x65 touch events over UART — the screen never drives GPIO itself.
import { useRef } from 'react';
import qrcode from 'qrcode-generator';
import { NX_DEFAULTS, rgb565ToCss, type NxComponent, type NextionRuntime } from '../../engine/devices/nextion';
import { sim, useSimVersion } from '../../state/engine';
import { useApp } from '../../state/store';

const FONT_PX = [12, 16, 20, 26, 32];

export const PICS = ['🌱', '💧', '🌡️', '☀️', '🌀', '⚠️', '⚙️', '🏠', '⬅️', '➡️', '🧪', '💡', '🔌', '⏱️', '✅', '❌'];

function Qr({ text, size, fg, bg }: { text: string; size: number; fg: string; bg: string }) {
  const q = qrcode(0, 'M');
  q.addData(text || ' ');
  q.make();
  const n = q.getModuleCount();
  const cell = size / (n + 2);
  const rects: React.ReactElement[] = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (q.isDark(r, c)) rects.push(<rect key={`${r}.${c}`} x={(c + 1) * cell} y={(r + 1) * cell} width={cell + 0.2} height={cell + 0.2} fill={fg} />);
  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      <rect width={size} height={size} fill={bg} />
      {rects}
    </svg>
  );
}

export function renderNxComponent(c: NxComponent, attrs: Record<string, any>, pressed: boolean, scale: number) {
  const a = { ...NX_DEFAULTS[c.type].attrs, ...attrs };
  const fpx = (FONT_PX[Number(a.font) || 0] ?? 16) * scale;
  const base: React.CSSProperties = {
    position: 'absolute',
    left: c.x * scale,
    top: c.y * scale,
    width: c.w * scale,
    height: c.h * scale,
    overflow: 'hidden',
    boxSizing: 'border-box',
    fontSize: fpx,
    lineHeight: 1.1,
    fontFamily: 'Arial, "Segoe UI", sans-serif',
    display: 'flex',
    alignItems: Number(a.ycen) === 0 ? 'flex-start' : Number(a.ycen) === 2 ? 'flex-end' : 'center',
    justifyContent: Number(a.xcen) === 0 ? 'flex-start' : Number(a.xcen) === 2 ? 'flex-end' : 'center',
    whiteSpace: 'pre',
    direction: 'ltr',
  };
  const bco = rgb565ToCss(Number(a.bco ?? 65535));
  const pco = rgb565ToCss(Number(a.pco ?? 0));
  switch (c.type) {
    case 'text':
      return <div style={{ ...base, background: Number(a.sta) === 0 ? 'transparent' : bco, color: pco, padding: `0 ${3 * scale}px` }}>{String(a.txt)}</div>;
    case 'button': {
      const bg = pressed ? rgb565ToCss(Number(a.bco2)) : bco;
      const fg = pressed ? rgb565ToCss(Number(a.pco2)) : pco;
      return <div style={{ ...base, background: bg, color: fg, borderRadius: 4 * scale, border: `${Math.max(1, scale)}px solid rgba(0,0,0,.35)` }}>{String(a.txt)}</div>;
    }
    case 'dualstate': {
      const on = Number(a.val) === 1;
      return <div style={{ ...base, background: on ? rgb565ToCss(Number(a.bco2)) : bco, color: on ? rgb565ToCss(Number(a.pco2)) : pco, borderRadius: 4 * scale, border: `${Math.max(1, scale)}px solid rgba(0,0,0,.35)` }}>{String(a.txt)}</div>;
    }
    case 'number': {
      const len = Number(a.length) || 0;
      const s = len ? String(Number(a.val)).padStart(len, '0') : String(Number(a.val));
      return <div style={{ ...base, background: bco, color: pco }}>{s}</div>;
    }
    case 'xfloat': {
      const d = Number(a.vvs1) || 0;
      return <div style={{ ...base, background: bco, color: pco }}>{(Number(a.val) / 10 ** d).toFixed(d)}</div>;
    }
    case 'progress': {
      const pct = Math.max(0, Math.min(100, Number(a.val)));
      return (
        <div style={{ ...base, background: bco, border: `${Math.max(1, scale)}px solid rgba(0,0,0,.3)` }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: pco }} />
        </div>
      );
    }
    case 'slider': {
      const min = Number(a.minval);
      const max = Number(a.maxval);
      const f = max > min ? (Number(a.val) - min) / (max - min) : 0;
      return (
        <div style={{ ...base, background: 'transparent' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: '45%', height: '10%', background: bco }} />
          <div style={{ position: 'absolute', left: `calc(${f * 100}% - ${6 * scale}px)`, top: '15%', width: 12 * scale, height: '70%', background: pco, borderRadius: 3 * scale }} />
        </div>
      );
    }
    case 'gauge': {
      const ang = Number(a.val);
      const s = c.w * scale;
      const r = s / 2 - 2;
      const rad = ((ang - 180) * Math.PI) / 180;
      return (
        <div style={{ ...base, background: 'transparent' }}>
          <svg width={s} height={c.h * scale}>
            <circle cx={s / 2} cy={s / 2} r={r} fill={bco} stroke="#0004" />
            <line x1={s / 2} y1={s / 2} x2={s / 2 + Math.cos(rad) * r * 0.85} y2={s / 2 + Math.sin(rad) * r * 0.85} stroke={pco} strokeWidth={Math.max(2, 3 * scale)} strokeLinecap="round" />
            <circle cx={s / 2} cy={s / 2} r={3 * scale} fill="#333" />
          </svg>
        </div>
      );
    }
    case 'checkbox':
      return (
        <div style={{ ...base, background: bco, border: `${Math.max(1, 2 * scale)}px solid ${pco}`, color: pco }}>
          {Number(a.val) ? '✔' : ''}
        </div>
      );
    case 'picture':
      return <div style={{ ...base, fontSize: Math.min(c.w, c.h) * scale * 0.8 }}>{PICS[Number(a.pic)] ?? '▢'}</div>;
    case 'qr':
      return (
        <div style={{ ...base }}>
          <Qr text={String(a.txt)} size={Math.min(c.w, c.h) * scale} fg={pco} bg={bco} />
        </div>
      );
    case 'hotspot':
      return <div style={{ ...base }} />;
    default:
      return null;
  }
}

export function NextionScreen({ compId, scale, interactive }: { compId: string | null; scale: number; interactive: boolean }) {
  useSimVersion();
  const project = useApp((s) => s.doc.nextion);
  const designPage = useApp((s) => s.nextionPage);
  const rt = compId ? (sim.device(compId) as NextionRuntime | null) : null;
  const powered = !!(compId && sim.vis.get(compId)?.powered);
  const live = rt && powered;
  const pageId = live ? rt!.page : designPage;
  const page = project.pages.find((p) => p.id === pageId) ?? project.pages[0];
  const dragging = useRef<string | null>(null);
  const W = project.width * scale;
  const H = project.height * scale;
  if (compId && !powered)
    return (
      <div className="nx-screen" style={{ width: W, height: H, background: '#050505' }}>
        <div className="nx-off">{scale > 0.8 ? 'Nextion not powered (5 V + GND)' : ''}</div>
      </div>
    );
  const at = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = (e.clientX - r.left) / (r.width / project.width);
    const sy = (e.clientY - r.top) / (r.height / project.height);
    const hits = page.components.filter((c) => c.type !== 'variable' && c.type !== 'timer' && sx >= c.x && sx < c.x + c.w && sy >= c.y && sy < c.y + c.h);
    return { hit: hits[hits.length - 1], sx };
  };
  const down = (e: React.PointerEvent) => {
    if (!interactive || !live || !compId) return;
    e.stopPropagation();
    const { hit, sx } = at(e);
    if (!hit) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = hit.name;
    if (hit.type === 'slider') setSlider(hit, sx);
    sim.nextionTouch(compId, hit.name, true);
  };
  const setSlider = (c: NxComponent, sx: number) => {
    const l = rt!.liveOf(page.id, c.name);
    if (!l) return;
    const min = Number(l.attrs.minval);
    const max = Number(l.attrs.maxval);
    rt!.setSlider(c.name, min + Math.max(0, Math.min(1, (sx - c.x) / c.w)) * (max - min));
  };
  const move = (e: React.PointerEvent) => {
    if (!dragging.current || !live) return;
    const c = page.components.find((x) => x.name === dragging.current);
    if (c?.type === 'slider') setSlider(c, at(e).sx);
  };
  const up = (e: React.PointerEvent) => {
    if (!dragging.current || !compId) return;
    e.stopPropagation();
    sim.nextionTouch(compId, dragging.current, false);
    dragging.current = null;
  };
  const dim = live ? rt!.dim / 100 : 1;
  return (
    <div
      className={`nx-screen ${interactive && live ? 'nx-live' : ''}`}
      style={{ width: W, height: H, background: rgb565ToCss(page.bco), filter: dim < 1 ? `brightness(${0.15 + 0.85 * dim})` : undefined }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      data-testid={compId ? `nextion-screen-${compId}` : 'nextion-design'}
    >
      {page.components.map((c) => {
        if (c.type === 'variable' || c.type === 'timer') return null;
        const l = live ? rt!.liveOf(page.id, c.name) : null;
        if (l && !l.visible) return null;
        return (
          <div key={c.id} data-nx={c.name}>
            {renderNxComponent(c, l ? l.attrs : c.attrs, live ? rt!.pressed === c.name : false, scale)}
          </div>
        );
      })}
      {live && rt!.sleep && <div className="nx-off">sleep</div>}
    </div>
  );
}
