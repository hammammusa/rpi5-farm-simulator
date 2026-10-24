"""adafruit_sht31d (simulator): SHT31D(i2c, address=0x44) — temperature, relative_humidity, heater, serial_number."""
import time

from _sensirion import SensirionDevice

_DEFAULT_ADDR = 0x44


class SHT31D(SensirionDevice):
    def __init__(self, i2c_bus, address=_DEFAULT_ADDR):
        if address not in (0x44, 0x45):
            raise ValueError('Invalid address: 0x%x' % address)
        super().__init__(i2c_bus, address)
        self._heater = False
        self.reset()

    def reset(self):
        self._cmd(0x30A2, delay=0.0015)
        self._heater = False

    def _measure(self):
        self._cmd(0x2400, delay=0.0155)
        t, h = self._read_words(2)
        return -45 + 175 * t / 65535.0, 100 * h / 65535.0

    @property
    def temperature(self):
        return self._measure()[0]

    @property
    def relative_humidity(self):
        return self._measure()[1]

    @property
    def heater(self):
        return self._heater

    @heater.setter
    def heater(self, on):
        self._cmd(0x306D if on else 0x3066)
        self._heater = bool(on)

    @property
    def serial_number(self):
        self._cmd(0x3780, delay=0.001)
        a, b = self._read_words(2)
        return (a << 16) | b

    @property
    def status(self):
        self._cmd(0xF32D, delay=0.001)
        return self._read_words(1)[0]

    def _get_values(self):
        return self._measure()
