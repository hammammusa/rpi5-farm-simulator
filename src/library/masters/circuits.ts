// The three COMPETITION MASTER circuits: Raspberry Pi 5, ESP32 and Wiren Board 7.4 running the
// same smart farm (same sensors, same loads, same thresholds). Each builder returns a complete,
// pre-wired project with its program; the library arranges the layout when it opens.
import { CircuitBuilder, WIRE_COLORS as W } from '../../engine/project';
import type { ProjectDoc } from '../../engine/types';
import { masterNextionTemplate } from '../../examples/nextionTemplates';
import { PI_INDEX_HTML, PI_MAIN } from './piCode';
import { ESP_MAIN } from './espCode';
import { WB_RULES } from './wbCode';

/** loads shared by the three projects: [id, type, props, label] */
const LOADS = {
  pump: ['water_pump', { role: 'circulation', rate: 4 }, 'Main pump 12 V'],
  fan: ['fan', { role: 'fan' }, 'Fan 12 V'],
  light: ['grow_light', { role: 'grow_light', watts: 36 }, 'Grow light 12 V'],
  doseA: ['dosing_pump', { role: 'dose_a', rate: 120 }, 'Dosing pump A'],
  doseB: ['dosing_pump', { role: 'dose_b', rate: 120 }, 'Dosing pump B'],
} as const;

function addLoad(b: CircuitBuilder, id: keyof typeof LOADS, x: number, y: number) {
  const [type, props, label] = LOADS[id];
  return b.add(id, type, x, y, { ...props }, 0, label);
}

/** alarm indicator: 12 V lamp modelled as an LED with a 2.2 kΩ series resistor */
function addAlarmLamp(b: CircuitBuilder, x: number, y: number) {
  return b.add('ralarm', 'resistor', x, y + 20, { ohms: 2200 }, 0, '2.2 kΩ').add('lamp', 'led', x + 90, y, { color: 'red' }, 0, 'Alarm lamp');
}

/** a load switched by a relay contact: supply + → COM, NO → load +, load − → supply − */
function switched(b: CircuitBuilder, ps: string, com: string, no: string, loadP: string, loadN: string, color: string) {
  return b.wire(`${ps}.P`, com, W.red).wire(no, loadP, color).wire(loadN, `${ps}.N`, W.black);
}

function finishDoc(b: CircuitBuilder, name: string, id: string): ProjectDoc {
  const d = b.doc({ name });
  d.exampleId = id;
  d.farm = { ...d.farm, enabled: true };
  return d;
}

