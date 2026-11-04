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
  /** shared copies read by workers (the Pi's Python worker and every controller's worker) */
  private shared: { f64: Float64Array; seq: Int32Array }[] = [];
  private listeners = new Set<() => void>();

  constructor(startMs = Date.now(), private wall: () => number = () => Date.now()) {
    this.epoch = startMs;
    this.anchor = this.wall();
  }

  attachShared(f64: Float64Array, seq: Int32Array) {
    this.shared.push({ f64, seq });
    this.publish();
    return () => {
      this.shared = this.shared.filter((x) => x.f64 !== f64);
    };
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
    for (const { f64, seq } of this.shared) {
      Atomics.add(seq, 0, 1);
      f64[0] = this.epoch;
      f64[1] = this.anchor;
      f64[2] = this.paused ? 0 : this.speed;
      Atomics.add(seq, 0, 1);
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
