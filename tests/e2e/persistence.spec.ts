// Acceptance tests G (persistence) plus project management, refresh recovery,
// learning modes, monitors and error explanations in the real browser.
import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  return errors;
}

const state = (page: Page) =>
  page.evaluate(() => {
    const d = (window as any).__rpi5sim.useApp.getState().doc;
    return { id: d.id, name: d.name, schema: d.schema, components: d.components, wires: d.wires, files: d.files, nextion: d.nextion, farm: d.farm, sim: d.sim, view: d.view };
  });

test('G1–G4 a 30-component project keeps every part, wire colour, route, bend, setting, code, Nextion layout and farm data after reopening', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    const S = (window as any).__rpi5sim;
    const d = S.newProject('Thirty parts');
    const C: any[] = [{ id: 'pi', type: 'rpi5', x: 40, y: 40, rotation: 0, props: { onewire: true } }];
    const types = ['led', 'resistor', 'button', 'dht22', 'relay_module', 'bh1750', 'potentiometer', 'buzzer', 'ds18b20', 'soil_moisture'];
    for (let i = 0; C.length < 30; i++) C.push({ id: `c${i}`, type: types[i % types.length], x: 420 + (i % 6) * 130, y: 60 + Math.floor(i / 6) * 140, rotation: (i % 4) * 90, props: {} });
    const dht = C.find((c) => c.type === 'dht22');
    dht.props = { temperature: 31.5, humidity: 72 };
    d.components = C;
    d.wires = [
      { id: 'w1', from: { comp: 'pi', pin: 'P7' }, to: { comp: dht.id, pin: 'DATA' }, color: '#8b5a2b', width: 4, route: 'orthogonal', points: [{ x: 400, y: 120 }] },
      { id: 'w2', from: { comp: 'pi', pin: 'P1' }, to: { comp: dht.id, pin: 'VCC' }, color: '#ff00aa', route: 'diag45', points: [{ x: 380, y: 30 }, { x: 410, y: 70 }] },
      { id: 'w3', from: { comp: dht.id, pin: 'GND' }, to: { comp: 'pi', pin: 'P6' }, color: '#2b2b2b', label: 'ground' },
    ];
    d.files = [
      { name: 'main.py', content: 'import config\nprint(config.PIN)\n' },
      { name: 'config.py', content: 'PIN = 4\n' },
    ];
    d.nextion.pages[0].components.push({ id: 1, name: 't0', type: 'text', x: 10, y: 10, w: 100, h: 30, txt: 'hello', pco: 0, bco: 65535, font: 0 });
    d.farm.reservoirL = 87;
    d.sim.speed = 5;
    d.view = { ...d.view, showGrid: false, wireWidth: 4 };
    S.useApp.getState().loadProject(d);
  });
  const before = await state(page);
  await page.evaluate(() => (window as any).__rpi5sim.saveNow());
  // G3: "close" (open another project) and reopen from the Projects list
  await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().loadProject((window as any).__rpi5sim.newProject('Other')));
  await page.reload();
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  await page.getByTestId('tab-projects').click();
  await page.getByTestId('project-search').fill('thirty');
  await expect(page.getByTestId('project-list').locator('tbody tr')).toHaveCount(1);
  await page.getByTestId('project-list').getByRole('button', { name: 'Open' }).click();
  await expect.poll(async () => (await state(page)).name).toBe('Thirty parts');
  const after = await state(page);
  expect(after.components).toEqual(before.components);
  expect(after.wires).toEqual(before.wires);
  expect(after.files).toEqual(before.files);
  expect(after.nextion).toEqual(before.nextion);
  expect(after.farm.reservoirL).toBe(87);
  expect(after.sim.speed).toBe(5);
  expect(after.view).toMatchObject({ showGrid: false, wireWidth: 4 });
  await page.getByTestId('tab-circuit').click();
  await expect(page.getByTestId('wire-w1')).toHaveAttribute('data-route', 'orthogonal');
  await expect(page.getByTestId('wire-w2')).toHaveAttribute('data-color', '#ff00aa');
  expect(errors).toEqual([]);
});

