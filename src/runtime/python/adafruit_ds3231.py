"""adafruit_ds3231 (simulator): DS3231(i2c) — datetime (time.struct_time), temperature, lost_power."""
import time

from adafruit_bus_device.i2c_device import I2CDevice


def _bcd2bin(v):
    return v - 6 * (v >> 4)


def _bin2bcd(v):
    return v + 6 * (v // 10)


class DS3231:
    def __init__(self, i2c):
        self.i2c_device = I2CDevice(i2c, 0x68)

    def _read(self, reg, n):
        buf = bytearray(n)
        with self.i2c_device as d:
            d.write_then_readinto(bytes([reg]), buf)
        return buf

    @property
    def datetime(self):
        b = self._read(0x00, 7)
        return time.struct_time((2000 + _bcd2bin(b[6]), _bcd2bin(b[5] & 0x1F), _bcd2bin(b[4]), _bcd2bin(b[2] & 0x3F), _bcd2bin(b[1]), _bcd2bin(b[0] & 0x7F), (b[3] - 1) % 7, -1, -1))

    @datetime.setter
    def datetime(self, t):
        data = [_bin2bcd(t.tm_sec), _bin2bcd(t.tm_min), _bin2bcd(t.tm_hour), t.tm_wday % 7 + 1, _bin2bcd(t.tm_mday), _bin2bcd(t.tm_mon), _bin2bcd(t.tm_year - 2000)]
        with self.i2c_device as d:
            d.write(bytes([0x00] + data))

    @property
    def temperature(self):
        b = self._read(0x11, 2)
        t = b[0] if b[0] < 128 else b[0] - 256
        return t + (b[1] >> 6) * 0.25

    @property
    def lost_power(self):
        return bool(self._read(0x0F, 1)[0] & 0x80)

    @lost_power.setter
    def lost_power(self, v):
        st = self._read(0x0F, 1)[0]
        with self.i2c_device as d:
            d.write(bytes([0x0F, st | 0x80 if v else st & 0x7F]))
