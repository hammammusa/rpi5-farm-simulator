// The example library in the real browser: the browser (search, filters, sort, favourites,
// progress, suggestions), opening a private copy, the automatic check in the Python worker,
// reopening after a reload, Auto Arrange with undo, rerouting when a part moves, and image +
// wiring-table export of every example.
import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  return errors;
}

/** the library lives in the lazily loaded Examples tab */
async function loadLibrary(page: Page) {
  await page.getByTestId('tab-learn').click();
  await page.waitForFunction(() => !!(window as any).__rpi5lib, null, { timeout: 30_000 });
}

const ids = (page: Page) => page.locator('.learn-list [data-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')!));

test('examples browser: search, filters, sort, favourites, progress and suggestions', async ({ page }) => {
  const errors = await boot(page);
  await loadLibrary(page);
  const total = await page.evaluate(() => (window as any).__rpi5lib.LIBRARY.length);
  expect(total).toBeGreaterThanOrEqual(100);
  await expect(page.getByTestId('lib-count')).toContainText(`${total} / ${total}`);

  // search by part name or model
  await page.getByTestId('lib-search').fill('hc-sr04');
  const found = await ids(page);
  expect(found.length).toBeGreaterThan(3);
  expect(found).toContain('robot-obstacle-avoider');
  expect(found.length).toBeLessThan(total);
  await page.getByTestId('lib-search').fill('');

  // category + level
  await page.getByTestId('lib-cat').selectOption('challenges');
  const ch = await ids(page);
  expect(ch.length).toBeGreaterThanOrEqual(6);
  expect(ch.every((id) => id.startsWith('ch-'))).toBe(true);
  await page.getByTestId('lib-cat').selectOption('advanced');
  await page.getByTestId('lib-level').selectOption('advanced');
  const adv = await ids(page);
  expect(adv).toContain('adv-greenhouse-controller');
  expect(await page.evaluate((xs) => xs.every((id: string) => (window as any).__rpi5lib.libraryEntry(id).level === 'advanced'), adv)).toBe(true);
  await page.getByTestId('lib-cat').selectOption('all');
  await page.getByTestId('lib-level').selectOption('all');

  // component filter
  await page.getByTestId('lib-comp').selectOption('tds_sensor');
  const tds = await ids(page);
  expect(tds).toContain('adv-aquarium');
  expect(await page.evaluate((xs) => xs.every((id: string) => (window as any).__rpi5lib.libraryEntry(id).types.includes('tds_sensor')), tds)).toBe(true);
  await page.getByTestId('lib-comp').selectOption('all');

  // sort by number of components and by difficulty
  await page.getByTestId('lib-sort').selectOption('fewest');
  const counts = await page.evaluate((xs) => xs.map((id: string) => (window as any).__rpi5lib.libraryEntry(id).partCount), await ids(page));
  expect(counts).toEqual([...counts].sort((a, b) => a - b));
  await page.getByTestId('lib-sort').selectOption('hard');
  const levels = await page.evaluate((xs) => xs.map((id: string) => ['beginner', 'intermediate', 'advanced'].indexOf((window as any).__rpi5lib.libraryEntry(id).level)), await ids(page));
  expect(levels).toEqual([...levels].sort((a, b) => b - a));
  await page.getByTestId('lib-sort').selectOption('number');

  // detail: goal, parts, steps, code, suggestions
  await page.locator('.learn-list [data-id="farm-ec-dosing"]').click();
  const detail = page.getByTestId('lib-detail');
  await expect(detail).toHaveAttribute('data-id', 'farm-ec-dosing');
  await expect(page.getByTestId('lib-parts').locator('li')).not.toHaveCount(0);
  await expect(detail.locator('pre.code-view')).toContainText('import');
  const next = page.getByTestId('lib-next').locator('button');
  expect(await next.count()).toBeGreaterThan(0);
  const nextId = await next.first().getAttribute('data-id');
  await next.first().click();
  await expect(detail).toHaveAttribute('data-id', nextId!);

  // favourite and completed survive a reload
  await page.getByTestId('lib-fav').click();
  await page.getByTestId('lib-done').click();
  await expect(page.getByTestId('lib-fav')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  await page.getByTestId('tab-learn').click();
  await page.getByTestId('lib-status').selectOption('fav');
  expect(await ids(page)).toEqual([nextId]);
  await page.getByTestId('lib-status').selectOption('done');
  expect(await ids(page)).toEqual([nextId]);
  await page.getByTestId('lib-status').selectOption('all');
  expect(errors).toEqual([]);
});

test('library examples pass their automatic check in the Python worker, open as private copies and survive a reload', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  await page.getByTestId('tab-learn').click();
  for (const id of ['ch-binary-quiz', 'adv-smart-door', 'sensors-ultrasonic-ruler', 'farm-greenhouse-climate']) {
    await page.locator(`.learn-list [data-id="${id}"]`).click();
    await page.getByTestId('check-example').click();
    await expect(page.locator('[data-check]').first()).toHaveAttribute('data-check', 'PASS', { timeout: 90_000 });
    await expect(page.locator(`.learn-list [data-id="${id}"]`)).toContainText('✔');
  }

  // open a private copy
  const before = await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.id);
  await page.locator('.learn-list [data-id="adv-aquarium"]').click();
  await page.getByTestId('open-example').click();
  await expect(page.getByTestId('auto-arrange')).toBeVisible();
  const opened = await page.evaluate(() => {
    const S = (window as any).__rpi5sim;
    const d = S.useApp.getState().doc;
    const ref = (window as any).__rpi5lib.libraryEntry('adv-aquarium').build();
    return { id: d.id, exampleId: d.exampleId, same: JSON.stringify(S.netSignature(d)) === JSON.stringify(S.netSignature(ref)), q: S.layoutQuality(d), comps: d.components.map((c: any) => [c.id, c.x, c.y]) };
  });
  expect(opened.id).not.toBe(before);
  expect(opened.exampleId).toBe('lib:adv-aquarium');
  expect(opened.same).toBe(true);
  expect(opened.q.overlaps).toEqual([]);
  expect(opened.q.dangling).toEqual([]);

  // reopened after a reload exactly as it was
  await page.evaluate(() => (window as any).__rpi5sim.saveNow());
  await page.reload();
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  const again = await page.evaluate(() => {
    const d = (window as any).__rpi5sim.useApp.getState().doc;
    return { id: d.id, comps: d.components.map((c: any) => [c.id, c.x, c.y]) };
  });
  expect(again).toEqual({ id: opened.id, comps: opened.comps });
  expect(errors).toEqual([]);
});