// ====================================================================== Raspberry Pi 5
// BCM plan: GPIO16 DHT22 · UART0 GPIO14/15 MH-Z19B · SPI0 MCP3008 (CH0 pH, CH1 EC, CH2 level,
// CH3 ACS712) · GPIO17 pump, GPIO22 fan, GPIO27 light, GPIO23 alarm lamp (4-ch relay) ·
// GPIO5 dose A, GPIO6 dose B (2-ch relay) · GPIO26 DOSING button, GPIO19 TEST button.
export function piMasterCircuit(): ProjectDoc {
  const b = new CircuitBuilder().add('pi', 'rpi5', 20, 60, {}, 0, 'Raspberry Pi 5');
  // sensors
  b.add('dht', 'dht22', 260, -160, { source: 'farm' }, 0, 'DHT22');
  b.wire('pi.P1', 'dht.VCC', W.red, '3V3').wire('pi.P36', 'dht.DATA', W.yellow, 'GPIO16').wire('dht.GND', 'pi.P39', W.black);
  b.add('co2', 'mhz19b', 360, -160, { source: 'farm' }, 0, 'MH-Z19B CO₂');
  b.wire('pi.P2', 'co2.VCC', W.red, '5V').wire('co2.GND', 'pi.P6', W.black).wire('pi.P8', 'co2.RX', W.green, 'GPIO14 TX').wire('co2.TX', 'pi.P10', W.blue, 'GPIO15 RX');
  b.add('adc', 'mcp3008', 260, 300, {}, 0, 'MCP3008');
  b.wire('pi.P17', 'adc.VDD', W.red, '3V3').wire('pi.P17', 'adc.VREF', W.red).wire('adc.AGND', 'pi.P25', W.black).wire('adc.DGND', 'pi.P25', W.black);
  b.wire('pi.P23', 'adc.CLK', W.purple, 'SCLK').wire('adc.DOUT', 'pi.P21', W.green, 'MISO').wire('pi.P19', 'adc.DIN', W.blue, 'MOSI').wire('pi.P24', 'adc.CS', W.orange, 'CE0');
  b.add('ph', 'ph_sensor', 460, -160, { source: 'farm' }, 0, 'pH');
  b.add('ec', 'ec_sensor', 540, -160, { source: 'farm' }, 0, 'EC');
  b.add('lvl', 'water_level_analog', 620, -160, { source: 'farm' }, 0, 'Water level');
  for (const [id, ch] of [['ph', 0], ['ec', 1], ['lvl', 2]] as const) b.wire('pi.P4', `${id}.VCC`, W.red).wire(`${id}.GND`, 'pi.P30', W.black).wire(`${id}.AO`, `adc.CH${ch}`, W.yellow, `CH${ch}`);
  b.add('cur', 'acs712', 700, 40, { range: 5 }, 0, 'ACS712 pump current');
  b.wire('pi.P4', 'cur.VCC', W.red).wire('cur.GND', 'pi.P34', W.black).wire('cur.OUT', 'adc.CH3', W.yellow, 'CH3');
  // relays (active HIGH, 5 V coils)
  b.add('rl4', 'relay_module', 460, 40, { channels: 4, trigger: 'high', coil: 5 }, 0, 'Relay ×4');
  b.wire('pi.P2', 'rl4.VCC', W.red).wire('rl4.GND', 'pi.P14', W.black);
  b.wire('pi.P11', 'rl4.IN1', W.orange, 'GPIO17 pump').wire('pi.P15', 'rl4.IN2', W.orange, 'GPIO22 fan').wire('pi.P13', 'rl4.IN3', W.orange, 'GPIO27 light').wire('pi.P16', 'rl4.IN4', W.orange, 'GPIO23 alarm');
  b.add('rl2', 'relay_module', 460, 260, { channels: 2, trigger: 'high', coil: 5 }, 0, 'Relay ×2 (dosing)');
  b.wire('pi.P4', 'rl2.VCC', W.red).wire('rl2.GND', 'pi.P34', W.black);
  b.wire('pi.P29', 'rl2.IN1', W.orange, 'GPIO5 dose A').wire('pi.P31', 'rl2.IN2', W.orange, 'GPIO6 dose B');
  // loads on the 12 V supply
  b.add('ps', 'power_supply', 460, 420, { volts: 12, amps: 10 }, 0, '12 V 10 A');
  addLoad(b, 'pump', 860, 0);
  b.wire('ps.P', 'rl4.COM1', W.red).wire('rl4.NO1', 'cur.IPP', W.red).wire('cur.IPN', 'pump.P', W.red).wire('pump.N', 'ps.N', W.black);
  addLoad(b, 'fan', 860, 100);
  switched(b, 'ps', 'rl4.COM2', 'rl4.NO2', 'fan.P', 'fan.N', W.red);
  addLoad(b, 'light', 860, 200);
  switched(b, 'ps', 'rl4.COM3', 'rl4.NO3', 'light.P', 'light.N', W.red);
  addAlarmLamp(b, 700, 160);
  b.wire('ps.P', 'rl4.COM4', W.red).wire('rl4.NO4', 'ralarm.1', W.red).wire('ralarm.2', 'lamp.A', W.red).wire('lamp.K', 'ps.N', W.black);
  addLoad(b, 'doseA', 700, 280);
  switched(b, 'ps', 'rl2.COM1', 'rl2.NO1', 'doseA.P', 'doseA.N', W.red);
  addLoad(b, 'doseB', 800, 280);
  switched(b, 'ps', 'rl2.COM2', 'rl2.NO2', 'doseB.P', 'doseB.N', W.red);
  // mode buttons to GND (internal pull-ups)
  b.add('btnDose', 'button', 260, 440, {}, 0, 'DOSING button');
  b.wire('pi.P37', 'btnDose.1a', W.green, 'GPIO26').wire('btnDose.2a', 'pi.P39', W.black);
  b.add('btnTest', 'button', 320, 440, {}, 0, 'TEST button');
  b.wire('pi.P35', 'btnTest.1a', W.green, 'GPIO19').wire('btnTest.2a', 'pi.P20', W.black);

  const d = finishDoc(b, 'COMPETITION MASTER 01 — Raspberry Pi 5 Smart Farm', 'master-pi5');
  d.files = [
    { name: 'main.py', content: PI_MAIN },
    { name: 'templates/index.html', content: PI_INDEX_HTML },
  ];
  d.mainFile = 'main.py';
  return d;
}

