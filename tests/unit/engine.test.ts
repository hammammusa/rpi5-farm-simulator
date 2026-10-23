import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../../src/engine/project';
import { Simulator } from '../../src/engine/simulator';
import { Circuit, GND, solve } from '../../src/engine/solver';
import { compH, compP, compT, rawFor } from '../../src/engine/devices/bme280';
import { Mcp3008 } from '../../src/engine/devices/mcp3008';
import { mhzChecksum } from '../../src/engine/devices/mhz19';

const codes = (s: Simulator) => s.issues.map((i) => i.code);

function ledCircuit(gpioPhys = 11, withGround = true) {
  const b = new CircuitBuilder()
    .add('pi', 'rpi5', 0, 0)
    .add('r1', 'resistor', 400, 300, { ohms: 330 })
    .add('led1', 'led', 500, 300, { color: 'red' })
    .wire(`pi.P${gpioPhys}`, 'r1.1')
    .wire('r1.2', 'led1.A');
  if (withGround) b.wire('led1.K', 'pi.P6');
  return new Simulator(b.doc());
}

describe('solver', () => {
  it('solves a divider', () => {
    const c = new Circuit(2);
    c.addV('s', 'v', 0, GND, 10, 0.001);
    c.addR('r', 'a', 0, 1, 1000);
    c.addR('r', 'b', 1, GND, 1000);
    const s = solve(c);
    expect(s.volt(1)).toBeCloseTo(5, 2);
  });
  it('turns a forward-biased diode on', () => {
    const c = new Circuit(2);
    c.addV('s', 'v', 0, GND, 3.3, 0.001);
    c.addR('r', 'r', 0, 1, 330);
    c.addD('d', 'd', 1, GND, 1.9, 15);
    const s = solve(c);
    expect(s.cur('d:d') * 1000).toBeGreaterThan(3.5);
    expect(s.cur('d:d') * 1000).toBeLessThan(4.5);
  });
});

describe('GPIO + LED', () => {
  it('LED on GPIO17 lights only when GPIO17 is HIGH (Test 1)', () => {
    const s = ledCircuit(11);
    s.programStart();
    s.gpioSetup(17, 'output', 'none', 'LED');
    expect(s.vis.get('led1')!.brightness).toBe(0);
    s.gpioWrite(17, 1);
    expect(s.vis.get('led1')!.brightness).toBeGreaterThan(0.3);
    expect(s.vis.get('led1')!.ma).toBeGreaterThan(3);
    s.gpioWrite(17, 0);
    expect(s.vis.get('led1')!.brightness).toBe(0);
  });

  it('LED wired to GPIO18 ignores GPIO17 (Test 2)', () => {
    const s = ledCircuit(12);
    s.programStart();
    s.gpioSetup(17, 'output', 'none', 'LED');
    s.gpioWrite(17, 1);
    expect(s.vis.get('led1')!.brightness).toBe(0);
    expect(codes(s)).toContain('I_GPIO_NOT_IN_CODE');
    expect(codes(s)).toContain('I_GPIO_UNCONNECTED');
  });

  it('missing ground leaves the LED dark with an open-circuit note (Test 3)', () => {
    const s = ledCircuit(11, false);
    s.programStart();
    s.gpioSetup(17, 'output', 'none', 'LED');
    s.gpioWrite(17, 1);
    expect(s.vis.get('led1')!.brightness).toBe(0);
    expect(codes(s)).toContain('W_OPEN_CIRCUIT');
  });

  it('LED without resistor warns about current', () => {
    const doc = new CircuitBuilder().add('pi', 'rpi5', 0, 0).add('led1', 'led', 500, 300).wire('pi.P11', 'led1.A').wire('led1.K', 'pi.P6').doc();
    const s = new Simulator(doc);
    s.programStart();
    s.gpioSetup(17, 'output', 'none', 'LED');
    s.gpioWrite(17, 1);
    expect(codes(s)).toContain('W_LED_NO_RESISTOR');
    expect(codes(s)).toContain('W_GPIO_OVERCURRENT');
  });

  it('PWM dims the LED proportionally', () => {
    const s = ledCircuit(11);
    s.programStart();
    s.gpioSetup(17, 'output', 'none', 'PWMLED');
    s.gpioPwm(17, 100, 1);
    const full = s.vis.get('led1')!.brightness;
    s.gpioPwm(17, 100, 0.25);
    const quarter = s.vis.get('led1')!.brightness;
    expect(quarter).toBeGreaterThan(full * 0.15);
    expect(quarter).toBeLessThan(full * 0.35);
  });
});

