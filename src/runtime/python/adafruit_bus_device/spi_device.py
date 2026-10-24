"""adafruit_bus_device.spi_device.SPIDevice over the simulated busio.SPI."""


class SPIDevice:
    def __init__(self, spi, chip_select=None, *, cs_active_value=False, baudrate=100000, polarity=0, phase=0, extra_clocks=0):
        self.spi = spi
        self.chip_select = chip_select
        self.cs_active_value = cs_active_value
        if chip_select is not None:
            chip_select.switch_to_output(value=not cs_active_value)

    def __enter__(self):
        while not self.spi.try_lock():
            pass
        if self.chip_select is not None:
            self.chip_select.value = self.cs_active_value
        return self.spi

    def __exit__(self, *exc):
        if self.chip_select is not None:
            self.chip_select.value = not self.cs_active_value
        self.spi.unlock()
        return False
