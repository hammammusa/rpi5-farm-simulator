"""Bosch BME280/BMP280 datasheet compensation (floating-point version), shared by the
adafruit_bme280 / adafruit_bmp280 simulator drivers. It reads the calibration registers
from the device, exactly like the real libraries."""

import struct
import time

from adafruit_bus_device.i2c_device import I2CDevice


class BoschTPH:
    chip_ids = (0x60,)
    has_humidity = True
    name = 'BME280'

    def __init__(self, i2c, address):
        self._dev = I2CDevice(i2c, address)
        cid = self._read(0xD0, 1)[0]
        if cid not in self.chip_ids:
            raise RuntimeError('Failed to find %s! Chip ID 0x%x' % (self.name, cid))
        self._write(0xE0, 0xB6)  # soft reset
        time.sleep(0.004)
        self._t = struct.unpack('<HhhHhhhhhhhh', bytes(self._read(0x88, 24)))
        if self.has_humidity:
            h1 = self._read(0xA1, 1)[0]
            c = self._read(0xE1, 7)
            h2, h3 = struct.unpack('<hB', bytes(c[0:3]))
            h4 = (c[3] << 4) | (c[4] & 0x0F)
            if h4 & 0x800:
                h4 -= 0x1000
            h5 = (c[5] << 4) | (c[4] >> 4)
            if h5 & 0x800:
                h5 -= 0x1000
            h6 = struct.unpack('<b', bytes([c[6]]))[0]
            self._h = (h1, h2, h3, h4, h5, h6)
            self._write(0xF2, 0x01)  # humidity oversampling ×1
        self._write(0xF4, 0x27)  # T and P oversampling ×1, normal mode
        self.sea_level_pressure = 1013.25
        self._t_fine = 0.0

    def _read(self, reg, n):
        buf = bytearray(n)
        with self._dev as d:
            d.write_then_readinto(bytes([reg]), buf)
        return list(buf)

    def _write(self, reg, val):
        with self._dev as d:
            d.write(bytes([reg, val]))

    def _raw(self):
        d = self._read(0xF7, 8 if self.has_humidity else 6)
        p = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4)
        t = (d[3] << 12) | (d[4] << 4) | (d[5] >> 4)
        h = (d[6] << 8) | d[7] if self.has_humidity else 0
        return t, p, h

    @property
    def temperature(self):
        adc, _, _ = self._raw()
        t1, t2, t3 = self._t[0:3]
        v1 = (adc / 16384.0 - t1 / 1024.0) * t2
        v2 = ((adc / 131072.0 - t1 / 8192.0) ** 2) * t3
        self._t_fine = v1 + v2
        return self._t_fine / 5120.0

    @property
    def pressure(self):
        self.temperature
        _, adc, _ = self._raw()
        p1, p2, p3, p4, p5, p6, p7, p8, p9 = self._t[3:12]
        v1 = self._t_fine / 2.0 - 64000.0
        v2 = v1 * v1 * p6 / 32768.0
        v2 = v2 + v1 * p5 * 2.0
        v2 = v2 / 4.0 + p4 * 65536.0
        v1 = (p3 * v1 * v1 / 524288.0 + p2 * v1) / 524288.0
        v1 = (1.0 + v1 / 32768.0) * p1
        if v1 == 0:
            return 0
        pr = 1048576.0 - adc
        pr = ((pr - v2 / 4096.0) * 6250.0) / v1
        v1 = p9 * pr * pr / 2147483648.0
        v2 = pr * p8 / 32768.0
        return (pr + (v1 + v2 + p7) / 16.0) / 100.0  # hPa

    @property
    def relative_humidity(self):
        if not self.has_humidity:
            raise AttributeError('%s has no humidity sensor' % self.name)
        self.temperature
        _, _, adc = self._raw()
        h1, h2, h3, h4, h5, h6 = self._h
        v = self._t_fine - 76800.0
        v = (adc - (h4 * 64.0 + h5 / 16384.0 * v)) * (h2 / 65536.0 * (1.0 + h6 / 67108864.0 * v * (1.0 + h3 / 67108864.0 * v)))
        v = v * (1.0 - h1 * v / 524288.0)
        return max(0.0, min(100.0, v))

    humidity = relative_humidity

    @property
    def altitude(self):
        return 44330 * (1.0 - (self.pressure / self.sea_level_pressure) ** 0.1903)
