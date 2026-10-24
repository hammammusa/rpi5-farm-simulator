"""adafruit_tsl2561 (simulator): TSL2561(i2c, address=0x39) — lux, broadband, infrared, gain, integration_time."""
import time

from adafruit_bus_device.i2c_device import I2CDevice

_CMD = 0x80
_WORD = 0x20
_CLIP = (4900, 37000, 65000)
_SCALE = (322 / 11.0, 322 / 81.0, 1.0)


class TSL2561:
    def __init__(self, i2c, address=0x39):
        self._dev = I2CDevice(i2c, address)
        pid = self.chip_id
        if pid[0] != 0x05:
            raise RuntimeError('Failed to find TSL2561! Part 0x%x Rev 0x%x' % pid)
        self.enabled = True
        self._gain = 0
        self._integ = 2
        self._timing()

    def _rd(self, reg, n):
        buf = bytearray(n)
        with self._dev as d:
            d.write_then_readinto(bytes([_CMD | (_WORD if n == 2 else 0) | reg]), buf)
        return buf

    def _wr(self, reg, val):
        with self._dev as d:
            d.write(bytes([_CMD | reg, val]))

    @property
    def chip_id(self):
        v = self._rd(0x0A, 1)[0]
        return (v >> 4, v & 0x0F)

    @property
    def enabled(self):
        return (self._rd(0x00, 1)[0] & 3) == 3

    @enabled.setter
    def enabled(self, on):
        self._wr(0x00, 0x03 if on else 0x00)
        time.sleep(0.01)

    def _timing(self):
        self._wr(0x01, (0x10 if self._gain else 0) | self._integ)

    @property
    def gain(self):
        return self._gain

    @gain.setter
    def gain(self, g):
        self._gain = 1 if g else 0
        self._timing()

    @property
    def integration_time(self):
        return self._integ

    @integration_time.setter
    def integration_time(self, t):
        self._integ = int(t) & 3
        self._timing()

    @property
    def broadband(self):
        b = self._rd(0x0C, 2)
        return b[0] | (b[1] << 8)

    @property
    def infrared(self):
        b = self._rd(0x0E, 2)
        return b[0] | (b[1] << 8)

    @property
    def luminosity(self):
        return self.broadband, self.infrared

    @property
    def lux(self):
        ch0, ch1 = self.luminosity
        if ch0 == 0 or ch0 > _CLIP[min(self._integ, 2)] or ch1 > _CLIP[min(self._integ, 2)]:
            return None
        scale = _SCALE[min(self._integ, 2)] * (1 if self._gain else 16)
        ch0 *= scale
        ch1 *= scale
        r = ch1 / ch0
        if r <= 0.50:
            lux = 0.0304 * ch0 - 0.062 * ch0 * r ** 1.4
        elif r <= 0.61:
            lux = 0.0224 * ch0 - 0.031 * ch1
        elif r <= 0.80:
            lux = 0.0128 * ch0 - 0.0153 * ch1
        elif r <= 1.30:
            lux = 0.00146 * ch0 - 0.00112 * ch1
        else:
            lux = 0.0
        return lux
