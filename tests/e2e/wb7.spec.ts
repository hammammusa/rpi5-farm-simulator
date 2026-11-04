// Wiren Board 7.4 in the browser: wb-rules in QuickJS, the MQTT monitor, and the complete
// ESP32 (MicroPython worker) → MQTT → WB7 → Modbus relay → pump → Smart Farm loop.
import { expect, test, type Page } from '@playwright/test';
import { integrationCircuit } from '../../src/examples/mcu/irrigationLoop';

async function open(page: Page, doc: any) {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  await page.evaluate((d) => {
    const S = (window as any).__rpi5sim;
    S.useApp.getState().loadProject(S.migrate({ ...S.newProject('WB test'), ...d }));
  }, doc);
}
const term = (page: Page) => page.evaluate(() => (window as any).__rpi5sim.useApp.getState().term.map((l: any) => l.text).join(''));

test('WB7: default wb-rules program — dry contact on A2 switches the pump on A1; MQTT monitor toggles A1', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, {
    components: [
      { id: 'wb', type: 'wb74', x: 300, y: 80, rotation: 0, props: {} },
      { id: 'ps', type: 'power_supply', x: 60, y: 80, rotation: 0, props: { volts: 12, amps: 5 } },
      { id: 'btn', type: 'button', x: 300, y: 320, rotation: 0, props: {} },
      { id: 'pump', type: 'water_pump', x: 600, y: 80, rotation: 0, props: {} },
    ],
    wires: [
      { id: 'w1', from: { comp: 'ps', pin: 'P' }, to: { comp: 'wb', pin: 'VIN1' }, color: '#e0393e' },
      { id: 'w2', from: { comp: 'ps', pin: 'N' }, to: { comp: 'wb', pin: 'GND1' }, color: '#2b2b2b' },
      { id: 'w3', from: { comp: 'btn', pin: '1a' }, to: { comp: 'wb', pin: 'A2' }, color: '#2e9d4f' },
      { id: 'w4', from: { comp: 'btn', pin: '2a' }, to: { comp: 'wb', pin: 'GND2' }, color: '#2b2b2b' },
      { id: 'w5', from: { comp: 'pump', pin: 'P' }, to: { comp: 'ps', pin: 'P' }, color: '#e0393e' },
      { id: 'w6', from: { comp: 'pump', pin: 'N' }, to: { comp: 'wb', pin: 'A1' }, color: '#2b7bd6' },
    ],
  });
  const prog = await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.controllers?.wb);
  expect(prog).toEqual({ language: 'wbrules', main: 'wb/main.js' });
  await page.getByTestId('run').click();
  await expect.poll(() => term(page), { timeout: 30_000 }).toContain('wb-rules: loaded 1 script(s), 1 rule(s)');
  await page.evaluate(() => (window as any).__rpi5sim.sim.pressButton('btn', true));
  await expect.poll(() => page.evaluate(() => (window as any).__rpi5sim.sim.vis.get('pump')?.run ?? 0), { timeout: 5_000 }).toBeGreaterThan(0.8);
  await expect.poll(() => term(page), { timeout: 5_000 }).toContain('wb-gpio/A2_IN = false -> A1_OUT true');
  await page.evaluate(() => (window as any).__rpi5sim.sim.pressButton('btn', false));
  await expect.poll(() => page.evaluate(() => (window as any).__rpi5sim.sim.vis.get('pump')?.run ?? 0), { timeout: 5_000 }).toBeLessThan(0.1);
  // MQTT monitor: the live A1_OUT switch is clickable
  await page.getByTestId('dock-mqtt').click();
  const a1 = page.locator('[data-topic="/devices/wb-gpio/controls/A1_OUT"] button');
  await expect(a1).toHaveText('OFF');
  await a1.click();
  await expect(a1).toHaveText('ON');
  await expect.poll(() => page.evaluate(() => (window as any).__rpi5sim.sim.vis.get('pump')?.run ?? 0), { timeout: 5_000 }).toBeGreaterThan(0.8);
  await expect(page.locator('[data-topic="/devices/demo/controls/presses"]')).toContainText('1');
  await page.getByTestId('stop').click();
  await expect.poll(() => term(page), { timeout: 5_000 }).toContain('Program stopped');
  expect(errors).toEqual([]);
});

test('WB7: a syntax error in rules.js is reported with file and line', async ({ page }) => {
  await open(page, {
    components: [
      { id: 'wb', type: 'wb74', x: 300, y: 80, rotation: 0, props: {} },
      { id: 'ps', type: 'power_supply', x: 60, y: 80, rotation: 0, props: { volts: 24 } },
    ],
    wires: [
      { id: 'w1', from: { comp: 'ps', pin: 'P' }, to: { comp: 'wb', pin: 'VIN1' }, color: '#e0393e' },
      { id: 'w2', from: { comp: 'ps', pin: 'N' }, to: { comp: 'wb', pin: 'GND1' }, color: '#2b2b2b' },
    ],
    files: [{ name: 'main.py', content: '' }, { name: 'wb/main.js', content: 'defineRule("x", {\n  whenChanged: "wb-gpio/A1_IN",\n  then: function () {\n    log("x"\n  }\n});\n' }],
    controllers: { wb: { language: 'wbrules', main: 'wb/main.js' } },
  });
  await page.getByTestId('run').click();
  await expect.poll(() => page.evaluate(() => (window as any).__rpi5sim.useApp.getState().pyError?.type), { timeout: 30_000 }).toBe('SyntaxError');
  const err = await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().pyError);
  expect(err.file).toBe('wb/main.js');
  expect(err.line).toBeGreaterThanOrEqual(4);
});

test('ESP32 MicroPython → MQTT → WB7 rule → Modbus relay → pump → Smart Farm (browser, real workers)', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, integrationCircuit());
  await page.evaluate(() => (window as any).__rpi5sim.setSpeed?.(1));
  const m0 = await page.evaluate(() => (window as any).__rpi5sim.sim.farm.read('tray.moisture'));
  await page.getByTestId('run').click();
  await expect.poll(() => term(page), { timeout: 60_000 }).toMatch(/Wi-Fi 192\.168\.42\.\d+/);
  await expect.poll(() => term(page), { timeout: 30_000 }).toMatch(/pump ON/);
  await expect.poll(() => page.evaluate(() => (window as any).__rpi5sim.sim.vis.get('pump')?.run ?? 0), { timeout: 10_000 }).toBeGreaterThan(0.8);
  await expect.poll(() => page.evaluate(() => (window as any).__rpi5sim.sim.farm.read('tray.moisture')), { timeout: 60_000 }).toBeGreaterThan(m0 + 10);
  await expect.poll(() => term(page), { timeout: 60_000 }).toMatch(/pump OFF/);
  await page.getByTestId('stop').click();
  await expect.poll(() => page.evaluate(() => Object.values((window as any).__rpi5sim.useApp.getState().mcu).every((m: any) => m.state === 'idle')), { timeout: 10_000 }).toBe(true);
});
