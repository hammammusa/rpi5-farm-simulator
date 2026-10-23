// Core data model shared by the circuit engine, the Python bridge and the UI.
// The engine never imports React; the UI renders from these structures.

export type Rotation = 0 | 90 | 180 | 270;

export interface PinRef {
  comp: string;
  pin: string;
}

export interface ComponentInstance {
  id: string;
  type: string;
  x: number;
  y: number;
  rotation: Rotation;
  props: Record<string, any>;
  label?: string;
}

export interface Wire {
  id: string;
  from: PinRef;
  to: PinRef;
  color: string;
  label?: string;
  points?: { x: number; y: number }[];
}

export interface ProjectFile {
  name: string;
  content: string;
}

export interface ProjectDoc {
  schema: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  components: ComponentInstance[];
  wires: Wire[];
  files: ProjectFile[];
  mainFile: string;
  nextion: import('./devices/nextion').NextionProject;
  farm: import('./farm').FarmConfig;
  sim: { speed: number; startTime?: string };
  exampleId?: string;
  notes?: string;
}

export type PinKind = 'power' | 'ground' | 'gpio' | 'digital' | 'analog' | 'passive' | 'terminal' | 'nc' | 'hole';

export interface PinDef {
  id: string;
  label: string;
  x: number;
  y: number;
  kind: PinKind;
  desc?: string;
}

export type PropType = 'number' | 'select' | 'boolean' | 'string';

export interface PropDef {
  key: string;
  label: string;
  type: PropType;
  default: any;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: any; label: string }[];
  /** Live props can be changed while the program runs (sensor values). */
  live?: boolean;
  group?: 'config' | 'sensor' | 'farm' | 'fault';
  help?: string;
  visible?: (props: Record<string, any>) => boolean;
}

export type Category =
  | 'board'
  | 'basic'
  | 'passive'
  | 'semiconductor'
  | 'input'
  | 'output'
  | 'power'
  | 'sensor'
  | 'actuator'
  | 'display'
  | 'interface';

export interface FaultDef {
  id: string;
  label: string;
  help?: string;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  code: string;
  severity: Severity;
  /** i18n params used to build the message/explanation */
  params?: Record<string, string | number>;
  comps: string[];
  pins?: PinRef[];
  /** stable key to dedupe */
  key: string;
}

export interface GpioRuntime {
  bcm: number;
  mode: 'input' | 'output' | 'pwm' | 'alt';
  value: 0 | 1;
  pull: 'up' | 'down' | 'none';
  pwmFreq: number;
  pwmDuty: number;
  owner?: string;
  alt?: string;
  /** optional background pattern (gpiozero blink/pulse) */
  pattern?: PinPattern | null;
  watched?: boolean;
  bounceMs?: number;
}

export interface PinPattern {
  /** list of [duty 0..1, sim seconds] steps */
  steps: [number, number][];
  repeat: number | null;
  startSim: number;
  pwm: boolean;
  freq: number;
}
