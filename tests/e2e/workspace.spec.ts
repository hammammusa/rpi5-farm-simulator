// Acceptance tests C (workspace navigation) and D (wire editing), driven with a real mouse/keyboard.
import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  return errors;
}

/** Loads a small circuit: Pi, R1 → LED1 → GND on GPIO17, and R2 on GPIO18 whose wire crosses the first one. */
async function loadCircuit(page: Page) {
  await page.evaluate(() => {
    const S = (window as any).__rpi5sim;
    const d = S.newProject('Wire editing test');
    d.components = [
      { id: 'pi', type: 'rpi5', x: 40, y: 40, rotation: 0, props: {} },
      { id: 'r1', type: 'resistor', x: 520, y: 380, rotation: 0, props: { ohms: 330 } },
      { id: 'led1', type: 'led', x: 680, y: 360, rotation: 0, props: {} },
      { id: 'r2', type: 'resistor', x: 240, y: 520, rotation: 0, props: { ohms: 1000 } },
    ];
    d.wires = [
      { id: 'w1', from: { comp: 'pi', pin: 'P11' }, to: { comp: 'r1', pin: '1' }, color: '#e6b800' },
      { id: 'w2', from: { comp: 'r1', pin: '2' }, to: { comp: 'led1', pin: 'A' }, color: '#2b7bd6' },
      { id: 'w3', from: { comp: 'led1', pin: 'K' }, to: { comp: 'pi', pin: 'P6' }, color: '#2b2b2b' },
      { id: 'w4', from: { comp: 'pi', pin: 'P12' }, to: { comp: 'r2', pin: '1' }, color: '#2e9d4f', points: [{ x: 600, y: 300 }, { x: 600, y: 480 }] },
    ];
    S.useApp.getState().loadProject(d);
    S.useApp.setState({ tab: 'circuit' });
  });
  await page.waitForTimeout(300);
  await page.getByTestId('fit').click();
  await page.waitForTimeout(600);
}

const view = (page: Page) =>
  page.getByTestId('workspace').evaluate((el) => ({ x: Number(el.getAttribute('data-x')), y: Number(el.getAttribute('data-y')), k: Number(el.getAttribute('data-k')) }));
const comp = (page: Page, id: string) => page.evaluate((cid) => (window as any).__rpi5sim.useApp.getState().doc.components.find((c: any) => c.id === cid), id);
const wire = (page: Page, id: string) => page.evaluate((wid) => (window as any).__rpi5sim.useApp.getState().doc.wires.find((w: any) => w.id === wid), id);

/** A point on the canvas far from every part (top-right corner area of the workspace). */
async function emptyPoint(page: Page) {
  const r = (await page.getByTestId('workspace').boundingBox())!;
  return { x: r.x + r.width - 260, y: r.y + 120 };
}

/** screen position of the middle of a wire's drawn path */
async function wireMid(page: Page, id: string) {
  return page.locator(`[data-testid="wire-${id}"] .wire-line`).evaluate((p: SVGPathElement) => {
    const L = p.getTotalLength();
    const m = p.getPointAtLength(L * 0.5);
    const ctm = p.getScreenCTM()!;
    return { x: m.x * ctm.a + m.y * ctm.c + ctm.e, y: m.x * ctm.b + m.y * ctm.d + ctm.f };
  });
}

