"""adafruit_scd4x (simulator): SCD4X(i2c) — start_periodic_measurement(), data_ready, CO2, temperature, relative_humidity."""
import time

from _sensirion import SensirionDevice


class SCD4X(SensirionDevice):
    def __init__(self, i2c_bus, address=0x62):
        super().__init__(i2c_bus, address)
        self._co2 = self._t = self._h = None
        self.stop_periodic_measurement()

    def start_periodic_measurement(self):
        self._cmd(0x21B1)

    def start_low_periodic_measurement(self):
        self._cmd(0x21AC)

    def stop_periodic_measurement(self):
        self._cmd(0x3F86, delay=0.5)

    def measure_single_shot(self):
        self._cmd(0x219D, delay=5)

    @property
    def data_ready(self):
        self._cmd(0xE4B8, delay=0.001)
        return (self._read_words(1)[0] & 0x07FF) != 0

    @property
    def serial_number(self):
        self._cmd(0x3682, delay=0.001)
        return tuple(b for w in self._read_words(3) for b in (w >> 8, w & 0xFF))

    def _read_data(self):
        self._cmd(0xEC05, delay=0.001)
        co2, t, h = self._read_words(3)
        self._co2 = co2
        self._t = -45 + 175 * t / 65535.0
        self._h = 100 * h / 65535.0

    @property
    def CO2(self):
        if self.data_ready:
            self._read_data()
        return self._co2

    @property
    def temperature(self):
        if self.data_ready:
            self._read_data()
        return self._t

    @property
    def relative_humidity(self):
        if self.data_ready:
            self._read_data()
        return self._h
