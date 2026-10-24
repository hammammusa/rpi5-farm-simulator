// Acceptance tests F (export) in the real browser: image formats, tables, complete PDF, ZIP.
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__rpi5sim?.useApp.getState().runtimeState === 'ready', null, { timeout: 120_000 });
  // Pi + LED on GPIO17 through a resistor, a DHT22 on GPIO4, and a relay placed far outside the view
  await page.evaluate(() => {
    const S = (window as any).__rpi5sim;
    const d = S.newProject('Export test');
    d.description = 'Greenhouse node: LED status light, DHT22 climate sensor, pump relay.';
    d.components = [
      { id: 'pi', type: 'rpi5', x: 40, y: 40, rotation: 0, props: {} },
      { id: 'r1', type: 'resistor', x: 520, y: 380, rotation: 0, props: { ohms: 330 } },
      { id: 'led1', type: 'led', x: 680, y: 360, rotation: 0, props: {} },
      { id: 'dht', type: 'dht22', x: 520, y: 520, rotation: 0, props: {} },
      { id: 'far', type: 'relay_module', x: 3000, y: 2000, rotation: 0, props: {} },
    ];
    d.wires = [
      { id: 'w1', from: { comp: 'pi', pin: 'P11' }, to: { comp: 'r1', pin: '1' }, color: '#e6b800' },
      { id: 'w2', from: { comp: 'r1', pin: '2' }, to: { comp: 'led1', pin: 'A' }, color: '#2b7bd6' },
      { id: 'w3', from: { comp: 'led1', pin: 'K' }, to: { comp: 'pi', pin: 'P6' }, color: '#2b2b2b' },
      { id: 'w4', from: { comp: 'pi', pin: 'P1' }, to: { comp: 'dht', pin: 'VCC' }, color: '#e0393e' },
      { id: 'w5', from: { comp: 'pi', pin: 'P7' }, to: { comp: 'dht', pin: 'DATA' }, color: '#2e9d4f' },
      { id: 'w6', from: { comp: 'dht', pin: 'GND' }, to: { comp: 'pi', pin: 'P9' }, color: '#2b2b2b' },
      { id: 'w7', from: { comp: 'pi', pin: 'P13' }, to: { comp: 'far', pin: 'IN1' }, color: '#8e5bd6' },
      { id: 'w8', from: { comp: 'pi', pin: 'P2' }, to: { comp: 'far', pin: 'VCC' }, color: '#e0393e' },
      { id: 'w9', from: { comp: 'pi', pin: 'P14' }, to: { comp: 'far', pin: 'GND' }, color: '#2b2b2b' },
    ];
    d.files = [{ name: 'main.py', content: 'from gpiozero import LED, OutputDevice\nimport adafruit_dht, board\nled = LED(17)\npump = OutputDevice(27, active_high=False)\ndht = adafruit_dht.DHT22(board.D4)\n' }];
    S.useApp.getState().loadProject(d);
  });
  await page.getByTestId('export-btn').click();
  await expect(page.getByTestId('export-preview')).toBeVisible();
  return errors;
}

async function save(page: Page, testid: string) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByTestId(testid).click()]);
  const path = await d.path();
  return { name: d.suggestedFilename(), buf: readFileSync(path!) };
}

const pngSize = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
const pdfPages = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page /g) ?? []).length;

test('F1/F4/F11 PNG: whole circuit at high resolution, including parts far outside the view, with wire colours', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.getByTestId('export-image-info')).toContainText('5 components · 9 wires');
  await page.getByTestId('exp-scale').selectOption('2');
  const png = await save(page, 'export-image');
  expect(png.name).toBe('Export_test-circuit.png');
  expect(png.buf.subarray(1, 4).toString()).toBe('PNG');
  const { w, h } = pngSize(png.buf);
  // the relay sits at x=3000,y=2000 — the image must reach it (2 px per unit)
  expect(w).toBeGreaterThan(2 * 3000);
  expect(h).toBeGreaterThan(2 * 2000);
  // wire colours are really painted: count yellow (#e6b800) and purple (#8e5bd6) pixels
  const counts = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let yellow = 0;
    let purple = 0;
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, bl] = [px[i], px[i + 1], px[i + 2]];
      if (Math.abs(r - 0xe6) < 12 && Math.abs(g - 0xb8) < 12 && bl < 30) yellow++;
      if (Math.abs(r - 0x8e) < 12 && Math.abs(g - 0x5b) < 12 && Math.abs(bl - 0xd6) < 12) purple++;
    }
    return { yellow, purple };
  }, png.buf.toString('base64'));
  expect(counts.yellow).toBeGreaterThan(300);
  expect(counts.purple).toBeGreaterThan(300);
  expect(errors).toEqual([]);
});

