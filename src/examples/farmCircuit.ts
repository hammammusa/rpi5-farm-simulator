// Shared hardware for the advanced farm examples and the competition practice project.
//
// Pin plan (Raspberry Pi 5, BCM):
//   UART0  GPIO14/15  Nextion NX3224K028 (9600 baud)
//   UART4  GPIO12/13  MH-Z19B CO2 sensor (dtoverlay=uart4 on a real Pi)
//   SPI0   GPIO8-11   MCP3008: CH0 pH, CH1 EC, CH2 water-level (analog)
//   GPIO16            DHT22 air temperature / humidity
//   GPIO4             DS18B20 water temperature (1-Wire, dtoverlay=w1-gpio)
//   GPIO24            float switch (low-water protection, closed = water OK)
//   GPIO17/27/22/23   4-channel relay: pump, grow light, fan, heater (active-LOW)
//   GPIO5/6           2-channel relay: dosing pump A, dosing pump B (active-LOW)
import { WIRE_COLORS as W, type CircuitBuilder } from '../engine/project';
import { base } from './types';

export interface FarmOpts {
  nextion?: boolean;
  co2?: boolean;
  dosing?: boolean;
  analog?: boolean;
}

export function farmCircuit(o: FarmOpts = {}): CircuitBuilder {
  const b = base('Farm');
  // relays and loads
  b.add('rl4', 'relay_module', 470, 40, { channels: 4, trigger: 'low', coil: 5 }, 0, 'Relay ×4');
  b.add('ps', 'power_supply', 470, 250, { volts: 12, amps: 15 }, 0, '12 V 15 A');
  b.add('pump', 'water_pump', 700, 0, { role: 'circulation', rate: 4 }, 0, 'Circulation pump');
  b.add('light', 'grow_light', 700, 90, { role: 'grow_light', watts: 36 }, 0, 'Grow light');
  b.add('fan', 'fan', 850, 60, { role: 'fan' }, 0, 'Fan');
  b.add('heater', 'heater', 700, 150, { role: 'heater', watts: 40 }, 0, 'Heater');
  b.wire('pi.P2', 'rl4.VCC', W.red, '5V').wire('pi.P14', 'rl4.GND', W.black);
  b.wire('pi.P11', 'rl4.IN1', W.orange, 'GPIO17 pump').wire('pi.P13', 'rl4.IN2', W.yellow, 'GPIO27 light').wire('pi.P15', 'rl4.IN3', W.green, 'GPIO22 fan').wire('pi.P16', 'rl4.IN4', W.purple, 'GPIO23 heater');
  const loads: [string, number][] = [
    ['pump', 1],
    ['light', 2],
    ['fan', 3],
    ['heater', 4],
  ];
  for (const [id, ch] of loads) {
    b.wire('ps.P', `rl4.COM${ch}`, W.red);
    b.wire(`rl4.NO${ch}`, `${id}.P`, W.red);
    b.wire(`${id}.N`, 'ps.N', W.black);
  }
  if (o.dosing !== false) {
    b.add('rl2', 'relay_module', 470, 360, { channels: 2, trigger: 'low', coil: 5 }, 0, 'Relay ×2 (dosing)');
    b.add('doseA', 'dosing_pump', 700, 300, { role: 'dose_a', rate: 100 }, 0, 'Dosing pump A');
    b.add('doseB', 'dosing_pump', 800, 300, { role: 'dose_b', rate: 100 }, 0, 'Dosing pump B');
    b.wire('pi.P4', 'rl2.VCC', W.red).wire('pi.P34', 'rl2.GND', W.black);
    b.wire('pi.P29', 'rl2.IN1', W.orange, 'GPIO5 dose A').wire('pi.P31', 'rl2.IN2', W.yellow, 'GPIO6 dose B');
    b.wire('ps.P', 'rl2.COM1', W.red).wire('rl2.NO1', 'doseA.P', W.red).wire('doseA.N', 'ps.N', W.black);
    b.wire('ps.P', 'rl2.COM2', W.red).wire('rl2.NO2', 'doseB.P', W.red).wire('doseB.N', 'ps.N', W.black);
  }
  // sensors
  b.components[0].props.onewire = true; // dtoverlay=w1-gpio (GPIO4)
  b.add('wtemp', 'ds18b20', 380, 360, { source: 'farm', module: true }, 0, 'DS18B20 water');
  b.wire('pi.P1', 'wtemp.VCC', W.red).wire('pi.P7', 'wtemp.DQ', W.yellow, 'GPIO4 1-Wire').wire('pi.P9', 'wtemp.GND', W.black);
  b.add('dht', 'dht22', 40, 360, { source: 'farm' }, 0, 'DHT22');
  b.wire('pi.P17', 'dht.VCC', W.red, '3V3').wire('pi.P36', 'dht.DATA', W.yellow, 'GPIO16').wire('pi.P39', 'dht.GND', W.black);
  b.add('float', 'float_switch', 110, 380, { source: 'farm', trigger: 15, mode: 'closed_high' }, 0, 'Float switch');
  b.wire('pi.P18', 'float.1', W.blue, 'GPIO24').wire('float.2', 'pi.P20', W.black);
  if (o.analog !== false) {
    b.add('adc', 'mcp3008', 200, 380, {}, 0, 'MCP3008');
    b.wire('pi.P1', 'adc.VDD', W.red).wire('pi.P1', 'adc.VREF', W.red).wire('pi.P25', 'adc.AGND', W.black).wire('pi.P25', 'adc.DGND', W.black);
    b.wire('pi.P23', 'adc.CLK', W.purple).wire('pi.P21', 'adc.DOUT', W.green).wire('pi.P19', 'adc.DIN', W.blue).wire('pi.P24', 'adc.CS', W.orange);
    b.add('ph', 'ph_sensor', 200, 470, { source: 'farm' }, 0, 'pH');
    b.add('ec', 'ec_sensor', 260, 470, { source: 'farm' }, 0, 'EC');
    b.add('lvl', 'water_level_analog', 320, 470, { source: 'farm' }, 0, 'Level');
    for (const [id, ch] of [
      ['ph', 0],
      ['ec', 1],
      ['lvl', 2],
    ] as const) {
      b.wire('pi.P4', `${id}.VCC`, W.red).wire('pi.P30', `${id}.GND`, W.black).wire(`${id}.AO`, `adc.CH${ch}`, W.yellow);
    }
  }
  if (o.co2) {
    b.add('co2', 'mhz19b', 400, 470, { source: 'farm' }, 0, 'MH-Z19B');
    b.wire('pi.P4', 'co2.VCC', W.red).wire('pi.P9', 'co2.GND', W.black).wire('pi.P32', 'co2.RX', W.green, 'GPIO12 TX4').wire('pi.P33', 'co2.TX', W.blue, 'GPIO13 RX4');
  }
  if (o.nextion) {
    b.add('nx', 'nextion', 900, 380, { baud: 9600 }, 0, 'Nextion 2.8"');
    b.wire('pi.P2', 'nx.VCC', W.red, '5V').wire('pi.P6', 'nx.GND', W.black).wire('pi.P8', 'nx.RX', W.green, 'TX').wire('pi.P10', 'nx.TX', W.blue, 'RX');
  }
  return b;
}
