"""MicroPython-compatible framebuf (MONO_VLSB / MONO_HLSB subset) for the simulator.

Includes an 8x8 font for FrameBuffer.text() (ASCII 32-126), derived from the
bitmap font bundled with Pillow.
"""

MONO_VLSB = 0
MONO_HLSB = 3
MONO_HMSB = 4

_FONT = b'\x00\x00\x00\x00\x00\x00\x00\x00\x000000\x000\x00\x00(((\x00\x00\x00\x00((|((|((<dx<\x0clx\x10pTx\x10<T\x1c\x00\x008`0|X|\x00\x18\x10 \x00\x00\x00\x00\x00\x08\x100000\x10\x08 \x10\x18\x18\x18\x18\x10 \x10x0H\x00\x00\x00\x00\x00\x10\x10|\x10\x10\x00\x00\x00\x00\x00\x00\x00\x00\x18\x10\x00\x00\x00|\x00\x00\x00\x00\x00\x00\x00\x00\x00\x000\x00\x04\x04\x08\x08\x10\x10  8lllll8\x00\x18x\x18\x18\x18\x18~\x008l\x0c\x180l|\x008l\x0c8\x0cl8\x00\x0c\x1c,l~\x0c\x0c\x00|`xl\x0cLx\x008l`xll8\x00|l\x0c\x18\x1800\x008ll8ll8\x008ll<\x0cl8\x00\x00\x00\x000\x00\x000\x00\x00\x00\x000\x00\x000 \x00\x180`0\x18\x00\x00\x00\x00x\x00x\x00\x00\x00\x000\x18\x0c\x180\x00\x00\x008L\x180\x000\x008dLTTN`8\x00x8(|ln\x00\x00xlxllx\x00\x00<l``l8\x00\x00xllllx\x00\x00|`x`l|\x00\x00|`x``p\x00\x008l`|l<\x00\x00nl|lln\x00\x00x0000x\x00\x00<\x18\x18XXp\x00\x00lhpxlv\x00\x00p```l|\x00\x00Dll|TT\x00\x00nttlld\x00\x008llll8\x00\x00xllx`p\x00\x008llll8\x0c\x00xllxlv\x00\x00<dx\x1cLx\x00\x00|4000x\x00\x00nllll8\x00\x00nl(88\x10\x00\x00VTT|8(\x00\x00f<\x18\x18<f\x00\x00ff<\x18\x18<\x00\x00|l\x180l|\x0080000008@@  \x10\x10\x08\x088\x18\x18\x18\x18\x18\x188\x108l\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x000\x10\x08\x00\x00\x00\x00\x00\x00\x008l<l~\x00``xlllx\x00\x00\x008l`l8\x00\x1c\x0c<lll>\x00\x00\x008l|`<\x00\x1c0|000|\x00\x00\x006lll<\x0c``xllll\x00\x18\x00x\x18\x18\x18~\x00\x18\x00x\x18\x18\x18\x18\x18``lxpxn\x00x\x18\x18\x18\x18\x18~\x00\x00\x00x|TTT\x00\x00\x00Xllll\x00\x00\x008lll8\x00\x00\x00xlllx`\x00\x006lll<\x0c\x00\x00n:00x\x00\x00\x00<p<\x0e|\x0000|006\x1c\x00\x00\x00llll>\x00\x00\x00ll88\x10\x00\x00\x00VT|<(\x00\x00\x00v<\x18<n\x00\x00\x00nll(80\x00\x00|X0l|\x00\x0c\x18\x180\x18\x18\x18\x0c\x00\x10\x10\x10\x10\x10\x10\x10`00\x18000`\x00\x004X\x00\x00\x00\x00'


class FrameBuffer:
    def __init__(self, buf, width, height, fmt=MONO_VLSB, stride=None):
        self.buf = buf
        self.width = width
        self.height = height
        self.format = fmt
        self.stride = stride or width

    def pixel(self, x, y, c=None):
        if not (0 <= x < self.width and 0 <= y < self.height):
            return None if c is None else None
        if self.format == MONO_VLSB:
            i = (y >> 3) * self.stride + x
            bit = 1 << (y & 7)
        else:
            i = (y * self.stride + x) >> 3
            bit = (0x80 >> (x & 7)) if self.format == MONO_HLSB else (1 << (x & 7))
        if c is None:
            return 1 if self.buf[i] & bit else 0
        if c:
            self.buf[i] |= bit
        else:
            self.buf[i] &= ~bit & 0xFF

    def fill(self, c):
        v = 0xFF if c else 0
        for i in range(len(self.buf)):
            self.buf[i] = v

    def fill_rect(self, x, y, w, h, c):
        for yy in range(max(0, y), min(self.height, y + h)):
            for xx in range(max(0, x), min(self.width, x + w)):
                self.pixel(xx, yy, c)

    def rect(self, x, y, w, h, c, f=False):
        if f:
            return self.fill_rect(x, y, w, h, c)
        self.hline(x, y, w, c)
        self.hline(x, y + h - 1, w, c)
        self.vline(x, y, h, c)
        self.vline(x + w - 1, y, h, c)

    def hline(self, x, y, w, c):
        self.fill_rect(x, y, w, 1, c)

    def vline(self, x, y, h, c):
        self.fill_rect(x, y, 1, h, c)

    def line(self, x0, y0, x1, y1, c):
        dx = abs(x1 - x0)
        dy = -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        while True:
            self.pixel(x0, y0, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def text(self, s, x, y, c=1):
        for ch in str(s):
            code = ord(ch)
            if 32 <= code <= 126:
                g = _FONT[(code - 32) * 8:(code - 31) * 8]
                for row in range(8):
                    bits = g[row]
                    for col in range(8):
                        if bits & (0x80 >> col):
                            self.pixel(x + col, y + row, c)
            x += 8

    def scroll(self, dx, dy):
        old = bytes(self.buf)
        src = FrameBuffer(bytearray(old), self.width, self.height, self.format, self.stride)
        self.fill(0)
        for yy in range(self.height):
            for xx in range(self.width):
                if src.pixel(xx, yy):
                    self.pixel(xx + dx, yy + dy, 1)

    def blit(self, fbuf, x, y, key=-1):
        for yy in range(fbuf.height):
            for xx in range(fbuf.width):
                c = fbuf.pixel(xx, yy)
                if c != key:
                    self.pixel(x + xx, y + yy, c)
