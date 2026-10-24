"""lgpio (simulator subset) — the low-level library gpiozero uses on the Raspberry Pi 5.

Implemented: gpiochip_open/close, gpio_claim_input/output/alert, gpio_free, gpio_read/write,
tx_pwm, tx_servo, callback, i2c_open/close/read*/write*, spi_open/close/xfer/read/write,
serial_open/close/read/write/data_available. Errors raise lgpio.error like the real module.
On a Pi 5 with a current kernel the header GPIOs are on gpiochip 0 (gpiochip 4 on older kernels).
"""
from _simcore import call as _call, post as _post, on_edge as _on_edge, off_edge as _off_edge

__version__ = '0.2.2.0-sim'

SET_ACTIVE_LOW = 4
SET_OPEN_DRAIN = 8
SET_OPEN_SOURCE = 16
SET_PULL_UP = 32
SET_PULL_DOWN = 64
SET_PULL_NONE = 128
RISING_EDGE = 1
FALLING_EDGE = 2
BOTH_EDGES = 3
TIMEOUT = 2


class error(Exception):
    pass


_handles = {}
_next = [1]


def _new(kind, **info):
    h = _next[0]
    _next[0] += 1
    _handles[h] = dict(kind=kind, **info)
    return h


def _get(h, kind):
    d = _handles.get(h)
    if d is None or d['kind'] != kind:
        raise error('bad handle')
    return d


def _sim_reset():
    _handles.clear()


def _pull(flags):
    if flags & SET_PULL_UP:
        return 'up'
    if flags & SET_PULL_DOWN:
        return 'down'
    return 'none'


def _wrap(fn):
    try:
        return fn()
    except (OSError, RuntimeError, ValueError) as e:
        msg = str(e)
        if 'in use' in msg:
            raise error("'GPIO busy'")
        if 'not a valid GPIO' in msg:
            raise error("'bad GPIO number'")
        raise error("'%s'" % msg)


# ---------------------------------------------------------------- GPIO
def gpiochip_open(gpiochip):
    if gpiochip not in (0, 4):
        raise error("'can not open gpiochip'")
    return _new('chip', n=gpiochip, claims=set())


def gpiochip_close(handle):
    d = _get(handle, 'chip')
    for g in list(d['claims']):
        gpio_free(handle, g)
    _handles.pop(handle, None)
    return 0


def gpio_claim_output(handle, gpio, level=0, lFlags=0):
    d = _get(handle, 'chip')
    _wrap(lambda: _call('gpio.setup', pin=int(gpio), mode='output', owner='lgpio', initial=1 if level else 0))
    d['claims'].add(int(gpio))
    return 0


def gpio_claim_input(handle, gpio, lFlags=0):
    d = _get(handle, 'chip')
    _wrap(lambda: _call('gpio.setup', pin=int(gpio), mode='input', pull=_pull(lFlags), owner='lgpio'))
    d['claims'].add(int(gpio))
    return 0


def gpio_claim_alert(handle, gpio, eFlags, lFlags=0, notify_handle=None):
    gpio_claim_input(handle, gpio, lFlags)
    _call('gpio.watch', pin=int(gpio), on=True)
    return 0


def gpio_free(handle, gpio):
    d = _get(handle, 'chip')
    d['claims'].discard(int(gpio))
    _off_edge(int(gpio))
    try:
        _call('gpio.release', pin=int(gpio))
    except BaseException:
        pass
    return 0


def gpio_read(handle, gpio):
    _get(handle, 'chip')
    return _wrap(lambda: int(_call('gpio.read', pin=int(gpio))['value']))


def gpio_write(handle, gpio, level):
    _get(handle, 'chip')
    _post('gpio.write', pin=int(gpio), value=1 if level else 0)
    return 0


def tx_pwm(handle, gpio, pwm_frequency, pwm_duty_cycle, pulse_offset=0, pulse_cycles=0):
    _get(handle, 'chip')
    if not 0 <= pwm_duty_cycle <= 100:
        raise error("'bad PWM duty cycle'")
    _post('gpio.pwm', pin=int(gpio), freq=float(pwm_frequency), duty=float(pwm_duty_cycle) / 100.0)
    return 0


def tx_servo(handle, gpio, pulse_width, servo_frequency=50, pulse_offset=0, pulse_cycles=0):
    _get(handle, 'chip')
    if pulse_width and not 500 <= pulse_width <= 2500:
        raise error("'bad servo pulsewidth'")
    _post('gpio.pwm', pin=int(gpio), freq=float(servo_frequency), duty=(pulse_width / 1e6) * servo_frequency)
    return 0


