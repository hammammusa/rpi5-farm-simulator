// Part 12 performance measurements in the real browser. Every number here is measured,
// written to perf-results/perf-*.json and printed; the assertions only guard against
// regressions far outside the measured range (no frame-rate claims without data).
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  return errors;
}

/** Pi + LED chains (resistor → LED → GND) + buttons + a DHT22; ground daisy chain pads the wire count. */
async function loadBig(page: Page, parts: number, wires: number) {
  return page.evaluate(
    ({ parts, wires }) => {
      const S = (window as any).__rpi5sim;
      const d = S.newProject(`Perf ${parts} parts`);
      const gpioPhys = [11, 13, 15, 16, 18, 22, 29, 31, 32, 33, 35, 36, 37, 38, 40, 12];
      const gnd = [6, 9, 14, 20, 25, 30, 34, 39];
      const C: any[] = [{ id: 'pi', type: 'rpi5', x: 40, y: 40, rotation: 0, props: {} }, { id: 'dht', type: 'dht22', x: 420, y: 40, rotation: 0, props: {} }];
      const W: any[] = [];
      const w = (a: string, b: string, color = '#2b7bd6') => W.push({ id: `w${W.length + 1}`, from: { comp: a.split('.')[0], pin: a.split('.')[1] }, to: { comp: b.split('.')[0], pin: b.split('.')[1] }, color });
      w('pi.P1', 'dht.VCC', '#e0393e');
      w('pi.P7', 'dht.DATA', '#2e9d4f');
      w('dht.GND', 'pi.P6', '#2b2b2b');
      let i = 0;
      const leds: string[] = [];
      while (C.length < parts) {
        const col = i % 12;
        const row = Math.floor(i / 12);
        const x = 520 + col * 110;
        const y = 300 + row * 150;
        const g = gpioPhys[i % gpioPhys.length];
        if (i % 3 === 2) {
          C.push({ id: `b${i}`, type: 'button', x, y, rotation: 0, props: {} });
          w(`pi.P${g}`, `b${i}.1a`, '#ef7d22');
          w(`b${i}.2a`, `pi.P${gnd[i % gnd.length]}`, '#2b2b2b');
        } else {
          C.push({ id: `r${i}`, type: 'resistor', x, y, rotation: 0, props: { ohms: 330 } });
          if (C.length < parts) {
            C.push({ id: `l${i}`, type: 'led', x: x + 10, y: y + 60, rotation: 0, props: {} });
            leds.push(`l${i}`);
            w(`pi.P${g}`, `r${i}.1`, '#e6b800');
            w(`r${i}.2`, `l${i}.A`, '#2b7bd6');
            w(`l${i}.K`, `pi.P${gnd[i % gnd.length]}`, '#2b2b2b');
          }
        }
        i++;
      }
      for (let k = 0; W.length < wires; k++) w(`${leds[k % leds.length]}.K`, `${leds[(k + 1) % leds.length]}.K`, '#8a8a8a');
      d.components = C;
      d.wires = W;
      d.files = [
        {
          name: 'main.py',
          content: [
            'import time, board, adafruit_dht',
            'from gpiozero import LED, Button',
            'leds = [LED(p) for p in (17, 27, 22, 23, 24, 25)]',
            'dht = adafruit_dht.DHT22(board.D4)',
            'n = 0',
            'last = 0',
            'while True:',
            '    for l in leds:',
            '        l.toggle()',
            '    n += 1',
            '    if time.monotonic() - last >= 2:',
            '        last = time.monotonic()',
            '        try:',
            '            print(f"loop {n} temp {dht.temperature:.1f}", flush=True)',
            '        except RuntimeError as e:',
            '            print("dht retry", e)',
            '    time.sleep(0.02)',
          ].join('\n'),
        },
      ];
      const t0 = performance.now();
      S.useApp.getState().loadProject(d);
      return new Promise<{ comps: number; wires: number; loadMs: number }>((res) =>
        requestAnimationFrame(() => requestAnimationFrame(() => res({ comps: C.length, wires: W.length, loadMs: performance.now() - t0 }))),
      );
    },
    { parts, wires },
  );
}

/** frame intervals and long tasks while `during` runs */
async function measureFrames(page: Page, during: () => Promise<void>) {
  await page.evaluate(() => {
    const w = window as any;
    w.__frames = [];
    w.__long = [];
    let last = performance.now();
    w.__raf = true;
    const loop = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (w.__raf) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    try {
      w.__po = new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration)));
      w.__po.observe({ type: 'longtask', buffered: false });
    } catch {
      /* long-task API not available */
    }
  });
  await during();
  return page.evaluate(() => {
    const w = window as any;
    w.__raf = false;
    w.__po?.disconnect();
    const f = (w.__frames as number[]).slice(1).sort((a, b) => a - b);
    const q = (p: number) => f[Math.min(f.length - 1, Math.floor(p * f.length))];
    return { frames: f.length, p50: q(0.5), p95: q(0.95), max: f[f.length - 1], longTasks: w.__long.length, longestTask: Math.max(0, ...w.__long) };
  });
}

