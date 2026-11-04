// Messages between the main thread and a microcontroller worker (one worker per running
// controller). The shared-memory layout is the Pi runtime's (CTL, DATA_BYTES): synchronous
// engine calls block the worker with Atomics.wait while the main thread answers.
import type { PyErrorInfo, SharedBuffers } from '../protocol';
import type { LanguageId } from '../../engine/boards/types';

export type McuWorkerIn = {
  type: 'run';
  lang: LanguageId;
  base: string;
  shared: SharedBuffers;
  tzOffset: number;
  files: { name: string; content: string }[];
  main: string;
  /** the controller's folder in the project (its component id) */
  folder: string;
  /** Arduino: the compiled sketch */
  wasm?: Uint8Array;
};

export type McuWorkerOut =
  | { type: 'status'; text: string }
  | { type: 'started'; engine: string }
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'rpc'; method: string; args: any; t: number }
  | { type: 'post'; method: string; args: any; t: number }
  | { type: 'done'; status: 'ok' | 'error' | 'stopped' | 'reset'; error?: PyErrorInfo }
  | { type: 'fatal'; message: string };
