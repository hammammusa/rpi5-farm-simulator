# time / utime for the simulated ESP32 (MicroPython API). Time is simulation time: it follows
# the simulator's speed control. The RTC is set from the simulation clock, as after
# ntptime.settime(); a real board without NTP starts at 2000-01-01.
import _hw
import _sched

_TICKS_PERIOD = 1 << 30
_TICKS_MAX = _TICKS_PERIOD - 1


def sleep(seconds):
    _sched.wait_ms(seconds * 1000)


def sleep_ms(ms):
    _sched.wait_ms(ms)


def sleep_us(us):
    _sched.wait_ms(us / 1000)


def ticks_ms():
    return int(_hw.ticks_ms()) & _TICKS_MAX


def ticks_us():
    return int(_hw.ticks_ms() * 1000) & _TICKS_MAX


def ticks_cpu():
    return ticks_us()


def ticks_add(ticks, delta):
    return (ticks + delta) & _TICKS_MAX


def ticks_diff(ticks1, ticks2):
    d = (ticks1 - ticks2) & _TICKS_MAX
    return d - _TICKS_PERIOD if d >= _TICKS_PERIOD // 2 else d


def time():
    return int(_hw.epoch())


def time_ns():
    return int(_hw.epoch() * 1000000000)


def _days_before_year(y):
    y -= 1
    return y * 365 + y // 4 - y // 100 + y // 400


def _is_leap(y):
    return y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)


_MDAYS = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def gmtime(secs=None):
    if secs is None:
        secs = time()
    secs = int(secs)
    days, rem = divmod(secs, 86400)
    hh, rem = divmod(rem, 3600)
    mm, ss = divmod(rem, 60)
    wday = (days + 3) % 7  # 1970-01-01 was a Thursday (Monday = 0)
    y = 1970
    while True:
        n = 366 if _is_leap(y) else 365
        if days < n:
            break
        days -= n
        y += 1
    yday = days + 1
    m = 0
    while True:
        n = _MDAYS[m] + (1 if m == 1 and _is_leap(y) else 0)
        if days < n:
            break
        days -= n
        m += 1
    return (y, m + 1, days + 1, hh, mm, ss, wday, yday)


def localtime(secs=None):
    if secs is None:
        secs = time() + int(_hw.tz())
    return gmtime(secs)


def mktime(t):
    y, mo, d, hh, mm, ss = t[0], t[1], t[2], t[3], t[4], t[5]
    days = _days_before_year(y) - _days_before_year(1970)
    for m in range(mo - 1):
        days += _MDAYS[m] + (1 if m == 1 and _is_leap(y) else 0)
    days += d - 1
    return days * 86400 + hh * 3600 + mm * 60 + ss