test('F2/F5 SVG: valid vector file with every wire, its colour, part names, IDs and pin labels; background options', async ({ page }) => {
  await boot(page);
  await page.getByTestId('exp-format').selectOption('svg');
  const svg = (await save(page, 'export-image')).buf.toString('utf8');
  const check = await page.evaluate((s) => {
    const d = new DOMParser().parseFromString(s, 'image/svg+xml');
    const q = (sel: string) => [...d.querySelectorAll(sel)];
    return {
      parseError: !!d.querySelector('parsererror'),
      wires: q('[data-export-wire]').map((g) => `${g.getAttribute('data-export-wire')}=${g.getAttribute('data-color')}`),
      names: q('[data-export-name]').map((g) => g.textContent),
      pins: q('[data-export-pin]').map((g) => g.textContent),
      parts: q('[data-cid]').map((g) => g.getAttribute('data-cid')),
      bg: d.querySelector('[data-export="background"]')?.getAttribute('fill') ?? null,
    };
  }, svg);
  expect(check.parseError).toBe(false);
  expect(check.wires.sort()).toEqual(['w1=#e6b800', 'w2=#2b7bd6', 'w3=#2b2b2b', 'w4=#e0393e', 'w5=#2e9d4f', 'w6=#2b2b2b', 'w7=#8e5bd6', 'w8=#e0393e', 'w9=#2b2b2b']);
  expect(check.parts.sort()).toEqual(['dht', 'far', 'led1', 'pi', 'r1']);
  expect(check.names.join(' ')).toMatch(/Raspberry Pi 5.*pi/);
  expect(check.names.join(' ')).toContain('far');
  expect(check.pins).toEqual(expect.arrayContaining(['GPIO17 · 11', 'GPIO4 · 7', 'GND · 6', '3V3 · 1', 'IN1']));
  expect(check.bg).toBe('#ffffff');
  // transparent: no background; dark background; no labels
  await page.getByTestId('exp-bg').selectOption('transparent');
  await page.getByTestId('exp-labels').uncheck();
  const t = (await save(page, 'export-image')).buf.toString('utf8');
  expect(t).not.toContain('data-export="background"');
  expect(t).not.toContain('data-export-pin');
  await page.getByTestId('exp-bg').selectOption('dark');
  expect((await save(page, 'export-image')).buf.toString('utf8')).toContain('fill="#11171d"');
});

test('selected-components export contains only the selection', async ({ page }) => {
  await boot(page);
  await page.getByTestId('export-close').click();
  await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().select(['pi', 'dht']));
  await page.getByTestId('export-btn').click();
  await page.getByTestId('exp-scope').selectOption('selected');
  await expect(page.getByTestId('export-image-info')).toContainText('2 components · 3 wires');
  await page.getByTestId('exp-format').selectOption('svg');
  const svg = (await save(page, 'export-image')).buf.toString('utf8');
  expect(svg).toContain('data-cid="dht"');
  expect(svg).not.toContain('data-cid="led1"');
});

test('F3 PDF image of the circuit', async ({ page }) => {
  await boot(page);
  await page.getByTestId('exp-format').selectOption('pdf');
  const pdf = await save(page, 'export-image');
  expect(pdf.name).toBe('Export_test-circuit.pdf');
  expect(pdf.buf.subarray(0, 8).toString()).toBe('%PDF-1.4');
  expect(pdfPages(pdf.buf)).toBe(1);
  expect(pdf.buf.toString('latin1')).toContain('/Subtype /Image');
});