class _Callback:
    def __init__(self, chip, gpio, edge, func):
        self.gpio = gpio
        self._fn = None

        def handler(level, t, edge=edge, func=func, gpio=gpio, chip=chip):
            if (edge == RISING_EDGE and level != 1) or (edge == FALLING_EDGE and level != 0):
                return
            if func is not None:
                func(chip, gpio, level, int(t * 1e9))

        self._fn = handler
        _on_edge(gpio, handler)
        _call('gpio.watch', pin=gpio, on=True)

    def cancel(self):
        if self._fn is not None:
            _off_edge(self.gpio, self._fn)
            self._fn = None


def callback(handle, gpio, edge=RISING_EDGE, func=None):
    _get(handle, 'chip')
    return _Callback(handle, int(gpio), edge, func)


# ---------------------------------------------------------------- I2C
def i2c_open(i2c_bus, i2c_address, i2c_flags=0):
    if i2c_bus != 1:
        raise error("'can not open I2C device'")
    return _new('i2c', addr=int(i2c_address))


def i2c_close(handle):
    _get(handle, 'i2c')
    _handles.pop(handle, None)
    return 0


def _io(handle, write=None, read=0):
    d = _get(handle, 'i2c')
    return _wrap(lambda: _call('i2c', bus=1, addr=d['addr'], write=write, read=read))


def i2c_write_byte(handle, byte_val):
    _io(handle, [byte_val & 0xFF])
    return 0


def i2c_read_byte(handle):
    return _io(handle, None, 1)[0]


def i2c_write_byte_data(handle, reg, byte_val):
    _io(handle, [reg & 0xFF, byte_val & 0xFF])
    return 0


def i2c_read_byte_data(handle, reg):
    return _io(handle, [reg & 0xFF], 1)[0]


def i2c_write_word_data(handle, reg, word_val):
    _io(handle, [reg & 0xFF, word_val & 0xFF, (word_val >> 8) & 0xFF])
    return 0


def i2c_read_word_data(handle, reg):
    lo, hi = _io(handle, [reg & 0xFF], 2)
    return lo | (hi << 8)


def i2c_read_i2c_block_data(handle, reg, count):
    data = _io(handle, [reg & 0xFF], count)
    return len(data), bytearray(data)


def i2c_write_i2c_block_data(handle, reg, data):
    _io(handle, [reg & 0xFF] + [b & 0xFF for b in bytes(data)])
    return 0


def i2c_read_device(handle, count):
    data = _io(handle, None, count)
    return len(data), bytearray(data)


def i2c_write_device(handle, data):
    _io(handle, [b & 0xFF for b in bytes(data)])
    return 0


# ---------------------------------------------------------------- SPI
def spi_open(spi_device, spi_channel, baud, spi_flags=0):
    _wrap(lambda: _call('spi.open', bus=int(spi_device), dev=int(spi_channel)))
    return _new('spi', dev=int(spi_channel))


def spi_close(handle):
    _get(handle, 'spi')
    _handles.pop(handle, None)
    return 0


def spi_xfer(handle, data):
    d = _get(handle, 'spi')
    r = _call('spi.xfer', dev=d['dev'], data=[b & 0xFF for b in bytes(data)])
    return len(r), bytearray(r)


def spi_write(handle, data):
    spi_xfer(handle, data)
    return len(bytes(data))


def spi_read(handle, count):
    return spi_xfer(handle, bytes(count))


# ---------------------------------------------------------------- serial
def serial_open(tty, baud, ser_flags=0):
    import serial

    s = serial.Serial(tty if tty.startswith('/dev/') else '/dev/' + tty, baud, timeout=0)
    return _new('serial', s=s)


def serial_close(handle):
    _get(handle, 'serial')['s'].close()
    _handles.pop(handle, None)
    return 0


def serial_write(handle, data):
    _get(handle, 'serial')['s'].write(bytes(data))
    return 0


def serial_write_byte(handle, byte_val):
    return serial_write(handle, bytes([byte_val & 0xFF]))


def serial_read(handle, count=1000):
    d = _get(handle, 'serial')['s'].read(count)
    return len(d), bytearray(d)


def serial_read_byte(handle):
    n, d = serial_read(handle, 1)
    return d[0] if n else -1


def serial_data_available(handle):
    return _get(handle, 'serial')['s'].in_waiting


def error_text(errnum):
    return 'lgpio error %d' % errnum
