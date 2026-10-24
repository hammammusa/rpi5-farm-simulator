"""tm1637 (simulator): TM1637(clk, dio, brightness=7) — the raspberrypi-tm1637 style API.

The driver really bit-bangs the TM1637 two-wire protocol on the two GPIOs (DIO is driven
open-drain: input = released HIGH by the module pull-up, output LOW = 0) and reads the ACK.
"""
from _simcore import call as _call, post as _post

_SEG = {
    '0': 0x3F, '1': 0x06, '2': 0x5B, '3': 0x4F, '4': 0x66, '5': 0x6D, '6': 0x7D, '7': 0x07, '8': 0x7F, '9': 0x6F,
    'A': 0x77, 'b': 0x7C, 'B': 0x7C, 'C': 0x39, 'c': 0x58, 'd': 0x5E, 'D': 0x5E, 'E': 0x79, 'F': 0x71, 'G': 0x3D,
    'H': 0x76, 'h': 0x74, 'I': 0x06, 'J': 0x1E, 'L': 0x38, 'n': 0x54, 'N': 0x37, 'o': 0x5C, 'O': 0x3F, 'P': 0x73,
    'r': 0x50, 'S': 0x6D, 't': 0x78, 'U': 0x3E, 'u': 0x1C, 'y': 0x6E, 'Y': 0x6E, '-': 0x40, '_': 0x08, ' ': 0x00,
    '°': 0x63, '*': 0x63,
}


class TM1637:
    def __init__(self, clk, dio, brightness=7):
        self.clk = int(clk)
        self.dio = int(dio)
        self._bright = max(0, min(7, int(brightness)))
        _call('gpio.setup', pin=self.clk, mode='output', owner='tm1637 CLK', initial=1)
        _call('gpio.setup', pin=self.dio, mode='input', pull='none', owner='tm1637 DIO')
        self.ack_errors = 0

    # -- open-drain DIO and bit-level protocol
    def _dio(self, v):
        if v:
            _call('gpio.setup', pin=self.dio, mode='input', pull='none', owner='tm1637 DIO')
        else:
            _call('gpio.setup', pin=self.dio, mode='output', owner='tm1637 DIO', initial=0)

    def _clk(self, v):
        _post('gpio.write', pin=self.clk, value=1 if v else 0)

    def _start(self):
        self._clk(1)
        self._dio(1)
        self._dio(0)
        self._clk(0)

    def _stop(self):
        self._clk(0)
        self._dio(0)
        self._clk(1)
        self._dio(1)

    def _byte(self, b):
        for i in range(8):
            self._clk(0)
            self._dio((b >> i) & 1)
            self._clk(1)
        self._clk(0)
        self._dio(1)  # release DIO for the ACK
        self._clk(1)
        ack = _call('gpio.read', pin=self.dio)['value'] == 0
        self._clk(0)
        if not ack:
            self.ack_errors += 1
        return ack

    # -- commands
    def write(self, segments, pos=0):
        if not 0 <= pos <= 5:
            raise ValueError('Position out of range')
        self._start()
        self._byte(0x40)  # data command, auto-increment
        self._stop()
        self._start()
        self._byte(0xC0 | pos)
        for s in segments:
            self._byte(s & 0xFF)
        self._stop()
        self._start()
        self._byte(0x88 | self._bright)
        self._stop()

    def brightness(self, val=None):
        if val is None:
            return self._bright
        self._bright = max(0, min(7, int(val)))
        self._start()
        self._byte(0x88 | self._bright)
        self._stop()

    @staticmethod
    def encode_char(ch):
        if ch not in _SEG:
            raise ValueError("Character out of range: '%s'" % ch)
        return _SEG[ch]

    def encode_string(self, s):
        return [self.encode_char(c) for c in s]

    def show(self, string, colon=False):
        segs = self.encode_string(str(string)[:4].rjust(4) if len(str(string)) < 4 else str(string)[:4])
        if colon and len(segs) > 1:
            segs[1] |= 0x80
        self.write(segs)

    def number(self, num):
        num = max(-999, min(9999, int(num)))
        self.show(str(num).rjust(4))

    def numbers(self, num1, num2, colon=True):
        s = '%02d%02d' % (max(-9, min(99, int(num1))), max(-9, min(99, int(num2))))
        self.show(s, colon)

    def hex(self, val):
        self.show('%04x' % (val & 0xFFFF))

    def temperature(self, num):
        if num < -9:
            self.show(' Lo ')
        elif num > 99:
            self.show(' Hi ')
        else:
            self.show('%2d*C' % int(num))
