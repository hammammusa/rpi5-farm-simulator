import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GRID, boundsOf, pinWorld, snap } from '../engine/geometry';
import { getPart, hasPart, pinsOf, withDefaults } from '../engine/parts';
import { PI5_HEADER } from '../engine/pi5';
import type { ComponentInstance, PinRef } from '../engine/types';
import { WIRE_COLORS } from '../engine/project';
import { sim, useSimVersion } from '../state/engine';
import { useApp } from '../state/store';
import { useT } from '../i18n';
import { PartBody } from './parts/PartView';
import { compName, pinName } from '../state/wiring';

interface View {
  x: number;
  y: number;
  k: number;
}

type Drag =
  | { kind: 'move'; ids: string[]; sx: number; sy: number; dx: number; dy: number; started: boolean }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; add: boolean }
  | { kind: 'point'; wire: string; idx: number }
  | { kind: 'press'; comp: string };

const DEVICE_TYPES = new Set(['lcd1602_i2c', 'oled_ssd1306', 'nextion']);
const PRESSABLE = new Set(['button', 'switch']);

function pinPos(c: ComponentInstance, pin: string) {
  const m = getPart(c.type);
  const p = pinsOf(m, withDefaults(m, c.props)).find((x) => x.id === pin);
  return p ? pinWorld(c, p, m.w, m.h) : { x: c.x, y: c.y };
}

function piPinClass(bcm: number | null, kind: string) {
  if (kind === 'power3v3') return 'pin-3v3';
  if (kind === 'power5v') return 'pin-5v';
  if (kind === 'ground') return 'pin-gnd';
  if (bcm === null) return '';
  const g = sim.gpio[bcm];
  if (g.mode === 'output') return g.value ? 'pin-high' : 'pin-low';
  if (g.mode === 'pwm') return 'pin-pwm';
  if (g.mode === 'alt') return 'pin-alt';
  return 'pin-in';
}

