"""gpiozero compatibility layer for the Raspberry Pi 5 simulator.

Implements the most used gpiozero classes with the same names, arguments and
behaviour, backed by the simulated GPIO (pin factory: "SimFactory", standing in
for lgpio which gpiozero uses on a real Raspberry Pi 5).

Differences from real gpiozero:
  * callbacks (when_pressed, when_activated ...) run cooperatively while your
    program is inside sleep(), pause() or another blocking call, not in a
    background thread;
  * blink()/pulse() in background are executed by the simulator clock.
"""

import inspect as _inspect

import _simcore
from _simcore import call as _call, post as _post, now as _now, sleep as _sleep, wait_until as _wait_until

__version__ = '2.0.1-sim'


class GPIOZeroError(Exception):
    pass


class DeviceClosed(GPIOZeroError):
    pass


class BadEventHandler(GPIOZeroError, ValueError):
    pass


class BadWaitTime(GPIOZeroError, ValueError):
    pass


class BadPinFactory(GPIOZeroError, ImportError):
    pass


class InputDeviceError(GPIOZeroError):
    pass


class OutputDeviceError(GPIOZeroError):
    pass


class OutputDeviceBadValue(OutputDeviceError, ValueError):
    pass


class PinError(GPIOZeroError):
    pass


class PinInvalidPin(PinError, ValueError):
    pass


class PinFixedPull(PinError, AttributeError):
    pass


class GPIOPinInUse(GPIOZeroError):
    pass


class SPIError(GPIOZeroError):
    pass


class SPIBadChannel(SPIError, ValueError):
    pass


class PinInvalidState(PinError, ValueError):
    pass


_simcore.EXC.update({'GPIOPinInUse': GPIOPinInUse, 'PinInvalidPin': PinInvalidPin})

_devices = []


def _sim_reset():
    _devices.clear()
    _spi_open.clear()


def _sim_shutdown():
    for d in list(_devices):
        try:
            d.close()
        except BaseException:
            pass
    _devices.clear()


class SimFactory:
    """Stand-in for gpiozero.pins.lgpio.LGPIOFactory on a Pi 5."""

    def __repr__(self):
        return '<SimFactory (Raspberry Pi 5 simulator)>'


class Pin:
    def __init__(self, number):
        self.number = number

    @property
    def info(self):
        return 'GPIO%d' % self.number

    def __repr__(self):
        return 'GPIO%d' % self.number

    def __str__(self):
        return 'GPIO%d' % self.number

    def __eq__(self, other):
        return isinstance(other, Pin) and other.number == self.number

    def __hash__(self):
        return hash(self.number)