test('G5 an old (schema 1) project file imports and is upgraded without losing wires or code', async ({ page }) => {
  await boot(page);
  const v1 = {
    format: 'rpi5-farm-simulator',
    version: 1,
    project: {
      schema: 1,
      id: 'old1',
      name: 'Old project',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      components: [
        { id: 'pi', type: 'rpi5', x: 40, y: 40, rotation: 0, props: {} },
        { id: 'r1', type: 'resistor', x: 520, y: 380, rotation: 0, props: { ohms: 330 } },
        { id: 'led1', type: 'led', x: 680, y: 360, rotation: 0, props: {} },
      ],
      wires: [
        { id: 'w1', from: { comp: 'pi', pin: 'P11' }, to: { comp: 'r1', pin: '1' }, color: '#e6b800', points: [{ x: 500, y: 200 }] },
        { id: 'w2', from: { comp: 'r1', pin: '2' }, to: { comp: 'led1', pin: 'A' }, color: '#2b7bd6' },
        { id: 'w3', from: { comp: 'led1', pin: 'K' }, to: { comp: 'pi', pin: 'P6' }, color: '#2b2b2b' },
      ],
      files: [{ name: 'main.py', content: 'from gpiozero import LED\nfrom time import sleep\nled = LED(17)\nled.on()\nprint("on")\nsleep(10)\n' }],
      mainFile: 'main.py',
      sim: { speed: 1 },
    },
  };
  await page.getByTestId('tab-projects').click();
  await page.getByTestId('import-input').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v1)) });
  await expect.poll(async () => (await state(page)).name).toBe('Old project');
  const d = await state(page);
  expect(d.schema).toBe(2);
  expect(d.wires.map((w: any) => [w.id, w.color, w.points ?? null])).toEqual([
    ['w1', '#e6b800', [{ x: 500, y: 200 }]],
    ['w2', '#2b7bd6', null],
    ['w3', '#2b2b2b', null],
  ]);
  expect(d.view).toBeTruthy();
  await page.getByTestId('tab-circuit').click();
  await page.getByTestId('run').click();
  await expect(page.getByTestId('terminal')).toContainText('on', { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__rpi5sim.sim.vis.get('led1')?.brightness ?? 0)).toBeGreaterThan(0.2);
  await page.getByTestId('stop').click();
});

test('unsaved changes survive an immediate refresh (recovery)', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const S = (window as any).__rpi5sim;
    S.useApp.getState().loadProject(S.newProject('Recovery test'));
  });
  await page.evaluate(() => (window as any).__rpi5sim.saveNow());
  // edit and reload at once — before the 1.2 s autosave can run
  await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().rename('Recovered name'));
  await page.reload();
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  await expect.poll(async () => (await state(page)).name).toBe('Recovered name');
});

test('project management: Save As switches to a copy, templates create projects, recent list', async ({ page }) => {
  await boot(page);
  await page.getByTestId('tab-projects').click();
  await page.getByTestId('template-select').selectOption({ index: 1 });
  await page.getByTestId('new-from-template').click();
  await expect.poll(async () => (await state(page)).components.length).toBeGreaterThan(2);
  const original = await state(page);
  await page.getByTestId('tab-projects').click();
  page.once('dialog', (d) => d.accept('My copy'));
  await page.getByTestId('save-as').click();
  await expect.poll(async () => (await state(page)).name).toBe('My copy');
  const copy = await state(page);
  expect(copy.id).not.toBe(original.id);
  expect(copy.components).toEqual(original.components);
  await expect(page.getByTestId('recent-projects')).toContainText(original.name);
});

