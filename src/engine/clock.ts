// Simulation clock: simTime = epoch + (wall - anchor) × speed.
// The same three numbers are mirrored into a SharedArrayBuffer so the Python
// worker computes exactly the same time without messaging.

export class SimClock {
  /** simulation ms at anchor */
  epoch: number;
  /** wall-clock ms (Date.now) at anchor */
  anchor: number;
  speed = 1;
  paused = false;
  private shared: Float64Array | null = null;
  private seq: Int32Array | null = null;
  private listeners = new Set<() => void>();

  constructor(startMs = Date.now(), private wall: () => number = () => Date.now()) {
    this.epoch = startMs;
    this.anchor = this.wall();
  }

  attachShared(f64: Float64Array, seq: Int32Array) {
    this.shared = f64;
    this.seq = seq;
    this.publish();
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  nowMs(): number {
    if (this.paused) return this.epoch;
    return this.epoch + (this.wall() - this.anchor) * this.speed;
  }

  /** seconds since the Unix epoch, in simulation time */
  now(): number {
    return this.nowMs() / 1000;
  }

  private reanchor() {
    this.epoch = this.nowMs();
    this.anchor = this.wall();
  }

  setSpeed(s: number) {
    this.reanchor();
    this.speed = Math.max(0, s);
    this.publish();
  }

  setPaused(p: boolean) {
    this.reanchor();
    this.paused = p;
    this.publish();
  }

  set(ms: number) {
    this.epoch = ms;
    this.anchor = this.wall();
    this.publish();
  }

  private publish() {
    if (this.shared && this.seq) {
      Atomics.add(this.seq, 0, 1);
      this.shared[0] = this.epoch;
      this.shared[1] = this.anchor;
      this.shared[2] = this.paused ? 0 : this.speed;
      Atomics.add(this.seq, 0, 1);
    }
    for (const l of this.listeners) l();
  }
}

/** Worker-side reader of the shared clock (seqlock). */
export function readSharedClock(f64: Float64Array, seq: Int32Array): number {
  for (;;) {
    const s0 = Atomics.load(seq, 0);
    const epoch = f64[0];
    const anchor = f64[1];
    const speed = f64[2];
    const s1 = Atomics.load(seq, 0);
    if (s0 === s1 && (s0 & 1) === 0) return (epoch + (Date.now() - anchor) * speed) / 1000;
  }
}
