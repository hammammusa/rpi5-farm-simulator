"""RPi.GPIO-compatible API for the Raspberry Pi 5 simulator.

The original RPi.GPIO library does NOT work on a Raspberry Pi 5 (the GPIO
lives on the RP1 chip). On a real Pi 5 install the drop-in replacement:
    sudo apt remove python3-rpi.gpio && pip install rpi-lgpio
This module behaves like rpi-lgpio. Event callbacks run cooperatively
(during sleep()/waits), not in a background thread.
"""

import sys as _sys

import _simcore
from _simcore import call as _call, post as _post, now as _now, sleep as _sleep

VERSION = '0.6 (rpi-lgpio compatible, simulator)'
RPI_INFO = {'P1_REVISION': 3, 'REVISION': 'd04170', 'TYPE': 'Pi 5 Model B', 'MANUFACTURER': 'Sony UK', 'PROCESSOR': 'BCM2712', 'RAM': '8G'}
RPI_REVISION = 3

BOARD = 10
BCM = 11
OUT = 0
IN = 1
HIGH = 1
LOW = 0
PUD_OFF = 20
PUD_DOWN = 21
PUD_UP = 22
RISING = 31
FALLING = 32
BOTH = 33
UNKNOWN = -1
SERIAL = 40
SPI = 41
I2C = 42
HARD_PWM = 43

_mode = None
_warnings = True
_setup = {}  # bcm -> IN/OUT
_events = {}  # bcm -> {'edge':..., 'callbacks': [...], 'flag': bool, 'channel': user channel}


def _sim_reset():
    global _mode, _warnings
    _mode = None
    _warnings = True
    _setup.clear()
    _events.clear()


def _sim_shutdown():
    pass


def setwarnings(flag):
    global _warnings
    _warnings = bool(flag)


def setmode(mode):
    global _mode
    if mode not in (BOARD, BCM):
        raise ValueError('An invalid mode was passed to setmode()')
    if _mode is not None and _mode != mode:
        raise ValueError('A different mode has already been set!')
    _mode = mode


def getmode():
    return _mode


def _bcm(channel):
    if _mode is None:
        raise RuntimeError('Please set pin numbering mode using GPIO.setmode(GPIO.BOARD) or GPIO.setmode(GPIO.BCM)')
    try:
        ch = int(channel)
    except (TypeError, ValueError):
        raise ValueError('The channel sent is invalid on a Raspberry Pi')
    spec = ('BOARD%d' % ch) if _mode == BOARD else ch
    try:
        return _call('gpio.pin', spec=spec)
    except Exception:
        raise ValueError('The channel sent is invalid on a Raspberry Pi')


def _each(channel):
    if isinstance(channel, (list, tuple)):
        return list(channel)
    return [channel]


def setup(channel, direction, pull_up_down=PUD_OFF, initial=None):
    if direction not in (IN, OUT):
        raise ValueError('An invalid direction was passed to setup()')
    for ch in _each(channel):
        b = _bcm(ch)
        if b in _setup:
            if _warnings:
                _sys.stderr.write('RuntimeWarning: This channel is already in use, continuing anyway.  Use GPIO.setwarnings(False) to disable warnings.\n')
            _call('gpio.release', pin=b)
        if direction == OUT:
            init = 0 if initial is None else (1 if initial else 0)
            _call('gpio.setup', pin=b, mode='output', owner='RPi.GPIO', initial=init)
        else:
            pull = {PUD_UP: 'up', PUD_DOWN: 'down'}.get(pull_up_down, 'none')
            _call('gpio.setup', pin=b, mode='input', pull=pull, owner='RPi.GPIO')
        _setup[b] = direction


def output(channel, value):
    chans = _each(channel)
    vals = _each(value) if isinstance(value, (list, tuple)) else [value] * len(chans)
    if len(vals) != len(chans):
        raise RuntimeError('Number of channels != number of values')
    for ch, v in zip(chans, vals):
        b = _bcm(ch)
        if _setup.get(b) != OUT:
            raise RuntimeError('The GPIO channel has not been set up as an OUTPUT')
        _post('gpio.write', pin=b, value=1 if v else 0)


def input(channel):
    b = _bcm(channel)
    if b not in _setup:
        raise RuntimeError('You must setup() the GPIO channel first')
    return _call('gpio.read', pin=b)['value']


