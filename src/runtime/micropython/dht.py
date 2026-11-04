# dht module (MicroPython ESP32 API): DHT11 / DHT22 on one data pin.
from _sched import call


class DHTBase:
    def __init__(self, pin):
        self._pin = pin._id if hasattr(pin, '_id') else int(pin)
        self._t = None
        self._h = None

    def measure(self):
        r = call('dht.read', pin=self._pin, kind=self._kind)
        self._t = r['t']
        self._h = r['h']


class DHT11(DHTBase):
    _kind = 'DHT11'

    def temperature(self):
        return int(self._t)

    def humidity(self):
        return int(self._h)


class DHT22(DHTBase):
    _kind = 'DHT22'

    def temperature(self):
        return float(self._t)

    def humidity(self):
        return float(self._h)
