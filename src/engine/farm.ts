// Simplified hydroponic farm process model.
//
// DECLARED ASSUMPTIONS (training model — not agronomic or chemical truth):
//  * Reservoir is perfectly mixed. EC mixes linearly by volume:
//      EC = (EC·V + EC_stock·ΔV) / (V + ΔV)
//  * Each ml of nutrient concentrate per litre lowers pH by 0.15; each ml/L of
//    pH-down lowers pH by 0.6 (linear, clamped 3..9). Fresh water: EC 0.2, pH 7.2.
//  * Plants take up `consumptionLPerDay` of water; EC drifts −0.05/day and
//    pH +0.1/day (uptake), scaled by elapsed simulation time.
//  * Room air is a single thermal mass (150 kJ/K) leaking to outdoor air with
//    τ = 1 h; a running fan exchanges air with τ = 5 min.
//  * Pumps run at their rated flow × electrical run fraction, unless the
//    reservoir is below the pump intake (dry run) or the pump is faulted.
// All constants are visible in this file and in the Smart Farm tab.

export type FarmRole =
  | 'none'
  | 'circulation'
  | 'dose_a'
  | 'dose_b'
  | 'ph_down'
  | 'fresh_water'
  | 'drain'
  | 'fan'
  | 'heater'
  | 'humidifier'
  | 'grow_light';

export const FARM_ROLE_LABELS: Record<FarmRole, string> = {
  none: 'Not part of the farm',
  circulation: 'Circulation / irrigation pump (reservoir → channels)',
  dose_a: 'Dosing pump A (Fertilizer tank A → reservoir)',
  dose_b: 'Dosing pump B (Fertilizer tank B → reservoir)',
  ph_down: 'pH-down dosing pump',
  fresh_water: 'Fresh-water inlet valve',
  drain: 'Reservoir drain valve',
  fan: 'Ventilation / cooling fan',
  heater: 'Air heater',
  humidifier: 'Humidifier',
  grow_light: 'Grow light',
};

export interface FarmConfig {
  enabled: boolean;
  crop: string;
  reservoir: { capacityL: number; volumeL: number; ec: number; ph: number; tempC: number; heightCm: number };
  tankA: { capacityL: number; volumeL: number; ecStock: number };
  tankB: { capacityL: number; volumeL: number; ecStock: number };
  phDown: { capacityL: number; volumeL: number };
  channelCapacityL: number;
  intakeMinL: number;
  env: { outdoorTemp: number; outdoorHumidity: number; outdoorCO2: number; ambientLux: number };
  initial: { airTemp: number; humidity: number; co2: number };
  consumptionLPerDay: number;
  leak: boolean;
}

export function defaultFarmConfig(): FarmConfig {
  return {
    enabled: true,
    crop: 'Lettuce',
    reservoir: { capacityL: 40, volumeL: 30, ec: 1.2, ph: 6.2, tempC: 21, heightCm: 40 },
    tankA: { capacityL: 2, volumeL: 1.5, ecStock: 150 },
    tankB: { capacityL: 2, volumeL: 1.5, ecStock: 150 },
    phDown: { capacityL: 1, volumeL: 0.8 },
    channelCapacityL: 4,
    intakeMinL: 2,
    env: { outdoorTemp: 24, outdoorHumidity: 50, outdoorCO2: 420, ambientLux: 80 },
    initial: { airTemp: 25, humidity: 60, co2: 650 },
    consumptionLPerDay: 2,
    leak: false,
  };
}

export interface ActuatorDrive {
  comp: string;
  role: FarmRole;
  /** electrical run fraction 0..1 (negative = reversed, e.g. peristaltic) */
  run: number;
  /** L/min for pumps/valves, ml/min for dosing pumps */
  rate: number;
  watts: number;
  /** motor runs but moves no liquid (clogged / failed impeller) */
  noFlow?: boolean;
  /** relative calibration error of the actual flow, e.g. 0.03 = +3 % */
  calibration?: number;
}

export interface FarmAlarm {
  id: string;
  severity: 'error' | 'warning';
  since: number;
  params?: Record<string, string | number>;
}

