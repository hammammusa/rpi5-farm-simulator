// Application state (zustand). The project document lives here; the simulator
// is notified of every document change. Undo/redo snapshots the editable parts.
import { create } from 'zustand';
import { newProject, uid } from '../engine/project';
import { getPart, withDefaults } from '../engine/parts';
import type { ComponentInstance, ProjectDoc, Rotation, Wire } from '../engine/types';
import type { NextionProject } from '../engine/devices/nextion';
import type { FarmConfig } from '../engine/farm';

export type Tab = 'circuit' | 'python' | 'nextion' | 'farm' | 'web' | 'tests' | 'learn' | 'competition' | 'projects';
export type DockTab = 'terminal' | 'problems' | 'gpio' | 'uart' | 'logs' | 'code';

export interface TermLine {
  kind: 'out' | 'err' | 'sys' | 'in';
  text: string;
}

export interface PyErrorState {
  type: string;
  message: string;
  file?: string;
  line?: number;
  traceback: string;
}

type Snapshot = Pick<ProjectDoc, 'components' | 'wires' | 'nextion' | 'farm' | 'files' | 'mainFile'>;

interface AppState {
  doc: ProjectDoc;
  dirty: boolean;
  savedAt: number | null;
  past: Snapshot[];
  future: Snapshot[];
  selection: string[];
  selectedWire: string | null;
  tab: Tab;
  dockTab: DockTab;
  dockOpen: boolean;
  theme: 'dark' | 'light';
  lang: 'en' | 'ar';
  activeFile: string;
  runtimeState: string;
  runtimeDetail: string;
  term: TermLine[];
  pyError: PyErrorState | null;
  stdinPending: boolean;
  nextionPage: number;
  nextionSel: string | null;
  speed: number;
  ff: number | null;
  toast: string | null;

  setDoc(doc: ProjectDoc, opts?: { history?: boolean; markDirty?: boolean }): void;
  edit(fn: (d: ProjectDoc) => ProjectDoc, history?: boolean): void;
  loadProject(doc: ProjectDoc): void;
  undo(): void;
  redo(): void;
  addComponent(type: string, x: number, y: number, props?: Record<string, any>): string;
  moveComponents(ids: string[], dx: number, dy: number, history?: boolean): void;
  rotateSelected(): void;
  deleteSelected(): void;
  duplicateSelected(): void;
  setProp(id: string, key: string, value: any, history?: boolean): void;
  setLabel(id: string, label: string): void;
  addWire(w: Omit<Wire, 'id'>): void;
  updateWire(id: string, patch: Partial<Wire>): void;
  deleteWire(id: string): void;
  select(ids: string[], wire?: string | null): void;
  setFile(name: string, content: string): void;
  addFile(name: string, content?: string): void;
  renameFile(oldName: string, newName: string): void;
  deleteFile(name: string): void;
  setMainFile(name: string): void;
  setNextion(n: NextionProject, history?: boolean): void;
  setFarm(f: FarmConfig): void;
  setTab(t: Tab): void;
  setDock(t: DockTab, open?: boolean): void;
  toggleDock(): void;
  setTheme(t: 'dark' | 'light'): void;
  setLang(l: 'en' | 'ar'): void;
  setActiveFile(f: string): void;
  termWrite(kind: TermLine['kind'], text: string): void;
  termClear(): void;
  setRuntime(state: string, detail?: string): void;
  setPyError(e: PyErrorState | null): void;
  setStdinPending(p: boolean): void;
  setNextionPage(p: number): void;
  setNextionSel(s: string | null): void;
  setSpeed(s: number): void;
  showToast(msg: string): void;
  rename(name: string): void;
}

const snap = (d: ProjectDoc): Snapshot => ({ components: d.components, wires: d.wires, nextion: d.nextion, farm: d.farm, files: d.files, mainFile: d.mainFile });

function readPref<T extends string>(key: string, def: T): T {
  try {
    return (localStorage.getItem(key) as T) || def;
  } catch {
    return def;
  }
}

function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode */
  }
}

const MAX_TERM = 3000;

