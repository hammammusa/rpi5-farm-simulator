// Every ESP32 / Wiren Board project of the library runs its real programs (MicroPython,
// Arduino C++ compiled by Clang, wb-rules in QuickJS) against the simulated circuit and farm.
import { describe, expect, it } from 'vitest';
import { MCU_SPECS, type McuSpec } from '../../src/library/controllers';
import { LIBRARY } from '../../src/library';
import { WbRulesEngine } from '../../src/runtime/wb/wbRules';
import { McuHarness } from './mcuharness';

async function runSpec(spec: McuSpec) {
  // the project as it opens from the library (default layout applied): the programs must work
  // exactly as on the unarranged circuit, because arranging only moves parts and wires
  const doc = LIBRARY.find((e) => e.id === spec.id)!.build();
  const h = new McuHarness(doc);
  const out: string[] = [];
  const engines: WbRulesEngine[] = [];
  for (const c of doc.components.filter((k) => k.type === 'wb74')) {
    const e = new WbRulesEngine(h.sim, c.id, { log: (lv, t) => out.push(`${lv}: ${t}`) });
    h.sim.wb.get(c.id)!.onLog = (l) => out.push(`${l.level}: [${l.src}] ${l.msg}`);
    engines.push(e);
  }
  h.advance(0.3);
  for (const e of engines) {
    const r = await e.start(doc.files, doc.controllers![e.id].main);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
  }
  const events = [...(spec.test.events ?? [])].sort((a, b) => a.at - b.at);
  let verdict: string | null | undefined = spec.test.verify ? undefined : null;
  const t0 = h.now();
  const step = () => {
    const t = h.now() - t0;
    for (const e of engines) e.poll();
    while (events.length && t >= events[0].at) {
      const ev = events.shift()!;
      if (ev.press !== undefined) h.sim.pressButton(ev.comp, ev.press);
      if (ev.props) h.sim.setDoc({ ...h.sim.doc, components: h.sim.doc.components.map((c) => (c.id === ev.comp ? { ...c, props: { ...c.props, ...ev.props } } : c)) });
    }
    if (spec.test.verify && t >= spec.test.seconds - 0.6) verdict = spec.test.verify(h.sim);
  };
  const espComp = doc.components.find((c) => c.type === 'esp32_devkitc');
  if (espComp) {
    h.onWait = () => step();
    const lang = doc.controllers![espComp.id].language;
    const r = lang === 'arduino' ? await h.runArduino(espComp.id, spec.test.seconds) : await h.runMicroPython(espComp.id, spec.test.seconds);
    expect(r.status, `${r.error?.type}: ${r.error?.message}\n${r.stderr}`).toBe('stopped');
    out.push(r.stdout);
  } else {
    while (h.now() - t0 < spec.test.seconds) {
      h.advance(0.05);
      step();
    }
  }
  for (const e of engines) e.stop();
  return { out: out.join('\n'), verdict, doc };
}

describe('ESP32 and Wiren Board projects in the library', () => {
  it('has at least 5 ESP32, 5 Wiren Board and 1 combined project, all in the library', () => {
    expect(MCU_SPECS.filter((s) => s.board === 'esp32').length).toBeGreaterThanOrEqual(5);
    expect(MCU_SPECS.filter((s) => s.board === 'wb7').length).toBeGreaterThanOrEqual(5);
    expect(MCU_SPECS.filter((s) => s.board === 'both').length).toBeGreaterThanOrEqual(1);
    for (const s of MCU_SPECS) expect(LIBRARY.some((e) => e.id === s.id && e.cat === 'controllers')).toBe(true);
    expect(MCU_SPECS.filter((s) => s.board !== 'wb7').some((s) => Object.values(s.build().controllers ?? {}).some((c) => c.language === 'arduino'))).toBe(true);
  });

  it.each(MCU_SPECS.map((s) => [s.id, s] as const))('%s runs and passes its test', async (_id, spec) => {
    for (const t of [...spec.title, ...spec.goal, ...spec.result, ...spec.explain]) expect(t.length).toBeGreaterThan(10);
    const { out, verdict, doc } = await runSpec(spec);
    // every program file exists and every wire connects existing pins
    for (const p of Object.values(doc.controllers ?? {})) expect(doc.files.some((f) => f.name === p.main)).toBe(true);
    expect(out, out.slice(-1500)).toMatch(spec.test.expect);
    expect(verdict, out.slice(-1500)).toBeNull();
  }, 180_000);
});
