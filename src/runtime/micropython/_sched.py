# Simulator scheduler for MicroPython on the ESP32: simulation-time waiting, pin interrupts
# (Pin.irq) and software timers (machine.Timer). Callbacks run while the program waits
# (time.sleep*, ticks loops that sleep) or after main.py has returned, as MicroPython keeps
# servicing IRQs and timers from its REPL.
import _hw
import json

_irq = {}
_timers = []
_mqtt = []
EXC = {
    'OSError': OSError,
    'ValueError': ValueError,
    'TypeError': TypeError,
    'RuntimeError': RuntimeError,
    'SystemExit': SystemExit,
    'NotImplementedError': NotImplementedError,
}


def call(method, **kw):
    r = json.loads(_hw.call(method, json.dumps(kw)))
    if 'e' in r:
        raise EXC.get(r['e'], OSError)(r['m'])
    return r.get('v')


def post(method, **kw):
    _hw.post(method, json.dumps(kw))


def now_ms():
    return _hw.ticks_ms()


def _run_events():
    for e in call('events.take'):
        k = e['k']
        if k == 'edge':
            h = _irq.get(e['pin'])
            if h is not None:
                handler, trigger, pin = h
                if (e['v'] == 1 and trigger & 1) or (e['v'] == 0 and trigger & 2):
                    handler(pin)
        elif k == 'mqtt':
            for c in _mqtt:
                c._deliver(e['topic'], e['payload'])


def _run_timers(now):
    for t in list(_timers):
        if t._next is not None and now >= t._next:
            if t._periodic:
                t._next += t._period
                if t._next <= now:
                    t._next = now + t._period
            else:
                t._next = None
                _timers.remove(t)
            t._cb(t)


def wait_ms(ms):
    """Wait `ms` milliseconds of simulation time, servicing interrupts and timers."""
    end = now_ms() + ms
    while True:
        now = now_ms()
        _run_timers(now)
        nxt = end
        for t in _timers:
            if t._next is not None and t._next < nxt:
                nxt = t._next
        rem = nxt - now
        if rem < 0.001:
            # within a microsecond: the deadline has been reached (avoids float round-off loops)
            if end - now < 0.001:
                return
            _run_timers(nxt)
            continue
        if _hw.wait(rem) == 1:
            _run_events()


def busy():
    """True while interrupts, timers or MQTT callbacks can still do work."""
    return bool(_irq) or bool(_timers) or any(c._cb for c in _mqtt)