export const useApp = create<AppState>((set, get) => ({
  doc: newProject('My first Pi 5 project'),
  dirty: false,
  savedAt: null,
  past: [],
  future: [],
  selection: [],
  selectedWire: null,
  tab: 'circuit',
  dockTab: 'terminal',
  dockOpen: true,
  theme: readPref<'dark' | 'light'>('rpi5sim.theme', typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
  lang: readPref<'en' | 'ar'>('rpi5sim.lang', 'en'),
  activeFile: 'main.py',
  runtimeState: 'loading',
  runtimeDetail: '',
  term: [],
  pyError: null,
  stdinPending: false,
  nextionPage: 0,
  nextionSel: null,
  speed: 1,
  ff: null,
  toast: null,

  setDoc(doc, opts = {}) {
    const st = get();
    const past = opts.history ? [...st.past.slice(-99), snap(st.doc)] : st.past;
    set({ doc: { ...doc, updatedAt: Date.now() }, past, future: opts.history ? [] : st.future, dirty: opts.markDirty === false ? st.dirty : true });
  },
  edit(fn, history = true) {
    get().setDoc(fn(get().doc), { history });
  },
  loadProject(doc) {
    set({
      doc,
      past: [],
      future: [],
      selection: [],
      selectedWire: null,
      dirty: false,
      activeFile: doc.mainFile,
      pyError: null,
      nextionPage: 0,
      nextionSel: null,
      speed: doc.sim?.speed ?? 1,
    });
  },
  undo() {
    const st = get();
    const prev = st.past[st.past.length - 1];
    if (!prev) return;
    set({ doc: { ...st.doc, ...prev }, past: st.past.slice(0, -1), future: [snap(st.doc), ...st.future], dirty: true });
  },
  redo() {
    const st = get();
    const next = st.future[0];
    if (!next) return;
    set({ doc: { ...st.doc, ...next }, future: st.future.slice(1), past: [...st.past, snap(st.doc)], dirty: true });
  },
  addComponent(type, x, y, props = {}) {
    const m = getPart(type);
    const id = uid(type.slice(0, 3));
    const c: ComponentInstance = { id, type, x, y, rotation: 0, props: { ...props } };
    if (type === 'rpi5' && get().doc.components.some((k) => k.type === 'rpi5')) get().showToast('Only one Raspberry Pi 5 runs your program; the extra board is ignored.');
    get().edit((d) => ({ ...d, components: [...d.components, c] }));
    set({ selection: [id], selectedWire: null });
    void m;
    return id;
  },
  moveComponents(ids, dx, dy, history = false) {
    if (!dx && !dy) return;
    const set_ = new Set(ids);
    get().edit((d) => ({
      ...d,
      components: d.components.map((c) => (set_.has(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c)),
      wires: d.wires.map((w) =>
        w.points && set_.has(w.from.comp) && set_.has(w.to.comp) ? { ...w, points: w.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : w,
      ),
    }), history);
  },
  rotateSelected() {
    const ids = new Set(get().selection);
    if (!ids.size) return;
    get().edit((d) => ({ ...d, components: d.components.map((c) => (ids.has(c.id) ? { ...c, rotation: (((c.rotation + 90) % 360) as Rotation) } : c)) }));
  },
  deleteSelected() {
    const st = get();
    if (st.selectedWire) {
      st.deleteWire(st.selectedWire);
      return;
    }
    const ids = new Set(st.selection);
    if (!ids.size) return;
    st.edit((d) => ({
      ...d,
      components: d.components.filter((c) => !ids.has(c.id)),
      wires: d.wires.filter((w) => !ids.has(w.from.comp) && !ids.has(w.to.comp)),
    }));
    set({ selection: [] });
  },
  duplicateSelected() {
    const st = get();
    const ids = new Set(st.selection);
    if (!ids.size) return;
    const map = new Map<string, string>();
    const copies: ComponentInstance[] = [];
    for (const c of st.doc.components) {
      if (!ids.has(c.id)) continue;
      const nid = uid(c.type.slice(0, 3));
      map.set(c.id, nid);
      copies.push({ ...c, id: nid, x: c.x + 40, y: c.y + 40, props: { ...c.props }, label: c.label ? `${c.label} copy` : undefined });
    }
    const wires: Wire[] = st.doc.wires
      .filter((w) => map.has(w.from.comp) && map.has(w.to.comp))
      .map((w) => ({ ...w, id: uid('w'), from: { comp: map.get(w.from.comp)!, pin: w.from.pin }, to: { comp: map.get(w.to.comp)!, pin: w.to.pin }, points: w.points?.map((p) => ({ x: p.x + 40, y: p.y + 40 })) }));
    st.edit((d) => ({ ...d, components: [...d.components, ...copies], wires: [...d.wires, ...wires] }));
    set({ selection: copies.map((c) => c.id) });
  },
  setProp(id, key, value, history = true) {
    get().edit((d) => ({ ...d, components: d.components.map((c) => (c.id === id ? { ...c, props: { ...c.props, [key]: value } } : c)) }), history);
  },
  setLabel(id, label) {
    get().edit((d) => ({ ...d, components: d.components.map((c) => (c.id === id ? { ...c, label: label || undefined } : c)) }));
  },
  addWire(w) {
    const st = get();
    if (w.from.comp === w.to.comp && w.from.pin === w.to.pin) return;
    const dup = st.doc.wires.some(
      (x) => (x.from.comp === w.from.comp && x.from.pin === w.from.pin && x.to.comp === w.to.comp && x.to.pin === w.to.pin) || (x.to.comp === w.from.comp && x.to.pin === w.from.pin && x.from.comp === w.to.comp && x.from.pin === w.to.pin),
    );
    if (dup) return;
    const id = uid('w');
    st.edit((d) => ({ ...d, wires: [...d.wires, { ...w, id }] }));
    set({ selectedWire: id, selection: [] });
  },
  updateWire(id, patch) {
    get().edit((d) => ({ ...d, wires: d.wires.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
  },
  deleteWire(id) {
    get().edit((d) => ({ ...d, wires: d.wires.filter((w) => w.id !== id) }));
    set({ selectedWire: null });
  },
  select(ids, wire = null) {
    set({ selection: ids, selectedWire: wire });
  },
  setFile(name, content) {
    get().edit((d) => ({ ...d, files: d.files.map((f) => (f.name === name ? { ...f, content } : f)) }), false);
  },
  addFile(name, content = '') {
    if (get().doc.files.some((f) => f.name === name)) return;
    get().edit((d) => ({ ...d, files: [...d.files, { name, content }] }));
    set({ activeFile: name });
  },
  renameFile(oldName, newName) {
    if (!newName || get().doc.files.some((f) => f.name === newName)) return;
    get().edit((d) => ({ ...d, files: d.files.map((f) => (f.name === oldName ? { ...f, name: newName } : f)), mainFile: d.mainFile === oldName ? newName : d.mainFile }));
    if (get().activeFile === oldName) set({ activeFile: newName });
  },
  deleteFile(name) {
    const d0 = get().doc;
    if (d0.files.length <= 1) return;
    get().edit((d) => {
      const files = d.files.filter((f) => f.name !== name);
      return { ...d, files, mainFile: d.mainFile === name ? files[0].name : d.mainFile };
    });
    if (get().activeFile === name) set({ activeFile: get().doc.mainFile });
  },
  setMainFile(name) {
    get().edit((d) => ({ ...d, mainFile: name }));
  },
  setNextion(n, history = true) {
    get().edit((d) => ({ ...d, nextion: n }), history);
  },
  setFarm(f) {
    get().edit((d) => ({ ...d, farm: f }));
  },
  setTab(t) {
    set({ tab: t });
  },
  setDock(t, open = true) {
    set({ dockTab: t, dockOpen: open });
  },
  toggleDock() {
    set({ dockOpen: !get().dockOpen });
  },
  setTheme(t) {
    writePref('rpi5sim.theme', t);
    set({ theme: t });
  },
  setLang(l) {
    writePref('rpi5sim.lang', l);
    set({ lang: l });
  },
  setActiveFile(f) {
    set({ activeFile: f });
  },
  termWrite(kind, text) {
    if (!text) return;
    const term = get().term.slice();
    const parts = text.split('\n');
    const last = term[term.length - 1];
    // continue the previous line of the same kind if it had no newline
    if (last && last.kind === kind && !last.text.endsWith('\n')) {
      term[term.length - 1] = { kind, text: last.text + parts[0] + (parts.length > 1 ? '\n' : '') };
    } else term.push({ kind, text: parts[0] + (parts.length > 1 ? '\n' : '') });
    for (let i = 1; i < parts.length; i++) {
      if (i === parts.length - 1 && parts[i] === '') break;
      term.push({ kind, text: parts[i] + (i < parts.length - 1 ? '\n' : '') });
    }
    set({ term: term.length > MAX_TERM ? term.slice(-MAX_TERM) : term });
  },
  termClear() {
    set({ term: [] });
  },
  setRuntime(state, detail) {
    set({ runtimeState: state, runtimeDetail: detail ?? get().runtimeDetail });
  },
  setPyError(e) {
    set({ pyError: e });
  },
  setStdinPending(p) {
    set({ stdinPending: p });
  },
  setNextionPage(p) {
    set({ nextionPage: p, nextionSel: null });
  },
  setNextionSel(s) {
    set({ nextionSel: s });
  },
  setSpeed(s) {
    set({ speed: s });
  },
  showToast(msg) {
    set({ toast: msg });
    setTimeout(() => {
      if (get().toast === msg) set({ toast: null });
    }, 4000);
  },
  rename(name) {
    get().edit((d) => ({ ...d, name }), false);
  },
}));

export function propsOfComp(c: ComponentInstance) {
  return withDefaults(getPart(c.type), c.props);
}
