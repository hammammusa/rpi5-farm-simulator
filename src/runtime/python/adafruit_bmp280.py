"""adafruit_bmp280 (simulator): Adafruit_BMP280_I2C(i2c, address=0x77) — temperature, pressure, altitude."""
from _bosch import BoschTPH


class Adafruit_BMP280(BoschTPH):
    chip_ids = (0x58,)
    has_humidity = False
    name = 'BMP280'


class Adafruit_BMP280_I2C(Adafruit_BMP280):
    def __init__(self, i2c, address=0x77):
        super().__init__(i2c, address)
