import type { ComponentInstance } from '../types';

export interface DeviceHost {
  comp(): ComponentInstance;
  props(): Record<string, any>;
  /** sensor reading with source/fault handling */
  value(key: string): number;
  fault(): string;
  powered(): boolean;
  now(): number;
  /** device transmits on its UART TX pin */
  send(bytes: number[], t?: number): void;
  log(msg: string): void;
  changed(): void;
  /** net voltage of one of the part's own pins (for address-select / DC / WAKE pins) */
  pinVolt?(pin: string): number | null;
  /** id of the component instance */
  id?: string;
  /** the part's last computed visual/electrical state (from post()) */
  vis?(): Record<string, any> | undefined;
  /** per-instance runtime scratch shared with stamp()/post() (survives program runs) */
  rt?(): Record<string, any>;
  /** re-solve the circuit after the device changed an output (expanders, latches) */
  reevaluate?(): void;
  /** true when two of the part's own pins are on the same electrical net */
  sameNet?(a: string, b: string): boolean;
  /** true when the pin is wired to anything */
  pinConnected?(pin: string): boolean;
  /** device models of other parts sharing the net of one of this part's pins (RS-485 bus) */
  netPeers?(pin: string): { id: string; type: string; dev: DeviceModel | null }[];
}

export interface DeviceModel {
  i2cAddress?(): number;
  i2cWrite?(bytes: number[]): void;
  i2cRead?(n: number): number[];
  spiXfer?(bytes: number[]): number[];
  uartReceive?(bytes: number[], t: number): void;
  uartBaud?(): number;
  powerChanged?(on: boolean, t: number): void;
  tick?(t: number): void;
  view?(): any;
  reset?(): void;
  /** RS-485 frame arriving on the A/B pair; `reply` sends bytes back on the bus */
  rs485Receive?(bytes: number[], t: number, reply: (bytes: number[], t: number) => void): void;
}
