# machine module for the simulated ESP32-DevKitC V4 (MicroPython ESP32-port API).
# Every call goes to the simulator, which applies it to the board's own pins and the real
# circuit. Implemented: Pin (IN/OUT/OPEN_DRAIN, PULL_UP/PULL_DOWN, irq), PWM, ADC, I2C/SoftI2C,
# Timer (software timers), freq, unique_id, reset, idle. Not implemented: UART, SPI, RTC,
# deepsleep/lightsleep, WDT, Signal, touch, RMT — they raise NotImplementedError.
import _sched
from _sched import call, post


class Pin:
    IN = 1
    OUT = 3
    OPEN_DRAIN = 7
    PULL_UP = 2
    PULL_DOWN = 1
    IRQ_RISING = 1
    IRQ_FALLING = 2
    WAKE_LOW = 4
    WAKE_HIGH = 5

    def __init__(self, id, mode=-1, pull=-1, *, value=None):
        if isinstance(id, Pin):
            id = id._id
        if not isinstance(id, int):
            raise ValueError('invalid pin')
        self._id = id
        self._mode = None
        self.init(mode, pull, value=value)

    def init(self, mode=-1, pull=-1, *, value=None):
        if mode == -1 and pull == -1 and value is None:
            return
        if mode != -1:
            self._mode = mode
        m = 'output' if self._mode in (Pin.OUT, Pin.OPEN_DRAIN) else 'input'
        p = 'up' if pull == Pin.PULL_UP else 'down' if pull == Pin.PULL_DOWN else 'none'
        call('pin.setup', pin=self._id, mode=m, pull=p, value=1 if value else 0, owner='Pin(%d)' % self._id)

    def value(self, x=None):
        if x is None:
            return call('pin.read', pin=self._id)
        if self._mode not in (Pin.OUT, Pin.OPEN_DRAIN):
            # MicroPython keeps the level and applies it once the pin becomes an output
            self._pending = 1 if x else 0
            return None
        post('pin.write', pin=self._id, v=1 if x else 0)

    def __call__(self, x=None):
        return self.value(x)

    def on(self):
        self.value(1)

    def off(self):
        self.value(0)

    def irq(self, handler=None, trigger=IRQ_FALLING | IRQ_RISING):
        if handler is None:
            _sched._irq.pop(self._id, None)
            call('pin.irq', pin=self._id, on=False)
        else:
            _sched._irq[self._id] = (handler, trigger, self)
            call('pin.irq', pin=self._id, on=True)

    def __repr__(self):
        return 'Pin(%d)' % self._id


class PWM:
    def __init__(self, dest, *, freq=5000, duty=None, duty_u16=None, duty_ns=None):
        self._pin = dest._id if isinstance(dest, Pin) else int(dest)
        self._freq = freq
        self._duty = 0.5
        if duty is not None:
            self._duty = duty / 1023
        elif duty_u16 is not None:
            self._duty = duty_u16 / 65535
        elif duty_ns is not None:
            self._duty = duty_ns * freq / 1e9
        self._apply()

    def _apply(self):
        post('pwm.set', pin=self._pin, freq=self._freq, duty=max(0.0, min(1.0, self._duty)))

    def init(self, *, freq=None, duty=None, duty_u16=None, duty_ns=None):
        if freq is not None:
            self._freq = freq
        if duty is not None:
            self._duty = duty / 1023
        if duty_u16 is not None:
            self._duty = duty_u16 / 65535
        if duty_ns is not None:
            self._duty = duty_ns * self._freq / 1e9
        self._apply()

    def freq(self, f=None):
        if f is None:
            return self._freq
        self._freq = f
        self._apply()

    def duty(self, d=None):
        if d is None:
            return int(round(self._duty * 1023))
        self._duty = d / 1023
        self._apply()

    def duty_u16(self, d=None):
        if d is None:
            return int(round(self._duty * 65535))
        self._duty = d / 65535
        self._apply()

    def duty_ns(self, ns=None):
        if ns is None:
            return int(self._duty * 1e9 / self._freq)
        self._duty = ns * self._freq / 1e9
        self._apply()

    def deinit(self):
        call('pin.release', pin=self._pin)


