// Every example in the library, not a sample: the circuit is complete and well-formed,
// its Python runs against the simulated circuit and produces the expected result under
// the test inputs, the default layout is clean, the project survives save/reopen and
// export, and Auto Arrange does not change what the circuit does.
import { describe, expect, it } from 'vitest';
import { LIBRARY } from '../../src/library';
import { buildLibDoc, rawDoc } from '../../src/library/build';
import type { LibExample } from '../../src/library/dsl';
import { arrangeCircuit, layoutQuality, netSignature } from '../../src/engine/layout';
import { migrate } from '../../src/state/persist';
import { buildReport } from '../../src/export/report';
import { getPart, hasPart, pinsOf, withDefaults } from '../../src/engine/parts';
import type { ProjectDoc } from '../../src/engine/types';
import { buildNetlist } from '../../src/engine/netlist';
import { Harness } from './pyharness';

async function runExample(e: LibExample, doc: ProjectDoc) {
  const t = e.test;
  const h = new Harness(doc);
  h.stdinLines = [...(t.stdin ?? [])];
  const events = [...(t.events ?? [])].sort((a, b) => a.at - b.at);
  const errors = new Set<string>();
  let verdict: string | null = t.verify ? 'never checked (expected output not reached)' : null;
  h.onWait = (hh) => {
    const now = hh.now() - hh.t0;
    while (events.length && now >= events[0].at) {
      const ev = events.shift()!;
      if (ev.press !== undefined) hh.sim.pressButton(ev.comp, ev.press);
      if (ev.props) {
        const d = hh.sim.doc;
        hh.sim.setDoc({ ...d, components: d.components.map((c) => (c.id === ev.comp ? { ...c, props: { ...c.props, ...ev.props } } : c)) });
      }
    }
    for (const i of hh.sim.issues) if (i.severity === 'error') errors.add(i.code);
    if (t.verify && t.expect.test(hh.stdout)) verdict = t.verify(hh.sim);
  };
  // a short pause after the program keeps its final outputs applied while the check runs
  const r = await h.run(e.code + '\nimport time as _t\n_t.sleep(0.3)\n', { seconds: t.seconds ?? 6, files: e.files });
  return { r, out: r.stdout + r.stderr, verdict, errors: [...errors].filter((c) => !(t.allowErrors ?? []).includes(c)) };
}

/** deterministic scramble of all positions (what a messy user circuit looks like); parts plugged
 * into a breadboard move with it so they stay in their holes */
function scramble(d: ProjectDoc): ProjectDoc {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const boardOf = new Map(buildNetlist(d).insertions.map((i) => [i.comp, i.board]));
  const moved = new Map<string, { x: number; y: number }>();
  for (const c of d.components) if (!boardOf.has(c.id)) moved.set(c.id, { x: Math.round((rnd() * 1600) / 10) * 10, y: Math.round((rnd() * 1000) / 10) * 10 });
  const at = (c: ProjectDoc['components'][number]) => {
    const b = boardOf.get(c.id);
    if (!b) return moved.get(c.id)!;
    const board = d.components.find((x) => x.id === b)!;
    const m = moved.get(b)!;
    return { x: c.x + m.x - board.x, y: c.y + m.y - board.y };
  };
  return { ...d, components: d.components.map((c) => ({ ...c, ...at(c) })), wires: d.wires.map((w) => ({ ...w, points: undefined, route: undefined })) };
}

/** Wire-to-wire crossings allowed in a default layout. Power and ground wires from the Pi to
 * every part necessarily cross the signal wires, so the allowance grows with the circuit. */
const crossingLimit = (wires: number) => Math.max(6, Math.round(wires * (wires >= 40 ? 6 : wires >= 25 ? 4.5 : 3.5)));

describe('example library', () => {
  it('holds at least 100 runnable examples with unique ids, in every category', () => {
    expect(LIBRARY.length).toBeGreaterThanOrEqual(100);
    expect(new Set(LIBRARY.map((e) => e.id)).size).toBe(LIBRARY.length);
  });
});