test('Auto Arrange tidies a messy circuit, keeps every connection, undoes in one step and reroutes wires when a part moves', async ({ page }) => {
  const errors = await boot(page);
  await loadLibrary(page);
  const start = await page.evaluate(() => {
    const S = (window as any).__rpi5sim;
    const d = (window as any).__rpi5lib.libraryEntry('home-fire-alarm').build();
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    d.id = 'messy';
    d.exampleId = undefined;
    d.components = d.components.map((c: any) => ({ ...c, x: Math.round(rnd() * 900), y: Math.round(rnd() * 600) }));
    d.wires = d.wires.map((w: any) => ({ ...w, points: undefined, route: undefined, auto: undefined }));
    S.useApp.getState().loadProject(d);
    return { pos: d.components.map((c: any) => [c.id, c.x, c.y]), net: S.netSignature(d), q: S.layoutQuality(d) };
  });
  expect(start.q.overlaps.length + start.q.overBodies.length).toBeGreaterThan(0);

  await page.getByTestId('tab-circuit').click();
  await page.getByTestId('auto-arrange').click();
  const after = await page.evaluate(() => {
    const S = (window as any).__rpi5sim;
    const d = S.useApp.getState().doc;
    return { pos: d.components.map((c: any) => [c.id, c.x, c.y]), net: S.netSignature(d), q: S.layoutQuality(d), auto: d.wires.every((w: any) => w.auto), code: d.files };
  });
  expect(after.net).toEqual(start.net);
  expect(after.q.overlaps).toEqual([]);
  expect(after.q.overBodies).toEqual([]);
  expect(after.q.dangling).toEqual([]);
  expect(after.auto).toBe(true);
  expect(after.pos).not.toEqual(start.pos);

  // one undo step restores the user's layout
  await page.getByTestId('undo').click();
  expect(await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.components.map((c: any) => [c.id, c.x, c.y]))).toEqual(start.pos);
  await page.getByTestId('redo').click();
  expect(await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.components.map((c: any) => [c.id, c.x, c.y]))).toEqual(after.pos);

  // dragging a part keeps its wires attached and re-routes them
  const target = page.getByTestId('comp-siren');
  const box = (await target.boundingBox())!;
  const wiresBefore = await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.wires.filter((w: any) => w.from.comp === 'siren' || w.to.comp === 'siren').map((w: any) => JSON.stringify(w.points)));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 80, { steps: 8 });
  await page.mouse.up();
  const moved = await page.evaluate(() => {
    const S = (window as any).__rpi5sim;
    const d = S.useApp.getState().doc;
    return { q: S.layoutQuality(d), net: S.netSignature(d), wires: d.wires.filter((w: any) => w.from.comp === 'siren' || w.to.comp === 'siren').map((w: any) => JSON.stringify(w.points)) };
  });
  expect(moved.net).toEqual(start.net);
  expect(moved.q.dangling).toEqual([]);
  expect(moved.wires).not.toEqual(wiresBefore);

  // a manual bend turns the wire into a hand-routed one (it is not re-routed any more)
  const manual = await page.evaluate(() => {
    const st = (window as any).__rpi5sim.useApp.getState();
    const w = st.doc.wires[0];
    st.updateWire(w.id, { points: [{ x: 300, y: 40 }] });
    return (window as any).__rpi5sim.useApp.getState().doc.wires[0].auto;
  });
  expect(manual).toBe(false);
  expect(errors).toEqual([]);
});

