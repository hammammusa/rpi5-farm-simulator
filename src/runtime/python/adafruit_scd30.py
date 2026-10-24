"""adafruit_scd30 (simulator): SCD30(i2c) — data_available, CO2, temperature, relative_humidity."""
import struct
import time

from _sensirion import SensirionDevice


class SCD30(SensirionDevice):
    def __init__(self, i2c_bus, ambient_pressure=0, address=0x61):
        super().__init__(i2c_bus, address)
        self._co2 = self._t = self._h = None
        self.reset()
        self.measurement_interval = 2
        self._cmd(0x0010, [ambient_pressure])  # start continuous measurement

    def reset(self):
        self._cmd(0xD304, delay=0.03)

    @property
    def measurement_interval(self):
        self._cmd(0x4600, delay=0.003)
        return self._read_words(1)[0]

    @measurement_interval.setter
    def measurement_interval(self, v):
        self._cmd(0x4600, [int(v)])

    @property
    def data_available(self):
        self._cmd(0x0202, delay=0.003)
        return bool(self._read_words(1)[0])

    def _read_data(self):
        self._cmd(0x0300, delay=0.003)
        w = self._read_words(6)
        f = [struct.unpack('>f', struct.pack('>HH', w[i], w[i + 1]))[0] for i in (0, 2, 4)]
        self._co2, self._t, self._h = f

    @property
    def CO2(self):
        if self.data_available or self._co2 is None:
            self._read_data()
        return self._co2

    @property
    def temperature(self):
        if self.data_available or self._t is None:
            self._read_data()
        return self._t

    @property
    def relative_humidity(self):
        if self.data_available or self._h is None:
            self._read_data()
        return self._h

    @property
    def firmware_version(self):
        self._cmd(0xD100, delay=0.003)
        return self._read_words(1)[0]