const round = (o: any): any => JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)));

function report(name: string, data: unknown) {
  mkdirSync('perf-results', { recursive: true });
  writeFileSync(`perf-results/perf-${name}.json`, JSON.stringify(round(data), null, 2));
  console.log(`PERF ${name}`, JSON.stringify(round(data)));
}

for (const [parts, wires] of [
  [50, 100],
  [100, 200],
] as const) {
  test(`${parts} components / ${wires} wires: load, solve, drag a connected part, edit wires, save and reopen`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = await boot(page);
    const load = await loadBig(page, parts, wires);
    expect(load.comps).toBe(parts);
    expect(load.wires).toBe(wires);
    await expect(page.locator('[data-testid^="wire-w"]')).toHaveCount(wires);
    // DC solve of the whole circuit (netlist + nodal solver + every part's post())
    const solve = await page.evaluate(() => {
      const sim = (window as any).__rpi5sim.sim;
      const ts: number[] = [];
      for (let k = 0; k < 30; k++) {
        const t0 = performance.now();
        sim.evaluate();
        ts.push(performance.now() - t0);
      }
      ts.sort((a, b) => a - b);
      return { median: ts[15], max: ts[29] };
    });
    // move a connected push-button 40 times, one step per animation frame (its wires follow);
    // mouse dragging itself is covered by workspace.spec.ts — here we measure the re-render cost
    const before = await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.components.find((c: any) => c.id === 'b2').x);
    const drag = await measureFrames(page, async () => {
      await page.evaluate(async () => {
        const st = (window as any).__rpi5sim.useApp.getState();
        for (let k = 0; k < 40; k++) {
          st.moveComponents(['b2'], 4, 2);
          await new Promise((r) => requestAnimationFrame(r));
        }
      });
    });
    const moved = await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.components.find((c: any) => c.id === 'b2'));
    expect(moved.x).toBeGreaterThan(before + 100);
    // save and reopen through IndexedDB
    const persist = await page.evaluate(async () => {
      const S = (window as any).__rpi5sim;
      const st = S.useApp.getState();
      st.updateWire('w5', { color: '#8b5a2b', points: [{ x: 700, y: 200 }] });
      const t0 = performance.now();
      await S.saveNow();
      const saveMs = performance.now() - t0;
      return { saveMs, id: st.doc.id };
    });
    const t0 = Date.now();
    await page.reload();
    await page.waitForFunction((n) => (window as any).__rpi5sim?.useApp.getState().doc.components.length === n, parts, { timeout: 60_000 });
    const reopenMs = Date.now() - t0;
    const back = await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.wires.find((w: any) => w.id === 'w5'));
    expect(back).toMatchObject({ color: '#8b5a2b', points: [{ x: 700, y: 200 }] });
    report(`${parts}`, { components: parts, wires, loadAndFirstRenderMs: load.loadMs, solveMs: solve, dragFrames: drag, saveMs: persist.saveMs, reloadAndReopenMs: reopenMs });
    // guards far above the measured values on this machine
    expect(solve.median).toBeLessThan(200);
    expect(drag.p50).toBeLessThan(200);
    expect(errors).toEqual([]);
  });
}

test('continuous Python with frequent sensor changes, actuators toggling and wire edits while running', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  await loadBig(page, 100, 200);
  await page.getByTestId('run').click();
  await expect(page.getByTestId('terminal')).toContainText('loop', { timeout: 60_000 });
  const temps = [18, 22, 26, 30, 34];
  const frames = await measureFrames(page, async () => {
    for (let k = 0; k < 50; k++) {
      // change the DHT22 temperature every 100 ms and recolour a wire every 10th step
      await page.evaluate(
        ({ v, k }) => {
          const st = (window as any).__rpi5sim.useApp.getState();
          st.setProp('dht', 'temperature', v, false);
          if (k % 10 === 0) st.updateWire('w4', { color: k % 20 ? '#e6b800' : '#2e9d4f' });
        },
        { v: temps[Math.floor(k / 10)], k },
      );
      await page.waitForTimeout(100);
    }
  });
  await expect(page.getByTestId('terminal')).toContainText('temp 34.0', { timeout: 20_000 });
  const out = await page.getByTestId('terminal').innerText();
  const loops = [...out.matchAll(/loop (\d+)/g)].map((m) => Number(m[1]));
  const sim = await page.evaluate(() => {
    const s = (window as any).__rpi5sim.sim;
    return { lit: [...s.vis.values()].filter((v: any) => v?.lit || v?.brightness > 0.1).length, events: s.pyEvents.length };
  });
  await page.getByTestId('stop').click();
  report('python', { components: 100, wires: 200, frames, pythonLoopsSeen: loops.length ? loops[loops.length - 1] : 0, lastPrintedTemp: /temp ([\d.]+)/g.exec(out.split('\n').reverse().join('\n'))?.[1], simEvents: sim.events });
  expect(loops.length).toBeGreaterThan(1);
  expect(loops[loops.length - 1]).toBeGreaterThan(loops[0]);
  expect(frames.p50).toBeLessThan(200);
  expect(errors).toEqual([]);
});
