"""Legacy Adafruit_DHT API (deprecated upstream and not supported on Raspberry Pi 5).

Provided so older tutorials run in the simulator; on a real Pi 5 use adafruit_dht.
"""

import sys as _sys

from _simcore import call as _call, sleep as _sleep

DHT11 = 11
DHT22 = 22
AM2302 = 22
_warned = False


def read(sensor, pin, platform=None):
    global _warned
    if not _warned:
        _warned = True
        _sys.stderr.write('[simulator] Adafruit_DHT is deprecated and does not run on Raspberry Pi 5 — use adafruit_dht.DHT22(board.D%d)\n' % int(pin))
    r = _call('dht.read', pin=int(pin))
    if r.get('error'):
        return None, None
    if sensor == DHT11:
        return float(round(r['humidity'])), float(round(r['temperature']))
    return r['humidity'], r['temperature']


def read_retry(sensor, pin, retries=15, delay_seconds=2, platform=None):
    for _ in range(retries):
        h, t = read(sensor, pin)
        if h is not None and t is not None:
            return h, t
        _sleep(delay_seconds)
    return None, None