test('every library example exports its circuit image and wiring table', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page);
  await loadLibrary(page);
  await page.getByTestId('export-btn').click();
  await page.waitForFunction(() => !!(window as any).__rpi5export, null, { timeout: 30_000 });
  await page.keyboard.press('Escape');
  const res = await page.evaluate(async () => {
    const X = (window as any).__rpi5export;
    const out: { id: string; ok: boolean; why?: string }[] = [];
    for (const e of (window as any).__rpi5lib.LIBRARY) {
      try {
        const d = e.build();
        const svg = X.renderCircuitSvg(d, X.DEFAULT_IMAGE);
        const rep = X.buildReport(d);
        const rows = rep.wiring.filter((r: any) => !r.wireId.startsWith('bb-')).length;
        const ok = svg.svg.includes('<svg') && svg.width > 100 && rows === d.wires.length;
        out.push({ id: e.id, ok, why: ok ? undefined : `svg ${svg.svg.slice(0, 20)} ${svg.width}×${svg.height}, rows ${rows}/${d.wires.length}` });
      } catch (err: any) {
        out.push({ id: e.id, ok: false, why: String(err?.message ?? err) });
      }
    }
    // PNG for a small, a medium and the largest circuit
    const png: number[] = [];
    for (const id of ['gpio-sos', 'farm-greenhouse-climate', 'ex20-city-farming']) png.push((await X.circuitPng(X.renderCircuitSvg((window as any).__rpi5lib.libraryEntry(id).build(), X.DEFAULT_IMAGE), 2)).size);
    return { out, png };
  });
  expect(res.out.filter((r) => !r.ok)).toEqual([]);
  expect(res.out.length).toBeGreaterThanOrEqual(100);
  for (const size of res.png) expect(size).toBeGreaterThan(5000);
  expect(errors).toEqual([]);
});

// Every library example's automatic check, in the real Python worker at 1× speed, one test per category.
const CATS = ['gpio', 'sensors', 'motors', 'displays', 'comms', 'smarthome', 'robotics', 'security', 'industrial', 'farming', 'energy', 'logic', 'data', 'challenges', 'advanced'];
for (const cat of CATS) {
  test(`automatic check passes for every "${cat}" example in the browser`, async ({ page }) => {
    test.setTimeout(420_000);
    const errors = await boot(page);
    await loadLibrary(page);
    const ids: string[] = await page.evaluate((c) => (window as any).__rpi5lib.LIBRARY.filter((e: any) => e.spec && e.cat === c).map((e: any) => e.id), cat);
    const failed: string[] = [];
    for (const id of ids) {
      const r = await page.evaluate(async (x) => {
        const e = (window as any).__rpi5lib.libraryEntry(x);
        const rep = await (window as any).__rpi5runScenario(e.scenarios()[0], 1, false);
        return { status: rep.status, actual: rep.actual, error: rep.error };
      }, id);
      if (r.status !== 'PASS') failed.push(`${id}: ${r.status} ${r.actual} ${r.error ?? ''}`);
    }
    expect(failed).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('an opened example keeps running until Stop and keeps reacting to the button (reaction game)', async ({ page }) => {
  const errors = await boot(page);
  await loadLibrary(page);
  await page.locator('.learn-list [data-id="gpio-reaction-game"]').click();
  await page.getByTestId('open-example').click();
  await page.getByTestId('run').click();
  await expect(page.getByTestId('runtime-state')).toContainText('Running');
  // nobody presses: earlier versions ended here after one timed-out round
  await page.waitForTimeout(8000);
  await expect(page.getByTestId('runtime-state')).toContainText('Running');
  await expect(page.getByTestId('terminal')).toContainText('too slow');
  // press the real button part in the workspace while its LED is lit
  await page.waitForFunction(() => ((window as any).__rpi5sim.sim.vis.get('led')?.brightness ?? 0) > 0.2, null, { timeout: 10_000 });
  const box = (await page.locator('[data-testid="comp-btn"] .press-target').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect(page.getByTestId('terminal')).toContainText(/reaction time: \d\.\d\d s \(best/);
  await expect(page.getByTestId('runtime-state')).toContainText('Running');
  await page.getByTestId('stop').click();
  await expect(page.getByTestId('runtime-state')).toContainText('Ready', { timeout: 5000 });
  expect(errors).toEqual([]);
});
