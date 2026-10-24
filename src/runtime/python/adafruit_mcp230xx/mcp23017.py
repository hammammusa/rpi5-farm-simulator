"""adafruit_mcp230xx.mcp23017: MCP23017(i2c, address=0x20) — get_pin(0..15), gpio, iodir, gppu."""
from adafruit_bus_device.i2c_device import I2CDevice
from adafruit_mcp230xx.digital_inout import DigitalInOut


class MCP23017:
    def __init__(self, i2c, address=0x20, reset=True):
        self._device = I2CDevice(i2c, address)
        if reset:
            self.iodir = 0xFFFF
            self.gppu = 0x0000
            self._write_u16(0x02, 0x0000)  # IPOL

    def _read_u16(self, reg):
        buf = bytearray(2)
        with self._device as d:
            d.write_then_readinto(bytes([reg]), buf)
        return buf[0] | (buf[1] << 8)

    def _write_u16(self, reg, val):
        with self._device as d:
            d.write(bytes([reg, val & 0xFF, (val >> 8) & 0xFF]))

    @property
    def gpio(self):
        return self._read_u16(0x12)

    @gpio.setter
    def gpio(self, val):
        self._write_u16(0x12, val)

    @property
    def iodir(self):
        return self._read_u16(0x00)

    @iodir.setter
    def iodir(self, val):
        self._write_u16(0x00, val)

    @property
    def gppu(self):
        return self._read_u16(0x0C)

    @gppu.setter
    def gppu(self, val):
        self._write_u16(0x0C, val)

    @property
    def olat(self):
        return self._read_u16(0x14)

    def get_pin(self, pin):
        if not 0 <= pin <= 15:
            raise ValueError('Pin number must be 0-15.')
        return DigitalInOut(pin, self)
