"""Adafruit Blinka `digitalio` on the simulated Raspberry Pi 5 GPIO."""

from _simcore import call as _call, post as _post

__version__ = '8.0.0-sim'

_state = {}  # bcm -> [is_output, value]


def _sim_reset():
    _state.clear()


def _outputs_low():
    return [b for b, (out, v) in _state.items() if out and not v]


class Direction:
    INPUT = 'INPUT'
    OUTPUT = 'OUTPUT'


class Pull:
    UP = 'UP'
    DOWN = 'DOWN'


class DriveMode:
    PUSH_PULL = 'PUSH_PULL'
    OPEN_DRAIN = 'OPEN_DRAIN'


class DigitalInOut:
    def __init__(self, pin):
        self._bcm = int(getattr(pin, 'id', pin))
        self._dir = Direction.INPUT
        self._pull = None
        self._value = False
        _call('gpio.setup', pin=self._bcm, mode='input', pull='none', owner='digitalio')
        _state[self._bcm] = [False, False]

    def deinit(self):
        _state.pop(self._bcm, None)
        try:
            _call('gpio.release', pin=self._bcm)
        except BaseException:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.deinit()

    def switch_to_output(self, value=False, drive_mode=DriveMode.PUSH_PULL):
        self._dir = Direction.OUTPUT
        self._value = bool(value)
        _call('gpio.setup', pin=self._bcm, mode='output', owner='digitalio', initial=1 if value else 0)
        _state[self._bcm] = [True, self._value]

    def switch_to_input(self, pull=None):
        self._dir = Direction.INPUT
        self._pull = pull
        _call('gpio.setup', pin=self._bcm, mode='input', pull={Pull.UP: 'up', Pull.DOWN: 'down'}.get(pull, 'none'), owner='digitalio')
        _state[self._bcm] = [False, False]

    @property
    def direction(self):
        return self._dir

    @direction.setter
    def direction(self, d):
        if d == Direction.OUTPUT:
            self.switch_to_output(self._value)
        else:
            self.switch_to_input(self._pull)

    @property
    def pull(self):
        return self._pull

    @pull.setter
    def pull(self, p):
        if self._dir == Direction.OUTPUT:
            raise AttributeError('Not an input')
        self.switch_to_input(p)

    @property
    def value(self):
        if self._dir == Direction.OUTPUT:
            return self._value
        return bool(_call('gpio.read', pin=self._bcm)['value'])

    @value.setter
    def value(self, v):
        if self._dir != Direction.OUTPUT:
            raise AttributeError('Not an output')
        self._value = bool(v)
        _state[self._bcm] = [True, self._value]
        _post('gpio.write', pin=self._bcm, value=1 if v else 0)

    @property
    def drive_mode(self):
        return DriveMode.PUSH_PULL
