// Static (connectivity-level) electrical rule checks. Dynamic checks that need
// voltages/currents live in each part's post() and run on every solve.

import { I2C1, ONEWIRE_DEFAULT_PIN, PI5_HEADER, SPI0, UART_PORTS } from './pi5';
import { getPart, hasPart, pinsOf } from './parts';
import type { Simulator } from './simulator';
import type { Issue, Severity } from './types';

export function validateStatic(sim: Simulator): Issue[] {
  const out: Issue[] = [];
  const add = (code: string, severity: Severity, comps: string[], params: Record<string, string | number> = {}, pins: { comp: string; pin: string }[] = []) =>
    out.push({ code, severity, comps, params, pins, key: `${code}|${comps.join(',')}|${JSON.stringify(params)}` });
  const { doc, net } = sim;
  const netOf = (comp: string, pin: string) => net.netOf({ comp, pin });
  const pis = doc.components.filter((c) => c.type === 'rpi5');
  if (pis.length > 1) add('W_MULTIPLE_PI', 'warning', pis.slice(1).map((p) => p.id));
  const pi = sim.pi();

  if (pi) {
    const n = (phys: number) => netOf(pi.id, `P${phys}`);
    const gnd = n(6);
    const v33 = n(1);
    const v5 = n(2);
    if (v33 === gnd) add('E_SHORT_RAIL', 'error', [pi.id], { rail: '3.3V', amps: '∞' }, [{ comp: pi.id, pin: 'P1' }]);
    if (v5 === gnd) add('E_SHORT_RAIL', 'error', [pi.id], { rail: '5V', amps: '∞' }, [{ comp: pi.id, pin: 'P2' }]);
    if (v5 === v33) add('E_RAILS_SHORTED', 'error', [pi.id], {}, [{ comp: pi.id, pin: 'P1' }, { comp: pi.id, pin: 'P2' }]);
    for (const h of PI5_HEADER) {
      if (h.bcm === null) continue;
      const g = n(h.physical);
      if (g === v5) add('E_GPIO_TO_5V', 'error', [pi.id], { pin: h.bcm, phys: h.physical }, [{ comp: pi.id, pin: `P${h.physical}` }]);
      // external supply + directly on a GPIO
      for (const c of doc.components)
        if (c.type === 'power_supply' && netOf(c.id, 'P') === g)
          add('E_GPIO_EXTERNAL_SUPPLY', 'error', [c.id, pi.id], { pin: h.bcm, v: sim.propsOf(c).volts }, [{ comp: c.id, pin: 'P' }]);
    }
  }

  const tx0 = net.gpioNet.get(14);
  const rx0 = net.gpioNet.get(15);
  const sda = net.gpioNet.get(I2C1.sda);
  const scl = net.gpioNet.get(I2C1.scl);
  const i2cByAddr = new Map<number, string[]>();

  for (const c of doc.components) {
    if (!hasPart(c.type)) continue;
    const m = getPart(c.type);
    const props = sim.propsOf(c);
    const pinIds = pinsOf(m, props).map((p) => p.id);
    const has = (p: string) => pinIds.includes(p);

    // both leads of a 2-terminal part in the same breadboard strip
    if (['led', 'resistor', 'diode', 'buzzer', 'capacitor'].includes(c.type)) {
      const [a, b] = pinIds;
      const na = netOf(c.id, a);
      if (na >= 0 && na === netOf(c.id, b) && net.nets[na].pins.length > 2) add('W_SHORTED_PART', 'warning', [c.id], {}, [{ comp: c.id, pin: a }, { comp: c.id, pin: b }]);
    }

    // UART TX/RX crossing
    if (has('TX') && has('RX') && pi) {
      const dtx = netOf(c.id, 'TX');
      const drx = netOf(c.id, 'RX');
      if (tx0 !== undefined && dtx === tx0) add('E_UART_TX_TX', 'error', [c.id, pi.id], {}, [{ comp: c.id, pin: 'TX' }]);
      if (rx0 !== undefined && drx === rx0) add('E_UART_RX_RX', 'error', [c.id, pi.id], {}, [{ comp: c.id, pin: 'RX' }]);
      for (const [port, def] of Object.entries(UART_PORTS)) {
        if (port === '/dev/serial0' || port === '/dev/ttyAMA0') continue;
        if (net.gpioNet.get(def.tx) === dtx && dtx >= 0) add('E_UART_TX_TX', 'error', [c.id, pi.id], {}, [{ comp: c.id, pin: 'TX' }]);
      }
    }
    // I2C
    if (has('SDA') && has('SCL')) {
      const ds = netOf(c.id, 'SDA');
      const dc = netOf(c.id, 'SCL');
      if (sda !== undefined && scl !== undefined && ds === scl && dc === sda) add('E_I2C_SWAPPED', 'error', [c.id], {}, [{ comp: c.id, pin: 'SDA' }, { comp: c.id, pin: 'SCL' }]);
      if (ds === sda && dc === scl && ds >= 0) {
        const dev = m.device || m.bus === 'i2c' ? sim.device(c.id) : null;
        const addr = dev?.i2cAddress ? dev.i2cAddress() : Number(props.address);
        i2cByAddr.set(addr, [...(i2cByAddr.get(addr) ?? []), c.id]);
      }
      const gp = [ds, dc].map((x) => [...net.gpioNet].find(([, nn]) => nn === x)?.[0]).filter((x) => x !== undefined) as number[];
      if (gp.length && !(ds === sda && dc === scl) && !(ds === scl && dc === sda)) add('W_I2C_WRONG_PINS', 'warning', [c.id], { pins: gp.join(', ') });
    }
    // SPI (MCP3008)
    if (c.type === 'mcp3008' && pi) {
      const g = net.gpioNet;
      if (netOf(c.id, 'DIN') === g.get(SPI0.miso) && netOf(c.id, 'DOUT') === g.get(SPI0.mosi)) add('E_SPI_SWAPPED', 'error', [c.id], {}, [{ comp: c.id, pin: 'DIN' }, { comp: c.id, pin: 'DOUT' }]);
      const cs = netOf(c.id, 'CS');
      const anyWired = ['CLK', 'DIN', 'DOUT'].some((p) => [...g.values()].includes(netOf(c.id, p)));
      if (anyWired && cs !== g.get(8) && cs !== g.get(7)) add('W_SPI_CS', 'warning', [c.id], {}, [{ comp: c.id, pin: 'CS' }]);
    }
    // 1-Wire
    if (c.type === 'ds18b20' && pi) {
      const dq = netOf(c.id, 'DQ');
      const onewire = !!sim.piProps()?.onewire;
      const g4 = net.gpioNet.get(ONEWIRE_DEFAULT_PIN);
      if (dq >= 0 && net.nets[dq].comps.size > 1) {
        if (!onewire) add('I_ONEWIRE_DISABLED', 'info', [c.id, pi.id]);
        else if (dq !== g4) add('W_ONEWIRE_PIN', 'warning', [c.id], {}, [{ comp: c.id, pin: 'DQ' }]);
        if (!hasPullupResistor(sim, dq, 10000)) add('W_ONEWIRE_PULLUP', 'warning', [c.id], {}, [{ comp: c.id, pin: 'DQ' }]);
      }
    }
    if (c.type === 'dht22' || c.type === 'dht11' || c.type === 'am2302') {
      const d = netOf(c.id, 'DATA');
      if (d >= 0 && net.nets[d].comps.size > 1 && !hasPullupResistor(sim, d, 20000)) add('W_DHT_PULLUP', 'warning', [c.id], {}, [{ comp: c.id, pin: 'DATA' }]);
    }
    // common ground for parts that talk to the Pi
    if (pi && has('GND') && c.type !== 'rpi5' && !['power_supply'].includes(c.type)) {
      const sig = pinIds.filter((p) => !['GND', 'VCC', 'AGND', 'DGND', 'VDD', 'VREF'].includes(p));
      const talksToPi = sig.some((p) => [...net.gpioNet.values()].includes(netOf(c.id, p)));
      const g = netOf(c.id, c.type === 'mcp3008' ? 'DGND' : 'GND');
      if (talksToPi && g !== net.groundNet) add('W_NO_COMMON_GROUND', 'warning', [c.id], {}, [{ comp: c.id, pin: c.type === 'mcp3008' ? 'DGND' : 'GND' }]);
    }
    // low-side switch must share ground with the Pi
    if (pi && (c.type === 'mosfet' || c.type === 'npn')) {
      const ctl = c.type === 'mosfet' ? 'G' : 'B';
      const ret = c.type === 'mosfet' ? 'S' : 'E';
      const ctlNets = reachViaResistor(sim, netOf(c.id, ctl));
      const driven = [...net.gpioNet.values()].some((n) => ctlNets.has(n));
      if (driven && netOf(c.id, ret) !== net.groundNet) add('W_NO_COMMON_GROUND', 'warning', [c.id], {}, [{ comp: c.id, pin: ret }]);
    }
    // flyback diode for inductive loads switched by a transistor
    if (m.inductive && m.loadPins) {
      const [lp, ln] = m.loadPins;
      const np = netOf(c.id, lp);
      const nn = netOf(c.id, ln);
      const switched = doc.components.some(
        (s) => (s.type === 'mosfet' && netOf(s.id, 'D') === nn) || (s.type === 'npn' && netOf(s.id, 'C') === nn),
      );
      if (switched) {
        const hasDiode = doc.components.some((d) => d.type === 'diode' && netOf(d.id, 'K') === np && netOf(d.id, 'A') === nn);
        if (!hasDiode) add('W_NO_FLYBACK', 'warning', [c.id], {}, [{ comp: c.id, pin: lp }]);
      }
    }
  }
  for (const [addr, ids] of i2cByAddr) if (ids.length > 1) add('E_I2C_ADDR_CONFLICT', 'error', ids, { addr: `0x${addr.toString(16)}` });

  // pins wired to something but not used by the running program
  if (pi && sim.running) {
    for (const [bcm, netId] of net.gpioNet) {
      const others = [...net.nets[netId].comps].filter((id) => id !== pi.id);
      if (!others.length) continue;
      if (sim.claims.has(bcm)) continue;
      const names = others.map((id) => sim.comp(id)?.label || getPart(sim.comp(id)!.type).name).slice(0, 2).join(', ');
      add('I_GPIO_NOT_IN_CODE', 'info', others, { pin: bcm, parts: names });
    }
    for (const [bcm, owner] of sim.claims) {
      if (owner.startsWith('w1') || owner.startsWith('serial') || owner.startsWith('spi')) continue;
      if (!net.gpioNet.has(bcm) || ![...net.nets[net.gpioNet.get(bcm)!].comps].some((id) => id !== pi.id))
        add('I_GPIO_UNCONNECTED', 'info', [pi.id], { pin: bcm, owner });
    }
  }
  return out.concat(sim.getRuntimeIssues());
}

