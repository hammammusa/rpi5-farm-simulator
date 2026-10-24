import { Component, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { GRID, boundsOf, pinWorld, snap } from '../engine/geometry';
import { getPart, hasPart, pinsOf, withDefaults } from '../engine/parts';
import { PI5_HEADER } from '../engine/pi5';
import type { ComponentInstance, PinRef, ViewSettings, Wire, WireRoute } from '../engine/types';
import { WIRE_COLORS, WIRE_WIDTHS } from '../engine/project';
import { expandWire, findCrossings, pathD, type Pt } from '../engine/routing';
import { sim, useSimVersion } from '../state/engine';
import { compBounds, useApp, viewOf } from '../state/store';
import { useT } from '../i18n';
import { PartBody } from './parts/PartView';
import { compName, pinName } from '../state/wiring';
import { ContextMenu, type MenuEntry } from './ContextMenu';

interface View {
  x: number;
  y: number;
  k: number;
}

type Drag =
  | { kind: 'move'; ids: string[]; sx: number; sy: number; dx: number; dy: number; started: boolean }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean; ctx?: { target: Element; cx: number; cy: number } }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; add: boolean }
  | { kind: 'point'; wire: string; idx: number }
  | { kind: 'press'; comp: string }
  | { kind: 'minimap' };

const DEVICE_TYPES = new Set(['lcd1602_i2c', 'lcd2004_i2c', 'oled_ssd1306', 'nextion', 'ws2812_strip', 'seven_segment', 'tm1637', 'tft_st7735']);
const PRESSABLE = new Set(['button', 'switch', 'dip_switch']);
const MIN_K = 0.1;
const MAX_K = 6;

/** Live view state (read by the library to drop parts at the centre and by exports). */
export const liveView = { x: 20, y: 20, k: 1.4, w: 800, h: 600 };

export function workspaceCenter(): Pt {
  return { x: (liveView.w / 2 - liveView.x) / liveView.k, y: (liveView.h / 2 - liveView.y) / liveView.k };
}

export function pinPos(c: ComponentInstance, pin: string) {
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

export interface WirePathInfo {
  wire: Wire;
  pts: Pt[];
  a: Pt;
  b: Pt;
}

/** Drawn geometry of every wire of the document. */
export function wirePaths(doc: { components: ComponentInstance[]; wires: Wire[] }): WirePathInfo[] {
  const byId = new Map(doc.components.map((c) => [c.id, c]));
  const out: WirePathInfo[] = [];
  for (const w of doc.wires) {
    const fc = byId.get(w.from.comp);
    const tc = byId.get(w.to.comp);
    if (!fc || !tc || !hasPart(fc.type) || !hasPart(tc.type)) continue;
    const a = pinPos(fc, w.from.pin);
    const b = pinPos(tc, w.to.pin);
    out.push({ wire: w, a, b, pts: expandWire(a, w.points, b, w.route ?? 'manual').pts });
  }
  return out;
}

/** Point in the middle of the longest drawn segment (where labels go). */
export function labelAnchor(pts: Pt[]): Pt & { horizontal: boolean } {
  let best = 0;
  let k = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (l > best) {
      best = l;
      k = i;
    }
  }
  const a = pts[k];
  const b = pts[k + 1] ?? a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, horizontal: Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) };
}

export function circuitBounds(comps: ComponentInstance[], paths: WirePathInfo[] = []) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const c of comps) {
    if (!hasPart(c.type)) continue;
    const b = compBounds(c);
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0 - 20);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  for (const p of paths)
    for (const q of p.pts) {
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
    }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 400, y1: 300 };
  return { x0, y0, x1, y1 };
}

