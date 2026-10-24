"""neopixel (simulator): NeoPixel(pin, n, brightness=1.0, auto_write=True, pixel_order=GRB).

On a real Raspberry Pi 5 install `adafruit-circuitpython-neopixel` and
`adafruit-blinka-raspberry-pi5-neopixel` (the Pi 5 uses its RP1 PIO for the 800 kHz signal).
"""
from _simcore import call as _call

RGB = 'RGB'
GRB = 'GRB'
RGBW = 'RGBW'
GRBW = 'GRBW'

__version__ = '6.3.0-sim'


def _norm(c):
    if isinstance(c, int):
        return [(c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF]
    c = list(c)
    if len(c) == 4:  # RGBW → approximate as RGB + white
        return [min(255, c[0] + c[3]), min(255, c[1] + c[3]), min(255, c[2] + c[3])]
    return [int(c[0]) & 0xFF, int(c[1]) & 0xFF, int(c[2]) & 0xFF]


class NeoPixel:
    def __init__(self, pin, n, *, bpp=3, brightness=1.0, auto_write=True, pixel_order=None):
        self._bcm = int(getattr(pin, 'id', pin))
        self.n = int(n)
        self._px = [[0, 0, 0] for _ in range(self.n)]
        self._brightness = max(0.0, min(1.0, float(brightness)))
        self.auto_write = auto_write
        self.pixel_order = pixel_order or GRB
        _call('gpio.setup', pin=self._bcm, mode='output', owner='neopixel')

    def __len__(self):
        return self.n

    def __setitem__(self, i, color):
        if isinstance(i, slice):
            idx = range(*i.indices(self.n))
            for k, c in zip(idx, color):
                self._px[k] = _norm(c)
        else:
            if i < 0:
                i += self.n
            if not 0 <= i < self.n:
                raise IndexError('index out of range')
            self._px[i] = _norm(color)
        if self.auto_write:
            self.show()

    def __getitem__(self, i):
        if isinstance(i, slice):
            return [tuple(p) for p in self._px[i]]
        return tuple(self._px[i])

    def fill(self, color):
        c = _norm(color)
        self._px = [list(c) for _ in range(self.n)]
        if self.auto_write:
            self.show()

    @property
    def brightness(self):
        return self._brightness

    @brightness.setter
    def brightness(self, b):
        self._brightness = max(0.0, min(1.0, float(b)))
        if self.auto_write:
            self.show()

    def show(self):
        b = self._brightness
        _call('ws2812.show', pin=self._bcm, pixels=[[int(c * b) for c in p] for p in self._px])

    def deinit(self):
        self._px = [[0, 0, 0] for _ in range(self.n)]
        self.show()
        try:
            _call('gpio.release', pin=self._bcm)
        except BaseException:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.deinit()
