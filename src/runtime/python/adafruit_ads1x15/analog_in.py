"""adafruit_ads1x15.analog_in.AnalogIn(ads, positive_pin, negative_pin=None) — value (raw) and voltage."""

_DIFF = {(0, 1): 0, (0, 3): 1, (1, 3): 2, (2, 3): 3}


class AnalogIn:
    def __init__(self, ads, positive_pin, negative_pin=None):
        self._ads = ads
        self._pos = positive_pin
        self._neg = negative_pin
        self.is_differential = negative_pin is not None
        if self.is_differential and (positive_pin, negative_pin) not in _DIFF:
            raise ValueError('Differential channels must be (P0,P1), (P0,P3), (P1,P3) or (P2,P3)')

    @property
    def value(self):
        if self.is_differential:
            return self._ads.read(_DIFF[(self._pos, self._neg)], is_differential=True)
        return self._ads.read(self._pos)

    @property
    def voltage(self):
        return self._ads._volts(self.value)
