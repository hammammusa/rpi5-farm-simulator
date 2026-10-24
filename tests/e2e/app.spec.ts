import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  return errors;
}

const ledLit = (page: Page) => page.evaluate(() => ((window as any).__rpi5sim.sim.vis.get('led1')?.brightness ?? 0) > 0.2);

async function samples(page: Page, n: number, every = 250) {
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) {
    out.push(await ledLit(page));
    await page.waitForTimeout(every);
  }
  return out;
}

test('loads cross-origin isolated with Python 3 ready and no errors', async ({ page }) => {
  const errors = await boot(page);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await expect(page.getByTestId('runtime-state')).toContainText('Ready');
  expect(errors).toEqual([]);
});

test('example 1 from the UI: run, blink, rewire with the mouse, stop', async ({ page }) => {
  await boot(page);
  await page.getByTestId('tab-learn').click();
  await page.getByTestId('example-1').click();
  await page.getByTestId('open-example').click();
  await expect(page.getByTestId('workspace')).toBeVisible();
  await page.getByTestId('run').click();
  await expect(page.getByTestId('runtime-state')).toContainText('Running');
  const s = await samples(page, 12);
  expect(s.some((x) => x)).toBe(true);
  expect(s.some((x) => !x)).toBe(true);

  // delete the GPIO17 wire with the mouse + Delete key → LED goes dark
  const wire = await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.wires.find((w: any) => w.from.pin === 'P11').id);
  // click a point that lies on the wire (the middle of its path, not of its bounding box)
  const onWire = await page.locator(`[data-testid="wire-${wire}"] .wire-hit`).evaluate((el: SVGPathElement) => {
    const p = el.getPointAtLength(el.getTotalLength() / 2);
    const m = el.getScreenCTM()!;
    return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
  });
  await page.mouse.click(onWire.x, onWire.y);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(400);
  expect((await samples(page, 8)).some((x) => x)).toBe(false);

  // draw a new wire by clicking the Pi pin 11 and then breadboard hole a15
  await page.locator('[data-comp="pi"][data-pin="P11"]').click({ force: true });
  await page.locator('[data-comp="bb"][data-pin="a15"]').click({ force: true });
  await page.waitForTimeout(400);
  const wires = await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.wires.filter((w: any) => w.from.pin === 'P11' || w.to.pin === 'P11').length);
  expect(wires).toBe(1);
  const s2 = await samples(page, 12);
  expect(s2.some((x) => x) && s2.some((x) => !x)).toBe(true);

  const t0 = Date.now();
  await page.getByTestId('stop').click();
  await expect(page.getByTestId('runtime-state')).toContainText('Ready', { timeout: 5000 });
  expect(Date.now() - t0).toBeLessThan(5000);
});

test('Python error is shown with line and explanation', async ({ page }) => {
  await boot(page);
  await page.getByTestId('tab-python').click();
  await page.evaluate(() => {
    const st = (window as any).__rpi5sim.useApp.getState();
    st.setFile(st.doc.mainFile, 'a = 2\nprint(1 / 0)\n');
  });
  await page.getByTestId('run').click();
  await expect(page.getByTestId('py-error')).toContainText('ZeroDivisionError: division by zero');
  await expect(page.getByTestId('py-error')).toContainText('2');
  await expect(page.locator('.cm-error-line')).toHaveCount(1);
});

test('all 15 acceptance tests', async ({ page }) => {
  test.setTimeout(600_000);
  await boot(page);
  await page.getByTestId('tab-tests').click();
  await page.getByTestId('run-all-tests').click();
  await expect(page.getByTestId('tests-summary')).toContainText('/15', { timeout: 540_000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="run-all-tests"]')?.hasAttribute('disabled'), null, { timeout: 540_000 });
  const rows = await page.locator('[data-test-id]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-test-id'), e.getAttribute('data-status'), (e.querySelectorAll('td')[4] as HTMLElement)?.innerText]));
  console.log(rows.map((r) => r.join(' | ')).join('\n'));
  const production = /^https:/.test(page.url()) && !/localhost|127\.0\.0\.1/.test(page.url());
  for (const [id, status] of rows) {
    if (id === 'T15' && !production) expect(status).toBe('FAIL');
    else expect(status, `${id}`).toBe('PASS');
  }
});

test('project persists across a page reload', async ({ page }) => {
  await boot(page);
  await page.getByTestId('tab-learn').click();
  await page.getByTestId('example-5').click();
  await page.getByTestId('open-example').click();
  // openExample() saves, loads and saves again before switching to the circuit tab
  await page.waitForFunction(() => {
    const st = (window as any).__rpi5sim.useApp.getState();
    return st.tab === 'circuit' && st.doc.name === 'Ex 5 · Automatic fan' && !st.dirty;
  });
  await page.evaluate(() => {
    const st = (window as any).__rpi5sim.useApp.getState();
    st.setProp('dht', 'temperature', 31.25);
    st.addFile('notes.py', 'NOTE = "persist me"\n');
    st.rename('Persistence check');
  });
  await page.evaluate(() => (window as any).__rpi5sim.saveNow());
  const before = await page.evaluate(() => {
    const d = (window as any).__rpi5sim.useApp.getState().doc;
    return JSON.stringify([d.id, d.components, d.wires, d.files]);
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().doc.name === 'Persistence check', null, { timeout: 60_000 });
  const after = await page.evaluate(() => {
    const d = (window as any).__rpi5sim.useApp.getState().doc;
    return JSON.stringify([d.id, d.components, d.wires, d.files]);
  });
  expect(after).toBe(before);
});

test('competition challenges: reference solutions pass, skeletons fail', async ({ page }) => {
  test.setTimeout(600_000);
  await boot(page);
  await page.getByTestId('tab-competition').click();
  await page.waitForFunction(() => !!(window as any).__rpi5challenges && !!(window as any).__rpi5runScenario);
  const res = await page.evaluate(async () => {
    const { CHALLENGES, referenceDoc } = (window as any).__rpi5challenges;
    const { useApp } = (window as any).__rpi5sim;
    const out: Record<string, string[]> = {};
    for (const c of CHALLENGES) {
      for (const variant of ['reference', 'skeleton']) {
        const doc = variant === 'reference' ? referenceDoc(c.id) : c.build();
        useApp.getState().loadProject(doc);
        const reports: string[] = [];
        for (const cp of c.checkpoints) {
          const r = await (window as any).__rpi5runScenario(cp, 1, true);
          reports.push(`${cp.id}:${r.status}:${r.actual}`);
        }
        out[`${c.id}/${variant}`] = reports;
      }
    }
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  for (const [k, reports] of Object.entries(res)) {
    if (k.endsWith('/reference')) for (const r of reports) expect(r, k).toMatch(/:PASS:/);
    else expect(reports.some((r) => r.includes(':FAIL:') || r.includes(':ERROR:')), k).toBe(true);
  }
});

test('Arabic interface switches to RTL, code stays LTR', async ({ page }) => {
  await boot(page);
  await page.getByTestId('lang').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('tab-circuit')).toContainText('الدائرة');
  await page.getByTestId('tab-python').click();
  await expect(page.getByTestId('code-editor')).toHaveAttribute('dir', 'ltr');
  await page.getByTestId('lang').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('mobile layout keeps the main functions', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await boot(page);
  await expect(page.getByTestId('workspace')).toBeVisible();
  await expect(page.getByTestId('run')).toBeVisible();
  await page.getByTestId('tab-farm').click();
  await expect(page.getByTestId('farm-svg')).toBeVisible();
  await ctx.close();
});
