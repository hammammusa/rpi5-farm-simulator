// Registry-driven Python completion and hover docs for the code editor. Suggestions
// come only from the built-in driver registry (catalog/drivers.ts), so everything
// offered actually exists in the simulator's Python environment.
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { hoverTooltip, type EditorView } from '@codemirror/view';
import { DRIVERS, type ApiDoc } from '../catalog/drivers';

interface Entry extends ApiDoc {
  module: string;
}

const ENTRIES: Entry[] = DRIVERS.flatMap((d) => d.apis.map((a) => ({ ...a, module: d.module })));
const MODULES = DRIVERS.map((d) => ({ label: d.module === 'RPi' ? 'RPi.GPIO' : d.module, info: `${d.title}\nReal Pi: ${d.real.install}`, type: 'namespace' }));

/** children of a dotted path inside a module: ('gpiozero', '') → LED, Button…; ('gpiozero','LED') → on, off… */
function children(module: string, path: string): Entry[] {
  const depth = path ? path.split('.').length : 0;
  const prefix = path ? path + '.' : '';
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const e of ENTRIES) {
    if (e.module !== module || !e.name.startsWith(prefix)) continue;
    const seg = e.name.split('.')[depth];
    if (!seg || seen.has(seg)) continue;
    seen.add(seg);
    out.push(e.name.split('.').length === depth + 1 ? e : { ...e, name: prefix + seg, sig: undefined, doc: `${module}.${prefix}${seg}` });
  }
  return out;
}

const toOption = (e: Entry, label?: string) => {
  const last = label ?? e.name.split('.').pop()!;
  return {
    label: last,
    type: /^[A-Z]/.test(last) ? 'class' : e.sig?.includes('(') ? 'function' : 'property',
    detail: e.sig ? e.sig.replace(/^[\w.]+/, '').slice(0, 60) : undefined,
    info: `${e.sig ?? e.name}\n${e.doc}\n(${e.module})`,
    boost: /^[A-Z]/.test(last) ? 2 : 0,
  };
};

/** module aliases and from-imports declared in the code */
export function analyseImports(code: string) {
  const alias = new Map<string, { module: string; path: string }>();
  for (const m of code.matchAll(/^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?/gm)) {
    const full = m[1];
    const top = full.split('.')[0];
    const mod = top === 'RPi' ? 'RPi' : top;
    if (m[2]) alias.set(m[2], { module: mod, path: full.split('.').slice(1).join('.').replace(/^GPIO$/, 'GPIO') });
    else alias.set(top, { module: mod, path: '' });
  }
  for (const m of code.matchAll(/^\s*from\s+([\w.]+)\s+import\s+([\w, ]+(?:\s+as\s+\w+)?)/gm)) {
    const [top, ...rest] = m[1].split('.');
    for (const part of m[2].split(',')) {
      const [name, as] = part.trim().split(/\s+as\s+/);
      if (!name) continue;
      alias.set(as ?? name, { module: top, path: [...rest, name].join('.') });
    }
  }
  // variables created from a known class: led = LED(17)
  const vars = new Map<string, { module: string; path: string }>();
  for (const m of code.matchAll(/^\s*(\w+)\s*=\s*([\w.]+)\s*\(/gm)) {
    const [head, ...tail] = m[2].split('.');
    const a = alias.get(head);
    if (a) vars.set(m[1], { module: a.module, path: [a.path, ...tail].filter(Boolean).join('.') });
  }
  return { alias, vars };
}

export function piCompletions(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  // import / from X
  let m = /^\s*(?:import|from)\s+([\w.]*)$/.exec(before);
  if (m) return { from: ctx.pos - m[1].length, options: MODULES, validFor: /^[\w.]*$/ };
  // from X import y
  m = /^\s*from\s+([\w.]+)\s+import\s+(?:[\w, ]+,\s*)?(\w*)$/.exec(before);
  if (m) {
    const [top, ...rest] = m[1].split('.');
    return { from: ctx.pos - m[2].length, options: children(top === 'RPi' ? 'RPi' : top, rest.join('.')).map((e) => toOption(e)), validFor: /^\w*$/ };
  }
  const code = ctx.state.doc.toString();
  const { alias, vars } = analyseImports(code);
  // something.attr
  m = /([\w.]+)\.(\w*)$/.exec(before);
  if (m) {
    const [head, ...tail] = m[1].split('.');
    const a = alias.get(head) ?? vars.get(head);
    if (!a) return null;
    const path = [a.path, ...tail].filter(Boolean).join('.');
    const opts = children(a.module, path).map((e) => toOption(e));
    return opts.length ? { from: ctx.pos - m[2].length, options: opts, validFor: /^\w*$/ } : null;
  }
  const w = ctx.matchBefore(/\w+/);
  if (!w || (w.from === w.to && !ctx.explicit)) return null;
  const opts = [...alias.entries()].flatMap(([name, a]) => {
    const e = ENTRIES.find((x) => x.module === a.module && x.name === a.path);
    return e ? [toOption(e, name)] : [{ label: name, type: 'namespace', info: a.module }];
  });
  return { from: w.from, options: opts };
}

/** Lookup used by hover tooltips. */
export function describe(code: string, word: string, objectBefore?: string): Entry | null {
  const { alias, vars } = analyseImports(code);
  if (objectBefore) {
    const [head, ...tail] = objectBefore.split('.');
    const a = alias.get(head) ?? vars.get(head);
    if (a) {
      const path = [a.path, ...tail, word].filter(Boolean).join('.');
      const e = ENTRIES.find((x) => x.module === a.module && x.name === path);
      if (e) return e;
    }
  }
  const a = alias.get(word);
  if (a) {
    const e = ENTRIES.find((x) => x.module === a.module && x.name === a.path);
    if (e) return e;
    const d = DRIVERS.find((x) => x.module === a.module);
    if (d && !a.path) return { module: d.module, name: d.module, doc: `${d.title}. On a real Pi: ${d.real.install}` };
  }
  return null;
}

export const piHover = hoverTooltip((view: EditorView, pos: number) => {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  let s = pos - line.from;
  let e = s;
  while (s > 0 && /\w/.test(text[s - 1])) s--;
  while (e < text.length && /\w/.test(text[e])) e++;
  if (s === e) return null;
  const word = text.slice(s, e);
  const obj = /([\w.]+)\.$/.exec(text.slice(0, s))?.[1];
  const d = describe(view.state.doc.toString(), word, obj);
  if (!d) return null;
  return {
    pos: line.from + s,
    end: line.from + e,
    above: true,
    create() {
      const dom = document.createElement('div');
      dom.className = 'cm-pidoc';
      dom.dir = 'ltr';
      const h = document.createElement('code');
      h.textContent = d.sig ?? `${d.module}.${d.name}`;
      const p = document.createElement('div');
      p.textContent = d.doc;
      const m = document.createElement('div');
      m.className = 'muted';
      m.textContent = `module: ${d.module}`;
      dom.append(h, p, m);
      return { dom };
    },
  };
});
