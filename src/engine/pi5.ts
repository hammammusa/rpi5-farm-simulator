// Raspberry Pi 5 Model B — 40-pin J8 header (identical pin-out to Pi 4/3 B, but
// GPIO is provided by the RP1 I/O controller, which is why the classic RPi.GPIO
// library does not work on Pi 5 and gpiozero/lgpio are used instead).

export interface HeaderPin {
  physical: number;
  name: string; // '3V3', '5V', 'GND', 'GPIO17' ...
  bcm: number | null;
  kind: 'power3v3' | 'power5v' | 'ground' | 'gpio';
  alts: string[];
}

const P = (physical: number, name: string, bcm: number | null, alts: string[] = []): HeaderPin => ({
  physical,
  name,
  bcm,
  kind: name === '3V3' ? 'power3v3' : name === '5V' ? 'power5v' : name === 'GND' ? 'ground' : 'gpio',
  alts,
});

export const PI5_HEADER: HeaderPin[] = [
  P(1, '3V3', null),
  P(2, '5V', null),
  P(3, 'GPIO2', 2, ['I2C1 SDA']),
  P(4, '5V', null),
  P(5, 'GPIO3', 3, ['I2C1 SCL']),
  P(6, 'GND', null),
  P(7, 'GPIO4', 4, ['GPCLK0', '1-Wire (default)', 'UART2 TX']),
  P(8, 'GPIO14', 14, ['UART0 TX']),
  P(9, 'GND', null),
  P(10, 'GPIO15', 15, ['UART0 RX']),
  P(11, 'GPIO17', 17, []),
  P(12, 'GPIO18', 18, ['PWM0 CH2', 'PCM CLK']),
  P(13, 'GPIO27', 27, []),
  P(14, 'GND', null),
  P(15, 'GPIO22', 22, []),
  P(16, 'GPIO23', 23, []),
  P(17, '3V3', null),
  P(18, 'GPIO24', 24, []),
  P(19, 'GPIO10', 10, ['SPI0 MOSI']),
  P(20, 'GND', null),
  P(21, 'GPIO9', 9, ['SPI0 MISO', 'UART3 RX']),
  P(22, 'GPIO25', 25, []),
  P(23, 'GPIO11', 11, ['SPI0 SCLK']),
  P(24, 'GPIO8', 8, ['SPI0 CE0', 'UART3 TX']),
  P(25, 'GND', null),
  P(26, 'GPIO7', 7, ['SPI0 CE1']),
  P(27, 'GPIO0', 0, ['ID_SD (HAT EEPROM)', 'UART1 TX']),
  P(28, 'GPIO1', 1, ['ID_SC (HAT EEPROM)', 'UART1 RX']),
  P(29, 'GPIO5', 5, ['UART2 RX']),
  P(30, 'GND', null),
  P(31, 'GPIO6', 6, []),
  P(32, 'GPIO12', 12, ['PWM0 CH0', 'UART4 TX']),
  P(33, 'GPIO13', 13, ['PWM0 CH1', 'UART4 RX']),
  P(34, 'GND', null),
  P(35, 'GPIO19', 19, ['PWM0 CH3', 'PCM FS']),
  P(36, 'GPIO16', 16, []),
  P(37, 'GPIO26', 26, []),
  P(38, 'GPIO20', 20, ['PCM DIN']),
  P(39, 'GND', null),
  P(40, 'GPIO21', 21, ['PCM DOUT']),
];

export const PHYS_TO_BCM: Record<number, number> = {};
export const BCM_TO_PHYS: Record<number, number> = {};
for (const p of PI5_HEADER) {
  if (p.bcm !== null) {
    PHYS_TO_BCM[p.physical] = p.bcm;
    BCM_TO_PHYS[p.bcm] = p.physical;
  }
}

export const HARDWARE_PWM_PINS = [12, 13, 18, 19];

/** UART ports of the Pi 5 header (needs dtparam=uart0 / dtoverlay=uartN on a real Pi). */
export const UART_PORTS: Record<string, { tx: number; rx: number; label: string }> = {
  '/dev/serial0': { tx: 14, rx: 15, label: 'UART0' },
  '/dev/ttyAMA0': { tx: 14, rx: 15, label: 'UART0' },
  '/dev/ttyAMA1': { tx: 0, rx: 1, label: 'UART1' },
  '/dev/ttyAMA2': { tx: 4, rx: 5, label: 'UART2' },
  '/dev/ttyAMA3': { tx: 8, rx: 9, label: 'UART3' },
  '/dev/ttyAMA4': { tx: 12, rx: 13, label: 'UART4' },
};

export const I2C1 = { sda: 2, scl: 3 };
export const SPI0 = { mosi: 10, miso: 9, sclk: 11, ce: [8, 7] };
export const ONEWIRE_DEFAULT_PIN = 4;

/** BCM2712/RP1 reset pulls: GPIO0-8 pulled up, GPIO9-27 pulled down. */
export function defaultPull(bcm: number): 'up' | 'down' {
  return bcm <= 8 ? 'up' : 'down';
}

export const GPIO_LOGIC_V = 3.3;
export const GPIO_ABS_MAX_V = 3.6;
export const GPIO_VIH = 2.0;
export const GPIO_VIL = 0.8;
/** Recommended maximum per-pin current (mA). */
export const GPIO_MAX_MA = 16;
/** Approximate output resistance of a GPIO driver (8 mA drive strength). */
export const GPIO_RINT = 40;

/** Parse a gpiozero-style pin spec: 17, "GPIO17", "BCM17", "BOARD11", "J8:11". */
export function parsePinSpec(spec: string | number): number | null {
  if (typeof spec === 'number') return Number.isInteger(spec) && spec >= 0 && spec <= 27 ? spec : null;
  const s = String(spec).trim().toUpperCase();
  let m = /^(?:GPIO|BCM)?(\d+)$/.exec(s);
  if (m) {
    const n = +m[1];
    return n <= 27 ? n : null;
  }
  m = /^(?:BOARD|J8:)(\d+)$/.exec(s);
  if (m) {
    const b = PHYS_TO_BCM[+m[1]];
    return b === undefined ? null : b;
  }
  return null;
}

export function pinLabel(bcm: number): string {
  return `GPIO${bcm} (pin ${BCM_TO_PHYS[bcm]})`;
}
