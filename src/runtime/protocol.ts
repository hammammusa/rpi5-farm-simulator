// SharedArrayBuffer layout shared by the main thread and the Python worker.
export const CTL = {
  RPC_STATE: 0, // 0 = waiting, 1 = response ready
  RPC_LEN: 1,
  EVENT_SEQ: 2, // incremented by main when events are queued for Python
  STOP: 3, // 1 = stop requested
  CLOCK_SEQ: 4,
  SIZE: 16,
} as const;

export const DATA_BYTES = 4 * 1024 * 1024;

export interface SharedBuffers {
  ctl: SharedArrayBuffer;
  data: SharedArrayBuffer;
  clock: SharedArrayBuffer;
  interrupt: SharedArrayBuffer;
}

export function createShared(): SharedBuffers {
  return {
    ctl: new SharedArrayBuffer(CTL.SIZE * 4),
    data: new SharedArrayBuffer(DATA_BYTES),
    clock: new SharedArrayBuffer(4 * 8),
    interrupt: new SharedArrayBuffer(4),
  };
}

export interface PyErrorInfo {
  type: string;
  message: string;
  traceback: string;
  file?: string;
  line?: number;
}

export type WorkerIn =
  | { type: 'init'; base: string; shared: SharedBuffers; tzOffset: number; shims: Record<string, string> }
  | { type: 'run'; files: { name: string; content: string }[]; main: string };

export type WorkerOut =
  | { type: 'status'; text: string }
  | { type: 'ready'; version: string; python: string }
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'rpc'; method: string; args: any; t: number }
  | { type: 'post'; method: string; args: any; t: number }
  | { type: 'done'; status: 'ok' | 'error' | 'stopped'; error?: PyErrorInfo; files?: { name: string; content: string }[] }
  | { type: 'fatal'; message: string };
