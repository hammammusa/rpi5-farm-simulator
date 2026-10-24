"""adafruit_bme680 (simulator): Adafruit_BME680_I2C(i2c, address=0x77) — temperature, relative_humidity, pressure, gas, altitude.

FUNCTIONAL MODEL: the simulated BME680 stores compensated values in a simplified register
layout (documented in the part); this driver reads that layout. On a real BME680 use the
real `adafruit-circuitpython-bme680` package, which applies the Bosch calibration.
"""
import time

from adafruit_bus_device.i2c_device import I2CDevice


class Adafruit_BME680:
    def __init__(self, refresh_rate=10):
        if self._read(0xD0, 1)[0] != 0x61:
            raise RuntimeError('Failed to find BME680! Chip ID 0x%x' % self._read(0xD0, 1)[0])
        self._write(0xE0, 0xB6)
        time.sleep(0.005)
        self.sea_level_pressure = 1013.25
        self._last = None

    def _measure(self):
        self._write(0x74, 0x25)  # forced mode
        time.sleep(0.01)
        for _ in range(20):
            if self._read(0x1D, 1)[0] & 0x80:
                break
            time.sleep(0.005)
        d = self._read(0x1F, 15)
        p = (d[0] << 16) | (d[1] << 8) | d[2]
        t = (d[3] << 8) | d[4]
        if t & 0x8000:
            t -= 0x10000
        h = (d[6] << 8) | d[7]
        g = (d[11] << 24) | (d[12] << 16) | (d[13] << 8) | d[14]
        self._last = (t / 100.0, h / 1000.0, p / 100.0, g)
        return self._last

    @property
    def temperature(self):
        return self._measure()[0]

    @property
    def relative_humidity(self):
        return self._measure()[1]

    humidity = relative_humidity

    @property
    def pressure(self):
        return self._measure()[2]

    @property
    def gas(self):
        return self._measure()[3]

    @property
    def altitude(self):
        return 44330 * (1.0 - (self.pressure / self.sea_level_pressure) ** 0.1903)


class Adafruit_BME680_I2C(Adafruit_BME680):
    def __init__(self, i2c, address=0x77, debug=False, *, refresh_rate=10):
        self._dev = I2CDevice(i2c, address)
        super().__init__(refresh_rate=refresh_rate)

    def _read(self, reg, n):
        buf = bytearray(n)
        with self._dev as d:
            d.write_then_readinto(bytes([reg]), buf)
        return list(buf)

    def _write(self, reg, val):
        with self._dev as d:
            d.write(bytes([reg, val]))
