// Wiren Board 7.4 (Wiren Board LLC) — Linux automation controller (ARM Cortex-A7, Debian).
// Terminal data from the Wiren Board 7.4 wiki page and the wb-hwconf-manager board file
// boards/wb74x.conf: supply 9…48 V DC on V+; universal channels A1–A4 = open-collector output
// to GND (30 V, 1 A, over-current protected, High-Z by default) plus input / voltage measurement
// (100 kΩ, 0…36.3 V); W1–W2 = 1-Wire or discrete input lines at 5 V; RS-485-1 and RS-485-2
// (RS-485-2 shares its transceiver with CAN). MQTT names follow wb-mqtt-gpio / wb-mqtt-adc.
import type { BoardDefinition, BoardPin } from './types';

const t = (pin: string, label: string, kind: BoardPin['kind'], num?: number): BoardPin => ({ pin, label, num, kind, caps: kind === 'terminal' ? { input: true, output: true } : {} });

export const WB74: BoardDefinition = {
  type: 'wb74',
  family: 'plc',
  vendor: 'Wiren Board',
  model: 'Wiren Board 7.4',
  languages: ['wbrules'],
  defaultLanguage: 'wbrules',
  logicV: 5,
  absMaxV: 30,
  pinMa: { recommended: 1000, max: 1000 },
  pins: [
    t('VIN1', 'V+', 'power'),
    t('VIN2', 'V+', 'power'),
    t('GND1', 'GND', 'ground'),
    t('GND2', 'GND', 'ground'),
    t('GND3', 'GND', 'ground'),
    t('A1', 'A1', 'terminal', 1),
    t('A2', 'A2', 'terminal', 2),
    t('A3', 'A3', 'terminal', 3),
    t('A4', 'A4', 'terminal', 4),
    t('W1', 'W1', 'terminal', 101),
    t('W2', 'W2', 'terminal', 102),
    t('RS1_A', 'RS-485-1 A', 'terminal'),
    t('RS1_B', 'RS-485-1 B', 'terminal'),
    t('RS2_A', 'RS-485-2 A', 'terminal'),
    t('RS2_B', 'RS-485-2 B', 'terminal'),
  ],
  sources: ['Wiren Board wiki, "Wiren Board 7.4" — terminals, ratings', 'github.com/wirenboard/wb-hwconf-manager boards/wb74x.conf — RS485-1, RS485-2 (shared with CAN)', 'github.com/wirenboard/wb-rules README — rule API', 'github.com/wirenboard/wb-mqtt-gpio — /devices/wb-gpio/controls/A1_OUT, A1_IN'],
  limits:
    'Functional model: wb-rules scripts run in a QuickJS sandbox against a virtual MQTT broker and simulated wb-mqtt-gpio / wb-mqtt-adc / wb-mqtt-w1 / wb-mqtt-serial drivers. Debian, the Linux kernel, the web UI, CAN, the expansion-module slots, Ethernet/Wi-Fi hardware and the RTC are not emulated.',
};

export const WB74_CHANNELS = [1, 2, 3, 4] as const;
/** analog measurement range of A1–A4 (rev. 7.4; 7.4.1 measures up to 32.5 V) */
export const WB74_ADC_MAX_V = 36.3;
export const WB74_OUT_MAX_V = 30;
export const WB74_OUT_MAX_A = 1;
export const WB74_SUPPLY = { min: 9, max: 48 };
