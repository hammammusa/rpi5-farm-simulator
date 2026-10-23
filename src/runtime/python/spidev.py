"""py-spidev compatible SPI access (/dev/spidev0.0 = CE0/GPIO8, /dev/spidev0.1 = CE1/GPIO7)."""

from _simcore import call as _call


class SpiDev:
    def __init__(self, bus=None, device=None):
        self.max_speed_hz = 125000000
        self.mode = 0
        self.bits_per_word = 8
        self.cshigh = False
        self.lsbfirst = False
        self.threewire = False
        self.loop = False
        self.no_cs = False
        self._dev = None
        if bus is not None:
            self.open(bus, device or 0)

    def open(self, bus, device):
        _call('spi.open', bus=int(bus), dev=int(device))
        self._bus = int(bus)
        self._dev = int(device)

    def close(self):
        self._dev = None

    def _x(self, data):
        if self._dev is None:
            raise OSError(9, 'Bad file descriptor')
        return list(_call('spi.xfer', dev=self._dev, data=[int(x) & 0xff for x in data]))

    def xfer(self, data, speed_hz=0, delay_usecs=0, bits_per_word=0):
        return self._x(data)

    def xfer2(self, data, speed_hz=0, delay_usecs=0, bits_per_word=0):
        return self._x(data)

    def xfer3(self, data, speed_hz=0, delay_usecs=0, bits_per_word=0):
        return self._x(data)

    def readbytes(self, n):
        return self._x([0] * n)

    def writebytes(self, data):
        self._x(data)

    def writebytes2(self, data):
        self._x(list(data))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
