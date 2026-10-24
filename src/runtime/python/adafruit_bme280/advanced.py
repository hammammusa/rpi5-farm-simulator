"""adafruit_bme280.basic: Adafruit_BME280_I2C(i2c, address=0x77) — temperature, humidity, pressure, altitude."""
from _bosch import BoschTPH


class Adafruit_BME280(BoschTPH):
    chip_ids = (0x60,)
    name = 'BME280'


class Adafruit_BME280_I2C(Adafruit_BME280):
    def __init__(self, i2c, address=0x77):
        super().__init__(i2c, address)