export function Workspace() {
  useSimVersion();
  const t = useT();
  const doc = useApp((s) => s.doc);
  const selection = useApp((s) => s.selection);
  const selectedWire = useApp((s) => s.selectedWire);
  const highlightNet = useApp((s) => s.highlightNet);
  const mode = useApp((s) => s.mode);
  const running = useApp((s) => s.runtimeState === 'running');
  const vs = viewOf(doc);
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setViewState] = useState<View>({ x: 20, y: 20, k: 1.4 });
  const viewRef = useRef(view);
  const target = useRef<View | null>(null);
  const anim = useRef<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [wiring, setWiring] = useState<{ from: PinRef; points: { x: number; y: number }[]; cur: { x: number; y: number } } | null>(null);
  const [hover, setHover] = useState<{ comp: string; pin: string; sx: number; sy: number } | null>(null);
  const [wireColor, setWireColor] = useState(WIRE_COLORS.blue);
  const [space, setSpace] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[]; testid: string } | null>(null);
  const [viewMenu, setViewMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const fitted = useRef<string>('');
  const pendingMove = useRef<{ x: number; y: number; target: Element | null; clientX: number; clientY: number } | null>(null);
  const moveRaf = useRef<number | null>(null);

  // ------------------------------------------------------------ view (smooth)
  const applyView = useCallback((v: View) => {
    viewRef.current = v;
    Object.assign(liveView, v);
    setViewState(v);
  }, []);

  const stepAnim = useCallback(() => {
    const tg = target.current;
    if (!tg) {
      anim.current = null;
      return;
    }
    const cur = viewRef.current;
    const f = 0.32;
    const next = { x: cur.x + (tg.x - cur.x) * f, y: cur.y + (tg.y - cur.y) * f, k: cur.k + (tg.k - cur.k) * f };
    if (Math.abs(next.k - tg.k) < 0.001 && Math.abs(next.x - tg.x) < 0.3 && Math.abs(next.y - tg.y) < 0.3) {
      applyView(tg);
      target.current = null;
      anim.current = null;
      return;
    }
    applyView(next);
    anim.current = requestAnimationFrame(stepAnim);
  }, [applyView]);

  /** Animate to a view (smooth zoom / fit / centre). */
  const animateTo = useCallback(
    (v: View) => {
      target.current = { ...v, k: Math.max(MIN_K, Math.min(MAX_K, v.k)) };
      if (anim.current === null) anim.current = requestAnimationFrame(stepAnim);
    },
    [stepAnim],
  );

  const setView = useCallback(
    (v: View) => {
      target.current = null;
      applyView(v);
    },
    [applyView],
  );

  const zoomAt = useCallback(
    (factor: number, mx?: number, my?: number) => {
      const r = svgRef.current?.getBoundingClientRect();
      const cx = mx ?? (r ? r.width / 2 : 400);
      const cy = my ?? (r ? r.height / 2 : 300);
      const base = target.current ?? viewRef.current;
      const k = Math.max(MIN_K, Math.min(MAX_K, base.k * factor));
      animateTo({ k, x: cx - ((cx - base.x) * k) / base.k, y: cy - ((cy - base.y) * k) / base.k });
    },
    [animateTo],
  );

  const toWorld = useCallback((cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  }, []);

  const fit = useCallback(
    (smooth = true) => {
      const svg = svgRef.current;
      if (!svg) return;
      const d = useApp.getState().doc;
      const comps = d.components.filter((c) => hasPart(c.type));
      if (!comps.length) return;
      const b = circuitBounds(comps, wirePaths(d));
      const r = svg.getBoundingClientRect();
      const k = Math.max(0.15, Math.min(2.5, Math.min((r.width - 60) / (b.x1 - b.x0 || 1), (r.height - 70) / (b.y1 - b.y0 || 1))));
      const v = { k, x: (r.width - (b.x1 - b.x0) * k) / 2 - b.x0 * k, y: (r.height - (b.y1 - b.y0) * k) / 2 - b.y0 * k };
      if (smooth) animateTo(v);
      else setView(v);
    },
    [animateTo, setView],
  );

  const center = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const d = useApp.getState().doc;
    const b = circuitBounds(d.components, wirePaths(d));
    const r = svg.getBoundingClientRect();
    const k = viewRef.current.k;
    animateTo({ k, x: r.width / 2 - ((b.x0 + b.x1) / 2) * k, y: r.height / 2 - ((b.y0 + b.y1) / 2) * k });
  }, [animateTo]);

  const resetView = useCallback(() => animateTo({ x: 20, y: 20, k: 1 }), [animateTo]);

  // fit when a different project is loaded (or an example replaces the circuit)
  const fitKey = `${doc.id}:${doc.exampleId ?? ''}`;
  useEffect(() => {
    if (fitted.current !== fitKey) {
      fitted.current = fitKey;
      requestAnimationFrame(() => fit(false));
    }
  }, [fitKey, fit]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(() => {
      const r = svg.getBoundingClientRect();
      liveView.w = r.width;
      liveView.h = r.height;
    });
    ro.observe(svg);
    // wheel: non-passive so the page (and browser zoom on Ctrl+wheel / pinch) never moves instead of the canvas
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0018)), mx, my);
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => {
      ro.disconnect();
      svg.removeEventListener('wheel', wheel);
    };
  }, [zoomAt]);

  // ------------------------------------------------------------ keyboard
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable || tgt.closest('.cm-editor'))) return;
      if (useApp.getState().tab !== 'circuit') return;
      const st = useApp.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.code === 'Space') {
        e.preventDefault();
        setSpace(true);
        return;
      }
      if (e.key === 'Escape') {
        setWiring(null);
        setMenu(null);
        st.select([]);
        st.setHighlightNet(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        st.deleteSelected();
      } else if (k === 'r' && !mod) st.rotateSelected();
      else if (mod && k === 'd') {
        e.preventDefault();
        st.duplicateSelected();
      } else if (mod && k === 'a') {
        e.preventDefault();
        st.select(st.doc.components.map((c) => c.id));
      } else if (mod && k === 'c') {
        if (st.copySelection()) e.preventDefault();
      } else if (mod && k === 'x') {
        if (st.copySelection()) {
          e.preventDefault();
          st.deleteSelected();
        }
      } else if (mod && k === 'v') {
        e.preventDefault();
        st.paste();
      } else if (mod && k === 'g') {
        e.preventDefault();
        if (e.shiftKey) st.ungroupSelected();
        else st.groupSelected();
      } else if (k === 'l' && !mod) st.toggleLock();
      else if (k === 'f' && !mod) fit();
      else if (e.key === '?' || (k === '/' && e.shiftKey)) setHelp((h) => !h);
      else if (!mod && (e.key === '+' || e.key === '=')) zoomAt(1.25);
      else if (!mod && e.key === '-') zoomAt(0.8);
      else if (!mod && e.key === '0') fit();
      else if (e.key.startsWith('Arrow') && st.selection.length) {
        e.preventDefault();
        const step = viewOf(st.doc).snap ? GRID : 1;
        const d = e.shiftKey ? step * 5 : step;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        st.moveComponents(st.selection, dx, dy, true);
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpace(false);
    };
    const blur = () => setSpace(false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
    };
  }, [fit, zoomAt]);

  // ------------------------------------------------------------ pointer
  const pinAt = (el: Element | null): PinRef | null => {
    const p = el?.closest?.('[data-pin]') as HTMLElement | null;
    if (!p) return null;
    return { comp: p.dataset.comp!, pin: p.dataset.pin! };
  };

  const snapPt = (p: Pt, g = 5) => (vs.snap ? { x: snap(p.x, g), y: snap(p.y, g) } : { x: Math.round(p.x), y: Math.round(p.y) });

  /** selecting one member of a group selects all of it */
  const withGroups = (ids: string[]) => {
    const comps = useApp.getState().doc.components;
    const groups = new Set(comps.filter((c) => ids.includes(c.id) && c.group).map((c) => c.group));
    if (!groups.size) return ids;
    return [...new Set([...ids, ...comps.filter((c) => c.group && groups.has(c.group)).map((c) => c.id)])];
  };

  const startPan = (e: React.PointerEvent, ctx?: { target: Element; cx: number; cy: number }) => {
    e.preventDefault();
    const v = viewRef.current;
    target.current = null;
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false, ctx });
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const st = useApp.getState();
    setMenu(null);
    setViewMenu(false);
    const w = toWorld(e.clientX, e.clientY);
    // Ctrl/⌘ + left drag, Space + drag and middle drag pan the view
    if (e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey || space))) {
      startPan(e);
      return;
    }
    if (e.button === 2) {
      if (wiring) {
        setWiring(null);
        return;
      }
      // right button: drag pans, a click opens the context menu
      startPan(e, { target: e.target as Element, cx: e.clientX, cy: e.clientY });
      return;
    }
    const pin = pinAt(e.target as Element);
    if (pin) {
      e.stopPropagation();
      if (wiring) finishWire(pin);
      else setWiring({ from: pin, points: [], cur: w });
      return;
    }
    if (wiring) {
      setWiring({ ...wiring, points: [...wiring.points, snapPt(w)] });
      return;
    }
    const handle = (e.target as Element).closest?.('[data-handle]') as HTMLElement | null;
    if (handle) {
      st.edit((d) => d, true);
      setDrag({ kind: 'point', wire: handle.dataset.wire!, idx: Number(handle.dataset.handle) });
      svgRef.current?.setPointerCapture?.(e.pointerId);
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
          svgRef.current?.setPointerCapture?.(e.pointerId);
        } else if (c.type === 'dip_switch') {
          const k = Number(((e.target as Element).closest('[data-sw]') as HTMLElement | null)?.dataset.sw ?? -1);
          if (k >= 0) st.setProp(id, `sw${k + 1}`, !withDefaults(getPart(c.type), c.props)[`sw${k + 1}`], false);
        } else st.setProp(id, 'position', withDefaults(getPart(c.type), c.props).position === 'A' ? 'B' : 'A', false);
        return;
      }
      let ids = st.selection;
      if (e.shiftKey) ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      else if (!ids.includes(id)) ids = [id];
      ids = withGroups(ids);
      st.select(ids);
      setDrag({ kind: 'move', ids, sx: w.x, sy: w.y, dx: 0, dy: 0, started: false });
      svgRef.current?.setPointerCapture?.(e.pointerId);
      return;
    }
    setDrag({ kind: 'marquee', x0: w.x, y0: w.y, x1: w.x, y1: w.y, add: e.shiftKey });
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const finishWire = (to: PinRef) => {
    if (!wiring) return;
    if (to.comp === wiring.from.comp && to.pin === wiring.from.pin) {
      setWiring(null);
      return;
    }
    useApp.getState().addWire({ from: wiring.from, to, color: wireColor, points: wiring.points.length ? wiring.points : undefined, route: 'manual' });
    setWiring(null);
  };

  const processMove = () => {
    moveRaf.current = null;
    const pm = pendingMove.current;
    if (!pm) return;
    pendingMove.current = null;
    const w = { x: pm.x, y: pm.y };
    if (wiring) setWiring((wr) => (wr ? { ...wr, cur: w } : wr));
    const pin = pinAt(pm.target);
    if (pin) setHover({ ...pin, sx: pm.clientX, sy: pm.clientY });
    else setHover((h) => (h ? null : h));
    const dr = dragRef.current;
    if (!dr) return;
    const st = useApp.getState();
    if (dr.kind === 'pan') {
      const moved = dr.moved || Math.hypot(pm.clientX - dr.sx, pm.clientY - dr.sy) > 4;
      if (moved) {
        setView({ ...viewRef.current, x: dr.vx + pm.clientX - dr.sx, y: dr.vy + pm.clientY - dr.sy });
        if (!dr.moved) setDrag({ ...dr, moved: true });
      }
    } else if (dr.kind === 'move') {
      const g = viewOf(st.doc).snap ? GRID : 1;
      const tdx = snap(w.x - dr.sx, g);
      const tdy = snap(w.y - dr.sy, g);
      if (tdx !== dr.dx || tdy !== dr.dy) {
        if (st.doc.components.some((c) => dr.ids.includes(c.id) && c.locked)) {
          if (!dr.started) st.showToast('Locked parts do not move — unlock them first (L).');
          setDrag({ ...dr, dx: tdx, dy: tdy, started: true });
          return;
        }
        if (!dr.started) st.edit((d) => d, true); // one undo step per drag
        st.moveComponents(dr.ids, tdx - dr.dx, tdy - dr.dy, false);
        setDrag({ ...dr, dx: tdx, dy: tdy, started: true });
      }
    } else if (dr.kind === 'marquee') setDrag({ ...dr, x1: w.x, y1: w.y });
    else if (dr.kind === 'point') {
      const wire = st.doc.wires.find((x) => x.id === dr.wire);
      if (wire?.points) {
        const pts = wire.points.slice();
        pts[dr.idx] = snapPt(w);
        st.edit((d) => ({ ...d, wires: d.wires.map((x) => (x.id === wire.id ? { ...x, points: pts } : x)) }), false);
      }
    }
  };

  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const onPointerMove = (e: React.PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    pendingMove.current = { ...w, target: e.target as Element, clientX: e.clientX, clientY: e.clientY };
    // pan follows the pointer immediately; everything else is batched per animation frame
    if (drag?.kind === 'pan') processMove();
    else if (moveRaf.current === null) moveRaf.current = requestAnimationFrame(processMove);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const st = useApp.getState();
    if (moveRaf.current !== null) {
      cancelAnimationFrame(moveRaf.current);
      processMove();
    }
    if (drag?.kind === 'pan' && drag.ctx && !drag.moved) openContextMenu(drag.ctx.target, drag.ctx.cx, drag.ctx.cy);
    if (drag?.kind === 'marquee') {
      const x0 = Math.min(drag.x0, drag.x1),
        x1 = Math.max(drag.x0, drag.x1),
        y0 = Math.min(drag.y0, drag.y1),
        y1 = Math.max(drag.y0, drag.y1);
      if (Math.abs(x1 - x0) < 3 && Math.abs(y1 - y0) < 3) {
        st.select([]);
        st.setHighlightNet(null);
      } else {
        const ids = st.doc.components
          .filter((c) => {
            if (!hasPart(c.type)) return false;
            const b = compBounds(c);
            return b.x0 >= x0 && b.x1 <= x1 && b.y0 >= y0 && b.y1 <= y1;
          })
          .map((c) => c.id);
        st.select(withGroups(drag.add ? [...new Set([...st.selection, ...ids])] : ids));
      }
    } else if (drag?.kind === 'press') sim.pressButton(drag.comp, false);
    // drag-to-wire: release over a different pin finishes the wire
    if (wiring && e.button === 0) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const pin = pinAt(el);
      if (pin && (pin.comp !== wiring.from.comp || pin.pin !== wiring.from.pin)) finishWire(pin);
    }
    setDrag(null);
  };

  // double-click: on a bend handle removes it, on a wire adds a bend point there
  const onDoubleClick = (e: React.MouseEvent) => {
    const st = useApp.getState();
    const w = toWorld(e.clientX, e.clientY);
    // pointer capture retargets the event to the <svg>: use the element under the pointer
    const el = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
    const handle = el.closest?.('[data-handle]') as HTMLElement | null;
    if (handle) {
      st.removeBendAt(handle.dataset.wire!, w, Number(handle.dataset.handle));
      return;
    }
    const wireEl = el.closest?.('[data-wire]') as HTMLElement | null;
    if (wireEl) {
      st.addBend(wireEl.dataset.wire!, snapPt(w));
      st.select([], wireEl.dataset.wire!);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const type = e.dataTransfer.getData('application/x-part');
    if (!type || !hasPart(type)) return;
    e.preventDefault();
    const m = getPart(type);
    const w = toWorld(e.clientX, e.clientY);
    useApp.getState().addComponent(type, snap(w.x - m.w / 2), snap(w.y - m.h / 2));
  };

  // ------------------------------------------------------------ context menus
  const colorRow = (current: string, pick: (c: string) => void) => (
    <div className="ctx-colors">
      {Object.entries(WIRE_COLORS).map(([n, c]) => (
        <button key={n} className={`swatch ${current === c ? 'on' : ''}`} style={{ background: c }} title={t(n)} aria-label={`${t('Wire colour')} ${n}`} data-testid={`ctx-color-${n}`} onClick={() => pick(c)} />
      ))}
      <label className="swatch custom" title={t('Custom colour')}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(current) ? current : '#2b7bd6'} onChange={(e) => pick(e.target.value)} aria-label={t('Custom colour')} data-testid="ctx-color-custom" />
      </label>
    </div>
  );

  const openContextMenu = (el: Element, cx: number, cy: number) => {
    const st = useApp.getState();
    const w = toWorld(cx, cy);
    const wireEl = el.closest?.('[data-wire]') as HTMLElement | null;
    const compEl = el.closest?.('[data-cid]') as HTMLElement | null;
    if (wireEl) {
      const id = wireEl.dataset.wire!;
      const wire = st.doc.wires.find((x) => x.id === id);
      if (!wire) return;
      st.select([], id);
      const route = wire.route ?? 'manual';
      const routeBtn = (r: WireRoute, label: string) => (
        <button key={r} className={route === r ? 'on' : ''} data-testid={`ctx-route-${r}`} onClick={() => (st.setWireRoute(id, r), setMenu(null))}>
          {t(label)}
        </button>
      );
      setMenu({
        x: cx,
        y: cy,
        testid: 'wire-menu',
        items: [
          { title: `${compName(st.doc, wire.from.comp).split(' (')[0]}.${pinName(st.doc, wire.from.comp, wire.from.pin)} → ${compName(st.doc, wire.to.comp).split(' (')[0]}.${pinName(st.doc, wire.to.comp, wire.to.pin)}` },
          { label: t('Change colour'), render: () => colorRow(wire.color, (c) => (st.updateWire(id, { color: c }), setMenu(null))) },
          { label: t('Add bend point'), onClick: () => st.addBend(id, snapPt(w)), testid: 'ctx-add-bend' },
          { label: t('Remove bend point'), onClick: () => st.removeBendAt(id, w), disabled: !wire.points?.length, testid: 'ctx-remove-bend' },
          { label: t('Straighten'), onClick: () => st.setWireRoute(id, 'straight'), testid: 'ctx-straighten' },
          { label: t('Auto route'), onClick: () => st.autoRouteWire(id), testid: 'ctx-autoroute' },
          {
            label: t('Routing'),
            render: () => (
              <div className="ctx-seg">
                <span>{t('Routing')}</span>
                {routeBtn('manual', 'Manual')}
                {routeBtn('orthogonal', '90°')}
                {routeBtn('diag45', '45°')}
                {routeBtn('straight', 'Straight')}
              </div>
            ),
          },
          {
            label: t('Change thickness'),
            render: () => (
              <div className="ctx-seg">
                <span>{t('Thickness')}</span>
                {WIRE_WIDTHS.map((wd) => (
                  <button key={wd} className={(wire.width ?? vs.wireWidth) === wd ? 'on' : ''} data-testid={`ctx-width-${wd}`} onClick={() => (st.updateWire(id, { width: wd }), setMenu(null))}>
                    {wd}
                  </button>
                ))}
              </div>
            ),
          },
          {
            label: t('Add label'),
            onClick: () => {
              const l = window.prompt(t('Wire label'), wire.label ?? '');
              if (l !== null) st.updateWire(id, { label: l || undefined });
            },
            testid: 'ctx-label',
          },
          { label: t('Highlight net'), onClick: () => st.setHighlightNet(wire.from), testid: 'ctx-highlight' },
          'sep',
          { label: t('Delete wire'), onClick: () => st.deleteWire(id), danger: true, shortcut: 'Del', testid: 'ctx-delete-wire' },
        ],
      });
      return;
    }
    if (compEl) {
      const id = compEl.dataset.cid!;
      let ids = st.selection.includes(id) ? st.selection : withGroups([id]);
      st.select(ids);
      ids = useApp.getState().selection;
      const comps = st.doc.components.filter((c) => ids.includes(c.id));
      const locked = comps.every((c) => c.locked);
      const grouped = comps.some((c) => c.group);
      const many = ids.length > 1;
      setMenu({
        x: cx,
        y: cy,
        testid: 'comp-menu',
        items: [
          { title: many ? t('{n} components selected', { n: ids.length }) : compName(st.doc, id) },
          { label: t('Rotate 90°'), onClick: () => st.rotateSelected(), shortcut: 'R' },
          { label: t('Duplicate'), onClick: () => st.duplicateSelected(), shortcut: 'Ctrl+D' },
          { label: t('Copy'), onClick: () => st.copySelection(), shortcut: 'Ctrl+C' },
          { label: locked ? t('Unlock position') : t('Lock position'), onClick: () => st.toggleLock(ids), shortcut: 'L', testid: 'ctx-lock' },
          ...(many ? ([{ label: t('Group'), onClick: () => st.groupSelected(), shortcut: 'Ctrl+G' }] as MenuEntry[]) : []),
          ...(grouped ? ([{ label: t('Ungroup'), onClick: () => st.ungroupSelected(), shortcut: 'Ctrl+Shift+G' }] as MenuEntry[]) : []),
          { label: comps.every((c) => c.hideLabel) ? t('Show label') : t('Hide label'), onClick: () => st.setHideLabel(ids, !comps.every((c) => c.hideLabel)) },
          ...(many
            ? ([
                'sep',
                {
                  label: t('Align'),
                  render: () => (
                    <div className="ctx-seg">
                      <span>{t('Align')}</span>
                      {(
                        [
                          ['left', '⇤'],
                          ['hcenter', '↔'],
                          ['right', '⇥'],
                          ['top', '⤒'],
                          ['vcenter', '↕'],
                          ['bottom', '⤓'],
                        ] as const
                      ).map(([k, s]) => (
                        <button key={k} title={t(`Align ${k}`)} data-testid={`ctx-align-${k}`} onClick={() => (st.align(k), setMenu(null))}>
                          {s}
                        </button>
                      ))}
                    </div>
                  ),
                },
                { label: t('Distribute horizontally'), onClick: () => st.distribute('h'), disabled: ids.length < 3 },
                { label: t('Distribute vertically'), onClick: () => st.distribute('v'), disabled: ids.length < 3 },
              ] as MenuEntry[])
            : []),
          'sep',
          { label: t('Delete'), onClick: () => st.deleteSelected(), danger: true, shortcut: 'Del' },
        ],
      });
      return;
    }
    setMenu({
      x: cx,
      y: cy,
      testid: 'canvas-menu',
      items: [
        { label: t('Paste'), onClick: () => st.paste(w), shortcut: 'Ctrl+V' },
        { label: t('Select all'), onClick: () => st.select(st.doc.components.map((c) => c.id)), shortcut: 'Ctrl+A' },
        'sep',
        { label: t('Fit to screen'), onClick: () => fit(), shortcut: 'F' },
        { label: t('Center circuit'), onClick: center },
        { label: t('Reset view'), onClick: resetView },
        { label: t('Auto-route all wires'), onClick: () => st.doc.wires.forEach((x) => st.autoRouteWire(x.id)) },
      ],
    });
  };

  // ------------------------------------------------------------ derived drawing data
  const highlightKeys = useMemo(() => {
    const src = hover ?? (wiring ? wiring.from : null) ?? highlightNet;
    if (!src) return null;
    const n = sim.net.netOf(src);
    if (n < 0) return null;
    return new Set(sim.net.nets[n].pins.map((p) => `${p.comp}:${p.pin}`));
  }, [hover?.comp, hover?.pin, wiring?.from, highlightNet, doc]);

  const persistentNet = useMemo(() => {
    if (!highlightNet) return null;
    const n = sim.net.netOf(highlightNet);
    return n < 0 ? null : new Set(sim.net.nets[n].pins.map((p) => `${p.comp}:${p.pin}`));
  }, [highlightNet, doc]);

  const issueComps = useMemo(() => {
    const m = new Map<string, 'error' | 'warning'>();
    for (const i of sim.issues) for (const c of i.comps) if (i.severity !== 'info' && m.get(c) !== 'error') m.set(c, i.severity as any);
    return m;
  }, [sim.version]);

  const paths = useMemo(() => wirePaths(doc), [doc.wires, doc.components]);
  const crossings = useMemo(() => (vs.showCrossings ? findCrossings(paths.map((p) => ({ id: p.wire.id, pts: p.pts }))) : []), [paths, vs.showCrossings]);
  // pins with two or more wires attached are drawn as junction dots
  const junctions = useMemo(() => {
    const count = new Map<string, number>();
    for (const w of doc.wires) for (const r of [w.from, w.to]) count.set(`${r.comp}:${r.pin}`, (count.get(`${r.comp}:${r.pin}`) ?? 0) + 1);
    return count;
  }, [doc.wires]);

  const comps = doc.components.filter((c) => hasPart(c.type));
  const ordered = [...comps.filter((c) => c.type === 'breadboard'), ...comps.filter((c) => c.type !== 'breadboard')];
  // a stable Set while the insertions are unchanged keeps the memoised parts from re-rendering
  const insertedKey = sim.net.insertions.map((i) => `${i.board}:${i.hole}`).join('|');
  const insertedPins = useMemo(() => new Set(insertedKey ? insertedKey.split('|') : []), [insertedKey]);
  const groupBoxes = useMemo(() => {
    const sel = new Set(selection);
    const groups = new Map<string, ComponentInstance[]>();
    for (const c of comps) if (c.group && sel.has(c.id)) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
    return [...groups.values()].map((cs) => circuitBounds(cs));
  }, [selection, doc.components]);

  const grid = Math.max(2, vs.gridSize || GRID);
  const bgStyle = vs.background ? { background: vs.background } : undefined;

  return (
    <div className="workspace" ref={rootRef} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} style={bgStyle}>
      <svg
        ref={svgRef}
        className={`ws-svg ${space || drag?.kind === 'pan' ? 'panning' : ''} ${space ? 'pan-ready' : ''} ${wiring ? 'wiring' : ''} pins-${vs.pinShape}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        data-testid="workspace"
        data-k={view.k.toFixed(4)}
        data-x={view.x.toFixed(1)}
        data-y={view.y.toFixed(1)}
        role="application"
        aria-label={t('Circuit workspace')}
      >
        <defs>
          <pattern id="grid" width={grid * view.k} height={grid * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <circle cx={1} cy={1} r={grid * view.k > 5 ? 0.9 : 0} className="grid-dot" />
          </pattern>
        </defs>
        {vs.showGrid && <rect width="100%" height="100%" fill="url(#grid)" />}
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`} className="ws-world">
          {ordered.map((c) => (
            <CompNode
              key={c.id}
              c={c}
              sel={selection.includes(c.id)}
              iss={issueComps.get(c.id)}
              running={running}
              hl={highlightKeys}
              inserted={insertedPins}
              vs={vs}
              ver={sim.version}
            />
          ))}
          {groupBoxes.map((b, i) => (
            <rect key={i} x={b.x0 - 12} y={b.y0 - 12} width={b.x1 - b.x0 + 24} height={b.y1 - b.y0 + 24} className="group-box" rx={8} />
          ))}
          {paths.map(({ wire: w, pts, a, b }) => {
            const sel = selectedWire === w.id;
            const width = w.width ?? vs.wireWidth;
            const anchor = labelAnchor(pts);
            const netId = sim.net.netOf(w.from);
            const net = netId >= 0 ? sim.net.nets[netId] : null;
            const volts = vs.showVoltages && netId >= 0 ? sim.netVoltage(netId) : null;
            const tags: string[] = [];
            if (vs.showWireLabels && w.label) tags.push(w.label);
            if (vs.showNetNames && net && !/^Net \d+$/.test(net.name)) tags.push(net.name);
            if (volts !== null && volts !== undefined) tags.push(`${volts.toFixed(2)} V`);
            return (
              <WireView
                key={w.id}
                w={w}
                d={pathD(pts)}
                ctlD={sel && (w.route ?? 'manual') !== 'manual' && w.points?.length ? pathD(expandWire(a, w.points, b, 'manual').pts) : ''}
                ax={a.x}
                ay={a.y}
                bx={b.x}
                by={b.y}
                sel={sel}
                hlNet={!!persistentNet?.has(`${w.from.comp}:${w.from.pin}`)}
                width={width}
                tag={tags.join(' · ')}
                tx={anchor.x}
                ty={anchor.y - width - 2}
              />
            );
          })}
          {crossings.map((x, i) => (
            <circle key={i} cx={x.x} cy={x.y} r={3.2} className="wire-cross" data-testid="wire-crossing">
              <title>{t('Wires cross here but are NOT connected')}</title>
            </circle>
          ))}
          {[...junctions.entries()].map(([key, n]) => {
            if (n < 2) return null;
            const [cid, pid] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
            const c = doc.components.find((x) => x.id === cid);
            if (!c || !hasPart(c.type)) return null;
            const p = pinPos(c, pid);
            return <circle key={key} cx={p.x} cy={p.y} r={3.6} className="junction" data-testid="junction" />;
          })}
          {wiring &&
            (() => {
              const fc = doc.components.find((c) => c.id === wiring.from.comp)!;
              const a = pinPos(fc, wiring.from.pin);
              const pts = [a, ...wiring.points, wiring.cur];
              return <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')} stroke={wireColor} className="wire-line wire-draft" style={{ strokeWidth: vs.wireWidth }} />;
            })()}
          {drag?.kind === 'marquee' && (
            <rect x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} className="marquee" />
          )}
        </g>
      </svg>
      <div className="ws-toolbar" role="toolbar" aria-label={t('Workspace tools')}>
        <button onClick={() => zoomAt(1.25)} title={t('Zoom in (+)')} aria-label={t('Zoom in')} data-testid="zoom-in">
          ＋
        </button>
        <button onClick={() => zoomAt(0.8)} title={t('Zoom out (−)')} aria-label={t('Zoom out')} data-testid="zoom-out">
          －
        </button>
        <button onClick={() => fit()} title={t('Fit to screen (F)')} aria-label={t('Fit to screen')} data-testid="fit">
          ⤢
        </button>
        <button onClick={center} title={t('Center circuit')} aria-label={t('Center circuit')} data-testid="center">
          ⌖
        </button>
        <button onClick={resetView} title={t('Reset view (100%)')} aria-label={t('Reset view')} data-testid="reset-view">
          1:1
        </button>
        <span className="sep" />
        <button onClick={() => useApp.getState().rotateSelected()} title={t('Rotate (R)')} aria-label={t('Rotate')} disabled={!selection.length}>
          ⟳
        </button>
        <button onClick={() => useApp.getState().duplicateSelected()} title={t('Duplicate (Ctrl+D)')} aria-label={t('Duplicate')} disabled={!selection.length}>
          ⧉
        </button>
        <button onClick={() => useApp.getState().toggleLock()} title={t('Lock / unlock position (L)')} aria-label={t('Lock position')} disabled={!selection.length} data-testid="lock">
          🔒
        </button>
        <button onClick={() => useApp.getState().deleteSelected()} title={t('Delete (Del)')} aria-label={t('Delete')} disabled={!selection.length && !selectedWire}>
          🗑
        </button>
        <button onClick={() => useApp.getState().undo()} title={t('Undo (Ctrl+Z)')} aria-label={t('Undo')} data-testid="undo">
          ↶
        </button>
        <button onClick={() => useApp.getState().redo()} title={t('Redo (Ctrl+Y)')} aria-label={t('Redo')} data-testid="redo">
          ↷
        </button>
        {selection.length > 1 && (
          <>
            <span className="sep" />
            <button onClick={() => useApp.getState().align('left')} title={t('Align left')} data-testid="align-left">
              ⇤
            </button>
            <button onClick={() => useApp.getState().align('top')} title={t('Align top')} data-testid="align-top">
              ⤒
            </button>
            <button onClick={() => useApp.getState().distribute('h')} title={t('Distribute horizontally')} disabled={selection.length < 3} data-testid="distribute-h">
              ⇹
            </button>
            <button onClick={() => useApp.getState().groupSelected()} title={t('Group (Ctrl+G)')} data-testid="group">
              ⊞
            </button>
          </>
        )}
        <span className="sep" />
        <span className="ws-hint">{t('New wire')}</span>
        {Object.entries(WIRE_COLORS).map(([n, c]) => (
          <button key={n} className={`swatch ${wireColor === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setWireColor(c)} title={t(n)} aria-label={`${t('Wire colour')} ${n}`} />
        ))}
        <label className="swatch custom" title={t('Custom colour')}>
          <input type="color" value={wireColor} onChange={(e) => setWireColor(e.target.value)} aria-label={t('Custom wire colour')} />
        </label>
        <span className="sep" />
        <button className={viewMenu ? 'on' : ''} onClick={() => setViewMenu((v) => !v)} title={t('View & appearance')} aria-label={t('View & appearance')} data-testid="view-menu-btn">
          ⚙
        </button>
        <button onClick={() => setHelp(true)} title={t('Keyboard shortcuts (?)')} aria-label={t('Keyboard shortcuts')}>
          ?
        </button>
        <button
          onClick={() => {
            const el = rootRef.current?.closest('.circuit-tab') as HTMLElement | null;
            if (!el) return;
            if (document.fullscreenElement) void document.exitFullscreen();
            else void el.requestFullscreen?.().catch(() => el.classList.toggle('focus-mode'));
          }}
          title={t('Full screen')}
          aria-label={t('Full screen')}
        >
          ⛶
        </button>
      </div>
      {viewMenu && <ViewPanel vs={vs} onClose={() => setViewMenu(false)} />}
      {vs.minimap && comps.length > 0 && <MiniMap view={view} paths={paths} onMove={(v) => setView(v)} svg={svgRef} />}
      <div className="ws-status">
        <span>
          {wiring
            ? t('Wiring: click a pin to finish · click empty space to add a bend · Esc / right-click to cancel')
            : running
              ? t('Program running — click buttons and switches to operate them')
              : mode === 'beginner'
                ? t('Drag parts from the library · click a pin to start a wire · Ctrl+drag or Space+drag to pan · wheel to zoom · right-click for options')
                : t('Ctrl/Space+drag pan · wheel zoom · double-click wire = bend · right-click menus · ? shortcuts')}
        </span>
        <span className="zoom" data-testid="zoom-pct">
          {Math.round(view.k * 100)}%
        </span>
      </div>
      {hover && <PinTooltip {...hover} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} testid={menu.testid} />}
      {help && <ShortcutsHelp onClose={() => setHelp(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- one wire
/** Props are primitives (plus the stored wire object), so unchanged wires skip re-rendering. */
const WireView = memo(function WireView(p: { w: Wire; d: string; ctlD: string; ax: number; ay: number; bx: number; by: number; sel: boolean; hlNet: boolean; width: number; tag: string; tx: number; ty: number }) {
  const { w, width } = p;
  return (
    <g data-wire={w.id} className={`wire ${p.sel ? 'sel' : ''} ${p.hlNet ? 'net-hl' : ''}`} data-testid={`wire-${w.id}`} data-color={w.color} data-width={width} data-route={w.route ?? 'manual'} data-bends={w.points?.length ?? 0}>
      <path d={p.d} className="wire-hit" style={{ strokeWidth: Math.max(10, width + 7) }} />
      <path d={p.d} className="wire-shadow" style={{ strokeWidth: width + 2 }} />
      <path d={p.d} stroke={w.color} className="wire-line" style={{ strokeWidth: width }} />
      {p.ctlD ? <path d={p.ctlD} className="wire-ctl" /> : null}
      <circle cx={p.ax} cy={p.ay} r={Math.max(2, width * 0.75)} fill={w.color} className="wire-end" />
      <circle cx={p.bx} cy={p.by} r={Math.max(2, width * 0.75)} fill={w.color} className="wire-end" />
      {p.sel && w.points?.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={4.5} className="wire-handle" data-handle={i} data-wire={w.id} data-testid={`bend-${w.id}-${i}`} />)}
      {p.tag && (
        <text x={p.tx} y={p.ty} className="wire-label" textAnchor="middle">
          {p.tag}
        </text>
      )}
    </g>
  );
});

// ---------------------------------------------------------------- one component
export const CompNode = memo(function CompNode({
  c,
  sel,
  iss,
  running,
  hl,
  inserted,
  vs,
  ver,
}: {
  c: ComponentInstance;
  sel: boolean;
  iss?: 'error' | 'warning';
  running: boolean;
  hl: Set<string> | null;
  inserted: Set<string>;
  vs: ViewSettings;
  ver: number;
}) {
  const m = getPart(c.type);
  const props = withDefaults(m, c.props);
  const pv = { x: snap(m.w / 2), y: snap(m.h / 2) };
  const dev = DEVICE_TYPES.has(c.type) ? sim.device(c.id) : null;
  const label = !c.hideLabel && vs.showNames ? c.label ?? (c.type === 'breadboard' || c.type === 'rpi5' ? '' : m.short ?? '') : '';
  return (
    <g data-cid={c.id} transform={`translate(${c.x} ${c.y}) rotate(${c.rotation} ${pv.x} ${pv.y})`} className={`comp ${sel ? 'selected' : ''} ${c.locked ? 'locked' : ''}`} data-testid={`comp-${c.id}`}>
      <rect x={-8} y={-8} width={m.w + 16} height={m.h + 16} className={`comp-hit ${sel ? 'sel' : ''} ${iss ? `iss-${iss}` : ''}`} rx={6} />
      <PartErrorBoundary type={c.type} w={m.w} h={m.h}>
        <PartBody comp={c} m={m} props={props} v={sim.vis.get(c.id)} dev={dev} running={running} ver={dev ? ver : 0} />
      </PartErrorBoundary>
      {pinsOf(m, props).map((p) => {
        const key = `${c.id}:${p.id}`;
        const h = hl?.has(key);
        if (p.kind === 'hole') {
          const ins = inserted.has(key);
          return <rect key={p.id} data-comp={c.id} data-pin={p.id} x={p.x - 3} y={p.y - 3} width={6} height={6} rx={1} className={`hole ${ins ? 'hole-ins' : ''} ${h ? 'hl' : ''}`} />;
        }
        let cls = 'pin';
        if (c.type === 'rpi5') {
          const hp = PI5_HEADER[Number(p.id.slice(1)) - 1];
          cls += ' ' + piPinClass(hp.bcm, hp.kind);
        }
        return <rect key={p.id} data-comp={c.id} data-pin={p.id} x={p.x - 3.5} y={p.y - 3.5} width={7} height={7} rx={vs.pinShape === 'round' ? 3.5 : 1.5} className={`${cls} ${h ? 'hl' : ''}`} />;
      })}
      {c.type === 'rpi5' && vs.showGpioNumbers && <PiPinNumbers />}
      {label && (
        <text x={m.w / 2} y={-12} textAnchor="middle" className={`comp-label ${c.label ? '' : 'auto'}`} transform={`rotate(${-c.rotation} ${m.w / 2} -12)`}>
          {label}
        </text>
      )}
      {c.locked && (
        <text x={m.w + 2} y={-2} className="lock-badge" transform={`rotate(${-c.rotation} ${m.w + 2} -2)`}>
          🔒
        </text>
      )}
    </g>
  );
});

function PiPinNumbers() {
  return (
    <g className="pi-pin-numbers" pointerEvents="none">
      {PI5_HEADER.map((h) => {
        const col = Math.floor((h.physical - 1) / 2);
        const odd = h.physical % 2 === 1;
        const x = 40 + col * 10;
        const txt = h.bcm !== null ? `${h.bcm}` : h.name === 'GND' ? 'G' : h.name === '3V3' ? '3V3' : '5V';
        const y = odd ? 38 : 13;
        return (
          <text key={h.physical} x={x} y={y} textAnchor="middle" className={`pi-num ${h.bcm === null ? 'pwr' : ''}`}>
            {txt}
          </text>
        );
      })}
    </g>
  );
}

/** One failing part renderer must never take the whole workspace down. */
class PartErrorBoundary extends Component<{ type: string; w: number; h: number; children: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() {
    return { err: true };
  }
  componentDidCatch(e: unknown) {
    console.error('part renderer failed', this.props.type, e);
  }
  render() {
    if (this.state.err)
      return (
        <g>
          <rect width={this.props.w} height={this.props.h} fill="#5a1d1d" stroke="#f55" rx={4} />
          <text x={4} y={14} className="pt-label" fill="#fff">
            {this.props.type} ⚠
          </text>
        </g>
      );
    return this.props.children;
  }
}

// ---------------------------------------------------------------- minimap
function MiniMap({ view, paths, onMove, svg }: { view: View; paths: WirePathInfo[]; onMove(v: View): void; svg: React.RefObject<SVGSVGElement | null> }) {
  const doc = useApp((s) => s.doc);
  const W = 180;
  const H = 120;
  const b = circuitBounds(doc.components, paths);
  // size kept current by the workspace's ResizeObserver: reading layout here would force a reflow every frame
  const vw = liveView.w / view.k;
  const vh = liveView.h / view.k;
  const vx = -view.x / view.k;
  const vy = -view.y / view.k;
  const x0 = Math.min(b.x0, vx) - 20;
  const y0 = Math.min(b.y0, vy) - 20;
  const x1 = Math.max(b.x1, vx + vw) + 20;
  const y1 = Math.max(b.y1, vy + vh) + 20;
  const s = Math.min(W / (x1 - x0), H / (y1 - y0));
  const dragging = useRef(false);
  const go = (e: React.PointerEvent) => {
    const rr = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const wx = (e.clientX - rr.left) / s + x0;
    const wy = (e.clientY - rr.top) / s + y0;
    onMove({ k: view.k, x: liveView.w / 2 - wx * view.k, y: liveView.h / 2 - wy * view.k });
  };
  return (
    <svg
      className="minimap"
      width={W}
      height={H}
      data-testid="minimap"
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        go(e);
      }}
      onPointerMove={(e) => dragging.current && go(e)}
      onPointerUp={() => (dragging.current = false)}
    >
      <g transform={`scale(${s}) translate(${-x0} ${-y0})`}>
        {doc.components.filter((c) => hasPart(c.type)).map((c) => {
          const bb = compBounds(c);
          return <rect key={c.id} x={bb.x0} y={bb.y0} width={bb.x1 - bb.x0} height={bb.y1 - bb.y0} className={`mm-comp ${c.type === 'rpi5' ? 'pi' : ''}`} />;
        })}
        {paths.map((p) => (
          <path key={p.wire.id} d={pathD(p.pts)} stroke={p.wire.color} className="mm-wire" style={{ strokeWidth: 2 / s }} />
        ))}
        <rect x={vx} y={vy} width={vw} height={vh} className="mm-view" style={{ strokeWidth: 1.5 / s }} />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------- view settings
function ViewPanel({ vs, onClose }: { vs: ViewSettings; onClose(): void }) {
  const t = useT();
  const st = useApp.getState();
  const tog = (k: keyof ViewSettings, label: string) => (
    <label className="vp-row" key={k}>
      <input type="checkbox" checked={!!vs[k]} onChange={(e) => st.setView({ [k]: e.target.checked } as any)} data-testid={`view-${k}`} />
      <span>{t(label)}</span>
    </label>
  );
  return (
    <div className="view-panel" data-testid="view-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="vp-head">
        <b>{t('View & appearance')}</b>
        <button onClick={onClose} aria-label={t('Close')}>
          ✕
        </button>
      </div>
      {tog('showGrid', 'Show grid')}
      {tog('snap', 'Snap to grid')}
      <label className="vp-row">
        <span>{t('Grid size')}</span>
        <select value={vs.gridSize} onChange={(e) => st.setView({ gridSize: Number(e.target.value) })} data-testid="view-gridSize">
          {[5, 10, 20, 40].map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      {tog('minimap', 'Mini-map')}
      {tog('showGpioNumbers', 'Show GPIO numbers on the Pi header')}
      {tog('showNames', 'Show component names')}
      {tog('showWireLabels', 'Show wire labels')}
      {tog('showNetNames', 'Show net names on wires')}
      {tog('showVoltages', 'Show net voltages on wires')}
      {tog('showCrossings', 'Mark wire crossings (not connected)')}
      <label className="vp-row">
        <span>{t('Default wire thickness')}</span>
        <select value={vs.wireWidth} onChange={(e) => st.setView({ wireWidth: Number(e.target.value) })} data-testid="view-wireWidth">
          {WIRE_WIDTHS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>
      <label className="vp-row">
        <span>{t('Pin heads')}</span>
        <select value={vs.pinShape} onChange={(e) => st.setView({ pinShape: e.target.value as any })} data-testid="view-pinShape">
          <option value="square">{t('Square')}</option>
          <option value="round">{t('Round')}</option>
        </select>
      </label>
      <label className="vp-row">
        <span>{t('Workspace background')}</span>
        <input type="color" value={vs.background || '#11171d'} onChange={(e) => st.setView({ background: e.target.value })} data-testid="view-background" />
        <button onClick={() => st.setView({ background: '' })}>{t('Theme')}</button>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- shortcuts
export const SHORTCUTS: [string, string][] = [
  ['Ctrl + drag / Space + drag / middle drag', 'Pan the workspace'],
  ['Mouse wheel / pinch', 'Zoom toward the pointer'],
  ['+ / − / 0 / F', 'Zoom in / out / fit to screen'],
  ['Drag a part', 'Move it (wires follow)'],
  ['Click a pin, then another pin', 'Draw a wire (click empty space for bends)'],
  ['Double-click a wire', 'Add a bend point'],
  ['Double-click a bend point', 'Remove it'],
  ['Right-click', 'Context menu (wire, part or canvas)'],
  ['Shift + click / drag box', 'Multi-select'],
  ['R', 'Rotate 90°'],
  ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste'],
  ['Ctrl+D', 'Duplicate'],
  ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'],
  ['L', 'Lock / unlock position'],
  ['Arrows (Shift = ×5)', 'Nudge selected parts'],
  ['Delete', 'Delete selection'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['F5 / Ctrl+Enter, Shift+F5', 'Run / stop the program'],
  ['Ctrl+S', 'Save'],
  ['Esc', 'Cancel wire, close menu, clear selection'],
];

function ShortcutsHelp({ onClose }: { onClose(): void }) {
  const t = useT();
  return (
    <div className="modal-back" onPointerDown={onClose} data-testid="shortcuts-help">
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="vp-head">
          <b>{t('Keyboard shortcuts')}</b>
          <button onClick={onClose} aria-label={t('Close')}>
            ✕
          </button>
        </div>
        <table className="data-table">
          <tbody>
            {SHORTCUTS.map(([k, d]) => (
              <tr key={k}>
                <td dir="ltr">
                  <kbd>{k}</kbd>
                </td>
                <td>{t(d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">{t('Workspace shortcuts are ignored while you type in the code editor or a text field.')}</p>
      </div>
    </div>
  );
}

function PinTooltip({ comp, pin, sx, sy }: { comp: string; pin: string; sx: number; sy: number }) {
  const t = useT();
  const doc = useApp((s) => s.doc);
  const mode = useApp((s) => s.mode);
  const c = doc.components.find((x) => x.id === comp);
  if (!c || !hasPart(c.type)) return null;
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
      {mode === 'beginner' && pd?.desc && c.type !== 'rpi5' && <div className="muted">{pd.desc}</div>}
      {mode === 'beginner' && pd && <div className="muted">{t(PIN_KIND_HINT[pd.kind] ?? '')}</div>}
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

const PIN_KIND_HINT: Record<string, string> = {
  power: 'Power pin: connect to the supply voltage shown in the part description.',
  ground: 'Ground: connect to a GND pin of the Pi (all grounds must be common).',
  gpio: 'GPIO: 3.3 V logic only — never connect 5 V or more.',
  digital: 'Digital signal: goes to a GPIO or a bus pin (I2C/SPI/UART).',
  analog: 'Analog signal: the Pi 5 has no ADC — connect it to an ADC channel (MCP3008/ADS1115).',
  passive: 'Passive lead: either direction.',
  terminal: 'Screw terminal / load connection.',
  nc: 'Not connected internally.',
};
