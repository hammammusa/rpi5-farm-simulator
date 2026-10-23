import type { DeviceHost, DeviceModel } from './device';

/** PC serial terminal behind a USB-UART adapter. */
export class SerialTerminal implements DeviceModel {
  received: number[] = [];
  constructor(private host: DeviceHost) {}
  uartBaud() {
    return Number(this.host.props().baud) || 9600;
  }
  reset() {
    this.received = [];
  }
  uartReceive(bytes: number[]) {
    if (this.host.fault() === 'uart_loss') return;
    this.received.push(...bytes);
    if (this.received.length > 8192) this.received = this.received.slice(-8192);
    this.host.changed();
  }
  type(text: string, t: number) {
    const bytes = Array.from(new TextEncoder().encode(text));
    this.host.send(bytes, t);
  }
  view() {
    return { text: new TextDecoder().decode(new Uint8Array(this.received)) };
  }
}
