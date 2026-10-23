"""RPLCD-compatible CharLCD for a PCF8574 I2C backpack (HD44780, 4-bit mode).

The driver sends the same byte stream as the real library; the simulated LCD
decodes E strobes, RS and nibbles from those bytes.
"""

from smbus2 import SMBus, i2c_msg

RS = 0x01
EN = 0x04
BL = 0x08
ROW_OFFSETS = (0x00, 0x40, 0x14, 0x54)


class CharLCD:
    def __init__(self, i2c_expander='PCF8574', address=0x27, expander_params=None, port=1, cols=16, rows=2, dotsize=8,
                 charmap='A02', auto_linebreaks=True, backlight_enabled=True):
        if i2c_expander not in ('PCF8574', 'PCF8574A'):
            raise NotImplementedError('Only the PCF8574 backpack is simulated')
        self._addr = address
        self._bus = SMBus(port)
        self.cols = cols
        self.rows = rows
        self.auto_linebreaks = auto_linebreaks
        self._bl = BL if backlight_enabled else 0
        self._pos = (0, 0)
        out = []
        for n in (0x03, 0x03, 0x03, 0x02):
            out += self._nibble_bytes(n, 0)
        self._send(out)
        self.command(0x28 if rows > 1 else 0x20)  # 4-bit, lines, 5x8
        self.command(0x0C)  # display on
        self.clear()
        self.command(0x06)  # entry mode: increment

    def _nibble_bytes(self, nibble, rs):
        b = ((nibble & 0x0F) << 4) | self._bl | rs
        return [b, b | EN, b]

    def _send(self, data):
        self._bus.i2c_rdwr(i2c_msg.write(self._addr, data))

    def _byte(self, v, rs):
        return self._nibble_bytes(v >> 4, rs) + self._nibble_bytes(v & 0x0F, rs)

    def command(self, v):
        self._send(self._byte(v, 0))

    def write(self, v):
        self._send(self._byte(v, RS))

    def clear(self):
        self.command(0x01)
        self._pos = (0, 0)

    def home(self):
        self.command(0x02)
        self._pos = (0, 0)

    @property
    def cursor_pos(self):
        return self._pos

    @cursor_pos.setter
    def cursor_pos(self, value):
        row, col = value
        self._pos = (row, col)
        self.command(0x80 | (ROW_OFFSETS[row] + col))

    @property
    def backlight_enabled(self):
        return bool(self._bl)

    @backlight_enabled.setter
    def backlight_enabled(self, v):
        self._bl = BL if v else 0
        self._send([self._bl])

    @property
    def display_enabled(self):
        return True

    @display_enabled.setter
    def display_enabled(self, v):
        self.command(0x0C if v else 0x08)

    def write_string(self, value):
        out = []
        row, col = self._pos
        for ch in str(value):
            if ch == '\n':
                row = (row + 1) % self.rows
                out += self._byte(0x80 | (ROW_OFFSETS[row] + col), 0)
                continue
            if ch == '\r':
                col = 0
                out += self._byte(0x80 | ROW_OFFSETS[row], 0)
                continue
            code = 0xDF if ch == '°' else (ord(ch) if ord(ch) < 256 else ord('?'))
            out += self._byte(code, RS)
            col += 1
            if col >= self.cols and self.auto_linebreaks:
                col = 0
                row = (row + 1) % self.rows
                out += self._byte(0x80 | ROW_OFFSETS[row], 0)
        self._send(out)
        self._pos = (row, col)

    def create_char(self, location, bitmap):
        out = self._byte(0x40 | ((location & 7) << 3), 0)
        for b in bitmap:
            out += self._byte(b, RS)
        self._send(out)
        self.cursor_pos = self._pos

    def close(self, clear=False):
        if clear:
            self.clear()
