"""adafruit_tca9548a (simulator): TCA9548A(i2c, address=0x70); tca[n] behaves like a busio.I2C on channel n."""


class TCA9548A_Channel:
    def __init__(self, tca, channel):
        self.tca = tca
        self.channel_switch = bytearray([1 << channel])

    def _select(self):
        self.tca.i2c.writeto(self.tca.address, self.channel_switch)

    def try_lock(self):
        while not self.tca.i2c.try_lock():
            pass
        self._select()
        return True

    def unlock(self):
        self.tca.i2c.writeto(self.tca.address, b'\x00')
        return self.tca.i2c.unlock()

    def scan(self):
        self._select()
        return [a for a in self.tca.i2c.scan() if a != self.tca.address]

    def readfrom_into(self, address, buffer, **kwargs):
        if address == self.tca.address:
            raise ValueError('Device address must be different than TCA9548A address.')
        return self.tca.i2c.readfrom_into(address, buffer, **kwargs)

    def writeto(self, address, buffer, **kwargs):
        if address == self.tca.address:
            raise ValueError('Device address must be different than TCA9548A address.')
        return self.tca.i2c.writeto(address, buffer, **kwargs)

    def writeto_then_readfrom(self, address, buffer_out, buffer_in, **kwargs):
        if address == self.tca.address:
            raise ValueError('Device address must be different than TCA9548A address.')
        return self.tca.i2c.writeto_then_readfrom(address, buffer_out, buffer_in, **kwargs)


class TCA9548A:
    def __init__(self, i2c, address=0x70):
        self.i2c = i2c
        self.address = address
        self.channels = [None] * 8

    def __len__(self):
        return 8

    def __getitem__(self, key):
        if not 0 <= key <= 7:
            raise IndexError('Channel must be an integer in the range: 0-7.')
        if self.channels[key] is None:
            self.channels[key] = TCA9548A_Channel(self, key)
        return self.channels[key]
