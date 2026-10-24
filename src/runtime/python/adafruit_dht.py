"""adafruit-circuitpython-dht compatible DHT11/DHT22 driver (works on Raspberry Pi 5).

Like the real library: reading faster than every 2 s returns the cached value,
and failed reads raise RuntimeError — wrap reads in try/except and retry.
"""

from _simcore import call as _call, now as _now

__version__ = '4.0.4-sim'

_claimed = set()


def _sim_reset():
    _claimed.clear()


class DHTBase:
    _min_interval = 2.0
    _kind = 'DHT22'

    def __init__(self, pin, use_pulseio=True):
        self._bcm = int(getattr(pin, 'id', pin))
        if self._bcm in _claimed:
            raise RuntimeError('pin %d is already in use by another DHT sensor' % self._bcm)
        _call('gpio.setup', pin=self._bcm, mode='input', pull='none', owner='adafruit_dht.%s' % self._kind)
        _claimed.add(self._bcm)
        self._last = -1e9
        self._temperature = None
        self._humidity = None

    def measure(self):
        t = _now()
        if t - self._last < self._min_interval and self._temperature is not None:
            return
        self._last = t
        r = _call('dht.read', pin=self._bcm, kind=self._kind)
        err = r.get('error')
        if err == 'not_found':
            hint = r.get('hint')
            raise RuntimeError('DHT sensor not found, check wiring' + (' (simulator: %s)' % hint if hint else ''))
        if err == 'timeout':
            raise RuntimeError('A full buffer was not returned. Try again.')
        if self._kind == 'DHT11':
            self._temperature = int(round(r['temperature']))
            self._humidity = int(round(r['humidity']))
        else:
            self._temperature = r['temperature']
            self._humidity = r['humidity']

    @property
    def temperature(self):
        self.measure()
        return self._temperature

    @property
    def humidity(self):
        self.measure()
        return self._humidity

    def exit(self):
        if self._bcm in _claimed:
            _claimed.discard(self._bcm)
            try:
                _call('gpio.release', pin=self._bcm)
            except BaseException:
                pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.exit()


class DHT22(DHTBase):
    _kind = 'DHT22'


class DHT21(DHTBase):
    _kind = 'DHT22'


class DHT11(DHTBase):
    _kind = 'DHT11'
    _min_interval = 1.0
