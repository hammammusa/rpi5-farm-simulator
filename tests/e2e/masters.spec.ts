// The three COMPETITION MASTER projects in the real app: Focused Study Mode, the study page, the
// 10 scenarios on the browser runtimes (Pyodide, MicroPython, wb-rules), opening the circuit
// (clean layout, wire explanation), running the program (live status panel), Code Recall judged
// by behaviour, and the printable PDFs (saved in study-pdfs/ for the artifact and the docs).
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const PROJECTS = [
  { id: 'master-pi5', recall: 'LIGHT' },
  { id: 'master-esp32', recall: 'FAN' },
  { id: 'master-wb7', recall: 'DOSING' },
];
const OUT = 'study-pdfs';
mkdirSync(OUT, { recursive: true });

test.describe.configure({ mode: 'serial' });

async function ready(page: Page) {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  await page.getByTestId('tab-learn').click();
}

async function select(page: Page, id: string) {
  const focus = page.getByTestId('focus-mode').locator('input');
  if (!(await focus.isChecked())) await focus.check();
  await page.locator(`.learn-item[data-id="${id}"]`).click();
  await expect(page.getByTestId('master-study')).toHaveAttribute('data-id', id);
}

test('Focused Study Mode lists only the three master projects, first in the library', async ({ page }) => {
  await ready(page);
  const first = page.locator('.learn-list .panel-title.sub').first();
  await expect(first).toContainText('City Farming — My 3 Master Projects');
  await page.getByTestId('focus-mode').locator('input').check();
  await expect(page.locator('.learn-item[data-id]')).toHaveCount(3);
  await expect(page.getByTestId('focus-note')).toBeVisible();
  await page.getByTestId('focus-mode').locator('input').uncheck();
  expect(await page.locator('.learn-item[data-id]').count()).toBeGreaterThanOrEqual(164);
});

for (const P of PROJECTS) {
  test(`${P.id}: the 10 scenarios pass on the browser runtime`, async ({ page }) => {
    test.setTimeout(600_000);
    await ready(page);
    await select(page, P.id);
    await expect(page.getByTestId('master-circuit-img')).toBeVisible({ timeout: 30_000 });
    for (const tab of ['sections', 'wiring', 'exercises', 'compare', 'hardware']) {
      await page.getByTestId(`mtab-${tab}`).click();
      await expect(page.getByTestId(`master-${tab}`)).toBeVisible();
    }
    // explain every line
    await page.getByTestId('mtab-sections').click();
    await page.getByTestId('msec-auto').click();
    await page.locator('.xline').nth(3).click();
    await expect(page.locator('.xterms')).toBeVisible();
    await page.getByTestId('mtab-tests').click();
    await page.getByTestId('master-run-all').click();
    await expect(page.getByTestId('master-score')).toHaveText(/10 \/ 10/, { timeout: 540_000 });
    expect(await page.locator('[data-check="PASS"]').count()).toBe(10);
    // study PDFs (with these results), the cheat sheet and the comparison
    await page.getByTestId('mtab-export').click();
    for (const lang of ['en', 'ar']) {
      await page.evaluate((l) => (window as any).__rpi5sim.useApp.getState().setLang(l), lang);
      for (const what of ['study', 'cheat', ...(P.id === 'master-pi5' ? ['compare'] : [])]) {
        const dl = page.waitForEvent('download', { timeout: 120_000 });
        await page.getByTestId(`pdf-${what}`).click();
        const d = await dl;
        await d.saveAs(`${OUT}/${d.suggestedFilename()}`);
        expect(d.suggestedFilename()).toMatch(new RegExp(`-${lang}\\.pdf$`));
      }
    }
    await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().setLang('en'));
  });

  test(`${P.id}: opens wired and arranged, runs, shows the status and explains a wire`, async ({ page }) => {
    test.setTimeout(240_000);
    await ready(page);
    await select(page, P.id);
    await page.getByTestId('open-example').click();
    await expect(page.getByTestId('fit')).toBeVisible();
    const q = await page.evaluate(() => {
      const S = (window as any).__rpi5sim;
      const d = S.useApp.getState().doc;
      const r = S.layoutQuality(d);
      return { overlaps: r.overlaps.length, overBodies: r.overBodies.length, dangling: r.dangling.length, wires: d.wires.length };
    });
    expect(q).toMatchObject({ overlaps: 0, overBodies: 0, dangling: 0 });
    expect(q.wires).toBeGreaterThan(40);
    await page.getByTestId('fit').click();
    await page.locator('.workspace').screenshot({ path: `${OUT}/${P.id}-circuit.png` });
    // explain the first wire
    await page.evaluate(() => {
      const S = (window as any).__rpi5sim;
      S.useApp.getState().select([], S.useApp.getState().doc.wires[0].id);
    });
    await expect(page.getByTestId('master-wire-note')).toBeVisible();
    // run: the status panel fills from the program's STATUS lines
    await page.getByTestId('run').click();
    await page.waitForFunction(() => /STATUS mode=AUTO/.test((window as any).__rpi5sim.useApp.getState().term.map((l: any) => l.text).join('')), null, { timeout: 120_000 });
    await page.getByTestId('tab-learn').click();
    await expect(page.locator('[data-status="Mode"] td')).toHaveText('AUTO');
    await expect(page.locator('[data-load="light"]')).toBeVisible();
    await page.evaluate(() => (window as any).__rpi5sim.stopProgram());
  });

  test(`${P.id}: Code Recall — hidden part fails its behaviour check, the original passes`, async ({ page }) => {
    test.setTimeout(300_000);
    await ready(page);
    await select(page, P.id);
    await page.getByTestId('open-example').click();
    await page.getByTestId('tab-learn').click();
    await page.getByTestId('mtab-recall').click();
    await page.getByTestId(`recall-hide-${P.recall}`).click();
    await page.getByTestId('tab-learn').click();
    await page.getByTestId('mtab-recall').click();
    await page.getByTestId(`recall-check-${P.recall}`).click();
    await expect(page.getByTestId(`recall-result-${P.recall}`)).toHaveClass(/bad/, { timeout: 240_000 });
    await page.getByTestId(`recall-restore-${P.recall}`).click();
    await expect(page.getByTestId(`recall-check-${P.recall}`)).toBeEnabled();
    await page.getByTestId(`recall-check-${P.recall}`).click();
    await expect(page.getByTestId(`recall-check-${P.recall}`)).toBeDisabled();
    await expect(page.getByTestId(`recall-check-${P.recall}`)).toBeEnabled({ timeout: 240_000 });
    const cls = await page.getByTestId(`recall-result-${P.recall}`).getAttribute('class');
    if (cls !== 'ok') console.log('RECALL OUTPUT', await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().term.map((l: any) => l.text).join('')));
    await expect(page.getByTestId(`recall-result-${P.recall}`)).toHaveClass(/ok/);
  });
}
