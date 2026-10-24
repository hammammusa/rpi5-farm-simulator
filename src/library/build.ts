// Turns a library example into a ready-to-open project: parts and wires from its
// circuit, the default layout (Auto Arrange + standard wire colours, deterministic,
// pinned by the library snapshot test) and the Python files.
import { CircuitBuilder, newProject } from "../engine/project";
import { arrangeCircuit } from "../engine/layout";
import { getPart, hasPart } from "../engine/parts";
import type { ProjectDoc } from "../engine/types";
import type { Scenario } from "../tests/host";
import { currentSim } from "../catalog/examples";
import { getRuntime } from "../state/engine";
import type { LibExample } from "./dsl";

export function rawDoc(e: LibExample): ProjectDoc {
  const b = new CircuitBuilder();
  b.add("pi", "rpi5", 40, 60, e.piProps ?? {}, 0, "Raspberry Pi 5");
  e.parts.forEach(([id, type, props, label], i) => {
    if (!hasPart(type)) throw new Error(`${e.id}: unknown part type ${type}`);
    b.add(
      id,
      type,
      500 + (i % 6) * 160,
      60 + Math.floor(i / 6) * 160,
      props,
      0,
      label ?? getPart(type).short,
    );
  });
  for (const w of e.wires) {
    const [a, c] = w.split(">");
    b.wire(a, c, "#2b7bd6");
  }
  const d = b.doc({ name: e.title[0] });
  d.files = [
    { name: "main.py", content: e.code },
    ...Object.entries(e.files ?? {}).map(([name, content]) => ({
      name,
      content,
    })),
  ];
  d.mainFile = "main.py";
  d.exampleId = `lib:${e.id}`;
  d.description = e.goal[0];
  d.farm = newProject().farm;
  return d;
}

const cache = new Map<string, ProjectDoc>();

/** The example as it opens: default layout applied. */
export function buildLibDoc(e: LibExample): ProjectDoc {
  let d = cache.get(e.id);
  if (!d) {
    d = arrangeCircuit(rawDoc(e), { recolor: true });
    cache.set(e.id, d);
  }
  return structuredClone(d);
}

/** In-app automatic test: loads the example, runs its code in the real worker and checks it. */
export function libScenario(e: LibExample): Scenario {
  const t = e.test;
  return {
    id: `lib-${e.id}`,
    name: e.title[0],
    expected: `Output matches ${t.expect}${t.verify ? " and the circuit check passes" : ""}`,
    async run(h) {
      await h.load(buildLibDoc(e));
      // the outputs the program leaves are judged for 0.3 s before gpiozero closes them
      currentSim().holdOnExit = 0.3;
      try {
        return await judge(h);
      } finally {
        currentSim().holdOnExit = 0;
      }
    },
  };

  async function judge(h: Parameters<Scenario["run"]>[0]) {
    await h.run();
    const events = [...(t.events ?? [])].sort((a, b) => a.at - b.at);
    let verdict: string | null = t.verify ? "not checked" : null;
    let elapsed = 0;
    await h.waitSim(t.seconds ?? 6, (now) => {
      elapsed = now;
      while (events.length && now >= events[0].at) {
        const ev = events.shift()!;
        if (ev.press !== undefined) currentSim().pressButton(ev.comp, ev.press);
        if (ev.props)
          for (const [k, v] of Object.entries(ev.props))
            h.setProp(ev.comp, k, v);
      }
      // judged while the program runs: at exit gpiozero closes its devices (outputs go low)
      if (
        t.verify &&
        getRuntime()?.state === "running" &&
        t.expect.test(h.term())
      )
        verdict = t.verify(currentSim());
    });
    const out = h.term();
    const ok = t.expect.test(out) && verdict === null && !h.pyError();
    return {
      pass: ok,
      actual: `${out.trim().split("\n").slice(-3).join(" | ")}${verdict ? ` — ${verdict}` : ""} (${elapsed.toFixed(1)} s)`,
    };
  }
}
