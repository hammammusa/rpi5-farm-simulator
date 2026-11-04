// ESP32-DevKitC V4 in the browser: real MicroPython runs in its own worker, drives the
// circuit, prints to the terminal, reports errors with file/line and stops on demand.
import { expect, test, type Page } from '@playwright/test';

const LED_CIRCUIT = (extra: any[] = []) => ({
  components: [
    { id: 'esp', type: 'esp32_devkitc', x: 60, y: 60, rotation: 0, props: {} },
    { id: 'r1', type: 'resistor', x: 300, y: 120, rotation: 0, props: { ohms: 330 } },
    { id: 'led1', type: 'led', x: 400, y: 100, rotation: 0, props: {} },
    ...extra,
  ],
  wires: [
    { id: 'w1', from: { comp: 'esp', pin: 'IO23' }, to: { comp: 'r1', pin: '1' }, color: '#2e9d4f' },
    { id: 'w2', from: { comp: 'r1', pin: '2' }, to: { comp: 'led1', pin: 'A' }, color: '#2e9d4f' },
    { id: 'w3', from: { comp: 'led1', pin: 'K' }, to: { comp: 'esp', pin: 'GND2' }, color: '#2b2b2b' },
  ],
});

async function open(page: Page, build: string) {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  await page.evaluate(build);
}

const ledBrightness = (page: Page) => page.evaluate(() => (window as any).__rpi5sim.sim.vis.get('led1')?.brightness ?? 0);

test('ESP32 MicroPython blinks an LED on GPIO23 and stops cleanly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(
    page,
    `(() => {
      const S = window.__rpi5sim;
      const d = S.newProject('ESP32 blink');
      Object.assign(d, ${JSON.stringify(LED_CIRCUIT())});
      S.useApp.getState().loadProject(S.migrate(d));
    })()`,
  );
  // the board got its own program folder with the default MicroPython blink program
  const prog = await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.controllers?.esp);
  expect(prog).toEqual({ language: 'micropython', main: 'esp/main.py' });
  await page.getByTestId('run').click();
  await expect(page.getByTestId('terminal')).toContainText('LED on', { timeout: 60_000 });
  await expect.poll(() => ledBrightness(page), { timeout: 5_000 }).toBeGreaterThan(0.3);
  await expect(page.getByTestId('terminal')).toContainText('LED off', { timeout: 10_000 });
  await expect.poll(() => ledBrightness(page), { timeout: 5_000 }).toBeLessThan(0.05);
  await page.getByTestId('stop').click();
  await expect(page.getByTestId('terminal')).toContainText('Program stopped', { timeout: 10_000 });
  await expect(page.getByTestId('run')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().mcu.esp.state)).toBe('idle');
  expect(errors).toEqual([]);
});

test('ESP32 and Raspberry Pi run side by side; per-controller Run/Stop/Reset', async ({ page }) => {
  await open(
    page,
    `(() => {
      const S = window.__rpi5sim;
      const d = S.newProject('Pi + ESP32');
      const c = ${JSON.stringify(LED_CIRCUIT([{ id: 'pi', type: 'rpi5', x: 600, y: 300, rotation: 0, props: {} }]))};
      Object.assign(d, c);
      d.files = [
        { name: 'main.py', content: 'import time\\nwhile True:\\n    print("pi alive", flush=True)\\n    time.sleep(1)\\n' },
        { name: 'esp/main.py', content: 'import time\\nn = 0\\nwhile True:\\n    n += 1\\n    print("esp tick", n)\\n    time.sleep(0.5)\\n' },
      ];
      S.useApp.getState().loadProject(S.migrate(d));
    })()`,
  );
  await page.getByTestId('run').click();
  await expect(page.getByTestId('terminal')).toContainText('pi alive', { timeout: 60_000 });
  await expect(page.getByTestId('terminal')).toContainText('esp tick 2', { timeout: 30_000 });
  // terminal lines carry their controller
  await expect(page.locator('[data-src="esp"]').first()).toBeVisible();
  // open the ESP32's program and stop only that controller
  await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().setDock('code', true));
  await page.getByTestId('controller-select').first().selectOption('esp');
  await page.getByTestId('ctrl-stop').first().click();
  await expect.poll(() => page.evaluate(() => (window as any).__rpi5sim.useApp.getState().mcu.esp.state), { timeout: 10_000 }).toBe('idle');
  expect(await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().runtimeState)).toBe('running');
  // Reset starts the program from the beginning again
  await page.getByTestId('ctrl-reset').first().click();
  await expect.poll(() => page.evaluate(() => (window as any).__rpi5sim.useApp.getState().mcu.esp.state), { timeout: 30_000 }).toBe('running');
  await page.getByTestId('stop').click();
  await expect.poll(() => page.evaluate(() => (window as any).__rpi5sim.useApp.getState().runtimeState), { timeout: 10_000 }).toBe('ready');
  await expect.poll(() => page.evaluate(() => (window as any).__rpi5sim.useApp.getState().mcu.esp.state), { timeout: 10_000 }).toBe('idle');
});

test('ESP32 errors show the type, file and line; a busy loop still stops', async ({ page }) => {
  await open(
    page,
    `(() => {
      const S = window.__rpi5sim;
      const d = S.newProject('ESP32 errors');
      Object.assign(d, ${JSON.stringify(LED_CIRCUIT())});
      d.files = [{ name: 'main.py', content: '' }, { name: 'esp/main.py', content: 'from machine import Pin\\n\\nflash = Pin(6, Pin.OUT)\\n' }];
      S.useApp.getState().loadProject(S.migrate(d));
    })()`,
  );
  await page.getByTestId('run').click();
  await expect(page.getByTestId('py-error')).toContainText('ValueError', { timeout: 60_000 });
  await expect(page.getByTestId('py-error')).toContainText('esp/main.py');
  const err = await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().pyError);
  expect(err.line).toBe(3);
  // a loop that never calls the simulator: Stop terminates the worker
  await page.evaluate(() => {
    const S = (window as any).__rpi5sim;
    S.useApp.getState().setFile('esp/main.py', 'print("spin")\nwhile True:\n    pass\n');
  });
  await page.getByTestId('run').click();
  await expect(page.getByTestId('terminal')).toContainText('spin', { timeout: 60_000 });
  await page.getByTestId('stop').click();
  await expect(page.getByTestId('terminal')).toContainText('Program stopped', { timeout: 10_000 });
});

test('adding an ESP32 from the library creates its program folder', async ({ page }) => {
  await open(page, `window.__rpi5sim.useApp.getState().loadProject(window.__rpi5sim.newProject('lib'))`);
  const r = await page.evaluate(() => {
    const st = (window as any).__rpi5sim.useApp.getState();
    const id = st.addComponent('esp32_devkitc', 700, 80);
    const doc = (window as any).__rpi5sim.useApp.getState().doc;
    return { id, prog: doc.controllers?.[id], file: doc.files.find((f: any) => f.name === `${id}/main.py`)?.content ?? null };
  });
  expect(r.prog).toEqual({ language: 'micropython', main: `${r.id}/main.py` });
  expect(r.file).toContain('Pin(23, Pin.OUT)');
});