test('learning modes, monitors and error explanations', async ({ page }) => {
  const errors = await boot(page);
  // a DHT22 on GPIO4, an LED on GPIO17, and a 12 V supply wrongly tied to GPIO27
  await page.evaluate(() => {
    const S = (window as any).__rpi5sim;
    const d = S.newProject('Monitors');
    d.components = [
      { id: 'pi', type: 'rpi5', x: 40, y: 40, rotation: 0, props: {} },
      { id: 'dht', type: 'dht22', x: 520, y: 60, rotation: 0, props: { temperature: 27.5, humidity: 61 } },
      { id: 'r1', type: 'resistor', x: 520, y: 380, rotation: 0, props: { ohms: 330 } },
      { id: 'led1', type: 'led', x: 680, y: 360, rotation: 0, props: {} },
      { id: 'ps', type: 'power_supply', x: 700, y: 560, rotation: 0, props: { volts: 12 } },
    ];
    d.wires = [
      { id: 'w1', from: { comp: 'pi', pin: 'P1' }, to: { comp: 'dht', pin: 'VCC' }, color: '#e0393e' },
      { id: 'w2', from: { comp: 'pi', pin: 'P7' }, to: { comp: 'dht', pin: 'DATA' }, color: '#2e9d4f' },
      { id: 'w3', from: { comp: 'dht', pin: 'GND' }, to: { comp: 'pi', pin: 'P6' }, color: '#2b2b2b' },
      { id: 'w4', from: { comp: 'pi', pin: 'P11' }, to: { comp: 'r1', pin: '1' }, color: '#e6b800' },
      { id: 'w5', from: { comp: 'r1', pin: '2' }, to: { comp: 'led1', pin: 'A' }, color: '#2b7bd6' },
      { id: 'w6', from: { comp: 'led1', pin: 'K' }, to: { comp: 'pi', pin: 'P9' }, color: '#2b2b2b' },
      { id: 'w7', from: { comp: 'ps', pin: 'P' }, to: { comp: 'pi', pin: 'P13' }, color: '#ef7d22' },
      { id: 'w8', from: { comp: 'ps', pin: 'N' }, to: { comp: 'pi', pin: 'P14' }, color: '#2b2b2b' },
    ];
    d.files = [{ name: 'main.py', content: 'import time, board, adafruit_dht\nfrom gpiozero import LED\nled = LED(17)\nled.on()\ndht = adafruit_dht.DHT22(board.D4)\nprint("T", dht.temperature)\ntime.sleep(30)\n' }];
    S.useApp.getState().loadProject(d);
    S.useApp.getState().setMode('beginner');
  });
  // beginner mode keeps every problem visible, with the affected connection and how to check it
  await page.getByTestId('dock-problems').click();
  const card = page.locator('.issue[data-code="E_GPIO_EXTERNAL_SUPPLY"]').first();
  await expect(card).toBeVisible();
  await expect(card.getByTestId('issue-connections')).toContainText('w7');
  await expect(card).toContainText('How to check');
  await expect(page.getByTestId('dock-bus')).toHaveCount(0);
  // run, then read the monitors
  await page.getByTestId('run').click();
  await page.getByTestId('dock-terminal').click();
  await expect(page.getByTestId('terminal')).toContainText('T 27.5', { timeout: 60_000 });
  await page.getByTestId('dock-gpio').click();
  await expect(page.getByTestId('gpio-attached-17')).toContainText('Resistor');
  await expect(page.locator('[data-gpio="17"]')).toContainText('HIGH');
  await expect(page.locator('[data-gpio="27"]')).toContainText('⛔');
  await page.getByTestId('dock-sensors').click();
  await expect(page.getByTestId('sensor-monitor')).toContainText('27.5 °C');
  await page.getByTestId('dock-events').click();
  const ev = page.getByTestId('event-monitor');
  await expect(ev.locator('[data-kind="run"]')).toContainText('python3 main.py');
  await expect(ev.locator('[data-kind="import"]').first()).toBeVisible();
  await expect(ev.locator('[data-kind="gpio"]', { hasText: 'GPIO17' })).toContainText('OUTPUT');
  // advanced mode adds protocol inspection and the simulation log
  await page.getByTestId('mode-toggle').click();
  await expect(page.getByTestId('mode-toggle')).toHaveAttribute('data-mode', 'advanced');
  await page.getByTestId('dock-bus').click();
  await expect(page.getByTestId('bus-monitor')).toBeVisible();
  await page.getByTestId('stop').click();
  expect(errors).toEqual([]);
});

test('I2C monitor shows the BH1750 transactions', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().setMode('advanced'));
  await page.getByTestId('lib-search').fill('BH1750');
  await page.getByTestId('lib-bh1750').click();
  await page.getByTestId('insp-tab-python').click();
  await page.getByTestId('load-example').click();
  await page.getByTestId('run').click();
  await page.getByTestId('dock-bus').click();
  await expect(page.getByTestId('bus-monitor').locator('[data-bus="I2C1"]').first()).toContainText('0x23', { timeout: 60_000 });
});