class ADC:
    ATTN_0DB = 0
    ATTN_2_5DB = 1
    ATTN_6DB = 2
    ATTN_11DB = 3
    WIDTH_9BIT = 0
    WIDTH_10BIT = 1
    WIDTH_11BIT = 2
    WIDTH_12BIT = 3
    _DB = (0, 2.5, 6, 11)

    def __init__(self, pin, *, atten=ATTN_11DB):
        self._pin = pin._id if isinstance(pin, Pin) else int(pin)
        self._atten = atten
        self._bits = 12
        call('adc.check', pin=self._pin)

    def atten(self, a):
        self._atten = a

    def width(self, w):
        self._bits = 9 + w

    def _read(self):
        return call('adc.read', pin=self._pin, atten=self._DB[self._atten])

    def read(self):
        return self._read()['raw'] >> (12 - self._bits)

    def read_u16(self):
        return (self._read()['raw'] * 65535) // 4095

    def read_uv(self):
        return int(self._read()['volts'] * 1000000)


ADCBlock = None


class I2C:
    _DEFAULT = {0: (18, 19), 1: (25, 26)}

    def __init__(self, id=0, *, scl=None, sda=None, freq=400000, timeout=50000):
        dscl, dsda = self._DEFAULT.get(id, (18, 19))
        self._scl = scl._id if isinstance(scl, Pin) else (dscl if scl is None else int(scl))
        self._sda = sda._id if isinstance(sda, Pin) else (dsda if sda is None else int(sda))
        self._freq = freq
        call('i2c.open', sda=self._sda, scl=self._scl)

    def scan(self):
        return call('i2c.scan', sda=self._sda, scl=self._scl)

    def _xfer(self, addr, w, n):
        return call('i2c.xfer', sda=self._sda, scl=self._scl, addr=addr, w=w, n=n)

    def writeto(self, addr, buf, stop=True):
        self._xfer(addr, list(buf), 0)
        return len(buf)

    def readfrom(self, addr, nbytes, stop=True):
        return bytes(self._xfer(addr, None, nbytes))

    def readfrom_into(self, addr, buf, stop=True):
        data = self._xfer(addr, None, len(buf))
        for i in range(len(buf)):
            buf[i] = data[i]

    def writeto_mem(self, addr, memaddr, buf, *, addrsize=8):
        self._xfer(addr, [memaddr] + list(buf), 0)

    def readfrom_mem(self, addr, memaddr, nbytes, *, addrsize=8):
        self._xfer(addr, [memaddr], 0)
        return bytes(self._xfer(addr, None, nbytes))

    def readfrom_mem_into(self, addr, memaddr, buf, *, addrsize=8):
        data = self.readfrom_mem(addr, memaddr, len(buf))
        for i in range(len(buf)):
            buf[i] = data[i]


class SoftI2C(I2C):
    def __init__(self, scl, sda, *, freq=400000, timeout=50000):
        self._scl = scl._id if isinstance(scl, Pin) else int(scl)
        self._sda = sda._id if isinstance(sda, Pin) else int(sda)
        self._freq = freq
        call('i2c.open', sda=self._sda, scl=self._scl)


class Timer:
    ONE_SHOT = 0
    PERIODIC = 1

    def __init__(self, id=-1, **kw):
        self._id = id
        self._next = None
        if kw:
            self.init(**kw)

    def init(self, *, mode=PERIODIC, period=-1, freq=-1, callback=None):
        if freq > 0:
            period = 1000 / freq
        if period <= 0 or callback is None:
            raise ValueError('period and callback are required')
        self.deinit()
        self._period = period
        self._periodic = mode == Timer.PERIODIC
        self._cb = callback
        self._next = _sched.now_ms() + period
        _sched._timers.append(self)

    def deinit(self):
        if self in _sched._timers:
            _sched._timers.remove(self)
        self._next = None


def freq(hz=None):
    if hz is None:
        return 240000000


def unique_id():
    return bytes(call('board.uid'))


def reset():
    call('board.reset')


def soft_reset():
    call('board.reset')


def idle():
    _sched.wait_ms(1)


def _missing(name):
    class _M:
        def __init__(self, *a, **k):
            raise NotImplementedError('machine.%s is not simulated (see the ESP32 limits in the board description)' % name)

    return _M


UART = _missing('UART')
SPI = _missing('SPI')
SoftSPI = _missing('SoftSPI')
RTC = _missing('RTC')
WDT = _missing('WDT')
Signal = _missing('Signal')
TouchPad = _missing('TouchPad')


def deepsleep(ms=0):
    raise NotImplementedError('machine.deepsleep is not simulated')


def lightsleep(ms=0):
    raise NotImplementedError('machine.lightsleep is not simulated')
