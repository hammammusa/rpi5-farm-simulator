# ds18x20 module (MicroPython API): DS18B20 temperature on a OneWire bus.
from _sched import call
import onewire


class DS18X20:
    def __init__(self, onewire_bus):
        self.ow = onewire_bus

    def scan(self):
        return [rom for rom in self.ow.scan() if rom[0] in (0x10, 0x22, 0x28)]

    def convert_temp(self):
        # the simulated sensor converts instantly; real code waits 750 ms afterwards
        call('ow.scan', pin=self.ow._pin)

    def read_temp(self, rom):
        return call('ow.temp', pin=self.ow._pin, rom=onewire._rid(rom))
