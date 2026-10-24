"""adafruit_mcp230xx.digital_inout.DigitalInOut for MCP23017 pins."""
import digitalio


class DigitalInOut:
    def __init__(self, pin_number, mcp):
        self._pin = pin_number
        self._mcp = mcp

    def _bit(self, reg, v):
        cur = self._mcp._read_u16(reg)
        self._mcp._write_u16(reg, cur | (1 << self._pin) if v else cur & ~(1 << self._pin))

    def switch_to_output(self, value=False, **kwargs):
        self.direction = digitalio.Direction.OUTPUT
        self.value = value

    def switch_to_input(self, pull=None, invert_polarity=False, **kwargs):
        self.direction = digitalio.Direction.INPUT
        self.pull = pull

    @property
    def direction(self):
        return digitalio.Direction.INPUT if self._mcp.iodir & (1 << self._pin) else digitalio.Direction.OUTPUT

    @direction.setter
    def direction(self, d):
        self._bit(0x00, d == digitalio.Direction.INPUT)

    @property
    def value(self):
        return bool(self._mcp.gpio & (1 << self._pin))

    @value.setter
    def value(self, v):
        cur = self._mcp.olat
        self._mcp._write_u16(0x14, cur | (1 << self._pin) if v else cur & ~(1 << self._pin))

    @property
    def pull(self):
        return digitalio.Pull.UP if self._mcp.gppu & (1 << self._pin) else None

    @pull.setter
    def pull(self, p):
        if p == digitalio.Pull.DOWN:
            raise ValueError('Pull-down resistors are not supported!')
        self._bit(0x0C, p == digitalio.Pull.UP)