test('F6/F7/F8/F12 wiring, GPIO and BOM tables match the circuit', async ({ page }) => {
  await boot(page);
  const table = page.getByTestId('export-table');
  await expect(table).toHaveAttribute('data-rows', '9');
  for (const w of ['w1', 'w5', 'w7']) await expect(table).toContainText(w);
  await expect(table.locator('tr', { hasText: 'w5' })).toContainText('GPIO4');
  await expect(table.locator('tr', { hasText: 'w5' })).toContainText('DHT22');
  await page.getByTestId('exp-tab-gpio').click();
  await expect(table.locator('tr', { hasText: 'GPIO17' })).toContainText('Output');
  await expect(table.locator('tr', { hasText: 'GPIO17' })).toContainText('led = LED');
  await expect(table.locator('tr', { hasText: 'GPIO27' })).toContainText('pump = OutputDevice');
  await expect(table.locator('tr', { hasText: 'GPIO4' })).toContainText('Bidirectional');
  await page.getByTestId('exp-tab-bom').click();
  await expect(table.locator('tr', { hasText: 'Jumper wires' })).toContainText('9');
  const csv = (await save(page, 'export-csv')).buf.toString('utf8');
  expect(csv.split('\r\n')[0]).toContain('Assembly notes');
  const xlsx = unzipSync(new Uint8Array((await save(page, 'export-xlsx')).buf));
  expect(strFromU8(xlsx['xl/workbook.xml'])).toMatch(/Wiring.*Nets.*GPIO allocation.*Bill of materials.*Power/);
  expect(strFromU8(xlsx['xl/worksheets/sheet1.xml'])).toContain('w7');
});

test('F9 complete project documentation PDF in English and Arabic', async ({ page }) => {
  await boot(page);
  const en = await save(page, 'export-pdf-doc');
  expect(en.name).toBe('Export_test-documentation-en.pdf');
  const text = en.buf.toString('latin1');
  expect(pdfPages(en.buf)).toBeGreaterThanOrEqual(6);
  // the invisible text layer makes the English report searchable: check all 15 sections
  for (const s of [
    '1. Project title',
    '2. Project description',
    '3. Export date',
    '4. Raspberry Pi model',
    '5. Circuit diagram',
    '6. Components list',
    '7. Wiring table',
    '8. Raspberry Pi 5 GPIO allocation',
    '9. Power requirements',
    '10. Electrical warnings',
    '11. Python code',
    '12. Required real-hardware libraries',
    '13. Execution instructions',
    '14. Known simulation limitations',
    '15. Assembly checklist',
    'Greenhouse node',
  ])
    expect(text, s).toContain(`(${s}`);
  await expect(page.getByTestId('export-status')).toContainText('pages');
  await page.getByTestId('exp-lang').selectOption('ar');
  const ar = await save(page, 'export-pdf-doc');
  expect(ar.name).toBe('Export_test-documentation-ar.pdf');
  expect(pdfPages(ar.buf)).toBeGreaterThanOrEqual(6);
});

test('F10 full ZIP with code, image, tables and documentation; it re-imports', async ({ page }) => {
  await boot(page);
  const zip = await save(page, 'export-zip-full');
  const z = unzipSync(new Uint8Array(zip.buf));
  expect(Object.keys(z)).toEqual(
    expect.arrayContaining([
      'README.md',
      'REAL_HARDWARE.md',
      'project.json',
      'simulation.json',
      'code/main.py',
      'circuit/circuit.png',
      'circuit/circuit.svg',
      'wiring/wiring.csv',
      'wiring/wiring.xlsx',
      'wiring/gpio_allocation.csv',
      'bom/bom.csv',
      'docs/project.pdf',
    ]),
  );
  expect(strFromU8(z['code/main.py'])).toContain('led = LED(17)');
  expect(strFromU8(z['REAL_HARDWARE.md'])).toContain('gpiozero');
  expect(strFromU8(z['README.md'])).toContain('python3 main.py');
  // round trip through Projects → Import
  await page.getByTestId('export-close').click();
  await page.getByTestId('tab-projects').click();
  await page.getByTestId('import-input').setInputFiles({ name: 'Export_test-project.zip', mimeType: 'application/zip', buffer: zip.buf });
  await expect.poll(() => page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.components.length)).toBe(5);
  const wires = await page.evaluate(() => (window as any).__rpi5sim.useApp.getState().doc.wires.map((w: any) => w.color));
  expect(wires).toHaveLength(9);
});