describe('inputs', () => {
  it('button with pull-up reads LOW when pressed', () => {
    const doc = new CircuitBuilder().add('pi', 'rpi5', 0, 0).add('b1', 'button', 500, 300).wire('pi.P11', 'b1.1a').wire('b1.2a', 'pi.P6').doc();
    const s = new Simulator(doc);
    s.programStart();
    s.gpioSetup(17, 'input', 'up', 'Button');
    s.gpioWatch(17, true);
    expect(s.gpioRead(17).value).toBe(1);
    s.pressButton('b1', true);
    expect(s.gpioRead(17).value).toBe(0);
    expect(s.takeEvents().some((e) => e.k === 'edge' && e.v === 0)).toBe(true);
  });

  it('floating input is reported', () => {
    const doc = new CircuitBuilder().add('pi', 'rpi5', 0, 0).add('b1', 'button', 500, 300).wire('pi.P11', 'b1.1a').doc();
    const s = new Simulator(doc);
    s.programStart();
    s.gpioSetup(17, 'input', 'none', 'Button');
    expect(s.gpioRead(17).floating).toBe(true);
  });
});

describe('electrical safety', () => {
  it('12 V supply on a GPIO is an error (Test 10)', () => {
    const doc = new CircuitBuilder()
      .add('pi', 'rpi5', 0, 0)
      .add('ps', 'power_supply', 500, 300, { volts: 12 })
      .wire('ps.P', 'pi.P11')
      .wire('ps.N', 'pi.P6')
      .doc();
    const s = new Simulator(doc);
    expect(codes(s)).toContain('E_GPIO_OVERVOLTAGE');
    expect(codes(s)).toContain('E_GPIO_EXTERNAL_SUPPLY');
  });

  it('3V3 shorted to GND trips the rail', () => {
    const doc = new CircuitBuilder().add('pi', 'rpi5', 0, 0).add('r', 'resistor', 300, 300, { ohms: 10 }).wire('pi.P1', 'r.1').wire('r.2', 'pi.P9').doc();
    const s = new Simulator(doc);
    expect(codes(s)).not.toContain('E_SHORT_RAIL'); // 330 mA through 10 Ω is a heavy load but not a short
    const doc2 = new CircuitBuilder().add('pi', 'rpi5', 0, 0).wire('pi.P1', 'pi.P9').doc();
    expect(codes(new Simulator(doc2))).toContain('E_SHORT_RAIL');
  });

  it('pump driven straight from a GPIO is flagged and does not run', () => {
    const doc = new CircuitBuilder().add('pi', 'rpi5', 0, 0).add('p', 'water_pump', 500, 300).wire('pi.P11', 'p.P').wire('p.N', 'pi.P6').doc();
    const s = new Simulator(doc);
    s.programStart();
    s.gpioSetup(17, 'output', 'none', 'OutputDevice');
    s.gpioWrite(17, 1);
    expect(codes(s)).toContain('E_GPIO_DRIVES_LOAD');
    expect(s.vis.get('p')!.run).toBe(0);
  });
});

function relayPumpDoc(trigger = 'low') {
  return new CircuitBuilder()
    .add('pi', 'rpi5', 0, 0)
    .add('rl', 'relay_module', 450, 50, { trigger })
    .add('ps', 'power_supply', 450, 300, { volts: 12 })
    .add('p', 'water_pump', 700, 250)
    .wire('pi.P2', 'rl.VCC')
    .wire('pi.P6', 'rl.GND')
    .wire('pi.P11', 'rl.IN1')
    .wire('ps.P', 'rl.COM1')
    .wire('rl.NO1', 'p.P')
    .wire('p.N', 'ps.N')
    .doc();
}