// ====================================================================== ESP32
// ADC1 only (works with Wi-Fi on): GPIO36 pH, GPIO39 EC, GPIO34 level, GPIO35 ACS712 ·
// GPIO4 DHT22 · UART2 (TX17/RX16) MH-Z19B · UART1 (TX18/RX19) Nextion · GPIO26 pump, GPIO27 fan,
// GPIO14 light, GPIO13 alarm (4-ch relay) · GPIO25 dose A, GPIO33 dose B (2-ch relay) ·
// GPIO23 DOSING button, GPIO32 TEST button. 5 V parts on their own 5 V supply, common GND.
export function espMasterCircuit(): ProjectDoc {
  const b = new CircuitBuilder().add('esp', 'esp32_devkitc', 40, 60, {}, 0, 'ESP32');
  b.add('ps5', 'power_supply', 40, 420, { volts: 5, amps: 3 }, 0, '5 V 3 A');
  b.wire('ps5.N', 'esp.GND1', W.black, 'common GND');
  // sensors
  b.add('dht', 'dht22', 260, -160, { source: 'farm' }, 0, 'DHT22');
  b.wire('esp.3V3', 'dht.VCC', W.red, '3V3').wire('dht.DATA', 'esp.IO4', W.yellow, 'GPIO4').wire('dht.GND', 'esp.GND3', W.black);
  b.add('co2', 'mhz19b', 360, -160, { source: 'farm' }, 0, 'MH-Z19B CO₂');
  b.wire('ps5.P', 'co2.VCC', W.red, '5V').wire('co2.GND', 'ps5.N', W.black).wire('esp.IO17', 'co2.RX', W.green, 'TX2 GPIO17').wire('co2.TX', 'esp.IO16', W.blue, 'RX2 GPIO16');
  b.add('ph', 'ph_sensor', 460, -160, { source: 'farm' }, 0, 'pH');
  b.add('ec', 'ec_sensor', 540, -160, { source: 'farm' }, 0, 'EC');
  b.add('lvl', 'water_level_analog', 620, -160, { source: 'farm' }, 0, 'Water level');
  for (const [id, pin] of [['ph', 'VP'], ['ec', 'VN'], ['lvl', 'IO34']] as const) b.wire('ps5.P', `${id}.VCC`, W.red).wire(`${id}.GND`, 'ps5.N', W.black).wire(`${id}.AO`, `esp.${pin}`, W.yellow, pin === 'VP' ? 'GPIO36' : pin === 'VN' ? 'GPIO39' : 'GPIO34');
  b.add('cur', 'acs712', 700, 40, { range: 5 }, 0, 'ACS712 pump current');
  b.wire('ps5.P', 'cur.VCC', W.red).wire('cur.GND', 'ps5.N', W.black).wire('cur.OUT', 'esp.IO35', W.yellow, 'GPIO35');
  // Nextion screen on UART1
  b.add('nx', 'nextion', 260, 420, { baud: 9600 }, 0, 'Nextion 2.8"');
  b.wire('ps5.P', 'nx.VCC', W.red).wire('nx.GND', 'ps5.N', W.black).wire('esp.IO18', 'nx.RX', W.green, 'TX1 GPIO18').wire('nx.TX', 'esp.IO19', W.blue, 'RX1 GPIO19');
  // relays (active HIGH, 5 V coils on the 5 V supply, 3.3 V inputs)
  b.add('rl4', 'relay_module', 460, 40, { channels: 4, trigger: 'high', coil: 5 }, 0, 'Relay ×4');
  b.wire('ps5.P', 'rl4.VCC', W.red).wire('rl4.GND', 'ps5.N', W.black);
  b.wire('esp.IO26', 'rl4.IN1', W.orange, 'GPIO26 pump').wire('esp.IO27', 'rl4.IN2', W.orange, 'GPIO27 fan').wire('esp.IO14', 'rl4.IN3', W.orange, 'GPIO14 light').wire('esp.IO13', 'rl4.IN4', W.orange, 'GPIO13 alarm');
  b.add('rl2', 'relay_module', 460, 260, { channels: 2, trigger: 'high', coil: 5 }, 0, 'Relay ×2 (dosing)');
  b.wire('ps5.P', 'rl2.VCC', W.red).wire('rl2.GND', 'ps5.N', W.black);
  b.wire('esp.IO25', 'rl2.IN1', W.orange, 'GPIO25 dose A').wire('esp.IO33', 'rl2.IN2', W.orange, 'GPIO33 dose B');
  // loads on the 12 V supply
  b.add('ps', 'power_supply', 460, 420, { volts: 12, amps: 10 }, 0, '12 V 10 A');
  addLoad(b, 'pump', 860, 0);
  b.wire('ps.P', 'rl4.COM1', W.red).wire('rl4.NO1', 'cur.IPP', W.red).wire('cur.IPN', 'pump.P', W.red).wire('pump.N', 'ps.N', W.black);
  addLoad(b, 'fan', 860, 100);
  switched(b, 'ps', 'rl4.COM2', 'rl4.NO2', 'fan.P', 'fan.N', W.red);
  addLoad(b, 'light', 860, 200);
  switched(b, 'ps', 'rl4.COM3', 'rl4.NO3', 'light.P', 'light.N', W.red);
  addAlarmLamp(b, 700, 160);
  b.wire('ps.P', 'rl4.COM4', W.red).wire('rl4.NO4', 'ralarm.1', W.red).wire('ralarm.2', 'lamp.A', W.red).wire('lamp.K', 'ps.N', W.black);
  addLoad(b, 'doseA', 700, 280);
  switched(b, 'ps', 'rl2.COM1', 'rl2.NO1', 'doseA.P', 'doseA.N', W.red);
  addLoad(b, 'doseB', 800, 280);
  switched(b, 'ps', 'rl2.COM2', 'rl2.NO2', 'doseB.P', 'doseB.N', W.red);
  // mode buttons to GND (Pin.PULL_UP)
  b.add('btnDose', 'button', 260, 340, {}, 0, 'DOSING button');
  b.wire('esp.IO23', 'btnDose.1a', W.green, 'GPIO23').wire('btnDose.2a', 'esp.GND2', W.black);
  b.add('btnTest', 'button', 320, 340, {}, 0, 'TEST button');
  b.wire('esp.IO32', 'btnTest.1a', W.green, 'GPIO32').wire('btnTest.2a', 'esp.GND1', W.black);

  const d = finishDoc(b, 'COMPETITION MASTER 02 — ESP32 Smart Farm (MicroPython)', 'master-esp32');
  d.files = [
    { name: 'main.py', content: '# This project runs on the ESP32: open esp/main.py.\n' },
    { name: 'esp/main.py', content: ESP_MAIN },
  ];
  d.controllers = { esp: { language: 'micropython', main: 'esp/main.py' } };
  d.nextion = masterNextionTemplate();
  return d;
}

