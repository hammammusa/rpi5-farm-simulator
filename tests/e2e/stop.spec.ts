// Stop must always end with "Program stopped." — never an internal error, even when the
// interrupt reaches Python while the simulator is shutting the devices down.
import { expect, test } from '@playwright/test';

test('Stop during a sleeping loop ends cleanly, repeatedly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  await page.evaluate(() => {
    const S = (window as any).__rpi5sim;
    const d = S.newProject('Stop test');
    d.components = [
      { id: 'pi', type: 'rpi5', x: 40, y: 40, rotation: 0, props: {} },
      { id: 'dht', type: 'dht22', x: 520, y: 60, rotation: 0, props: {} },
    ];
    d.wires = [
      { id: 'w1', from: { comp: 'pi', pin: 'P1' }, to: { comp: 'dht', pin: 'VCC' }, color: '#e0393e' },
      { id: 'w2', from: { comp: 'pi', pin: 'P7' }, to: { comp: 'dht', pin: 'DATA' }, color: '#2e9d4f' },
      { id: 'w3', from: { comp: 'dht', pin: 'GND' }, to: { comp: 'pi', pin: 'P6' }, color: '#2b2b2b' },
    ];
    d.files = [{ name: 'main.py', content: 'import time, board, adafruit_dht\nfrom gpiozero import LED\nled = LED(17)\ndht = adafruit_dht.DHT22(board.D4)\nwhile True:\n    led.toggle()\n    print("T", dht.temperature, flush=True)\n    time.sleep(2)\n' }];
    S.useApp.getState().loadProject(d);
  });
  for (let k = 0; k < 4; k++) {
    await page.getByTestId('run').click();
    await expect(page.getByTestId('terminal')).toContainText('T ', { timeout: 60_000 });
    await page.waitForTimeout(300 + k * 400);
    await page.getByTestId('stop').click();
    await expect(page.getByTestId('terminal')).toContainText('Program stopped', { timeout: 10_000 });
    await expect(page.getByTestId('py-error')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().pyError)).toBeNull();
  }
  expect(errors).toEqual([]);
});
