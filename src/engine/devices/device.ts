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
}
