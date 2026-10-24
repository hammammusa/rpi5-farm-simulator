// Smart Farming Components: tanks, grow channels and plumbing drawn in the workspace.
// Tanks and the grow channel display the live Smart Farm model (they have no
// electrical pins); pipes are documentation-only drawings.
import { pin, type PartManifest } from './base';

function tank(type: string, name: string, short: string, key: 'reservoir' | 'tankA' | 'tankB' | 'phDown', description: string, colour: string): PartManifest {
  return {
    type,
    name,
    short,
    category: 'actuator',
    group: 'Smart Farming Components',
    description: `${description} It shows the live state of the Smart Farm model (level, and EC/pH/temperature for the reservoir). Pumps and valves change it when their "Smart Farm role" is set.`,
    w: 80,
    h: 100,
    pins: [],
    props: [{ key: 'colour', label: 'Colour', type: 'string', default: colour, group: 'config' }],
    support: 'full',
    fidelity: 'functional',
    limits: 'Display of the Smart Farm process model (perfectly mixed tank, linear EC/pH mixing — see the Smart Farm tab). The tank itself has no electrical pins; sensors read the same model when their value source is "Smart Farm".',
    voltage: '—',
    interfaces: ['Smart Farm model'],
    drivers: ['smartfarm'],
    post(ctx) {
      const f = ctx.sim.farm;
      if (key === 'reservoir') return { level: f.reservoir.volumeL, ec: f.reservoir.ec, ph: f.reservoir.ph, temp: f.reservoir.tempC, kind: key };
      const vol = key === 'tankA' ? f.tankA : key === 'tankB' ? f.tankB : f.phDown;
      return { level: vol, kind: key };
    },
  };
}

export const reservoirTank = tank('reservoir_tank', 'Nutrient reservoir tank', 'Reservoir', 'reservoir', 'Main hydroponic nutrient-solution reservoir.', '#2b7bd6');
export const fertTankA = tank('fert_tank_a', 'Fertilizer stock tank A', 'Tank A', 'tankA', 'Concentrated nutrient stock solution A (dosed by the pump with role "Dosing pump A").', '#8e5bd6');
export const fertTankB = tank('fert_tank_b', 'Fertilizer stock tank B', 'Tank B', 'tankB', 'Concentrated nutrient stock solution B (dosed by the pump with role "Dosing pump B").', '#e6b800');
export const phDownTank = tank('ph_down_tank', 'pH-down tank', 'pH−', 'phDown', 'Acid pH-down solution (dosed by the pump with role "pH-down dosing pump").', '#e0393e');

export const growChannel: PartManifest = {
  type: 'grow_channel',
  name: 'NFT grow channel with plants',
  short: 'NFT channel',
  category: 'actuator',
  group: 'Smart Farming Components',
  description: 'Nutrient-film channel with net pots. It shows the solution flow and plant stress reported by the Smart Farm model (dry channel, EC/pH out of range, temperature).',
  w: 220,
  h: 50,
  pins: [],
  props: [{ key: 'plants', label: 'Plants', type: 'number', default: 6, min: 1, max: 12, step: 1, unit: '', group: 'config' }],
  support: 'full',
  fidelity: 'functional',
  limits: 'Visualisation of the farm model (flow, channel water, stress flags). Plant growth is not simulated.',
  voltage: '—',
  interfaces: ['Smart Farm model'],
  drivers: ['smartfarm'],
  post(ctx) {
    const f = ctx.sim.farm;
    return { flow: f.flowLpm, inChannel: f.inTransitL, stress: f.stress.slice(0, 3) };
  },
};

function pipe(type: string, name: string, w: number, h: number): PartManifest {
  return {
    type,
    name,
    short: name.replace('Pipe ', ''),
    category: 'basic',
    group: 'Smart Farming Components',
    description: `${name} for drawing the plumbing of the system in diagrams and exports. Pipes are drawings only: liquid flow is computed by the Smart Farm model from the pump/valve roles.`,
    w,
    h,
    pins: [],
    props: [{ key: 'colour', label: 'Colour', type: 'string', default: '#9fb0c0', group: 'config' }],
    support: 'partial',
    fidelity: 'visual',
    limits: 'VISUAL ONLY: no hydraulic simulation and no electrical connection.',
    voltage: '—',
    drivers: [],
  };
}

export const pipeStraight = pipe('pipe_straight', 'Pipe (straight)', 100, 20);
export const pipeElbow = pipe('pipe_elbow', 'Pipe (elbow)', 60, 60);
export const pipeTee = pipe('pipe_tee', 'Pipe (tee)', 80, 50);

export const FARMKIT_PARTS: PartManifest[] = [reservoirTank, fertTankA, fertTankB, phDownTank, growChannel, pipeStraight, pipeElbow, pipeTee];

void pin;