export interface FarmState {
  t: number;
  reservoir: { volumeL: number; ec: number; ph: number; tempC: number };
  tankA: number;
  tankB: number;
  phDown: number;
  inTransitL: number;
  flowLpm: number;
  air: { temp: number; humidity: number; co2: number; lux: number; pressure: number };
  totals: { circulatedL: number; doseAml: number; doseBml: number; phDownml: number; freshL: number; drainedL: number; spilledL: number; energyWh: number };
  powerW: number;
  dryRunSec: number;
  noFlowSec: number;
  alarms: FarmAlarm[];
  /** per-component live flow info for visuals */
  flows: Record<string, number>;
  leakActive: boolean;
  stress: string[];
}

export function initialFarmState(cfg: FarmConfig, t: number): FarmState {
  return {
    t,
    reservoir: { volumeL: cfg.reservoir.volumeL, ec: cfg.reservoir.ec, ph: cfg.reservoir.ph, tempC: cfg.reservoir.tempC },
    tankA: cfg.tankA.volumeL,
    tankB: cfg.tankB.volumeL,
    phDown: cfg.phDown.volumeL,
    inTransitL: 0,
    flowLpm: 0,
    air: { temp: cfg.initial.airTemp, humidity: cfg.initial.humidity, co2: cfg.initial.co2, lux: cfg.env.ambientLux, pressure: 1013.25 },
    totals: { circulatedL: 0, doseAml: 0, doseBml: 0, phDownml: 0, freshL: 0, drainedL: 0, spilledL: 0, energyWh: 0 },
    powerW: 0,
    dryRunSec: 0,
    noFlowSec: 0,
    alarms: [],
    flows: {},
    leakActive: false,
    stress: [],
  };
}

const THERMAL_MASS = 150_000; // J/K
const TAU_ROOM = 3600;
const TAU_FAN = 300;
const TAU_WATER = 3 * 3600;
const TAU_CHANNEL = 25;
const LUX_PER_WATT = 150;

export class FarmModel {
  state: FarmState;
  drives: ActuatorDrive[] = [];
  constructor(public cfg: FarmConfig, t: number) {
    this.state = initialFarmState(cfg, t);
  }

  reset(cfg: FarmConfig, t: number) {
    this.cfg = cfg;
    this.state = initialFarmState(cfg, t);
  }

  private alarm(id: string, on: boolean, severity: 'error' | 'warning', params?: Record<string, string | number>) {
    const s = this.state;
    const idx = s.alarms.findIndex((a) => a.id === id);
    if (on && idx < 0) s.alarms.push({ id, severity, since: s.t, params });
    else if (on && idx >= 0 && params) s.alarms[idx].params = params;
    else if (!on && idx >= 0 && id !== 'AB_SIMULTANEOUS') s.alarms.splice(idx, 1);
  }

  clearLatched() {
    this.state.alarms = this.state.alarms.filter((a) => a.id !== 'AB_SIMULTANEOUS');
  }

  /** Integrate the process model up to simulation time t (seconds) with the current drives. */
  advanceTo(t: number) {
    const s = this.state;
    if (!this.cfg.enabled) {
      s.t = Math.max(s.t, t);
      return;
    }
    let remaining = t - s.t;
    if (remaining <= 0) return;
    // guard against enormous jumps (e.g. clock set years ahead)
    if (remaining > 7 * 86400) {
      s.t = t - 7 * 86400;
      remaining = 7 * 86400;
    }
    while (remaining > 1e-9) {
      const dt = Math.min(remaining, 1);
      this.step(dt);
      remaining -= dt;
      s.t += dt;
    }
  }

