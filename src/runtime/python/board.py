"""Adafruit Blinka `board` pin names for the Raspberry Pi 5 (BCM numbering)."""


class Pin:
    def __init__(self, bcm):
        self.id = bcm

    def __int__(self):
        return self.id

    def __index__(self):
        return self.id

    def __repr__(self):
        return 'board.D%d' % self.id

    def __eq__(self, other):
        return isinstance(other, Pin) and other.id == self.id

    def __hash__(self):
        return hash(self.id)


for _i in range(28):
    globals()['D%d' % _i] = Pin(_i)

SDA = D2  # noqa: F821
SCL = D3  # noqa: F821
SDA1, SCL1 = SDA, SCL
TXD = D14  # noqa: F821
RXD = D15  # noqa: F821
TX, RX = TXD, RXD
MOSI = D10  # noqa: F821
MISO = D9  # noqa: F821
SCLK = D11  # noqa: F821
SCK = SCLK
CE0 = D8  # noqa: F821
CE1 = D7  # noqa: F821
board_id = 'RASPBERRY_PI_5'
