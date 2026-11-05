// Default layouts of the ESP32 / Wiren Board projects in the real app: each project opens from
// the library already arranged (no overlaps, no wire across a part), pressing Arrange keeps it
// as good or better without touching the connections, and screenshots of both are saved in
// layout-shots/ (uploaded as a GitHub Actions artifact) for visual review.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const IDS = ['mcu-esp32-blink', 'mcu-esp32-dht-fan', 'mcu-esp32-soil-pump', 'mcu-esp32-grow-light', 'mcu-esp32-greenhouse', 'mcu-wb7-input-relay', 'mcu-wb7-level-irrigation', 'mcu-wb7-1wire-heating', 'mcu-wb7-modbus-output', 'mcu-wb7-mqtt-alarms', 'mcu-esp32-wb7-integration'];
const SHOTS = 'layout-shots';
mkdirSync(SHOTS, { recursive: true });

const quality = (page: Page) =>
  page.evaluate(() => {
    const S = (window as any).__rpi5sim;
    const d = S.useApp.getState().doc;
    const q = S.layoutQuality(d);
    return { crossings: q.crossings, overBodies: q.overBodies.length, overlaps: q.overlaps.length, dangling: q.dangling.length, sig: S.netSignature(d), pos: d.components.map((c: any) => [c.id, c.x, c.y]) };
  });

test.describe.configure({ mode: 'serial' });

for (const id of IDS) {
  test(`${id}: opens arranged; Arrange keeps it clean`, async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto('./');
    await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
    await page.getByTestId('tab-learn').click();
    await page.getByTestId('lib-cat').selectOption('controllers');
    await page.locator(`[data-id="${id}"]`).first().click();
    await page.getByTestId('open-example').click();
    await expect(page.getByTestId('fit')).toBeVisible();
    await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().setDock('terminal', false));
    await page.getByTestId('fit').click();
    await page.waitForTimeout(500);
    const q1 = await quality(page);
    expect(q1.overlaps).toBe(0);
    expect(q1.overBodies).toBe(0);
    expect(q1.dangling).toBe(0);
    await page.locator('.workspace').screenshot({ path: `${SHOTS}/${id}-opened.png` });
    await page.getByTestId('auto-arrange').click();
    await page.getByTestId('fit').click();
    await page.waitForTimeout(500);
    const q2 = await quality(page);
    expect(q2.sig).toEqual(q1.sig);
    expect(q2.overlaps).toBe(0);
    expect(q2.overBodies).toBe(0);
    expect(q2.crossings).toBeLessThanOrEqual(q1.crossings);
    // the default layout already is the Auto Arrange result: nothing moves
    expect(q2.pos).toEqual(q1.pos);
    await page.locator('.workspace').screenshot({ path: `${SHOTS}/${id}-arranged.png` });
  });
}