def gpio_function(channel):
    b = _bcm(channel)
    return _setup.get(b, IN)


def cleanup(channel=None):
    chans = list(_setup) if channel is None else [_bcm(c) for c in _each(channel)]
    for b in chans:
        if b in _events:
            remove_event_detect_bcm(b)
        if b in _setup:
            _call('gpio.release', pin=b)
            del _setup[b]


def _matches(edge, level):
    return edge == BOTH or (edge == RISING and level == 1) or (edge == FALLING and level == 0)


def add_event_detect(channel, edge, callback=None, bouncetime=None):
    b = _bcm(channel)
    if _setup.get(b) != IN:
        raise RuntimeError('You must setup() the GPIO channel as an input first')
    if edge not in (RISING, FALLING, BOTH):
        raise ValueError('The edge must be set to RISING, FALLING or BOTH')
    if b in _events:
        raise RuntimeError('Conflicting edge detection already enabled for this GPIO channel')
    ev = {'edge': edge, 'callbacks': [], 'flag': False, 'channel': channel}
    _events[b] = ev

    def handler(level, t, ev=ev):
        if not _matches(ev['edge'], level):
            return
        ev['flag'] = True
        for cb in list(ev['callbacks']):
            cb(ev['channel'])

    ev['handler'] = handler
    _call('gpio.watch', pin=b, on=True, bounce=int(bouncetime or 0))
    _simcore.on_edge(b, handler)
    if callback is not None:
        ev['callbacks'].append(callback)


def add_event_callback(channel, callback):
    b = _bcm(channel)
    if b not in _events:
        raise RuntimeError('Add event detection using add_event_detect first before adding a callback')
    _events[b]['callbacks'].append(callback)


def remove_event_detect_bcm(b):
    ev = _events.pop(b, None)
    if ev:
        _simcore.off_edge(b, ev['handler'])
        _call('gpio.watch', pin=b, on=False)


def remove_event_detect(channel):
    remove_event_detect_bcm(_bcm(channel))


def event_detected(channel):
    b = _bcm(channel)
    ev = _events.get(b)
    if not ev:
        return False
    _simcore.dispatch()
    f = ev['flag']
    ev['flag'] = False
    return f


def wait_for_edge(channel, edge, bouncetime=None, timeout=None):
    b = _bcm(channel)
    if _setup.get(b) != IN:
        raise RuntimeError('You must setup() the GPIO channel as an input first')
    if b in _events:
        raise RuntimeError('Conflicting edge detection events already exist for this GPIO channel')
    hit = []

    def h(level, t):
        if _matches(edge, level):
            hit.append(1)

    _call('gpio.watch', pin=b, on=True, bounce=int(bouncetime or 0))
    _simcore.on_edge(b, h)
    try:
        _simcore.wait_until(lambda: bool(hit), None if timeout is None else timeout / 1000.0, poll=0.005)
    finally:
        _simcore.off_edge(b, h)
        _call('gpio.watch', pin=b, on=False)
    return channel if hit else None


class PWM:
    def __init__(self, channel, frequency):
        b = _bcm(channel)
        if _setup.get(b) != OUT:
            raise RuntimeError('You must setup() the GPIO channel as an output first')
        if frequency <= 0:
            raise ValueError('frequency must be greater than 0.0')
        self._b = b
        self._freq = float(frequency)
        self._dc = 0.0
        self._running = False

    def start(self, dutycycle):
        if not 0 <= dutycycle <= 100:
            raise ValueError('dutycycle must have a value from 0.0 to 100.0')
        self._dc = float(dutycycle)
        self._running = True
        _post('gpio.pwm', pin=self._b, freq=self._freq, duty=self._dc / 100.0)

    def ChangeDutyCycle(self, dutycycle):
        if not 0 <= dutycycle <= 100:
            raise ValueError('dutycycle must have a value from 0.0 to 100.0')
        self._dc = float(dutycycle)
        if self._running:
            _post('gpio.pwm', pin=self._b, freq=self._freq, duty=self._dc / 100.0)

    def ChangeFrequency(self, frequency):
        if frequency <= 0:
            raise ValueError('frequency must be greater than 0.0')
        self._freq = float(frequency)
        if self._running:
            _post('gpio.pwm', pin=self._b, freq=self._freq, duty=self._dc / 100.0)

    def stop(self):
        self._running = False
        _post('gpio.write', pin=self._b, value=0)
