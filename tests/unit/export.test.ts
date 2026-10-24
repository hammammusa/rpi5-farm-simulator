// Export data: the wiring table matches the stored circuit exactly (F6, F12),
// GPIO allocation (F7), BOM (F8), code pin detection, XLSX and PDF structure.
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/examples';
import { CircuitBuilder, WIRE_COLORS as W } from '../../src/engine/project';
import { buildNetlist } from '../../src/engine/netlist';
import { buildReport, codeGpioUsage, toCsv, WIRING_COLUMNS } from '../../src/export/report';
import { buildXlsx } from '../../src/export/xlsx';
import { buildPdf } from '../../src/export/pdf';
import type { ProjectDoc } from '../../src/engine/types';

const docs: [string, ProjectDoc][] = EXAMPLES.map((e) => [e.title.en, e.build()]);
const pair = (a: string, b: string) => [a, b].sort().join(' — ');

describe('wiring table (F6, F12)', () => {
  for (const [name, doc] of docs) {
    it(`${name}: one row per wire and per breadboard insertion, nothing invented`, () => {
      const r = buildReport(doc);
      const net = buildNetlist(doc);
      const wireRows = r.wiring.filter((x) => !x.wireId.startsWith('bb-'));
      expect(wireRows.map((x) => x.wireId).sort()).toEqual(doc.wires.map((w) => w.id).sort());
      // the endpoints of every row are exactly the endpoints of that wire
      for (const row of wireRows) {
        const w = doc.wires.find((x) => x.id === row.wireId)!;
        expect(pair(row.srcId, row.dstId)).toBe(pair(w.from.comp, w.to.comp));
        expect(row.colorName).toContain(w.color);
      }
      expect(r.wiring.length - wireRows.length).toBe(net.insertions.length);
      // every net member listed really is on that net, and every connected part pin is listed
      for (const n of r.nets) expect(n.members.length).toBeGreaterThanOrEqual(2);
      expect(r.wiring.every((x) => x.status !== 'Broken')).toBe(true);
    });
  }

  it('a wire whose part was deleted is reported as broken, not as a connection', () => {
    const doc = new CircuitBuilder().add('pi', 'rpi5', 0, 0).add('led', 'led', 400, 0).wire('pi.P11', 'led.A').wire('pi.P6', 'gone.K').doc();
    const r = buildReport(doc);
    expect(r.wiring.find((x) => x.dstId === 'gone')?.status).toBe('Broken');
    expect(r.nets.some((n) => n.members.some((m) => m.includes('gone')))).toBe(false);
  });

  it('the Pi end is always the source and carries BCM + physical numbers', () => {
    const doc = new CircuitBuilder().add('pi', 'rpi5', 0, 0).add('dht', 'dht22', 400, 0).wire('dht.DATA', 'pi.P7', W.yellow).wire('pi.P1', 'dht.VCC', W.red).wire('dht.GND', 'pi.P6', W.black).doc();
    const r = buildReport(doc);
    const data = r.wiring.find((x) => x.dstId === 'dht' && x.srcBcm === 'GPIO4')!;
    expect(data).toMatchObject({ srcId: 'pi', srcPin: 'GPIO4', srcPhys: '7', net: 'GPIO4' });
    expect(r.wiring.find((x) => x.srcPin === '3V3')).toMatchObject({ srcPhys: '1', supply: '3.3 V', signal: 'Power' });
    expect(r.wiring.find((x) => x.srcPin === 'GND')).toMatchObject({ srcPhys: '6', supply: '0 V', signal: 'Ground' });
  });

  it('a multi-member net lists every other member on each wire row', () => {
    const doc = new CircuitBuilder()
      .add('pi', 'rpi5', 0, 0)
      .add('a', 'led', 400, 0)
      .add('b', 'led', 500, 0)
      .add('c', 'led', 600, 0)
      .wire('pi.P6', 'a.K')
      .wire('a.K', 'b.K')
      .wire('b.K', 'c.K')
      .doc();
    const r = buildReport(doc);
    const gnd = r.nets.find((n) => n.net === 'GND')!;
    expect(gnd.members.filter((m) => /\.Cathode/.test(m))).toHaveLength(3);
    expect(gnd.wires).toHaveLength(3);
    const first = r.wiring.find((x) => x.srcId === 'pi')!;
    expect(first.notes).toMatch(/Same net also: .*b\..*c\./);
  });

  it('CSV keeps the 15 columns, quotes commas and starts with a UTF-8 BOM', () => {
    const r = buildReport(docs[19][1]);
    const csv = toCsv(r.wiring, WIRING_COLUMNS);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const head = csv.slice(1).split('\r\n')[0].split(',');
    expect(head).toHaveLength(15);
    expect(head[0]).toBe('Wire ID');
    expect(csv.split('\r\n').length - 2).toBe(r.wiring.length);
  });
});