export function Workspace() {
  useSimVersion();
  const t = useT();
  const doc = useApp((s) => s.doc);
  const selection = useApp((s) => s.selection);
  const selectedWire = useApp((s) => s.selectedWire);
  const running = useApp((s) => s.runtimeState === 'running');
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 20, y: 20, k: 1.4 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [wiring, setWiring] = useState<{ from: PinRef; points: { x: number; y: number }[]; cur: { x: number; y: number } } | null>(null);
  const [hover, setHover] = useState<{ comp: string; pin: string; sx: number; sy: number } | null>(null);
  const [wireColor, setWireColor] = useState(WIRE_COLORS.blue);
  const [space, setSpace] = useState(false);
  const fitted = useRef<string>('');

  const toWorld = useCallback(
    (cx: number, cy: number) => {
      const r = svgRef.current!.getBoundingClientRect();
      return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
    },
    [view],
  );

  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const comps = useApp.getState().doc.components.filter((c) => hasPart(c.type));
    if (!comps.length) return;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const c of comps) {
      const m = getPart(c.type);
      const b = boundsOf(c, m.w, m.h);
      x0 = Math.min(x0, b.x0);
      y0 = Math.min(y0, b.y0 - 20);
      x1 = Math.max(x1, b.x1);
      y1 = Math.max(y1, b.y1);
    }
    const r = svg.getBoundingClientRect();
    const k = Math.max(0.3, Math.min(2.5, Math.min((r.width - 40) / (x1 - x0 || 1), (r.height - 40) / (y1 - y0 || 1))));
    setView({ k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k });
  }, []);

  // fit when a different project is loaded (or an example replaces the circuit)
  const fitKey = `${doc.id}:${doc.exampleId ?? ''}`;
  useEffect(() => {
    if (fitted.current !== fitKey) {
      fitted.current = fitKey;
      requestAnimationFrame(fit);
    }
  }, [fitKey, fit]);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable || tgt.closest('.cm-editor'))) return;
      if (useApp.getState().tab !== 'circuit') return;
      const st = useApp.getState();
      if (e.code === 'Space') setSpace(true);
      if (e.key === 'Escape') {
        setWiring(null);
        st.select([]);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        st.deleteSelected();
      } else if (e.key === 'r' || e.key === 'R') {
        if (!e.ctrlKey && !e.metaKey) st.rotateSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        st.duplicateSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        st.select(st.doc.components.map((c) => c.id));
      } else if (e.key === '+' || e.key === '=') setView((v) => ({ ...v, k: Math.min(4, v.k * 1.2) }));
      else if (e.key === '-') setView((v) => ({ ...v, k: Math.max(0.2, v.k / 1.2) }));
      else if (e.key === '0') fit();
      else if (e.key.startsWith('Arrow') && st.selection.length) {
        e.preventDefault();
        const d = GRID;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        st.moveComponents(st.selection, dx, dy, true);
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpace(false);
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, [fit]);

  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setView((v) => {
      const k = Math.max(0.2, Math.min(5, v.k * f));
      return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
    });
  };

  const pinAt = (el: Element | null): PinRef | null => {
    const p = el?.closest?.('[data-pin]') as HTMLElement | null;
    if (!p) return null;
    return { comp: p.dataset.comp!, pin: p.dataset.pin! };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const st = useApp.getState();
    const w = toWorld(e.clientX, e.clientY);
    if (e.button === 1 || e.button === 2 || space) {
      e.preventDefault();
      if (e.button === 2 && wiring) {
        setWiring(null);
        return;
      }
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    const pin = pinAt(e.target as Element);
    if (pin) {
      e.stopPropagation();
      if (wiring) {
        finishWire(pin);
      } else {
        setWiring({ from: pin, points: [], cur: w });
      }
      return;
    }
    if (wiring) {
      setWiring({ ...wiring, points: [...wiring.points, { x: snap(w.x, 5), y: snap(w.y, 5) }] });
      return;
    }
    const handle = (e.target as Element).closest?.('[data-handle]') as HTMLElement | null;
    if (handle) {
      st.edit((d) => d, true);
      setDrag({ kind: 'point', wire: handle.dataset.wire!, idx: Number(handle.dataset.handle) });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    const wireEl = (e.target as Element).closest?.('[data-wire]') as HTMLElement | null;
    if (wireEl) {
      st.select([], wireEl.dataset.wire!);
      return;
    }
    const compEl = (e.target as Element).closest?.('[data-cid]') as HTMLElement | null;
    if (compEl) {
      const id = compEl.dataset.cid!;
      const c = st.doc.components.find((x) => x.id === id)!;
      // while a program runs, clicking a button/switch operates it instead of moving it
      if (running && PRESSABLE.has(c.type) && (e.target as Element).closest('.press-target')) {
        if (c.type === 'button') {
          sim.pressButton(id, true);
          setDrag({ kind: 'press', comp: id });
          (e.target as Element).setPointerCapture?.(e.pointerId);
        } else st.setProp(id, 'position', withDefaults(getPart(c.type), c.props).position === 'A' ? 'B' : 'A', false);
        return;
      }
      let ids = st.selection;
      if (e.shiftKey) ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      else if (!ids.includes(id)) ids = [id];
      st.select(ids);
      setDrag({ kind: 'move', ids, sx: w.x, sy: w.y, dx: 0, dy: 0, started: false });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    setDrag({ kind: 'marquee', x0: w.x, y0: w.y, x1: w.x, y1: w.y, add: e.shiftKey });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const finishWire = (to: PinRef) => {
    if (!wiring) return;
    if (to.comp === wiring.from.comp && to.pin === wiring.from.pin) {
      setWiring(null);
      return;
    }
    useApp.getState().addWire({ from: wiring.from, to, color: wireColor, points: wiring.points.length ? wiring.points : undefined });
    setWiring(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    if (wiring) setWiring({ ...wiring, cur: w });
    const pin = pinAt(e.target as Element);
    if (pin) setHover({ ...pin, sx: e.clientX, sy: e.clientY });
    else if (hover) setHover(null);
    if (!drag) return;
    const st = useApp.getState();
    if (drag.kind === 'pan') setView((v) => ({ ...v, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy }));
    else if (drag.kind === 'move') {
      const tdx = snap(w.x - drag.sx);
      const tdy = snap(w.y - drag.sy);
      if (tdx !== drag.dx || tdy !== drag.dy) {
        if (!drag.started) st.edit((d) => d, true); // one undo step per drag
        st.moveComponents(drag.ids, tdx - drag.dx, tdy - drag.dy, false);
        setDrag({ ...drag, dx: tdx, dy: tdy, started: true });
      }
    } else if (drag.kind === 'marquee') setDrag({ ...drag, x1: w.x, y1: w.y });
    else if (drag.kind === 'point') {
      const wire = st.doc.wires.find((x) => x.id === drag.wire);
      if (wire?.points) {
        const pts = wire.points.slice();
        pts[drag.idx] = { x: snap(w.x, 5), y: snap(w.y, 5) };
        st.edit((d) => ({ ...d, wires: d.wires.map((x) => (x.id === wire.id ? { ...x, points: pts } : x)) }), false);
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const st = useApp.getState();
    if (drag?.kind === 'marquee') {
      const x0 = Math.min(drag.x0, drag.x1),
        x1 = Math.max(drag.x0, drag.x1),
        y0 = Math.min(drag.y0, drag.y1),
        y1 = Math.max(drag.y0, drag.y1);
      if (Math.abs(x1 - x0) < 3 && Math.abs(y1 - y0) < 3) st.select([]);
      else {
        const ids = st.doc.components
          .filter((c) => {
            if (!hasPart(c.type)) return false;
            const m = getPart(c.type);
            const b = boundsOf(c, m.w, m.h);
            return b.x0 >= x0 && b.x1 <= x1 && b.y0 >= y0 && b.y1 <= y1;
          })
          .map((c) => c.id);
        st.select(drag.add ? [...new Set([...st.selection, ...ids])] : ids);
      }
    } else if (drag?.kind === 'press') sim.pressButton(drag.comp, false);
    // drag-to-wire: release over a different pin finishes the wire
    if (wiring) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const pin = pinAt(el);
      if (pin && (pin.comp !== wiring.from.comp || pin.pin !== wiring.from.pin)) finishWire(pin);
    }
    setDrag(null);
  };

  const onDrop = (e: React.DragEvent) => {
    const type = e.dataTransfer.getData('application/x-part');
    if (!type || !hasPart(type)) return;
    e.preventDefault();
    const m = getPart(type);
    const w = toWorld(e.clientX, e.clientY);
    useApp.getState().addComponent(type, snap(w.x - m.w / 2), snap(w.y - m.h / 2));
  };

  // nets for highlighting the hovered pin's connections
  const hoverNet = useMemo(() => {
    const src = hover ?? (wiring ? wiring.from : null);
    if (!src) return null;
    const n = sim.net.netOf(src);
    if (n < 0) return null;
    return new Set(sim.net.nets[n].pins.map((p) => `${p.comp}:${p.pin}`));
  }, [hover?.comp, hover?.pin, wiring?.from, doc]);

  const issueComps = useMemo(() => {
    const m = new Map<string, 'error' | 'warning'>();
    for (const i of sim.issues) for (const c of i.comps) if (i.severity !== 'info' && m.get(c) !== 'error') m.set(c, i.severity as any);
    return m;
  }, [sim.version]);

  const comps = doc.components.filter((c) => hasPart(c.type));
  const ordered = [...comps.filter((c) => c.type === 'breadboard'), ...comps.filter((c) => c.type !== 'breadboard')];
  const insertedPins = new Set(sim.net.insertions.map((i) => `${i.board}:${i.hole}`));

  return (
    <div className="workspace" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className={`ws-svg ${space || drag?.kind === 'pan' ? 'panning' : ''} ${wiring ? 'wiring' : ''}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        data-testid="workspace"
        role="application"
        aria-label={t('Circuit workspace')}
      >
        <defs>
          <pattern id="grid" width={GRID * view.k} height={GRID * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <circle cx={1} cy={1} r={view.k > 0.6 ? 0.9 : 0} className="grid-dot" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {ordered.map((c) => {
            const m = getPart(c.type);
            const props = withDefaults(m, c.props);
            const pv = { x: snap(m.w / 2), y: snap(m.h / 2) };
            const sel = selection.includes(c.id);
            const dev = DEVICE_TYPES.has(c.type) ? sim.device(c.id) : null;
            const iss = issueComps.get(c.id);
            return (
              <g key={c.id} data-cid={c.id} transform={`translate(${c.x} ${c.y}) rotate(${c.rotation} ${pv.x} ${pv.y})`} className={`comp ${sel ? 'selected' : ''}`} data-testid={`comp-${c.id}`}>
                <rect x={-8} y={-8} width={m.w + 16} height={m.h + 16} className={`comp-hit ${sel ? 'sel' : ''} ${iss ? `iss-${iss}` : ''}`} rx={6} />
                <PartBody comp={c} m={m} props={props} v={sim.vis.get(c.id)} dev={dev} running={running} ver={dev ? sim.version : 0} />
                {pinsOf(m, props).map((p) => {
                  const key = `${c.id}:${p.id}`;
                  const hl = hoverNet?.has(key);
                  if (p.kind === 'hole') {
                    const ins = insertedPins.has(key);
                    return <rect key={p.id} data-comp={c.id} data-pin={p.id} x={p.x - 3} y={p.y - 3} width={6} height={6} rx={1} className={`hole ${ins ? 'hole-ins' : ''} ${hl ? 'hl' : ''}`} />;
                  }
                  let cls = 'pin';
                  if (c.type === 'rpi5') {
                    const h = PI5_HEADER[Number(p.id.slice(1)) - 1];
                    cls += ' ' + piPinClass(h.bcm, h.kind);
                  }
                  return <rect key={p.id} data-comp={c.id} data-pin={p.id} x={p.x - 3.5} y={p.y - 3.5} width={7} height={7} rx={1.5} className={`${cls} ${hl ? 'hl' : ''}`} />;
                })}
                {c.label && (
                  <text x={m.w / 2} y={-12} textAnchor="middle" className="comp-label" transform={`rotate(${-c.rotation} ${m.w / 2} -12)`}>
                    {c.label}
                  </text>
                )}
              </g>
            );
          })}
          {doc.wires.map((w) => {
            const fc = doc.components.find((c) => c.id === w.from.comp);
            const tc = doc.components.find((c) => c.id === w.to.comp);
            if (!fc || !tc || !hasPart(fc.type) || !hasPart(tc.type)) return null;
            const a = pinPos(fc, w.from.pin);
            const b = pinPos(tc, w.to.pin);
            const pts = [a, ...(w.points ?? []), b];
            const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
            const sel = selectedWire === w.id;
            return (
              <g key={w.id} data-wire={w.id} className={`wire ${sel ? 'sel' : ''}`} data-testid={`wire-${w.id}`}>
                <path d={d} className="wire-hit" />
                <path d={d} className="wire-shadow" />
                <path d={d} stroke={w.color} className="wire-line" />
                <circle cx={a.x} cy={a.y} r={2.2} fill={w.color} />
                <circle cx={b.x} cy={b.y} r={2.2} fill={w.color} />
                {sel && w.points?.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4} className="wire-handle" data-handle={i} data-wire={w.id} />)}
                {w.label && (
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} className="wire-label">
                    {w.label}
                  </text>
                )}
              </g>
            );
          })}
          {wiring &&
            (() => {
              const fc = doc.components.find((c) => c.id === wiring.from.comp)!;
              const a = pinPos(fc, wiring.from.pin);
              const pts = [a, ...wiring.points, wiring.cur];
              return <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')} stroke={wireColor} className="wire-line wire-draft" />;
            })()}
          {drag?.kind === 'marquee' && (
            <rect x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} className="marquee" />
          )}
        </g>
      </svg>
      <div className="ws-toolbar" role="toolbar" aria-label={t('Workspace tools')}>
        <button onClick={() => setView((v) => ({ ...v, k: Math.min(5, v.k * 1.2) }))} title={t('Zoom in (+)')} aria-label={t('Zoom in')}>
          ＋
        </button>
        <button onClick={() => setView((v) => ({ ...v, k: Math.max(0.2, v.k / 1.2) }))} title={t('Zoom out (−)')} aria-label={t('Zoom out')}>
          －
        </button>
        <button onClick={fit} title={t('Fit to screen (0)')} aria-label={t('Fit to screen')}>
          ⤢
        </button>
        <button onClick={() => useApp.getState().rotateSelected()} title={t('Rotate (R)')} aria-label={t('Rotate')} disabled={!selection.length}>
          ⟳
        </button>
        <button onClick={() => useApp.getState().duplicateSelected()} title={t('Duplicate (Ctrl+D)')} aria-label={t('Duplicate')} disabled={!selection.length}>
          ⧉
        </button>
        <button onClick={() => useApp.getState().deleteSelected()} title={t('Delete (Del)')} aria-label={t('Delete')} disabled={!selection.length && !selectedWire}>
          🗑
        </button>
        <button onClick={() => useApp.getState().undo()} title={t('Undo (Ctrl+Z)')} aria-label={t('Undo')}>
          ↶
        </button>
        <button onClick={() => useApp.getState().redo()} title={t('Redo (Ctrl+Y)')} aria-label={t('Redo')}>
          ↷
        </button>
        <span className="sep" />
        <span className="ws-hint">{t('Wire colour')}</span>
        {Object.entries(WIRE_COLORS).map(([n, c]) => (
          <button key={n} className={`swatch ${wireColor === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setWireColor(c)} title={n} aria-label={`${t('Wire colour')} ${n}`} />
        ))}
      </div>
      <div className="ws-status">
        {wiring
          ? t('Wiring: click a pin to finish · click empty space to add a bend · Esc / right-click to cancel')
          : running
            ? t('Program running — click buttons and switches to operate them')
            : t('Drag parts from the library · click a pin to start a wire · Space+drag or right-drag to pan · wheel to zoom')}
        <span className="zoom">{Math.round(view.k * 100)}%</span>
      </div>
      {hover && <PinTooltip {...hover} />}
    </div>
  );
}

function PinTooltip({ comp, pin, sx, sy }: { comp: string; pin: string; sx: number; sy: number }) {
  const t = useT();
  const doc = useApp((s) => s.doc);
  const c = doc.components.find((x) => x.id === comp);
  if (!c) return null;
  const m = getPart(c.type);
  const pd = pinsOf(m, withDefaults(m, c.props)).find((p) => p.id === pin);
  const n = sim.net.netOf({ comp, pin });
  const v = n >= 0 ? sim.netVoltage(n) : null;
  const others = n >= 0 ? sim.net.nets[n].pins.filter((p) => p.comp !== comp && doc.components.find((x) => x.id === p.comp)?.type !== 'breadboard') : [];
  let gpio = '';
  if (c.type === 'rpi5') {
    const h = PI5_HEADER[Number(pin.slice(1)) - 1];
    if (h.bcm !== null) {
      const g = sim.gpio[h.bcm];
      gpio = `${g.mode.toUpperCase()}${g.mode === 'output' ? (g.value ? ' HIGH' : ' LOW') : ''}${g.mode === 'pwm' ? ` ${Math.round(g.pwmDuty * 100)}% @ ${g.pwmFreq}Hz` : ''}${g.mode === 'input' ? ` pull-${g.pull}` : ''}${g.alt ? ` ${g.alt}` : ''}`;
    }
  }
  return (
    <div className="tooltip" style={{ left: sx + 14, top: sy + 14 }} dir="ltr">
      <b>{c.type === 'rpi5' ? pd?.desc : `${compName(doc, comp)} · ${pd?.label ?? pin}`}</b>
      {gpio && <div>{gpio}</div>}
      {v !== null && <div>{t('Voltage')}: {v.toFixed(2)} V</div>}
      {others.length > 0 && (
        <div className="muted">
          → {others.slice(0, 4).map((p) => `${compName(doc, p.comp)} ${pinName(doc, p.comp, p.pin)}`).join(', ')}
          {others.length > 4 ? ` +${others.length - 4}` : ''}
        </div>
      )}
      {!others.length && <div className="muted">{t('not connected')}</div>}
    </div>
  );
}
