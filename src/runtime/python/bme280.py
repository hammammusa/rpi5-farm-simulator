"""RPi.bme280-compatible driver: reads the calibration and data registers over
smbus2 and applies the compensation formulas from the Bosch BME280 datasheet."""

import datetime as _dt
import uuid as _uuid

from _simcore import sleep as _sleep

DEFAULT_PORT = 0x76


class oversampling:
    x1, x2, x4, x8, x16 = 1, 2, 3, 4, 5


class params(dict):
    __getattr__ = dict.__getitem__
    __setattr__ = dict.__setitem__


def _s16(v):
    return v - 65536 if v > 32767 else v


def _s8(v):
    return v - 256 if v > 127 else v


def load_calibration_params(bus, address=DEFAULT_PORT):
    c = bus.read_i2c_block_data(address, 0x88, 24)
    u16 = lambda i: c[i] | (c[i + 1] << 8)
    p = params()
    p.dig_T1 = u16(0)
    p.dig_T2 = _s16(u16(2))
    p.dig_T3 = _s16(u16(4))
    p.dig_P1 = u16(6)
    for k, i in zip(range(2, 10), range(8, 24, 2)):
        p['dig_P%d' % k] = _s16(u16(i))
    p.dig_H1 = bus.read_byte_data(address, 0xA1)
    h = bus.read_i2c_block_data(address, 0xE1, 7)
    p.dig_H2 = _s16(h[0] | (h[1] << 8))
    p.dig_H3 = h[2]
    p.dig_H4 = (_s8(h[3]) << 4) | (h[4] & 0x0F)
    p.dig_H5 = (_s8(h[5]) << 4) | (h[4] >> 4)
    p.dig_H6 = _s8(h[6])
    return p


class compensated_readings:
    def __init__(self, raw, p):
        self.id = _uuid.uuid4()
        self.timestamp = _dt.datetime.now()
        t_fine, self.temperature = self._temp(raw['t'], p)
        self.pressure = self._press(raw['p'], t_fine, p) / 100.0
        self.humidity = self._hum(raw['h'], t_fine, p)

    @staticmethod
    def _temp(adc, p):
        v1 = (adc / 16384.0 - p.dig_T1 / 1024.0) * p.dig_T2
        v2 = (adc / 131072.0 - p.dig_T1 / 8192.0) ** 2 * p.dig_T3
        t_fine = v1 + v2
        return t_fine, t_fine / 5120.0

    @staticmethod
    def _press(adc, t_fine, p):
        v1 = t_fine / 2.0 - 64000.0
        v2 = v1 * v1 * p.dig_P6 / 32768.0
        v2 = v2 + v1 * p.dig_P5 * 2.0
        v2 = v2 / 4.0 + p.dig_P4 * 65536.0
        v1 = (p.dig_P3 * v1 * v1 / 524288.0 + p.dig_P2 * v1) / 524288.0
        v1 = (1.0 + v1 / 32768.0) * p.dig_P1
        if v1 == 0:
            return 0
        pr = 1048576.0 - adc
        pr = (pr - v2 / 4096.0) * 6250.0 / v1
        v1 = p.dig_P9 * pr * pr / 2147483648.0
        v2 = pr * p.dig_P8 / 32768.0
        return pr + (v1 + v2 + p.dig_P7) / 16.0

    @staticmethod
    def _hum(adc, t_fine, p):
        h = t_fine - 76800.0
        h = (adc - (p.dig_H4 * 64.0 + p.dig_H5 / 16384.0 * h)) * (p.dig_H2 / 65536.0 * (1.0 + p.dig_H6 / 67108864.0 * h * (1.0 + p.dig_H3 / 67108864.0 * h)))
        h = h * (1.0 - p.dig_H1 * h / 524288.0)
        return max(0.0, min(100.0, h))

    def __repr__(self):
        return 'compensated_reading(id=%s, timestamp=%s, temp=%0.3f °C, pressure=%0.2f hPa, humidity=%0.2f %% rH)' % (
            self.id, self.timestamp, self.temperature, self.pressure, self.humidity)


def sample(bus, address=DEFAULT_PORT, compensation_params=None, sampling=oversampling.x1):
    if compensation_params is None:
        compensation_params = load_calibration_params(bus, address)
    bus.write_byte_data(address, 0xF2, sampling)
    bus.write_byte_data(address, 0xF4, (sampling << 5) | (sampling << 2) | 1)  # forced mode
    _sleep(0.01)
    d = bus.read_i2c_block_data(address, 0xF7, 8)
    raw = {
        'p': (d[0] << 12) | (d[1] << 4) | (d[2] >> 4),
        't': (d[3] << 12) | (d[4] << 4) | (d[5] >> 4),
        'h': (d[6] << 8) | d[7],
    }
    return compensated_readings(raw, compensation_params)
