// Behavioural DC circuit solver.
//
// This is a simplified nodal-analysis solver (not SPICE):
//  * resistors, Norton voltage sources (ideal source + internal resistance),
//    current sources, piecewise-linear diodes/LEDs and controlled switches;
//  * it computes steady-state DC node voltages and branch currents only;
//  * no capacitance/inductance/transients — capacitors are open circuits;
//  * non-linear parts are iterated to a fixed point (diode on/off states,
//    transistor/relay switches driven by previous-iteration voltages).
// Node -1 is the reference (Raspberry Pi GND when present).

export const GND = -1;
const GMIN = 1e-9;
const R_OFF = 1e9;

export type ElemKind = 'R' | 'V' | 'D' | 'SW' | 'I';

export interface ElemBase {
  id: string;
  owner: string;
  tag: string;
  k: ElemKind;
  a: number;
  b: number;
}
export interface RElem extends ElemBase { k: 'R'; r: number }
/** Voltage source v between a(+) and b(-), with internal resistance rint. */
export interface VElem extends ElemBase { k: 'V'; v: number; rint: number; imax?: number; enabled: boolean }
/** Diode from anode a to cathode b. */
export interface DElem extends ElemBase { k: 'D'; vf: number; rd: number; on: boolean }
export interface SWElem extends ElemBase {
  k: 'SW';
  ron: number;
  on: boolean;
  ctl?: (s: Solution) => boolean;
}
/** Current source pushing i amperes into node a, out of node b. */
export interface IElem extends ElemBase { k: 'I'; i: number }
export type Elem = RElem | VElem | DElem | SWElem | IElem;

export interface Solution {
  v: Float64Array;
  /** current through element a -> b (for V: current leaving + terminal) */
  i: Map<string, number>;
  driven: Uint8Array;
  converged: boolean;
  volt(node: number): number;
  cur(id: string): number;
}

export class Circuit {
  elems: Elem[] = [];
  private byId = new Map<string, Elem>();
  constructor(public n: number) {}

  private push<T extends Elem>(e: T): T {
    this.elems.push(e);
    this.byId.set(e.id, e);
    return e;
  }
  get(id: string) {
    return this.byId.get(id);
  }
  addR(owner: string, tag: string, a: number, b: number, r: number) {
    return this.push<RElem>({ id: `${owner}:${tag}`, owner, tag, k: 'R', a, b, r: Math.max(r, 1e-4) });
  }
  addV(owner: string, tag: string, a: number, b: number, v: number, rint: number, imax?: number) {
    return this.push<VElem>({ id: `${owner}:${tag}`, owner, tag, k: 'V', a, b, v, rint: Math.max(rint, 1e-4), imax, enabled: true });
  }
  addD(owner: string, tag: string, a: number, b: number, vf: number, rd: number) {
    return this.push<DElem>({ id: `${owner}:${tag}`, owner, tag, k: 'D', a, b, vf, rd, on: false });
  }
  addSW(owner: string, tag: string, a: number, b: number, ron: number, ctl: ((s: Solution) => boolean) | boolean) {
    const fixed = typeof ctl === 'boolean';
    return this.push<SWElem>({
      id: `${owner}:${tag}`,
      owner,
      tag,
      k: 'SW',
      a,
      b,
      ron: Math.max(ron, 1e-4),
      on: fixed ? (ctl as boolean) : false,
      ctl: fixed ? undefined : (ctl as (s: Solution) => boolean),
    });
  }
  addI(owner: string, tag: string, a: number, b: number, i: number) {
    return this.push<IElem>({ id: `${owner}:${tag}`, owner, tag, k: 'I', a, b, i });
  }
}

function gaussSolve(A: Float64Array, bvec: Float64Array, n: number): Float64Array {
  // In-place Gaussian elimination with partial pivoting on an n x n row-major matrix.
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(A[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r * n + col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best < 1e-30) continue;
    if (piv !== col) {
      for (let c = 0; c < n; c++) {
        const t = A[col * n + c];
        A[col * n + c] = A[piv * n + c];
        A[piv * n + c] = t;
      }
      const t = bvec[col];
      bvec[col] = bvec[piv];
      bvec[piv] = t;
    }
    const d = A[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r * n + col] / d;
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r * n + c] -= f * A[col * n + c];
      bvec[r] -= f * bvec[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = bvec[r];
    for (let c = r + 1; c < n; c++) s -= A[r * n + c] * x[c];
    const d = A[r * n + r];
    x[r] = Math.abs(d) < 1e-30 ? 0 : s / d;
  }
  return x;
}