  private step(dt: number) {
    const s = this.state;
    const c = this.cfg;
    const r = s.reservoir;
    let heatW = 0;
    let fan = 0;
    let humid = 0;
    let lightW = 0;
    let circLpm = 0;
    let doseA = 0;
    let doseB = 0;
    let power = 0;
    s.flows = {};
    const runningA = this.drives.some((d) => d.role === 'dose_a' && d.run > 0.05);
    const runningB = this.drives.some((d) => d.role === 'dose_b' && d.run > 0.05);
    let anyCirculationMotor = false;

    for (const d of this.drives) {
      power += d.watts;
      const run = d.run;
      if (Math.abs(run) < 0.05) continue;
      const cal = 1 + (d.calibration ?? 0);
      switch (d.role) {
        case 'circulation': {
          anyCirculationMotor = true;
          if (d.noFlow) break;
          if (r.volumeL <= c.intakeMinL) break;
          const q = Math.max(0, run) * d.rate * cal;
          circLpm += q;
          s.flows[d.comp] = q;
          break;
        }
        case 'dose_a':
        case 'dose_b':
        case 'ph_down': {
          if (d.noFlow) break;
          const key = d.role === 'dose_a' ? 'tankA' : d.role === 'dose_b' ? 'tankB' : 'phDown';
          let ml = run * d.rate * cal * (dt / 60);
          if (ml > 0) ml = Math.min(ml, (s as any)[key] * 1000);
          else ml = Math.max(ml, -r.volumeL * 1000);
          (s as any)[key] -= ml / 1000;
          s.flows[d.comp] = (ml / dt) * 60;
          if (Math.abs(ml) < 1e-12) break;
          const L = ml / 1000;
          if (d.role === 'ph_down') {
            s.totals.phDownml += ml;
            r.ph = clampPh(r.ph - (0.6 * ml) / Math.max(r.volumeL, 0.1));
            r.volumeL += L;
          } else {
            const stock = d.role === 'dose_a' ? c.tankA.ecStock : c.tankB.ecStock;
            if (d.role === 'dose_a') {
              s.totals.doseAml += ml;
              doseA += ml;
            } else {
              s.totals.doseBml += ml;
              doseB += ml;
            }
            const nv = Math.max(r.volumeL + L, 0.01);
            r.ec = Math.max(0, (r.ec * r.volumeL + stock * L) / nv);
            r.ph = clampPh(r.ph - (0.15 * ml) / Math.max(r.volumeL, 0.1));
            r.volumeL = nv;
          }
          break;
        }
        case 'fresh_water': {
          const L = Math.max(0, run) * d.rate * (dt / 60);
          const nv = r.volumeL + L;
          r.ec = (r.ec * r.volumeL + 0.2 * L) / nv;
          r.ph = (r.ph * r.volumeL + 7.2 * L) / nv;
          r.tempC = (r.tempC * r.volumeL + 18 * L) / nv;
          r.volumeL = nv;
          s.totals.freshL += L;
          s.flows[d.comp] = L > 0 ? (L / dt) * 60 : 0;
          break;
        }
        case 'drain': {
          const L = Math.min(r.volumeL, Math.max(0, run) * d.rate * (dt / 60));
          r.volumeL -= L;
          s.totals.drainedL += L;
          s.flows[d.comp] = L > 0 ? (L / dt) * 60 : 0;
          break;
        }
        case 'fan':
          fan = Math.max(fan, Math.min(1, Math.abs(run)));
          break;
        case 'heater':
          heatW += d.watts;
          break;
        case 'humidifier':
          humid = Math.max(humid, Math.min(1, run));
          break;
        case 'grow_light':
          lightW += d.watts;
          break;
      }
    }

    // circulation through the channels
    // water held in the channels relaxes towards flow × τ (capped by channel volume)
    const prev = s.inTransitL;
    const target = Math.min(c.channelCapacityL, (circLpm / 60) * TAU_CHANNEL);
    const next = target + (prev - target) * Math.exp(-dt / TAU_CHANNEL);
    r.volumeL -= next - prev;
    s.inTransitL = next;
    s.flowLpm = circLpm;
    s.totals.circulatedL += (circLpm / 60) * dt;

    // dry-run detection: motor powered but reservoir below intake
    const dry = anyCirculationMotor && r.volumeL <= c.intakeMinL;
    s.dryRunSec = dry ? s.dryRunSec + dt : 0;
    this.alarm('PUMP_DRY_RUN', dry, 'error', { level: Math.round(this.levelPct()) });
    s.noFlowSec = circLpm > 0 ? 0 : s.noFlowSec + dt;

    if (runningA && runningB) this.alarm('AB_SIMULTANEOUS', true, 'error');
    this.alarm('TANK_A_EMPTY', s.tankA <= 0.0005, 'warning');
    this.alarm('TANK_B_EMPTY', s.tankB <= 0.0005, 'warning');

    // leak
    s.leakActive = c.leak;
    if (c.leak) {
      const L = Math.min(r.volumeL, 0.2 * (dt / 60));
      r.volumeL -= L;
    }
    this.alarm('LEAK', c.leak, 'error');

    // plant uptake and drift
    const days = dt / 86400;
    const uptake = Math.min(r.volumeL, c.consumptionLPerDay * days);
    r.volumeL -= uptake;
    if (r.volumeL > 0.5) {
      r.ec = Math.max(0, r.ec - 0.05 * days);
      r.ph = clampPh(r.ph + 0.1 * days);
    }

    // overflow
    if (r.volumeL > c.reservoir.capacityL) {
      s.totals.spilledL += r.volumeL - c.reservoir.capacityL;
      r.volumeL = c.reservoir.capacityL;
      this.alarm('OVERFLOW', true, 'error');
    } else if (r.volumeL < c.reservoir.capacityL - 0.2) this.alarm('OVERFLOW', false, 'error');
    r.volumeL = Math.max(0, r.volumeL);

    // air climate
    const a = s.air;
    const e = c.env;
    const exch = 1 / TAU_ROOM + fan / TAU_FAN;
    a.temp += ((e.outdoorTemp - a.temp) * exch + (heatW + 0.8 * lightW) / THERMAL_MASS) * dt;
    const lightOn = lightW > 1;
    a.humidity += ((e.outdoorHumidity - a.humidity) * exch + (humid * 20 + (lightOn ? 2 : 0.5)) / 3600) * dt;
    a.humidity = Math.max(5, Math.min(99, a.humidity));
    a.co2 += ((e.outdoorCO2 - a.co2) * exch + (lightOn ? -150 : 30) / 3600) * dt;
    a.co2 = Math.max(200, a.co2);
    a.lux = e.ambientLux + lightW * LUX_PER_WATT;
    r.tempC += ((a.temp - r.tempC) / TAU_WATER) * dt;

    s.powerW = power;
    s.totals.energyWh += (power * dt) / 3600;

    // plant stress indicators
    const stress: string[] = [];
    if (s.noFlowSec > 6 * 3600) stress.push('no_water_flow');
    if (r.ec < 0.6 || r.ec > 2.8) stress.push('ec');
    if (r.ph < 5.0 || r.ph > 7.2) stress.push('ph');
    if (a.temp > 32 || a.temp < 10) stress.push('temperature');
    s.stress = stress;
  }