/** Nets reachable from netId through at most one resistor. */
function reachViaResistor(sim: Simulator, netId: number): Set<number> {
  const out = new Set<number>([netId]);
  if (netId < 0) return out;
  for (const c of sim.doc.components) {
    if (c.type !== 'resistor') continue;
    const a = sim.net.netOf({ comp: c.id, pin: '1' });
    const b = sim.net.netOf({ comp: c.id, pin: '2' });
    if (a === netId) out.add(b);
    if (b === netId) out.add(a);
  }
  return out;
}

/** True if a resistor ≤ maxOhms (a separate resistor or a module pull-up) ties the net to a supply ≥ 2.8 V. */
export function hasPullupResistor(sim: Simulator, netId: number, maxOhms: number): boolean {
  const r = sim.mainResult();
  const node = sim.nodeOfNet(netId, r);
  if (node === null || node < 0) return false;
  for (const e of r.c.elems) {
    if (e.owner === sim.net.piId) continue;
    if (e.k === 'R' && e.r <= maxOhms) {
      const other = e.a === node ? e.b : e.b === node ? e.a : null;
      if (other !== null && r.sol.volt(other) >= 2.8) return true;
    }
    if (e.k === 'V' && e.a === node && e.rint <= maxOhms && e.v >= 2.8) return true;
  }
  return false;
}
