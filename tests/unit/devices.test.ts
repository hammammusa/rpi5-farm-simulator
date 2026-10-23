import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../../src/engine/project';
import { Simulator } from '../../src/engine/simulator';
import { makeComponent, type NextionProject } from '../../src/engine/devices/nextion';
import { FarmModel, defaultFarmConfig } from '../../src/engine/farm';

const enc = (s: string) => [...new TextEncoder().encode(s), 0xff, 0xff, 0xff];

function nextionDoc(crossed = true) {
  const nx: NextionProject = { model: 'NX3224K028', width: 320, height: 240, pages: [{ id: 0, name: 'page0', bco: 65535, components: [] }, { id: 1, name: 'settings', bco: 0, components: [] }] };
  const p0 = nx.pages[0];
  p0.components.push(makeComponent(p0, 'text', 10, 10));
  p0.components.push(makeComponent(p0, 'button', 10, 60));
  p0.components.push(makeComponent(p0, 'number', 10, 120));
  const b = new CircuitBuilder()
    .add('pi', 'rpi5', 0, 0)
    .add('nx', 'nextion', 500, 0)
    .wire('pi.P2', 'nx.VCC')
    .wire('pi.P6', 'nx.GND');
  if (crossed) b.wire('pi.P8', 'nx.RX').wire('pi.P10', 'nx.TX');
  else b.wire('pi.P8', 'nx.TX').wire('pi.P10', 'nx.RX');
  const doc = b.doc();
  doc.nextion = nx;
  return doc;
}

function later(s: Simulator, dt: number) {
  return s.clock.now() + dt;
}

describe('UART + Nextion (Test 6)', () => {
  it('Python text assignment updates the screen; touch reaches the Pi', () => {
    const s = new Simulator(nextionDoc());
    s.programStart();
    s.uartOpen('/dev/serial0', 9600);
    // startup bytes 00 00 00 FF FF FF 88 FF FF FF arrive ~0.3 s after power-up
    s.uartFlushInput('/dev/serial0');
    s.uartWrite('/dev/serial0', enc('t0.txt="Pump ON"'));
    s.uartWrite('/dev/serial0', enc('n0.val=42'));
    const nx = s.device('nx') as any;
    expect(nx.liveOf(0, 't0').attrs.txt).toBe('Pump ON');
    expect(nx.liveOf(0, 'n0').attrs.val).toBe(42);
    s.nextionTouch('nx', 'b0', true);
    const bytes = s.uartRead('/dev/serial0', 64, later(s, 1));
    expect(bytes).toEqual([0x65, 0x00, 0x02, 0x01, 0xff, 0xff, 0xff]);
  });

  it('get returns 0x71 + little-endian number; bad attribute returns 0x1A', () => {
    const s = new Simulator(nextionDoc());
    s.programStart();
    s.uartOpen('/dev/serial0', 9600);
    s.uartFlushInput('/dev/serial0');
    s.uartWrite('/dev/serial0', enc('n0.val=300'));
    s.uartWrite('/dev/serial0', enc('get n0.val'));
    s.uartWrite('/dev/serial0', enc('t0.nope=1'));
    const b = s.uartRead('/dev/serial0', 64, later(s, 1));
    expect(b.slice(0, 8)).toEqual([0x71, 44, 1, 0, 0, 0xff, 0xff, 0xff]);
    expect(b.slice(8)).toEqual([0x1a, 0xff, 0xff, 0xff]);
  });

  it('TX↔TX wiring is flagged and nothing arrives', () => {
    const s = new Simulator(nextionDoc(false));
    expect(s.issues.map((i) => i.code)).toContain('E_UART_TX_TX');
    s.programStart();
    s.uartOpen('/dev/serial0', 9600);
    s.uartWrite('/dev/serial0', enc('t0.txt="x"'));
    expect((s.device('nx') as any).liveOf(0, 't0').attrs.txt).toBe('text');
  });

  it('baud mismatch garbles commands', () => {
    const s = new Simulator(nextionDoc());
    s.programStart();
    s.uartOpen('/dev/serial0', 115200);
    s.uartWrite('/dev/serial0', enc('t0.txt="x"'));
    expect((s.device('nx') as any).liveOf(0, 't0').attrs.txt).toBe('text');
  });

  it('page change resets local components', () => {
    const s = new Simulator(nextionDoc());
    s.programStart();
    s.uartOpen('/dev/serial0', 9600);
    s.uartWrite('/dev/serial0', enc('t0.txt="A"'));
    s.uartWrite('/dev/serial0', enc('page settings'));
    s.uartWrite('/dev/serial0', enc('page 0'));
    expect((s.device('nx') as any).liveOf(0, 't0').attrs.txt).toBe('text');
  });
});

describe('MH-Z19B over UART', () => {
  it('answers the 0x86 read command', () => {
    const doc = new CircuitBuilder()
      .add('pi', 'rpi5', 0, 0)
      .add('co2', 'mhz19b', 500, 0, { co2: 812 })
      .wire('pi.P4', 'co2.VCC')
      .wire('pi.P6', 'co2.GND')
      .wire('pi.P8', 'co2.RX')
      .wire('pi.P10', 'co2.TX')
      .doc();
    const s = new Simulator(doc);
    s.programStart();
    s.uartOpen('/dev/serial0', 9600);
    s.uartWrite('/dev/serial0', [0xff, 0x01, 0x86, 0, 0, 0, 0, 0, 0x79]);
    const r = s.uartRead('/dev/serial0', 9, later(s, 1));
    expect(r.length).toBe(9);
    expect(r[0]).toBe(0xff);
    expect(r[1]).toBe(0x86);
    expect(r[2] * 256 + r[3]).toBe(812);
  });
});

describe('farm model', () => {
  it('dosing 10 ml at 100 ml/min takes 6 s and raises EC', () => {
    const cfg = defaultFarmConfig();
    const f = new FarmModel(cfg, 0);
    const ec0 = f.state.reservoir.ec;
    f.drives = [{ comp: 'a', role: 'dose_a', run: 1, rate: 100, watts: 3 }];
    f.advanceTo(6);
    f.drives = [];
    f.advanceTo(10);
    expect(f.state.totals.doseAml).toBeCloseTo(10, 1);
    expect(f.state.reservoir.ec).toBeGreaterThan(ec0);
  });
  it('dosing A and B together raises the latched alarm', () => {
    const f = new FarmModel(defaultFarmConfig(), 0);
    f.drives = [
      { comp: 'a', role: 'dose_a', run: 1, rate: 100, watts: 3 },
      { comp: 'b', role: 'dose_b', run: 1, rate: 100, watts: 3 },
    ];
    f.advanceTo(2);
    f.drives = [];
    f.advanceTo(5);
    expect(f.state.alarms.map((a) => a.id)).toContain('AB_SIMULTANEOUS');
  });
  it('circulation pump runs dry when the reservoir is empty', () => {
    const cfg = defaultFarmConfig();
    cfg.reservoir.volumeL = 1;
    const f = new FarmModel(cfg, 0);
    f.drives = [{ comp: 'p', role: 'circulation', run: 1, rate: 4, watts: 6 }];
    f.advanceTo(10);
    expect(f.state.flowLpm).toBe(0);
    expect(f.state.alarms.map((a) => a.id)).toContain('PUMP_DRY_RUN');
  });
});