  levelPct() {
    return (100 * this.state.reservoir.volumeL) / this.cfg.reservoir.capacityL;
  }

  read(key: string): number {
    const s = this.state;
    switch (key) {
      case 'air.temp':
        return s.air.temp;
      case 'air.humidity':
        return s.air.humidity;
      case 'air.co2':
        return s.air.co2;
      case 'air.lux':
        return s.air.lux;
      case 'air.pressure':
        return s.air.pressure;
      case 'water.temp':
        return s.reservoir.tempC;
      case 'water.ec':
        return s.reservoir.ec;
      case 'water.ph':
        return s.reservoir.ph;
      case 'water.levelPct':
        return this.levelPct();
      case 'water.levelCm':
        return (this.levelPct() / 100) * this.cfg.reservoir.heightCm;
      case 'flow.lpm':
        return s.flowLpm;
      case 'leak':
        return s.leakActive ? 1 : 0;
      case 'tray.moisture':
        return Math.min(100, 25 + (75 * s.inTransitL) / Math.max(0.1, this.cfg.channelCapacityL));
      // ---- derived readings used by the extended sensor library (declared simplifications)
      case 'water.tds':
        return s.reservoir.ec * 500; // ppm, 500 scale (TDS ≈ 500 × EC[mS/cm])
      case 'water.distanceCm':
        return Math.max(2, this.cfg.reservoir.heightCm * (1 - this.levelPct() / 100) + 3); // sensor 3 cm above the brim
      case 'water.do': {
        const T = s.reservoir.tempC;
        const sat = 14.62 - 0.3898 * T + 0.006969 * T * T - 0.00005897 * T * T * T; // mg/L at 1 atm
        return sat * (s.flowLpm > 0.1 ? 0.95 : 0.8);
      }
      case 'tank.a':
        return (100 * s.tankA) / Math.max(0.01, this.cfg.tankA.capacityL);
      case 'tank.b':
        return (100 * s.tankB) / Math.max(0.01, this.cfg.tankB.capacityL);
      case 'tank.phdown':
        return (100 * s.phDown) / Math.max(0.01, this.cfg.phDown.capacityL);
      case 'pipe.kPa':
        return s.flowLpm > 0 ? 20 + 10 * s.flowLpm : 0;
      default:
        return 0;
    }
  }
}

function clampPh(p: number) {
  return Math.max(3, Math.min(9, p));
}