describe('relay + pump (Test 12)', () => {
  it('active-LOW relay energises when GPIO is LOW and runs the pump', () => {
    const s = new Simulator(relayPumpDoc('low'));
    s.programStart();
    s.gpioSetup(17, 'output', 'none', 'OutputDevice', 1);
    expect(s.vis.get('rl')!.ch[0].energised).toBe(false);
    expect(s.vis.get('p')!.run).toBe(0);
    s.gpioWrite(17, 0);
    expect(s.vis.get('rl')!.ch[0].energised).toBe(true);
    expect(s.vis.get('p')!.run).toBeGreaterThan(0.9);
  });
  it('active-HIGH relay energises with GPIO HIGH', () => {
    const s = new Simulator(relayPumpDoc('high'));
    s.programStart();
    s.gpioSetup(17, 'output', 'none', 'OutputDevice', 0);
    expect(s.vis.get('p')!.run).toBe(0);
    s.gpioWrite(17, 1);
    expect(s.vis.get('p')!.run).toBeGreaterThan(0.9);
  });
});

describe('analog + ADC (Test 11)', () => {
  it('pH sensor straight on a GPIO reports a missing ADC', () => {
    const doc = new CircuitBuilder()
      .add('pi', 'rpi5', 0, 0)
      .add('ph', 'ph_sensor', 500, 300)
      .wire('pi.P2', 'ph.VCC')
      .wire('pi.P6', 'ph.GND')
      .wire('ph.AO', 'pi.P11')
      .doc();
    expect(codes(new Simulator(doc))).toContain('E_ANALOG_NO_ADC');
  });

  it('pH through MCP3008 reads back the configured value', () => {
    const doc = new CircuitBuilder()
      .add('pi', 'rpi5', 0, 0)
      .add('adc', 'mcp3008', 500, 100)
      .add('ph', 'ph_sensor', 500, 300, { ph: 6.5 })
      .wire('pi.P1', 'adc.VDD')
      .wire('pi.P1', 'adc.VREF')
      .wire('pi.P6', 'adc.AGND')
      .wire('pi.P6', 'adc.DGND')
      .wire('pi.P23', 'adc.CLK')
      .wire('pi.P21', 'adc.DOUT')
      .wire('pi.P19', 'adc.DIN')
      .wire('pi.P24', 'adc.CS')
      .wire('pi.P2', 'ph.VCC')
      .wire('pi.P6', 'ph.GND')
      .wire('ph.AO', 'adc.CH0')
      .doc();
    const s = new Simulator(doc);
    expect(codes(s)).not.toContain('E_ANALOG_NO_ADC');
    s.programStart();
    s.spiOpen(0, 0);
    const r = s.spiXfer(0, [1, 0x80, 0]);
    const code = ((r[1] & 3) << 8) | r[2];
    const volts = (code / 1023) * 3.3;
    // V = pH / 3.5 with a 1 kΩ source into a 10 MΩ-ish ADC input
    expect(volts * 3.5).toBeGreaterThan(6.4);
    expect(volts * 3.5).toBeLessThan(6.6);
  });
});

describe('device protocols', () => {
  it('BME280 inverse compensation round-trips', () => {
    const { adcT, adcP, adcH } = rawFor(24.5, 1007.3, 61.2);
    const { t, tfine } = compT(adcT);
    expect(t).toBeCloseTo(24.5, 1);
    expect(compP(adcP, tfine) / 100).toBeCloseTo(1007.3, 0);
    expect(compH(adcH, tfine)).toBeCloseTo(61.2, 0);
  });
  it('MCP3008 bit protocol', () => {
    const m = new Mcp3008((_s, ch) => (ch === 3 ? 777 : 0));
    const r = m.spiXfer([1, (8 + 3) << 4, 0]);
    expect(((r[1] & 3) << 8) | r[2]).toBe(777);
  });
  it('MH-Z19B checksum of the read command is 0x79', () => {
    expect(mhzChecksum([0xff, 0x01, 0x86, 0, 0, 0, 0, 0, 0])).toBe(0x79);
  });
});
