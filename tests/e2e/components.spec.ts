// Acceptance tests B (component library) and A (built-in libraries) in the real browser + Python worker.
import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  await page.evaluate(() => {
    const S = (window as any).__rpi5sim;
    S.useApp.getState().loadProject(S.newProject('Components test'));
  });
  return errors;
}

const comps = (page: Page) => page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.components.map((c: any) => c.type));

test('B1–B4 add parts from several groups, see the pin-out, change and persist properties', async ({ page }) => {
  const errors = await boot(page);
  // B1: one part from each of several library groups (search + click)
  for (const [q, type] of [
    ['DHT22', 'dht22'],
    ['ADS1115', 'ads1115'],
    ['L298N', 'l298n'],
    ['TM1637', 'tm1637'],
    ['reservoir', 'reservoir_tank'],
    ['soil 485', 'rs485_soil'],
  ]) {
    await page.getByTestId('lib-search').fill(q);
    await page.getByTestId(`lib-${type}`).click();
  }
  await page.getByTestId('lib-search').fill('');
  expect(await comps(page)).toEqual(expect.arrayContaining(['dht22', 'ads1115', 'l298n', 'tm1637', 'reservoir_tank', 'rs485_soil']));
  // the fidelity filter narrows the list honestly
  await page.getByTestId('lib-fidelity').selectOption('visual');
  await expect(page.getByTestId('lib-pipe_straight')).toBeVisible();
  await expect(page.getByTestId('lib-dht22')).toHaveCount(0);
  await page.getByTestId('lib-fidelity').selectOption('');
  // B2: pin-out of the DHT22
  const id = await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.components.find((c: any) => c.type === 'dht22').id);
  await page.evaluate((i) => (window as any).__rpi5sim.useApp.getState().select([i]), id);
  await expect(page.getByTestId('inspector')).toContainText('DHT22');
  await expect(page.getByTestId('inspector')).toContainText('Fully Simulated');
  await page.getByTestId('insp-tab-pins').click();
  const pinout = page.getByTestId('insp-pinout');
  for (const p of ['+', 'out', '−']) await expect(pinout).toContainText(p);
  // B3: change a property through the inspector
  await page.getByTestId('insp-tab-info').click();
  await page.getByLabel('Temperature value').fill('33.5');
  expect(await page.evaluate((i) => (window as any).__rpi5sim.useApp.getState().doc.components.find((c: any) => c.id === i).props.temperature, id)).toBe(33.5);
  // B4: persisted after save + reload
  await page.evaluate(() => (window as any).__rpi5sim.saveNow());
  await page.reload();
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().doc.name === 'Components test', null, { timeout: 60_000 });
  expect(await page.evaluate((i) => (window as any).__rpi5sim.useApp.getState().doc.components.find((c: any) => c.id === i)?.props.temperature, id)).toBe(33.5);
  expect(errors).toEqual([]);
});

test('B5 "Test simulation" runs the DHT22 example in the real Python worker and passes', async ({ page }) => {
  await boot(page);
  await page.getByTestId('lib-search').fill('DHT22');
  await page.getByTestId('lib-dht22').click();
  await page.getByTestId('insp-tab-python').click();
  await expect(page.getByTestId('insp-example-code')).toContainText('adafruit_dht.DHT22(board.D4)');
  await page.getByTestId('test-part').click();
  await expect(page.getByTestId('test-part-result')).toContainText('PASS', { timeout: 120_000 });
});

test('B6 load a complete example (SHT31 via busio/adafruit_sht31d) and run it', async ({ page }) => {
  await boot(page);
  await page.getByTestId('lib-search').fill('SHT31');
  await page.getByTestId('lib-sht31').click();
  await page.getByTestId('insp-tab-python').click();
  await page.getByTestId('load-example').click();
  await expect.poll(() => page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.exampleId)).toBe('part:sht31');
  expect(await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.wires.length)).toBe(4);
  await page.getByTestId('run').click();
  await expect(page.getByTestId('terminal')).toContainText('T 24.0 °C  RH 55.0 %', { timeout: 60_000 });
});

test('A1/A6 in the browser: gpiozero needs no installation; an unsupported import is explained', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const st = (window as any).__rpi5sim.useApp.getState();
    st.setFile('main.py', 'from gpiozero import LED\nprint("gpiozero ok")\nimport pigpio\n');
  });
  await page.getByTestId('run').click();
  await expect(page.getByTestId('terminal')).toContainText('gpiozero ok', { timeout: 60_000 });
  await expect(page.getByTestId('py-error')).toContainText('pigpio does not support the Raspberry Pi 5');
});

test('Insert Example Code keeps the user code when asked', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().setFile('main.py', 'print("my own code")\n'));
  await page.getByTestId('lib-search').fill('BH1750');
  await page.getByTestId('lib-bh1750').click();
  await page.getByTestId('insp-tab-python').click();
  page.once('dialog', (d) => d.dismiss()); // Cancel = keep my code, add a new file
  await page.getByTestId('insert-example').click();
  const files = await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.files.map((f: any) => [f.name, f.content]));
  expect(files[0]).toEqual(['main.py', 'print("my own code")\n']);
  expect(files.some(([n, c]: [string, string]) => n === 'bh1750_example.py' && c.includes('BH1750'))).toBe(true);
});