describe.each(LIBRARY.filter((e) => e.spec).map((e) => [e.id, e] as const))('%s', (_id, entry) => {
  const e = entry.spec!;
  const doc = buildLibDoc(e);

  it('1–4 every part, pin and wire exists; nothing is left unconnected', () => {
    for (const [, type] of e.parts) expect(hasPart(type), type).toBe(true);
    const ids = new Set(doc.components.map((c) => c.id));
    for (const w of doc.wires)
      for (const end of [w.from, w.to]) {
        expect(ids.has(end.comp), `${w.id} → ${end.comp}`).toBe(true);
        const c = doc.components.find((x) => x.id === end.comp)!;
        const m = getPart(c.type);
        expect(pinsOf(m, withDefaults(m, c.props)).some((p) => p.id === end.pin), `${w.id}: ${c.type}.${end.pin}`).toBe(true);
      }
    // every part with pins is wired to something
    for (const c of doc.components) {
      const m = getPart(c.type);
      if (!pinsOf(m, withDefaults(m, c.props)).length) continue;
      expect(doc.wires.some((w) => w.from.comp === c.id || w.to.comp === c.id), `${c.id} has no wire`).toBe(true);
    }
  });

  it('5–6 the code runs and produces the expected result under the test inputs', async () => {
    const { r, out, verdict, errors } = await runExample(e, doc);
    expect(r.status, out).not.toBe('error');
    expect(out).toMatch(e.test.expect);
    expect(verdict, `${e.id}: ${verdict}`).toBeNull();
    expect(errors, `${e.id}: electrical errors`).toEqual([]);
  }, 90_000);

  it('7–9 default layout: no overlapping parts, no dangling wires, wires keep off other parts', () => {
    const q = layoutQuality(doc);
    expect(q.overlaps).toEqual([]);
    expect(q.dangling).toEqual([]);
    expect(q.overBodies, JSON.stringify(q.overBodies)).toEqual([]);
    expect(q.crossings).toBeLessThanOrEqual(crossingLimit(doc.wires.length));
  });

  it('10–11 save/reopen keeps the circuit; the wiring table matches it', () => {
    const back = migrate(JSON.parse(JSON.stringify(doc)));
    expect(back.components).toEqual(doc.components);
    expect(back.wires).toEqual(doc.wires);
    expect(back.files).toEqual(doc.files);
    const rep = buildReport(doc);
    expect(rep.wiring.filter((x) => !x.wireId.startsWith('bb-')).map((x) => x.wireId).sort()).toEqual(doc.wires.map((w) => w.id).sort());
    expect(rep.wiring.every((x) => x.status !== 'Broken')).toBe(true);
  });

  it('12 Auto Arrange of a scrambled copy keeps every connection and the program result', async () => {
    const arranged = arrangeCircuit(scramble(rawDoc(e)));
    expect(netSignature(arranged)).toEqual(netSignature(doc));
    expect(arranged.files).toEqual(doc.files);
    expect(arranged.components.map((c) => [c.id, c.type, c.props])).toEqual(doc.components.map((c) => [c.id, c.type, c.props]));
    const { out } = await runExample(e, arranged);
    expect(out).toMatch(e.test.expect);
  }, 90_000);
});

// the 20 guided examples: their programs and scenario checks run in examples.test.ts and the
// browser tests; here their default layout, save/reopen, report and Auto Arrange are checked
describe.each(LIBRARY.filter((e) => e.legacy).map((e) => [e.id, e] as const))('%s', (_id, entry) => {
  const doc = entry.build();

  it('7–9 default layout: no overlapping parts, no dangling wires, wires keep off other parts', () => {
    const q = layoutQuality(doc);
    expect(q.overlaps).toEqual([]);
    expect(q.dangling).toEqual([]);
    expect(q.overBodies, JSON.stringify(q.overBodies)).toEqual([]);
    expect(q.crossings).toBeLessThanOrEqual(crossingLimit(doc.wires.length));
  });

  it('10–11 save/reopen keeps the circuit; the wiring table matches it', () => {
    const back = migrate(JSON.parse(JSON.stringify(doc)));
    expect(back.components).toEqual(doc.components);
    expect(back.wires).toEqual(doc.wires);
    const rep = buildReport(doc);
    expect(rep.wiring.filter((x) => !x.wireId.startsWith('bb-')).map((x) => x.wireId).sort()).toEqual(doc.wires.map((w) => w.id).sort());
  });

  it('12 Auto Arrange of a scrambled copy keeps every connection', () => {
    const arranged = arrangeCircuit(scramble(doc));
    expect(netSignature(arranged)).toEqual(netSignature(doc));
    expect(arranged.files).toEqual(doc.files);
  });
});

describe('layout snapshot (default layouts are stored and reviewed)', () => {
  it('matches the reviewed default layouts', () => {
    const sig = Object.fromEntries(
      LIBRARY.filter((e) => e.spec).map((e) => {
        const d = buildLibDoc(e.spec!);
        return [e.id, d.components.map((c) => `${c.id}@${c.x},${c.y},${c.rotation}`).join(' ')];
      }),
    );
    expect(sig).toMatchSnapshot();
  });
});
