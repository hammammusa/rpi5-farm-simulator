"""st7735 (simulator, EXPERIMENTAL subset API): drive an ST7735 128×160 TFT over SPI0 + a D/C GPIO.

    import st7735
    tft = st7735.ST7735(port=0, cs=0, dc=24, rst=25)
    tft.fill(st7735.color565(0, 0, 0))
    tft.text("Hello", 10, 10, st7735.color565(255, 255, 0))

This is NOT the Pimoroni/Adafruit (PIL image based) API; on a real Pi port the drawing
calls to luma.lcd or adafruit_rgb_display.
"""
import time

import spidev
from _simcore import call as _call, post as _post
import framebuf as _fb


def color565(r, g, b):
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


class ST7735:
    def __init__(self, port=0, cs=0, dc=24, rst=None, width=128, height=160, rotation=0, spi_speed_hz=4000000):
        self.width, self.height = (height, width) if rotation in (90, 270) else (width, height)
        self._dc = int(dc)
        self._rst = rst
        self._spi = spidev.SpiDev(port, cs)
        self._spi.max_speed_hz = spi_speed_hz
        _call('gpio.setup', pin=self._dc, mode='output', owner='st7735 DC')
        if rst is not None:
            _call('gpio.setup', pin=int(rst), mode='output', owner='st7735 RST', initial=1)
        self._rotation = rotation
        self.begin()

    def _cmd(self, c, data=None):
        _post('gpio.write', pin=self._dc, value=0)
        self._spi.xfer2([c])
        if data:
            _post('gpio.write', pin=self._dc, value=1)
            for i in range(0, len(data), 4096):
                self._spi.xfer2(list(data[i : i + 4096]))

    def begin(self):
        if self._rst is not None:
            _post('gpio.write', pin=int(self._rst), value=0)
            time.sleep(0.01)
            _post('gpio.write', pin=int(self._rst), value=1)
        self._cmd(0x01)
        time.sleep(0.15)
        self._cmd(0x11)
        time.sleep(0.12)
        self._cmd(0x3A, [0x05])
        madctl = {0: 0x00, 90: 0x60, 180: 0xC0, 270: 0xA0}.get(self._rotation, 0)
        self._cmd(0x36, [madctl])
        self._cmd(0x29)

    def _window(self, x0, y0, x1, y1):
        self._cmd(0x2A, [x0 >> 8, x0 & 0xFF, x1 >> 8, x1 & 0xFF])
        self._cmd(0x2B, [y0 >> 8, y0 & 0xFF, y1 >> 8, y1 & 0xFF])

    def fill_rect(self, x, y, w, h, color):
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(self.width, x + w) - 1, min(self.height, y + h) - 1
        if x1 < x0 or y1 < y0:
            return
        self._window(x0, y0, x1, y1)
        n = (x1 - x0 + 1) * (y1 - y0 + 1)
        self._cmd(0x2C, [color >> 8, color & 0xFF] * n)

    def fill(self, color):
        self.fill_rect(0, 0, self.width, self.height, color)

    def pixel(self, x, y, color):
        self.fill_rect(x, y, 1, 1, color)

    def rect(self, x, y, w, h, color):
        self.fill_rect(x, y, w, 1, color)
        self.fill_rect(x, y + h - 1, w, 1, color)
        self.fill_rect(x, y, 1, h, color)
        self.fill_rect(x + w - 1, y, 1, h, color)

    def text(self, s, x, y, color, background=0, size=1):
        """Draw text with the built-in 8×8 font; each glyph is one window write (background colour default black)."""
        bg = 0 if background is None else background
        for k, ch in enumerate(str(s)):
            code = ord(ch)
            if code < 32 or code > 127:
                code = 63
            g = _fb._FONT[(code - 32) * 8 : (code - 31) * 8]
            gx = x + k * 8 * size
            if gx >= self.width or y >= self.height:
                break
            w = min(8 * size, self.width - gx)
            h = min(8 * size, self.height - y)
            data = []
            for py in range(h):
                bits = g[py // size]
                for px in range(w):
                    c = color if bits & (0x80 >> (px // size)) else bg
                    data += [c >> 8, c & 0xFF]
            self._window(gx, y, gx + w - 1, y + h - 1)
            self._cmd(0x2C, data)