def _wrap_handler(fn, device):
    if fn is None:
        return None
    if not callable(fn):
        raise BadEventHandler('value must be None or a callable')
    try:
        sig = _inspect.signature(fn)
        params = [p for p in sig.parameters.values() if p.default is p.empty and p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
        n = len(params)
    except (TypeError, ValueError):
        n = 0
    if n == 0:
        return lambda: fn()
    if n == 1:
        return lambda: fn(device)
    raise BadEventHandler('value must be a callable which accepts up to one mandatory parameter')


class Device:
    pin_factory = SimFactory()

    def __init__(self, *args, pin_factory=None, **kwargs):
        self._closed = False
        _devices.append(self)

    def close(self):
        self._closed = True
        if self in _devices:
            _devices.remove(self)

    @property
    def closed(self):
        return self._closed

    def _check_open(self):
        if self._closed:
            raise DeviceClosed('%s is closed or uninitialized' % self.__class__.__name__)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    @property
    def is_active(self):
        return bool(self.value)

    def __del__(self):
        pass

    # -- source/values
    @property
    def values(self):
        while True:
            yield self.value
            _sleep(getattr(self, 'source_delay', 0.01))


class GPIODevice(Device):
    def __init__(self, pin=None, *, pin_factory=None):
        if pin is None:
            raise GPIOZeroError('No pin given')
        super().__init__()
        try:
            self._bcm = _call('gpio.pin', spec=pin)
        except BaseException:
            self.close()
            raise
        self._pin = Pin(self._bcm)

    @property
    def pin(self):
        return None if self._closed else self._pin

    def close(self):
        if not self._closed:
            try:
                _call('gpio.release', pin=self._bcm)
            except BaseException:
                pass
        super().close()

    def __repr__(self):
        if self._closed:
            return '<gpiozero.%s object closed>' % self.__class__.__name__
        return '<gpiozero.%s object on pin GPIO%d, is_active=%s>' % (self.__class__.__name__, self._bcm, self.is_active)


# ---------------------------------------------------------------- outputs
class OutputDevice(GPIODevice):
    def __init__(self, pin=None, *, active_high=True, initial_value=False, pin_factory=None):
        super().__init__(pin)
        self._active_high = bool(active_high)
        self._active = bool(initial_value)
        try:
            _call('gpio.setup', pin=self._bcm, mode='output', owner=self.__class__.__name__, initial=self._level(self._active))
        except BaseException:
            self._closed = True
            if self in _devices:
                _devices.remove(self)
            raise
        self._source_handler = None

    def _level(self, active):
        return 1 if bool(active) == self._active_high else 0

    def _write(self, active):
        self._check_open()
        self._active = bool(active)
        _post('gpio.write', pin=self._bcm, value=self._level(active))

    def on(self):
        self._write(True)

    def off(self):
        self._write(False)

    def toggle(self):
        self._write(not self.is_active)

    @property
    def value(self):
        self._check_open()
        lvl = _call('gpio.read', pin=self._bcm)['value']
        return 1 if (lvl == 1) == self._active_high else 0

    @value.setter
    def value(self, v):
        self._write(bool(v))

    @property
    def active_high(self):
        return self._active_high

    @active_high.setter
    def active_high(self, v):
        self._active_high = bool(v)

    @property
    def is_active(self):
        return bool(self.value)

    # gpiozero's "source" property: follow another device's value
    @property
    def source(self):
        return getattr(self, '_source', None)

    @source.setter
    def source(self, src):
        self._source = src
        if src is None:
            return
        if isinstance(src, DigitalInputDevice):
            def follow(_v=None, _t=None, s=src):
                self.value = s.value
            src._followers.append(follow)
            follow()
        else:
            try:
                for v in src:
                    self.value = v
                    _sleep(getattr(self, 'source_delay', 0.01))
            except TypeError:
                raise GPIOZeroError('source must be a device or an iterable')


class DigitalOutputDevice(OutputDevice):
    def blink(self, on_time=1, off_time=1, n=None, background=True):
        self._check_open()
        a, i = self._level(True), self._level(False)
        _post('gpio.pattern', pin=self._bcm, pattern={'steps': [[a, on_time], [i, off_time]], 'repeat': n, 'pwm': False, 'freq': 0})
        if not background:
            if n is None:
                _simcore.idle_forever()
            _sleep((on_time + off_time) * n)


class LED(DigitalOutputDevice):
    @property
    def is_lit(self):
        return self.is_active


class Buzzer(DigitalOutputDevice):
    def beep(self, on_time=1, off_time=1, n=None, background=True):
        self.blink(on_time, off_time, n, background)


def _fade_steps(on_time, off_time, fade_in, fade_out, hi=1.0, lo=0.0, fps=25):
    steps = []
    if fade_in > 0:
        k = max(1, int(fade_in * fps))
        steps += [[lo + (hi - lo) * (j / k), fade_in / k] for j in range(k)]
    if on_time > 0:
        steps.append([hi, on_time])
    if fade_out > 0:
        k = max(1, int(fade_out * fps))
        steps += [[hi - (hi - lo) * (j / k), fade_out / k] for j in range(k)]
    if off_time > 0:
        steps.append([lo, off_time])
    return steps


class PWMOutputDevice(OutputDevice):
    def __init__(self, pin=None, *, active_high=True, initial_value=0, frequency=100, pin_factory=None):
        if not 0 <= initial_value <= 1:
            raise OutputDeviceBadValue('initial_value must be between 0 and 1')
        super().__init__(pin, active_high=active_high, initial_value=False)
        self._frequency = float(frequency)
        self._val = 0.0
        self.value = initial_value

    def _duty(self, v):
        return v if self._active_high else 1 - v

    @property
    def value(self):
        self._check_open()
        return self._val

    @value.setter
    def value(self, v):
        self._check_open()
        v = float(v)
        if not 0 <= v <= 1:
            raise OutputDeviceBadValue('PWM value must be between 0 and 1')
        self._val = v
        _post('gpio.pwm', pin=self._bcm, freq=self._frequency, duty=self._duty(v))

    def on(self):
        self.value = 1

    def off(self):
        self.value = 0

    def toggle(self):
        self.value = 1 - self._val

    @property
    def is_active(self):
        return self._val != 0

    @property
    def frequency(self):
        return self._frequency

    @frequency.setter
    def frequency(self, f):
        self._frequency = float(f)
        self.value = self._val

    def blink(self, on_time=1, off_time=1, fade_in_time=0, fade_out_time=0, n=None, background=True):
        self._check_open()
        steps = [[self._duty(d), t] for d, t in _fade_steps(on_time, off_time, fade_in_time, fade_out_time)]
        _post('gpio.pattern', pin=self._bcm, pattern={'steps': steps, 'repeat': n, 'pwm': True, 'freq': self._frequency})
        if not background:
            if n is None:
                _simcore.idle_forever()
            _sleep(sum(t for _, t in steps) * n)

    def pulse(self, fade_in_time=1, fade_out_time=1, n=None, background=True):
        self.blink(0, 0, fade_in_time, fade_out_time, n, background)


class PWMLED(PWMOutputDevice):
    @property
    def is_lit(self):
        return self.is_active


class RGBLED(Device):
    def __init__(self, red=None, green=None, blue=None, *, active_high=True, initial_value=(0, 0, 0), pwm=True, pin_factory=None):
        super().__init__()
        cls = PWMLED if pwm else LED
        self._pwm = pwm
        self._leds = []
        try:
            for p in (red, green, blue):
                self._leds.append(cls(p, active_high=active_high))
        except BaseException:
            for l in self._leds:
                l.close()
            raise
        self.value = initial_value

    @property
    def value(self):
        return tuple(float(l.value) for l in self._leds)

    @value.setter
    def value(self, v):
        v = tuple(v)
        if len(v) != 3 or any(not 0 <= x <= 1 for x in v):
            raise OutputDeviceBadValue('each RGB color component must be between 0 and 1')
        if not self._pwm and any(x not in (0, 1) for x in v):
            raise OutputDeviceBadValue('each RGB color component must be 0 or 1 with non-PWM RGBLEDs')
        for l, x in zip(self._leds, v):
            l.value = x

    color = value

    @property
    def red(self):
        return self.value[0]

    @red.setter
    def red(self, v):
        self.value = (v, self.value[1], self.value[2])

    @property
    def green(self):
        return self.value[1]

    @green.setter
    def green(self, v):
        self.value = (self.value[0], v, self.value[2])

    @property
    def blue(self):
        return self.value[2]

    @blue.setter
    def blue(self, v):
        self.value = (self.value[0], self.value[1], v)

    @property
    def is_active(self):
        return self.value != (0, 0, 0)

    is_lit = is_active

    def on(self):
        self.value = (1, 1, 1)

    def off(self):
        self.value = (0, 0, 0)

    def toggle(self):
        self.value = tuple(1 - x for x in self.value)

    def blink(self, on_time=1, off_time=1, fade_in_time=0, fade_out_time=0, on_color=(1, 1, 1), off_color=(0, 0, 0), n=None, background=True):
        for l, hi, lo in zip(self._leds, on_color, off_color):
            if isinstance(l, PWMLED):
                steps = [[l._duty(d), t] for d, t in _fade_steps(on_time, off_time, fade_in_time, fade_out_time, hi, lo)]
                _post('gpio.pattern', pin=l._bcm, pattern={'steps': steps, 'repeat': n, 'pwm': True, 'freq': l._frequency})
            else:
                _post('gpio.pattern', pin=l._bcm, pattern={'steps': [[l._level(hi), on_time], [l._level(lo), off_time]], 'repeat': n, 'pwm': False, 'freq': 0})
        if not background:
            if n is None:
                _simcore.idle_forever()
            _sleep((on_time + off_time + fade_in_time + fade_out_time) * n)

    def pulse(self, fade_in_time=1, fade_out_time=1, on_color=(1, 1, 1), off_color=(0, 0, 0), n=None, background=True):
        self.blink(0, 0, fade_in_time, fade_out_time, on_color, off_color, n, background)

    def close(self):
        for l in getattr(self, '_leds', []):
            l.close()
        super().close()


class Motor(Device):
    def __init__(self, forward=None, backward=None, *, enable=None, pwm=True, pin_factory=None):
        super().__init__()
        cls = PWMOutputDevice if pwm else DigitalOutputDevice
        self._fw = cls(forward)
        self._bw = cls(backward)
        self._en = DigitalOutputDevice(enable, initial_value=True) if enable is not None else None
        self._pwm = pwm

    @property
    def value(self):
        return float(self._fw.value) - float(self._bw.value)

    @value.setter
    def value(self, v):
        if not -1 <= v <= 1:
            raise OutputDeviceBadValue('Motor value must be between -1 and 1')
        if v > 0:
            self.forward(v)
        elif v < 0:
            self.backward(-v)
        else:
            self.stop()

    def forward(self, speed=1):
        if not self._pwm and speed not in (0, 1):
            raise ValueError('forward speed must be 0 or 1 with non-PWM Motors')
        self._bw.off()
        self._fw.value = speed

    def backward(self, speed=1):
        self._fw.off()
        self._bw.value = speed

    def reverse(self):
        self.value = -self.value

    def stop(self):
        self._fw.off()
        self._bw.off()

    @property
    def is_active(self):
        return self.value != 0

    def close(self):
        for d in (self._fw, self._bw, self._en):
            if d is not None:
                d.close()
        super().close()


class Servo(Device):
    def __init__(self, pin=None, *, initial_value=0.0, min_pulse_width=1 / 1000, max_pulse_width=2 / 1000, frame_width=20 / 1000, pin_factory=None):
        super().__init__()
        self._min = min_pulse_width
        self._max = max_pulse_width
        self._frame = frame_width
        self._pwm = PWMOutputDevice(pin, frequency=1 / frame_width)
        self._v = None
        self.value = initial_value

    @property
    def frame_width(self):
        return self._frame

    @property
    def min_pulse_width(self):
        return self._min

    @property
    def max_pulse_width(self):
        return self._max

    @property
    def pulse_width(self):
        return None if self._v is None else self._min + (self._v + 1) / 2 * (self._max - self._min)

    @property
    def value(self):
        return self._v

    @value.setter
    def value(self, v):
        if v is None:
            self._v = None
            self._pwm.value = 0
            return
        if not -1 <= v <= 1:
            raise OutputDeviceBadValue('Servo value must be between -1 and 1, or None')
        self._v = float(v)
        self._pwm.value = self.pulse_width / self._frame

    def min(self):
        self.value = -1

    def mid(self):
        self.value = 0

    def max(self):
        self.value = 1

    def detach(self):
        self.value = None

    @property
    def is_active(self):
        return self._v is not None

    def close(self):
        self._pwm.close()
        super().close()


class AngularServo(Servo):
    def __init__(self, pin=None, *, initial_angle=0.0, min_angle=-90, max_angle=90, min_pulse_width=1 / 1000, max_pulse_width=2 / 1000, frame_width=20 / 1000, pin_factory=None):
        self._min_angle = min_angle
        self._max_angle = max_angle
        super().__init__(pin, initial_value=self._to_value(initial_angle), min_pulse_width=min_pulse_width, max_pulse_width=max_pulse_width, frame_width=frame_width)

    def _to_value(self, a):
        if a is None:
            return None
        return (a - self._min_angle) / (self._max_angle - self._min_angle) * 2 - 1

    @property
    def angle(self):
        v = self.value
        return None if v is None else self._min_angle + (v + 1) / 2 * (self._max_angle - self._min_angle)

    @angle.setter
    def angle(self, a):
        self.value = self._to_value(a)

    @property
    def min_angle(self):
        return self._min_angle

    @property
    def max_angle(self):
        return self._max_angle


# ---------------------------------------------------------------- inputs
class InputDevice(GPIODevice):
    def __init__(self, pin=None, *, pull_up=False, active_state=None, pin_factory=None):
        super().__init__(pin)
        if pull_up is None:
            if active_state is None:
                self.close()
                raise PinInvalidState('Pin %d is defined as floating, but "active_state" is not defined' % self._bcm)
            pull = 'none'
            self._active_low = not active_state
        else:
            if active_state is not None:
                self.close()
                raise PinInvalidState('Pin %d is not floating, but "active_state" is not None' % self._bcm)
            pull = 'up' if pull_up else 'down'
            self._active_low = bool(pull_up)
        self._pull_up = pull_up
        try:
            _call('gpio.setup', pin=self._bcm, mode='input', pull=pull, owner=self.__class__.__name__)
        except BaseException:
            self._closed = True
            if self in _devices:
                _devices.remove(self)
            raise

    def _read_level(self):
        self._check_open()
        return _call('gpio.read', pin=self._bcm)['value']

    @property
    def value(self):
        lvl = self._read_level()
        return 1 if (lvl == 0) == self._active_low else 0

    @property
    def is_active(self):
        return bool(self.value)

    @property
    def pull_up(self):
        return self._pull_up


class DigitalInputDevice(InputDevice):
    def __init__(self, pin=None, *, pull_up=False, active_state=None, bounce_time=None, pin_factory=None):
        super().__init__(pin, pull_up=pull_up, active_state=active_state)
        self._bounce = bounce_time
        self._when_activated = None
        self._when_deactivated = None
        self._followers = []
        self._last_active = bool(self.value)
        self._changed_at = _now()
        _call('gpio.watch', pin=self._bcm, on=True, bounce=int((bounce_time or 0) * 1000))
        _simcore.on_edge(self._bcm, self._on_edge)

    def _on_edge(self, level, t):
        if self._closed:
            return
        active = (level == 0) == self._active_low
        if active == self._last_active:
            return
        self._last_active = active
        self._changed_at = t
        if active:
            self._fire_activated()
        else:
            self._fire_deactivated()
        for f in list(self._followers):
            f()

    def _fire_activated(self):
        if self._when_activated:
            self._when_activated()

    def _fire_deactivated(self):
        if self._when_deactivated:
            self._when_deactivated()

    @property
    def when_activated(self):
        return self._when_activated

    @when_activated.setter
    def when_activated(self, fn):
        self._when_activated = _wrap_handler(fn, self)

    @property
    def when_deactivated(self):
        return self._when_deactivated

    @when_deactivated.setter
    def when_deactivated(self, fn):
        self._when_deactivated = _wrap_handler(fn, self)

    def wait_for_active(self, timeout=None):
        return bool(_wait_until(lambda: self.is_active, timeout))

    def wait_for_inactive(self, timeout=None):
        return bool(_wait_until(lambda: not self.is_active, timeout))

    @property
    def active_time(self):
        return _now() - self._changed_at if self.is_active else None

    @property
    def inactive_time(self):
        return _now() - self._changed_at if not self.is_active else None

    def close(self):
        if not self._closed:
            _simcore.off_edge(getattr(self, '_bcm', -1), getattr(self, '_on_edge', None))
        super().close()


class SmoothedInputDevice(DigitalInputDevice):
    pass


class Button(DigitalInputDevice):
    def __init__(self, pin=None, *, pull_up=True, active_state=None, bounce_time=None, hold_time=1, hold_repeat=False, pin_factory=None):
        self.hold_time = hold_time
        self.hold_repeat = hold_repeat
        self._when_held = None
        self._hold_timer = None
        self._held_from = None
        super().__init__(pin, pull_up=pull_up, active_state=active_state, bounce_time=bounce_time)

    def _fire_activated(self):
        super()._fire_activated()
        self._held_from = None
        _simcore.cancel(self._hold_timer)
        self._hold_timer = _simcore.schedule(self.hold_time, self._check_hold)

    def _fire_deactivated(self):
        _simcore.cancel(self._hold_timer)
        self._hold_timer = None
        self._held_from = None
        super()._fire_deactivated()

    def _check_hold(self):
        if self._closed or not self._last_active:
            return
        if self._held_from is None:
            self._held_from = _now() - self.hold_time
        if self._when_held:
            self._when_held()
        if self.hold_repeat:
            self._hold_timer = _simcore.schedule(self.hold_time, self._check_hold)

    @property
    def is_pressed(self):
        return self.is_active

    @property
    def is_held(self):
        return self._held_from is not None and self.is_active

    @property
    def held_time(self):
        return _now() - self._held_from if self.is_held else None

    @property
    def pressed_time(self):
        return self.active_time

    when_pressed = DigitalInputDevice.when_activated
    when_released = DigitalInputDevice.when_deactivated

    @property
    def when_held(self):
        return self._when_held

    @when_held.setter
    def when_held(self, fn):
        self._when_held = _wrap_handler(fn, self)

    def wait_for_press(self, timeout=None):
        return self.wait_for_active(timeout)

    def wait_for_release(self, timeout=None):
        return self.wait_for_inactive(timeout)


class LineSensor(DigitalInputDevice):
    pass


class MotionSensor(DigitalInputDevice):
    when_motion = DigitalInputDevice.when_activated
    when_no_motion = DigitalInputDevice.when_deactivated

    @property
    def motion_detected(self):
        return self.is_active

    def wait_for_motion(self, timeout=None):
        return self.wait_for_active(timeout)

    def wait_for_no_motion(self, timeout=None):
        return self.wait_for_inactive(timeout)


# ---------------------------------------------------------------- SPI ADC
_spi_open = set()


class MCP3008(Device):
    bits = 10
    channels = 8

    def __init__(self, channel=0, *, differential=False, max_voltage=3.3, port=0, device=None, select_pin=None, clock_pin=None, mosi_pin=None, miso_pin=None, pin_factory=None):
        super().__init__()
        if not 0 <= channel < self.channels:
            raise SPIBadChannel('channel must be between 0 and %d' % (self.channels - 1))
        if device is None:
            device = {None: 0, 8: 0, 7: 1}.get(select_pin, 0)
        self._channel = channel
        self._differential = bool(differential)
        self._max_voltage = float(max_voltage)
        self._dev = device
        if (0, device) not in _spi_open:
            _call('spi.open', bus=port, dev=device)
            _spi_open.add((0, device))

    @property
    def channel(self):
        return self._channel

    @property
    def differential(self):
        return self._differential

    @property
    def raw_value(self):
        self._check_open()
        cfg = ((0 if self._differential else 8) + self._channel) << 4
        r = _call('spi.xfer', dev=self._dev, data=[1, cfg, 0])
        return ((r[1] & 3) << 8) | r[2]

    @property
    def value(self):
        return self.raw_value / ((1 << self.bits) - 1)

    @property
    def voltage(self):
        return self.value * self._max_voltage

    @property
    def max_voltage(self):
        return self._max_voltage


class CPUTemperature(Device):
    def __init__(self, *, sensor_file='/sys/class/thermal/thermal_zone0/temp', min_temp=0.0, max_temp=100.0, threshold=80.0, event_delay=5.0, pin_factory=None):
        super().__init__()
        self.min_temp = min_temp
        self.max_temp = max_temp
        self.threshold = threshold

    @property
    def temperature(self):
        return float(_call('cpu.temp'))

    @property
    def value(self):
        return max(0.0, min(1.0, (self.temperature - self.min_temp) / (self.max_temp - self.min_temp)))

    @property
    def is_active(self):
        return self.temperature > self.threshold


# ---------------------------------------------------------------- composite / ranging devices
class DistanceSensor(Device):
    """HC-SR04 ultrasonic ranger: ``DistanceSensor(echo=24, trigger=23, max_distance=1)``.

    Each read sends a 10 µs trigger pulse and times the echo in simulation time; the echo
    must reach the echo GPIO through your circuit (use a voltage divider: ECHO is 5 V).
    """

    def __init__(self, echo=None, trigger=None, *, queue_len=9, max_distance=1, threshold_distance=0.3, partial=False, pin_factory=None):
        super().__init__()
        if echo is None or trigger is None:
            raise GPIOZeroError('echo and trigger pins must be specified')
        if max_distance <= 0:
            raise ValueError('invalid maximum distance (must be positive)')
        self._echo = _call('gpio.pin', spec=echo)
        self._trigger = _call('gpio.pin', spec=trigger)
        _call('gpio.setup', pin=self._echo, mode='input', pull='none', owner='DistanceSensor echo')
        _call('gpio.setup', pin=self._trigger, mode='output', owner='DistanceSensor trigger', initial=0)
        self._max = float(max_distance)
        self.threshold_distance = float(threshold_distance)
        self._last = None

    @property
    def max_distance(self):
        return self._max

    @max_distance.setter
    def max_distance(self, v):
        if v <= 0:
            raise ValueError('invalid maximum distance (must be positive)')
        self._max = float(v)

    @property
    def echo(self):
        return Pin(self._echo)

    @property
    def trigger(self):
        return Pin(self._trigger)

    def _measure(self):
        self._check_open()
        r = _call('ultra.ping', trigger=self._trigger, echo=self._echo)
        if r.get('cm') is None:
            if r.get('reason') and 'reach' in r['reason']:
                import warnings

                warnings.warn('no echo received: %s' % r['reason'])
            self._last = self._max
        else:
            self._last = min(self._max, r['cm'] / 100.0)
        _sleep(0.06)  # the sensor needs ~60 ms between pings
        return self._last

    @property
    def distance(self):
        return self._measure()

    @property
    def value(self):
        return self._measure() / self._max

    @property
    def in_range(self):
        return self._measure() < self.threshold_distance

    def close(self):
        if not self._closed:
            for p in (self._echo, self._trigger):
                try:
                    _call('gpio.release', pin=p)
                except BaseException:
                    pass
        super().close()


class LEDBoard(Device):
    """A group of LEDs: ``LEDBoard(5, 6, 13, pwm=False)``; ``value`` is a tuple."""

    def __init__(self, *pins, pwm=False, active_high=True, initial_value=False, pin_factory=None, **named):
        super().__init__()
        cls = PWMLED if pwm else LED
        self._names = list(named)
        self.leds = tuple(cls(p, active_high=active_high, initial_value=initial_value) for p in list(pins) + list(named.values()))
        for n, led in zip(self._names, self.leds[len(pins):]):
            setattr(self, n, led)

    def __len__(self):
        return len(self.leds)

    def __getitem__(self, i):
        return self.leds[i]

    def __iter__(self):
        return iter(self.leds)

    @property
    def value(self):
        return tuple(led.value for led in self.leds)

    @value.setter
    def value(self, v):
        for led, x in zip(self.leds, v):
            led.value = x

    def on(self, *idx):
        for i, led in enumerate(self.leds):
            if not idx or i in idx:
                led.on()

    def off(self, *idx):
        for i, led in enumerate(self.leds):
            if not idx or i in idx:
                led.off()

    def toggle(self, *idx):
        for i, led in enumerate(self.leds):
            if not idx or i in idx:
                led.toggle()

    def close(self):
        for led in self.leds:
            led.close()
        super().close()


class LEDCharDisplay(LEDBoard):
    """Single 7-segment digit: ``LEDCharDisplay(a, b, c, d, e, f, g, dp=None, active_high=True)``."""

    _FONT = {
        ' ': 0x00, '0': 0x3F, '1': 0x06, '2': 0x5B, '3': 0x4F, '4': 0x66, '5': 0x6D, '6': 0x7D, '7': 0x07, '8': 0x7F, '9': 0x6F,
        'A': 0x77, 'B': 0x7C, 'C': 0x39, 'D': 0x5E, 'E': 0x79, 'F': 0x71, 'H': 0x76, 'L': 0x38, 'P': 0x73, 'U': 0x3E, '-': 0x40, '_': 0x08,
    }

    def __init__(self, *pins, dp=None, active_high=True, initial_value=' ', pin_factory=None):
        if len(pins) != 7:
            raise ValueError('LEDCharDisplay requires 7 segment pins (a–g)')
        super().__init__(*(list(pins) + ([dp] if dp is not None else [])), active_high=active_high)
        self._char = ' '
        self.value = initial_value

    @property
    def value(self):
        return self._char

    @value.setter
    def value(self, ch):
        ch = str(ch)
        dot = ch.endswith('.')
        c = ch[0].upper() if ch else ' '
        if c not in self._FONT:
            raise ValueError('character %r cannot be displayed' % c)
        bits = self._FONT[c]
        for i in range(7):
            self.leds[i].value = bool(bits & (1 << i))
        if len(self.leds) > 7:
            self.leds[7].value = dot
        self._char = ch


__all__ = [
    'Device', 'GPIODevice', 'OutputDevice', 'DigitalOutputDevice', 'LED', 'Buzzer', 'PWMOutputDevice', 'PWMLED',
    'RGBLED', 'Motor', 'Servo', 'AngularServo', 'InputDevice', 'DigitalInputDevice', 'Button', 'LineSensor',
    'MotionSensor', 'MCP3008', 'CPUTemperature', 'DistanceSensor', 'LEDBoard', 'LEDCharDisplay', 'GPIOZeroError', 'GPIOPinInUse', 'PinInvalidPin', 'DeviceClosed',
    'BadEventHandler', 'OutputDeviceBadValue', 'SPIBadChannel', 'PinInvalidState',
]
