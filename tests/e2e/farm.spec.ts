// Smart Farm tab: the heating simulation mode is chosen in the UI, applied to the room-air
// model at once, saved with the project and explained (Extreme Test is hypothetical).
import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  return errors;
}

const mode = (page: Page) =>
  page.evaluate(() => {
    const S = (window as any).__rpi5sim;
    return { doc: S.useApp.getState().doc.farm.heatingMode, sim: S.sim.farm.cfg.heatingMode };
  });

test('heating simulation mode: chosen in the Smart Farm tab, applied at once, saved with the project', async ({ page }) => {
  const errors = await boot(page);
  await page.getByTestId('tab-farm').click();
  if (!(await page.getByTestId('farm-enabled').isChecked())) await page.getByTestId('farm-enabled').check();
  const select = page.getByTestId('farm-heating-mode');
  await expect(select).toHaveValue('realistic');
  await expect(select.locator('option')).toHaveText([/Realistic — THERMAL_MASS = 150000 J\/K/, /Training — THERMAL_MASS = 12000 J\/K/, /Extreme Test — THERMAL_MASS = 2500 J\/K/]);
  await expect(page.getByTestId('farm-extreme-warning')).toHaveCount(0);

  await select.selectOption('training');
  expect(await mode(page)).toEqual({ doc: 'training', sim: 'training' });
  await expect(page.getByTestId('farm-heating-info')).toContainText('0.5 °C per minute');

  await select.selectOption('extreme');
  expect(await mode(page)).toEqual({ doc: 'extreme', sim: 'extreme' });
  const warning = page.getByTestId('farm-extreme-warning');
  await expect(warning).toContainText('outside realistic limits');
  await expect(warning).toContainText('DHT22');
  await expect(warning).toContainText('80.0 °C');

  // the model uses the new mass immediately: 100 W for 60 s of farm time heats the air by ~2.4 °C
  const rise = await page.evaluate(() => {
    const S = (window as any).__rpi5sim;
    const f = S.sim.farm;
    const t0 = f.state.t;
    f.state.air.temp = 25;
    f.cfg = { ...f.cfg, env: { ...f.cfg.env, outdoorTemp: 25 } };
    const drives = f.drives;
    f.drives = [{ comp: 'test', role: 'heater', run: 1, rate: 0, watts: 100 }];
    f.advanceTo(t0 + 60);
    const r = f.state.air.temp - 25;
    f.drives = drives;
    return r;
  });
  expect(rise).toBeGreaterThan(2.2);
  expect(rise).toBeLessThan(2.5);

  // above 80 °C the warning names the DHT22 limit live
  await page.evaluate(() => {
    const S = (window as any).__rpi5sim;
    S.sim.farm.state.air.temp = 95;
    S.sim.evaluate();
  });
  await expect(page.getByTestId('farm-dht-limit')).toContainText('above the DHT22 range');

  // saved with the project: survives a reload
  await page.evaluate(() => (window as any).__rpi5sim.saveNow());
  await page.reload();
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  expect((await mode(page)).doc).toBe('extreme');
  await page.getByTestId('tab-farm').click();
  await expect(page.getByTestId('farm-heating-mode')).toHaveValue('extreme');

  // back to Realistic: the warning disappears
  await page.getByTestId('farm-heating-mode').selectOption('realistic');
  expect(await mode(page)).toEqual({ doc: 'realistic', sim: 'realistic' });
  await expect(page.getByTestId('farm-extreme-warning')).toHaveCount(0);
  expect(errors).toEqual([]);
});
