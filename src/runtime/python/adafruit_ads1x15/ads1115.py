"""adafruit_ads1x15.ads1115: ADS1115(i2c, gain=1, address=0x48), pins P0–P3."""
from adafruit_ads1x15.ads1x15 import ADS1x15, Mode, Pin  # noqa: F401

P0, P1, P2, P3 = 0, 1, 2, 3


class ADS1115(ADS1x15):
    bits = 16