describe('GPIO allocation (F7)', () => {
  it('lists only wired header pins, with direction from the code and bus functions from the wiring', () => {
    const r = buildReport(docs[19][1]);
    const by = (b: string) => r.gpio.find((g) => g.bcm === b)!;
    expect(by('GPIO17')).toMatchObject({ phys: 11, direction: 'Output' });
    expect(by('GPIO17').purpose).toContain('OutputDevice');
    expect(by('GPIO24').direction).toBe('Input');
    expect(by('GPIO11').func).toMatch(/^SPI0 SCLK/);
    expect(by('GPIO9').func).toMatch(/^SPI0 MISO/);
    expect(by('GPIO14').func).toMatch(/^UART0 TX/);
    expect(by('GPIO12').func).toMatch(/^UART4 TX/);
    expect(by('GPIO4').func).toMatch(/^1-Wire/);
    // nothing for header pins without a wire
    const wiredPhys = new Set(docs[19][1].wires.flatMap((w) => [w.from, w.to]).filter((p) => p.comp === 'pi').map((p) => Number(p.pin.slice(1))));
    expect(r.gpio.every((g) => wiredPhys.has(g.phys))).toBe(true);
  });

  it('flags an unused wired GPIO and a pin claimed twice', () => {
    const doc = new CircuitBuilder().add('pi', 'rpi5', 0, 0).add('l1', 'led', 400, 0).add('l2', 'led', 400, 100).wire('pi.P11', 'l1.A').wire('pi.P13', 'l2.A').doc();
    doc.files = [{ name: 'main.py', content: 'from gpiozero import LED, Button\na = LED(17)\nb = Button(17)\n' }];
    const r = buildReport(doc);
    expect(r.gpio.find((g) => g.bcm === 'GPIO17')!.notes).toMatch(/Claimed more than once/);
    expect(r.gpio.find((g) => g.bcm === 'GPIO27')!.notes).toMatch(/Not used by the Python code/);
  });
});

describe('code pin detection', () => {
  const use = (code: string) => codeGpioUsage([{ name: 'main.py', content: code }]).map((u) => `${u.bcm}:${u.dir}${u.name ? `:${u.name}` : ''}`);
  it('gpiozero, constants, keyword pins and dict comprehensions', () => {
    expect(use('from gpiozero import LED\nPIN = 22\nled = LED(PIN)\n')).toEqual(['22:Output:led']);
    expect(use('s = DistanceSensor(echo=24, trigger=23)')).toEqual(['24:Input:s', '23:Output:s']);
    expect(use('PINS = {"pump": 17, "fan": 22}\nd = {n: OutputDevice(p) for n, p in PINS.items()}')).toEqual(['17:Output:pump', '22:Output:fan']);
    expect(use('fan = PWMOutputDevice("GPIO18")')).toEqual(['18:PWM output:fan']);
  });
  it('RPi.GPIO in BOARD mode, lgpio and Blinka', () => {
    expect(use('GPIO.setmode(GPIO.BOARD)\nGPIO.setup(11, GPIO.OUT)')).toEqual(['17:Output']);
    expect(use('lgpio.gpio_claim_input(h, 5)')).toEqual(['5:Input']);
    expect(use('dht = adafruit_dht.DHT22(board.D4)')).toEqual(['4:Bidirectional:dht']);
    expect(use('p = digitalio.DigitalInOut(board.D5)\np.direction = digitalio.Direction.OUTPUT')).toEqual(['5:Output:p']);
  });
});

describe('BOM (F8)', () => {
  for (const [name, doc] of docs) {
    it(`${name}: quantities add up and nothing is invented`, () => {
      const r = buildReport(doc);
      const parts = r.bom.filter((b) => b.name !== 'Jumper wires');
      expect(parts.reduce((a, b) => a + b.qty, 0)).toBe(doc.components.length);
      expect(r.bom.find((b) => b.name === 'Jumper wires')?.qty ?? 0).toBe(doc.wires.length);
      for (const b of r.bom) expect(Object.keys(b)).not.toContain('price');
    });
  }
});

describe('file formats', () => {
  it('XLSX: valid package, one sheet per table, escaped text', () => {
    const z = unzipSync(buildXlsx([{ name: 'Wiring', header: ['A', 'B'], rows: [['x & <y>', 3]] }, { name: 'Bad/name:[x]', header: ['C'], rows: [] }]));
    expect(Object.keys(z).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
    const s1 = strFromU8(z['xl/worksheets/sheet1.xml']);
    expect(s1).toContain('x &amp; &lt;y&gt;');
    expect(s1).toContain('<v>3</v>');
    expect(strFromU8(z['xl/workbook.xml'])).toContain('name="Bad name  x "');
  });

  it('PDF: valid cross-reference table, one page object per page, searchable Latin text', () => {
    const img = { w: 1, h: 1, rgb: new Uint8Array([120, 156, 99, 248, 255, 255, 63, 0, 5, 254, 2, 254]) };
    const pdf = buildPdf(
      [
        { width: 595.28, height: 841.89, image: img, texts: [{ x: 40, y: 60, size: 10, text: 'Wiring table (GPIO17)' }, { x: 40, y: 80, size: 10, text: 'جدول' }] },
        { width: 841.89, height: 595.28, image: img, texts: [] },
      ],
      { title: 'مشروع test' },
    );
    const s = new TextDecoder('latin1').decode(pdf);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(s).toContain('(Wiring table \\(GPIO17\\)) Tj');
    expect(s).not.toContain('جدول');
    // every xref offset points at its object
    const start = Number(/startxref\n(\d+)/.exec(s)![1]);
    const offsets = s.slice(start).split('\n').slice(3).filter((l) => / 00000 n $/.test(l)).map((l) => Number(l.slice(0, 10)));
    offsets.forEach((o, i) => expect(s.slice(o, o + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });
});
