// Default placement of the three COMPETITION MASTER circuits, drawn by hand on a grid so the
// study circuits read the same way: controller on the left, sensors along the top, relay modules
// and drivers in the middle, the 12 V loads on the right in the order of their relay channels,
// and the supplies in their own zone at the bottom. Only the wire paths are computed (router).
import type { ProjectDoc, Rotation, Zone } from '../../engine/types';
import { routeWires } from '../../engine/layout';
import type { MasterBoard } from './scenarios';

type Place = [x: number, y: number, rot?: Rotation];

const PI: Record<string, Place> = {
  pi: [40, 400],
  // sensors (top band)
  dht: [60, 60],
  co2: [160, 50],
  btnDose: [290, 90],
  btnTest: [380, 90],
  lvl: [470, 40],
  ec: [540, 40],
  ph: [610, 40],
  adc: [520, 200, 180],
  // relays (middle)
  rl4: [560, 400],
  rl2: [560, 630],
  // loads (right), in the order of the relay channels
  cur: [760, 320, 180],
  pump: [920, 280],
  fan: [920, 390],
  light: [920, 500],
  ralarm: [780, 570],
  lamp: [930, 550],
  doseA: [920, 630],
  doseB: [920, 730],
  // power
  ps: [620, 820],
};

const ESP: Record<string, Place> = {
  esp: [80, 300, 180],
  // sensors (top band)
  dht: [60, 60],
  co2: [160, 50],
  btnDose: [290, 90],
  btnTest: [380, 90],
  lvl: [470, 40],
  ec: [540, 40],
  ph: [610, 40],
  // relays (middle)
  rl4: [520, 300],
  rl2: [520, 530],
  // display
  nx: [100, 660],
  // loads (right)
  cur: [740, 220, 180],
  pump: [900, 180],
  fan: [900, 290],
  light: [900, 400],
  ralarm: [760, 470],
  lamp: [910, 450],
  doseA: [900, 530],
  doseB: [900, 630],
  // power
  ps5: [500, 720],
  ps: [700, 780],
};

const WB: Record<string, Place> = {
  wb: [60, 150],
  // sensors (top band)
  air: [120, 30],
  lvl: [380, 60],
  ec: [450, 60],
  ph: [520, 60],
  // relays (middle)
  mr: [560, 300],
  // loads (right)
  cur: [760, 200, 180],
  pump: [920, 160],
  doseA: [920, 270],
  doseB: [920, 370],
  fan: [920, 470],
  light: [920, 580],
  ralarm: [780, 650],
  lamp: [930, 630],
  // power
  ps: [120, 520],
  ps5: [320, 520],
};
const ZONES: Record<MasterBoard, [string, string, string[]][]> = {
  pi: [
    ['controller', 'Raspberry Pi 5 controller', ['pi']],
    ['input', 'Sensors and buttons', ['dht', 'co2', 'btnDose', 'btnTest', 'lvl', 'ec', 'ph', 'adc']],
    ['interface', 'Relay modules', ['rl4', 'rl2']],
    ['output', '12 V loads', ['cur', 'pump', 'fan', 'light', 'ralarm', 'lamp', 'doseA', 'doseB']],
    ['power', 'Power supply', ['ps']],
  ],
  esp: [
    ['controller', 'ESP32 controller', ['esp']],
    ['input', 'Sensors and buttons', ['dht', 'co2', 'btnDose', 'btnTest', 'lvl', 'ec', 'ph']],
    ['interface', 'Relay modules', ['rl4', 'rl2']],
    ['display', 'Nextion display', ['nx']],
    ['output', '12 V loads', ['cur', 'pump', 'fan', 'light', 'ralarm', 'lamp', 'doseA', 'doseB']],
    ['power', 'Power supplies', ['ps5', 'ps']],
  ],
  wb: [
    ['controller', 'Wiren Board 7.4 controller', ['wb']],
    ['input', 'Sensors (RS-485 and A1–A4)', ['air', 'lvl', 'ec', 'ph']],
    ['interface', 'Modbus relay module', ['mr']],
    ['output', '12 V loads', ['cur', 'pump', 'doseA', 'doseB', 'fan', 'light', 'ralarm', 'lamp']],
    ['power', 'Power supplies', ['ps', 'ps5']],
  ],
};

const PLACES: Record<MasterBoard, Record<string, Place>> = { pi: PI, esp: ESP, wb: WB };

/** the circuit at its study placement, with zones and routed wires */
export function placeMaster(raw: ProjectDoc, b: MasterBoard): ProjectDoc {
  const P = PLACES[b];
  const missing = raw.components.filter((c) => !P[c.id]).map((c) => c.id);
  if (missing.length) throw new Error(`no placement for ${missing.join(', ')}`);
  const doc: ProjectDoc = {
    ...raw,
    components: raw.components.map((c) => ({ ...c, x: P[c.id][0], y: P[c.id][1], rotation: P[c.id][2] ?? 0 })),
    wires: raw.wires.map((w) => {
      const { points: _p, route: _r, ...rest } = w;
      return { ...rest, auto: true };
    }),
    zones: ZONES[b].map(([role, label, members]): Zone => ({ id: `z-${role}`, label, role, members } as Zone)),
  };
  return routeWires(doc);
}
