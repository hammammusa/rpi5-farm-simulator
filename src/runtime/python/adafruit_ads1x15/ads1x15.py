"""Shared ADS1x15 register logic (simulator)."""
import struct
import time

from adafruit_bus_device.i2c_device import I2CDevice

_GAINS = {2 / 3: 6.144, 1: 4.096, 2: 2.048, 4: 1.024, 8: 0.512, 16: 0.256}
_PGA = {2 / 3: 0, 1: 1, 2: 2, 4: 3, 8: 4, 16: 5}


class Mode:
    CONTINUOUS = 0x0000
    SINGLE = 0x0100


class Pin:
    A0, A1, A2, A3 = 0, 1, 2, 3


class ADS1x15:
    def __init__(self, i2c, gain=1, data_rate=None, mode=Mode.SINGLE, comparator_queue_length=0, address=0x48):
        if gain not in _GAINS:
            raise ValueError('Gain must be one of: {}'.format(sorted(_GAINS)))
        self.i2c_device = I2CDevice(i2c, address)
        self._gain = gain
        self.mode = mode
        self.data_rate = data_rate or 128
        self._last_mux = None

    @property
    def gain(self):
        return self._gain

    @gain.setter
    def gain(self, g):
        if g not in _GAINS:
            raise ValueError('Gain must be one of: {}'.format(sorted(_GAINS)))
        self._gain = g

    @property
    def gains(self):
        return sorted(_GAINS)

    def read(self, pin, is_differential=False):
        mux = pin if is_differential else pin + 0x04
        cfg = 0x8000 | ((mux & 7) << 12) | (_PGA[self._gain] << 9) | self.mode | 0x0083
        with self.i2c_device as d:
            d.write(bytes([0x01, (cfg >> 8) & 0xFF, cfg & 0xFF]))
        if self.mode == Mode.SINGLE:
            time.sleep(1.0 / self.data_rate + 0.0001)
        buf = bytearray(2)
        with self.i2c_device as d:
            d.write_then_readinto(bytes([0x00]), buf)
        return struct.unpack('>h', bytes(buf))[0]

    def _volts(self, raw):
        return raw * _GAINS[self._gain] / 32767.0
