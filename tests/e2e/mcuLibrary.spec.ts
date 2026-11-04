// The ESP32 / Wiren Board projects of the example library: they appear in their own category,
// open like any example, and each passes its in-app scenario with the real runtimes.
import { expect, test, type Page } from '@playwright/test';

const IDS = ['mcu-esp32-blink', 'mcu-esp32-dht-fan', 'mcu-esp32-soil-pump', 'mcu-esp32-grow-light', 'mcu-esp32-greenhouse', 'mcu-wb7-input-relay', 'mcu-wb7-level-irrigation', 'mcu-wb7-1wire-heating', 'mcu-wb7-modbus-output', 'mcu-wb7-mqtt-alarms', 'mcu-esp32-wb7-integration'];

async function learn(page: Page) {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  await page.getByTestId('tab-learn').click();
  await page.waitForFunction(() => !!(window as any).__rpi5lib && !!(window as any).__rpi5runScenario, null, { timeout: 30_000 });
}

test('the controllers category lists the projects and opens one with its ESP32 program', async ({ page }) => {
  await learn(page);
  await page.getByTestId('lib-cat').selectOption('controllers');
  await expect(page.getByTestId('lib-count')).toContainText('11');
  await page.locator('[data-id="mcu-esp32-soil-pump"]').click();
  await page.getByTestId('open-example').click();
  await expect.poll(() => page.evaluate(() => (window as any).__rpi5sim.useApp.getState().activeFile)).toBe('esp/main.ino');
  expect(await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.controllers.esp.language)).toBe('arduino');
});

test.describe.configure({ mode: 'serial' });
for (const id of IDS) {
  test(`${id} passes its in-app test`, async ({ page }) => {
    test.setTimeout(240_000);
    await learn(page);
    const r = await page.evaluate((exId) => (window as any).__rpi5runScenario((window as any).__rpi5lib.libraryEntry(exId).scenarios()[0], 1), id);
    expect(r.status, `${r.actual}\n${r.error ?? ''}`).toBe('PASS');
  });
}
