import type { PartManifest } from './base';
import { pi5 } from './pi5';
import * as basic from './basic';
import * as act from './actuators';
import * as sen from './sensors';
import * as disp from './displays';

export const PARTS: PartManifest[] = [
  pi5,
  basic.breadboard,
  basic.led,
  basic.rgbLed,
  basic.resistor,
  basic.capacitor,
  basic.pushButton,
  basic.toggleSwitch,
  basic.potentiometer,
  basic.buzzer,
  basic.diode,
  basic.npn,
  basic.pnp,
  basic.mosfet,
  basic.powerSupply,
  act.relayModule,
  act.waterPump,
  act.dosingPump,
  act.solenoidValve,
  act.fan,
  act.dcMotor,
  act.heater,
  act.humidifier,
  act.growLight,
  act.servo,
  sen.dht22,
  sen.bme280,
  sen.ds18b20,
  sen.mhz19b,
  sen.phSensor,
  sen.ecSensor,
  sen.soilMoisture,
  sen.waterLevelAnalog,
  sen.floatSwitch,
  sen.flowSensor,
  sen.ldrModule,
  sen.bh1750,
  sen.leakSensor,
  sen.mcp3008,
  disp.nextion,
  disp.lcd1602,
  disp.oled,
  disp.usbSerial,
];

const byType = new Map(PARTS.map((p) => [p.type, p]));

export function getPart(type: string): PartManifest {
  const p = byType.get(type);
  if (!p) throw new Error(`Unknown component type: ${type}`);
  return p;
}

export function hasPart(type: string) {
  return byType.has(type);
}

/** Register an additional component at runtime (plugin architecture). */
export function registerPart(m: PartManifest) {
  if (byType.has(m.type)) throw new Error(`Component type already registered: ${m.type}`);
  PARTS.push(m);
  byType.set(m.type, m);
}

export * from './base';