function conductance(e: Elem): number {
  switch (e.k) {
    case 'R':
      return 1 / e.r;
    case 'V':
      return e.enabled ? 1 / e.rint : 0;
    case 'D':
      return e.on ? 1 / e.rd : 1 / R_OFF;
    case 'SW':
      return e.on ? 1 / e.ron : 1 / R_OFF;
    default:
      return 0;
  }
}

function linearSolve(c: Circuit): Float64Array {
  const n = c.n;
  if (n === 0) return new Float64Array(0);
  const A = new Float64Array(n * n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) A[i * n + i] += GMIN;
  const stampG = (a: number, bb: number, g: number) => {
    if (a >= 0) A[a * n + a] += g;
    if (bb >= 0) A[bb * n + bb] += g;
    if (a >= 0 && bb >= 0) {
      A[a * n + bb] -= g;
      A[bb * n + a] -= g;
    }
  };
  const inject = (node: number, i: number) => {
    if (node >= 0) b[node] += i;
  };
  for (const e of c.elems) {
    const g = conductance(e);
    if (g > 0) stampG(e.a, e.b, g);
    if (e.k === 'V' && e.enabled) {
      const i = e.v / e.rint;
      inject(e.a, i);
      inject(e.b, -i);
    } else if (e.k === 'D' && e.on) {
      // Diode on: Vf in series with rd -> Norton: current source vf/rd from cathode to anode side
      const i = e.vf / e.rd;
      inject(e.a, -i);
      inject(e.b, i);
    } else if (e.k === 'I') {
      inject(e.a, e.i);
      inject(e.b, -e.i);
    }
  }
  return gaussSolve(A, b, n);
}

function elemCurrent(e: Elem, v: (n: number) => number): number {
  const va = v(e.a);
  const vb = v(e.b);
  switch (e.k) {
    case 'R':
      return (va - vb) / e.r;
    case 'V':
      return e.enabled ? (e.v - (va - vb)) / e.rint : 0;
    case 'D':
      return e.on ? (va - vb - e.vf) / e.rd : (va - vb) / R_OFF;
    case 'SW':
      return e.on ? (va - vb) / e.ron : (va - vb) / R_OFF;
    case 'I':
      return e.i;
  }
}

function makeSolution(c: Circuit, x: Float64Array, converged: boolean): Solution {
  const volt = (node: number) => (node < 0 ? 0 : x[node] ?? 0);
  const i = new Map<string, number>();
  for (const e of c.elems) i.set(e.id, elemCurrent(e, volt));
  return {
    v: x,
    i,
    driven: computeDriven(c),
    converged,
    volt,
    cur: (id: string) => i.get(id) ?? 0,
  };
}

/** A node is "driven" if a conductive path connects it to the reference node. */
function computeDriven(c: Circuit): Uint8Array {
  const n = c.n;
  const parent = new Int32Array(n + 1);
  for (let i = 0; i <= n; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const idx = (node: number) => (node < 0 ? n : node);
  for (const e of c.elems) {
    const conducts =
      e.k === 'R' || (e.k === 'V' && e.enabled) || (e.k === 'SW' && e.on) || (e.k === 'D' && e.on);
    if (conducts) parent[find(idx(e.a))] = find(idx(e.b));
  }
  const root = find(n);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = find(i) === root ? 1 : 0;
  return out;
}

export function solve(c: Circuit, maxIter = 60): Solution {
  let x = linearSolve(c);
  let sol = makeSolution(c, x, true);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (const e of c.elems) {
      if (e.k === 'D') {
        const vd = sol.volt(e.a) - sol.volt(e.b);
        if (!e.on && vd > e.vf + 1e-6) {
          e.on = true;
          changed = true;
        } else if (e.on && (vd - e.vf) / e.rd < -1e-9) {
          e.on = false;
          changed = true;
        }
      } else if (e.k === 'SW' && e.ctl) {
        const want = e.ctl(sol);
        if (want !== e.on) {
          e.on = want;
          changed = true;
        }
      }
    }
    if (!changed) return sol;
    x = linearSolve(c);
    sol = makeSolution(c, x, true);
  }
  return makeSolution(c, x, false);
}
