"""adafruit_pcf8574 (simulator): PCF8574(i2c, address=0x20) — get_pin(n), read_gpio(), write_gpio()."""
from adafruit_bus_device.i2c_device import I2CDevice
import digitalio


class PCF8574:
    def __init__(self, i2c, address=0x20):
        self.i2c_device = I2CDevice(i2c, address)
        self._writebuf = 0xFF
        self.write_gpio(0xFF)

    def write_gpio(self, val):
        self._writebuf = val & 0xFF
        with self.i2c_device as d:
            d.write(bytes([self._writebuf]))

    def read_gpio(self):
        buf = bytearray(1)
        with self.i2c_device as d:
            d.readinto(buf)
        return buf[0]

    def write_pin(self, pin, val):
        if val:
            self.write_gpio(self._writebuf | (1 << pin))
        else:
            self.write_gpio(self._writebuf & ~(1 << pin))

    def read_pin(self, pin):
        return (self.read_gpio() >> pin) & 1

    def get_pin(self, pin):
        if not 0 <= pin < 8:
            raise ValueError('Pin number must be 0-7')
        return DigitalInOut(pin, self)


class DigitalInOut:
    def __init__(self, pin_number, pcf):
        self._pin = pin_number
        self._pcf = pcf
        self._dir = digitalio.Direction.INPUT

    def switch_to_output(self, value=False, **kwargs):
        self._dir = digitalio.Direction.OUTPUT
        self.value = value

    def switch_to_input(self, pull=None, **kwargs):
        self._dir = digitalio.Direction.INPUT
        self._pcf.write_pin(self._pin, True)  # release (weak pull-up)

    @property
    def direction(self):
        return self._dir

    @direction.setter
    def direction(self, d):
        if d == digitalio.Direction.OUTPUT:
            self.switch_to_output()
        else:
            self.switch_to_input()

    @property
    def value(self):
        return bool(self._pcf.read_pin(self._pin))

    @value.setter
    def value(self, v):
        self._pcf.write_pin(self._pin, bool(v))