// ====================================================================== Wiren Board 7.4
// RS-485-1 (9600 8N1): air sensor (temperature, humidity, CO₂) at Modbus address 2 and the
// WB-MR6C relay module at address 32 (K1 pump, K2 dose A, K3 dose B, K4 fan, K5 light, K6 alarm).
// A1–A4 measure voltage: A1 pH, A2 EC, A3 water level, A4 ACS712. The DOSING and TEST commands
// are pushbuttons of the virtual device "farm" (web interface / MQTT).
export function wbMasterCircuit(): ProjectDoc {
  const b = new CircuitBuilder().add('wb', 'wb74', 40, 60, {}, 0, 'WB7');
  b.add('ps', 'power_supply', 40, 420, { volts: 12, amps: 10 }, 0, '12 V 10 A');
  b.wire('ps.P', 'wb.VIN1', W.red).wire('ps.N', 'wb.GND1', W.black);
  b.add('ps5', 'power_supply', 200, 420, { volts: 5, amps: 1 }, 0, '5 V 1 A');
  b.wire('ps5.N', 'wb.GND2', W.black, 'common GND');
  // RS-485 bus
  b.add('air', 'rs485_climate', 300, -120, { source: 'farm', slave: 2 }, 0, 'Air sensor RS-485 (addr 2)');
  b.wire('ps.P', 'air.VCC', W.red).wire('air.GND', 'ps.N', W.black).wire('wb.RS1_A', 'air.A', W.yellow, 'RS-485 A').wire('wb.RS1_B', 'air.B', W.blue, 'RS-485 B');
  b.add('mr', 'wb_mr6c', 460, 40, { slave: 32 }, 0, 'WB-MR6C (addr 32)');
  b.wire('ps.P', 'mr.VIN', W.red).wire('mr.GND', 'ps.N', W.black).wire('wb.RS1_A', 'mr.A', W.yellow).wire('wb.RS1_B', 'mr.B', W.blue);
  // analog sensors on A1–A4
  b.add('ph', 'ph_sensor', 300, 260, { source: 'farm' }, 0, 'pH');
  b.add('ec', 'ec_sensor', 380, 260, { source: 'farm' }, 0, 'EC');
  b.add('lvl', 'water_level_analog', 460, 260, { source: 'farm' }, 0, 'Water level');
  for (const [id, a] of [['ph', 'A1'], ['ec', 'A2'], ['lvl', 'A3']] as const) b.wire('ps5.P', `${id}.VCC`, W.red).wire(`${id}.GND`, 'ps5.N', W.black).wire(`${id}.AO`, `wb.${a}`, W.yellow, a);
  b.add('cur', 'acs712', 700, 40, { range: 5 }, 0, 'ACS712 pump current');
  b.wire('ps5.P', 'cur.VCC', W.red).wire('cur.GND', 'ps5.N', W.black).wire('cur.OUT', 'wb.A4', W.yellow, 'A4');
  // loads on the relay module contacts
  addLoad(b, 'pump', 860, 0);
  b.wire('ps.P', 'mr.COM1', W.red).wire('mr.NO1', 'cur.IPP', W.red).wire('cur.IPN', 'pump.P', W.red).wire('pump.N', 'ps.N', W.black);
  addLoad(b, 'doseA', 700, 280);
  switched(b, 'ps', 'mr.COM2', 'mr.NO2', 'doseA.P', 'doseA.N', W.red);
  addLoad(b, 'doseB', 800, 280);
  switched(b, 'ps', 'mr.COM3', 'mr.NO3', 'doseB.P', 'doseB.N', W.red);
  addLoad(b, 'fan', 860, 100);
  switched(b, 'ps', 'mr.COM4', 'mr.NO4', 'fan.P', 'fan.N', W.red);
  addLoad(b, 'light', 860, 200);
  switched(b, 'ps', 'mr.COM5', 'mr.NO5', 'light.P', 'light.N', W.red);
  addAlarmLamp(b, 700, 160);
  b.wire('ps.P', 'mr.COM6', W.red).wire('mr.NO6', 'ralarm.1', W.red).wire('ralarm.2', 'lamp.A', W.red).wire('lamp.K', 'ps.N', W.black);

  const d = finishDoc(b, 'COMPETITION MASTER 03 — Wiren Board 7.4 Smart Farm (wb-rules)', 'master-wb7');
  d.files = [
    { name: 'main.py', content: '# This project runs on the Wiren Board: open wb/rules.js.\n' },
    { name: 'wb/rules.js', content: WB_RULES },
  ];
  d.controllers = { wb: { language: 'wbrules', main: 'wb/rules.js' } };
  return d;
}
