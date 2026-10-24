"""adafruit_ccs811 (simulator): CCS811(i2c, address=0x5A) — eco2, tvoc, data_ready."""
import time

from adafruit_bus_device.i2c_device import I2CDevice

DRIVE_MODE_IDLE = 0
DRIVE_MODE_1SEC = 1
DRIVE_MODE_10SEC = 2
DRIVE_MODE_60SEC = 3


class CCS811:
    def __init__(self, i2c_bus, address=0x5A):
        self._dev = I2CDevice(i2c_bus, address)
        if self._read(0x20, 1)[0] != 0x81:
            raise RuntimeError('Device ID returned is not correct! Please check your wiring.')
        if not self._read(0x00, 1)[0] & 0x10:
            raise RuntimeError('Device does not have a valid application loaded')
        with self._dev as d:
            d.write(bytes([0xF4]))  # APP_START
        time.sleep(0.1)
        self.drive_mode = DRIVE_MODE_1SEC
        self._eco2 = None
        self._tvoc = None

    def _read(self, reg, n):
        buf = bytearray(n)
        with self._dev as d:
            d.write_then_readinto(bytes([reg]), buf)
        return list(buf)

    @property
    def drive_mode(self):
        return self._read(0x01, 1)[0] >> 4

    @drive_mode.setter
    def drive_mode(self, m):
        with self._dev as d:
            d.write(bytes([0x01, (m & 7) << 4]))

    @property
    def data_ready(self):
        return bool(self._read(0x00, 1)[0] & 0x08)

    def _update(self):
        if self.data_ready:
            b = self._read(0x02, 8)
            self._eco2 = (b[0] << 8) | b[1]
            self._tvoc = (b[2] << 8) | b[3]

    @property
    def eco2(self):
        self._update()
        return self._eco2

    @property
    def tvoc(self):
        self._update()
        return self._tvoc

    @property
    def error(self):
        return bool(self._read(0x00, 1)[0] & 0x01)