test.describe('C · workspace navigation', () => {
  test('C1 Ctrl + left drag pans the view without moving or selecting parts', async ({ page }) => {
    await boot(page);
    await loadCircuit(page);
    const v0 = await view(page);
    const r1 = await comp(page, 'r1');
    // start the drag ON a component: with Ctrl held it must pan, not move the part
    const box = (await page.getByTestId('comp-r1').boundingBox())!;
    await page.keyboard.down('Control');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 + 60, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    const v1 = await view(page);
    expect(v1.x - v0.x).toBeCloseTo(-150, -1);
    expect(v1.y - v0.y).toBeCloseTo(60, -1);
    expect(await comp(page, 'r1')).toEqual(r1);
    // no text got selected while panning
    expect(await page.evaluate(() => String(window.getSelection() ?? ''))).toBe('');
    // Space + drag pans too
    const e = await emptyPoint(page);
    await page.mouse.move(e.x, e.y);
    await page.keyboard.down('Space');
    await page.mouse.down();
    await page.mouse.move(e.x + 80, e.y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    expect((await view(page)).x - v1.x).toBeCloseTo(80, -1);
  });

  test('C2 a normal drag moves the part, snapped to the grid', async ({ page }) => {
    await boot(page);
    await loadCircuit(page);
    const before = await comp(page, 'led1');
    const box = (await page.getByTestId('comp-led1').boundingBox())!;
    const { k } = await view(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60 * k, box.y + box.height / 2 + 40 * k, { steps: 10 });
    await page.mouse.up();
    const after = await comp(page, 'led1');
    expect(after.x - before.x).toBe(60);
    expect(after.y - before.y).toBe(40);
  });

  test('C3 wheel zoom is smooth and zooms toward the pointer; C4 fit to screen shows every part', async ({ page }) => {
    await boot(page);
    await loadCircuit(page);
    const v0 = await view(page);
    const ws = (await page.getByTestId('workspace').boundingBox())!;
    const px = ws.x + ws.width / 2;
    const py = ws.y + ws.height / 2;
    // world point under the pointer before zooming
    const wx = (px - ws.x - v0.x) / v0.k;
    await page.mouse.move(px, py);
    await page.mouse.wheel(0, -400);
    // sample during the animation: intermediate zoom levels prove it is animated, not a jump
    const ks: number[] = [];
    for (let i = 0; i < 8; i++) {
      ks.push((await view(page)).k);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(500);
    const v1 = await view(page);
    expect(v1.k).toBeGreaterThan(v0.k * 1.3);
    expect(new Set(ks.map((k) => k.toFixed(3))).size).toBeGreaterThan(2);
    // the same world point is still under the pointer
    expect((px - ws.x - v1.x) / v1.k).toBeCloseTo(wx, 0);
    await expect(page.getByTestId('zoom-pct')).toHaveText(`${Math.round(v1.k * 100)}%`);
    // fit: all parts visible inside the workspace
    await page.getByTestId('fit').click();
    await page.waitForTimeout(700);
    for (const id of ['pi', 'r1', 'led1', 'r2']) {
      const b = (await page.getByTestId(`comp-${id}`).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(ws.x - 1);
      expect(b.y).toBeGreaterThanOrEqual(ws.y - 1);
      expect(b.x + b.width).toBeLessThanOrEqual(ws.x + ws.width + 1);
      expect(b.y + b.height).toBeLessThanOrEqual(ws.y + ws.height + 1);
    }
    // minimap is shown
    await expect(page.getByTestId('minimap')).toBeVisible();
  });

  test('C5 workspace shortcuts do not fire while typing in the Python editor', async ({ page }) => {
    await boot(page);
    await loadCircuit(page);
    await page.getByTestId('comp-r1').click();
    await page.getByTestId('tab-python').click();
    const ed = page.locator('.cm-content');
    await ed.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n# r R l f');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('ArrowRight');
    await page.getByTestId('tab-circuit').click();
    const r1 = await comp(page, 'r1');
    expect(r1.rotation).toBe(0);
    expect(r1.locked).toBeFalsy();
    expect(await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.components.length)).toBe(4);
    const code = await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.files[0].content);
    expect(code).toContain('# r R l f');
  });
});

test.describe('D · wire editing', () => {
  test('D1–D6 colour, bend points, auto-route and thickness from the wire context menu', async ({ page }) => {
    const errors = await boot(page);
    await loadCircuit(page);
    // D1 colour via right-click menu
    let m = await wireMid(page, 'w2');
    await page.mouse.click(m.x, m.y, { button: 'right' });
    await expect(page.getByTestId('wire-menu')).toBeVisible();
    await page.getByTestId('ctx-color-orange').click();
    expect((await wire(page, 'w2')).color).toBe('#ef7d22');
    await expect(page.getByTestId('wire-w2')).toHaveAttribute('data-color', '#ef7d22');
    // custom colour from the inspector hex field
    await page.getByTestId('wire-color-hex').fill('#123abc');
    expect((await wire(page, 'w2')).color).toBe('#123abc');
    // D2 add a bend point by double-clicking the wire
    m = await wireMid(page, 'w1');
    await page.mouse.dblclick(m.x, m.y);
    await expect(page.getByTestId('wire-w1')).toHaveAttribute('data-bends', '1');
    // D3 drag the bend point
    const h = page.getByTestId('bend-w1-0');
    const hb = (await h.boundingBox())!;
    const p0 = (await wire(page, 'w1')).points[0];
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 50, hb.y + hb.height / 2 + 70, { steps: 8 });
    await page.mouse.up();
    const p1 = (await wire(page, 'w1')).points[0];
    expect(p1.x).toBeGreaterThan(p0.x);
    expect(p1.y).toBeGreaterThan(p0.y);
    // D4 remove it by double-clicking the handle
    const hb2 = (await page.getByTestId('bend-w1-0').boundingBox())!;
    await page.mouse.dblclick(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
    await expect(page.getByTestId('wire-w1')).toHaveAttribute('data-bends', '0');
    // D5 auto-route
    m = await wireMid(page, 'w3');
    await page.mouse.click(m.x, m.y, { button: 'right' });
    await page.getByTestId('ctx-autoroute').click();
    await expect(page.getByTestId('wire-w3')).toHaveAttribute('data-route', 'orthogonal');
    const segs = await page.locator('[data-testid="wire-w3"] .wire-line').getAttribute('d');
    const pts = segs!.split(/[ML]/).filter(Boolean).map((s) => s.trim().split(' ').map(Number));
    for (let i = 0; i + 1 < pts.length; i++) expect(pts[i][0] === pts[i + 1][0] || pts[i][1] === pts[i + 1][1]).toBe(true);
    // D6 thickness
    m = await wireMid(page, 'w3');
    await page.mouse.click(m.x, m.y, { button: 'right' });
    await page.getByTestId('ctx-width-5').click();
    await expect(page.getByTestId('wire-w3')).toHaveAttribute('data-width', '5');
    expect(await page.locator('[data-testid="wire-w3"] .wire-line').evaluate((p) => getComputedStyle(p).strokeWidth)).toBe('5px');
    // 45° and 90° route styles from the inspector
    await page.getByTestId('wire-route').selectOption('diag45');
    await expect(page.getByTestId('wire-w3')).toHaveAttribute('data-route', 'diag45');
    expect(errors).toEqual([]);
  });

  test('D7 moving a part keeps wires attached; D9 crossing wires are not connected', async ({ page }) => {
    await boot(page);
    await loadCircuit(page);
    const box = (await page.getByTestId('comp-r1').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 90, { steps: 10 });
    await page.mouse.up();
    // the wire end is drawn exactly on the moved pin
    const ok = await page.evaluate(() => {
      const pin = document.querySelector('[data-comp="r1"][data-pin="1"]') as SVGRectElement;
      const pr = pin.getBoundingClientRect();
      const path = document.querySelector('[data-testid="wire-w1"] .wire-line') as SVGPathElement;
      const end = path.getPointAtLength(path.getTotalLength());
      const ctm = path.getScreenCTM()!;
      const ex = end.x * ctm.a + end.y * ctm.c + ctm.e;
      const ey = end.x * ctm.b + end.y * ctm.d + ctm.f;
      return Math.hypot(ex - (pr.x + pr.width / 2), ey - (pr.y + pr.height / 2));
    });
    expect(ok).toBeLessThan(2);
    // w4 crosses w1/w2 visually: a crossing marker is drawn and the nets stay separate
    expect(await page.getByTestId('wire-crossing').count()).toBeGreaterThan(0);
    const sep = await page.evaluate(() => {
      const s = (window as any).__rpi5sim.sim;
      return s.net.netOf({ comp: 'r2', pin: '1' }) !== s.net.netOf({ comp: 'r1', pin: '1' }) && s.net.netOf({ comp: 'r2', pin: '1' }) !== s.net.netOf({ comp: 'led1', pin: 'A' });
    });
    expect(sep).toBe(true);
  });

  test('D8 wire colours, bends, routes and thickness survive save + page reload', async ({ page }) => {
    await boot(page);
    await loadCircuit(page);
    await page.evaluate(() => {
      const st = (window as any).__rpi5sim.useApp.getState();
      st.updateWire('w1', { color: '#8b5a2b', width: 4, points: [{ x: 300, y: 300 }], route: 'orthogonal' });
      st.updateWire('w2', { color: '#a020f0', route: 'diag45' });
      st.setView({ showGpioNumbers: true, background: '#202830' });
    });
    await page.evaluate(() => (window as any).__rpi5sim.saveNow());
    await page.reload();
    await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().doc.name === 'Wire editing test', null, { timeout: 60_000 });
    const w1 = await wire(page, 'w1');
    const w2 = await wire(page, 'w2');
    expect(w1).toMatchObject({ color: '#8b5a2b', width: 4, points: [{ x: 300, y: 300 }], route: 'orthogonal' });
    expect(w2).toMatchObject({ color: '#a020f0', route: 'diag45' });
    expect(await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.view)).toMatchObject({ showGpioNumbers: true, background: '#202830' });
    await expect(page.getByTestId('wire-w1')).toHaveAttribute('data-color', '#8b5a2b');
  });

  test('part context menu: lock, group, align; copy/paste and undo', async ({ page }) => {
    await boot(page);
    await loadCircuit(page);
    const b = (await page.getByTestId('comp-led1').boundingBox())!;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
    await page.getByTestId('ctx-lock').click();
    expect((await comp(page, 'led1')).locked).toBe(true);
    const before = await comp(page, 'led1');
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 140, b.y + 90, { steps: 6 });
    await page.mouse.up();
    expect((await comp(page, 'led1')).x).toBe(before.x);
    // multi-select + align top through the toolbar
    await page.getByTestId('comp-r1').click();
    // w4 ends on R2's left pin and runs across its thin body: shift-click the lower edge of R2
    const rb = (await page.getByTestId('comp-r2').boundingBox())!;
    await page.keyboard.down('Shift');
    await page.mouse.click(rb.x + rb.width * 0.7, rb.y + rb.height - 2);
    await page.keyboard.up('Shift');
    expect(await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().selection)).toEqual(['r1', 'r2']);
    await page.getByTestId('align-top').click();
    const [r1, r2] = [await comp(page, 'r1'), await comp(page, 'r2')];
    expect(r1.y).toBe(r2.y);
    await page.getByTestId('undo').click();
    expect((await comp(page, 'r2')).y).toBe(520);
    // copy / paste with the keyboard
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    expect(await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.components.length)).toBe(6);
  });
});
