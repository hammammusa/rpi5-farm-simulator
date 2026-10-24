"""adafruit_bus_device.i2c_device.I2CDevice over the simulated busio.I2C."""


class I2CDevice:
    def __init__(self, i2c, device_address, probe=True):
        self.i2c = i2c
        self.device_address = device_address
        if probe:
            self.__probe_for_device()

    def __probe_for_device(self):
        while not self.i2c.try_lock():
            pass
        try:
            self.i2c.writeto(self.device_address, b'')
        except OSError:
            try:
                buf = bytearray(1)
                self.i2c.readfrom_into(self.device_address, buf)
            except OSError:
                raise ValueError('No I2C device at address: 0x%x' % self.device_address)
        finally:
            self.i2c.unlock()

    def readinto(self, buf, *, start=0, end=None):
        self.i2c.readfrom_into(self.device_address, buf, start=start, end=end)

    def write(self, buf, *, start=0, end=None):
        self.i2c.writeto(self.device_address, buf, start=start, end=end)

    def write_then_readinto(self, out_buffer, in_buffer, *, out_start=0, out_end=None, in_start=0, in_end=None):
        self.i2c.writeto_then_readfrom(self.device_address, out_buffer, in_buffer, out_start=out_start, out_end=out_end, in_start=in_start, in_end=in_end)

    def __enter__(self):
        while not self.i2c.try_lock():
            pass
        return self

    def __exit__(self, *exc):
        self.i2c.unlock()
        return False
