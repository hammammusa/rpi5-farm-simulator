# neopixel module (MicroPython API): WS2812 strip on one data pin.
from _sched import call


class NeoPixel:
    ORDER = (1, 0, 2, 3)

    def __init__(self, pin, n, bpp=3, timing=1):
        self.pin = pin._id if hasattr(pin, '_id') else int(pin)
        self.n = n
        self.bpp = bpp
        self._px = [(0, 0, 0)] * n

    def __len__(self):
        return self.n

    def __setitem__(self, i, v):
        self._px[i] = tuple(v[:3])

    def __getitem__(self, i):
        return self._px[i]

    def fill(self, v):
        for i in range(self.n):
            self._px[i] = tuple(v[:3])

    def write(self):
        call('np.write', pin=self.pin, px=[list(p) for p in self._px])
