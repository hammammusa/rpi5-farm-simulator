"""Core of the Raspberry Pi 5 simulator runtime inside Pyodide.

Everything here talks to the simulation engine on the browser's main thread
through the `_simjs` JS module (synchronous RPC over SharedArrayBuffer).

Time: `time.time()`, `time.sleep()`, `datetime.now()` ... use *simulation time*,
which can run faster than real time (1x, 2x, 5x, 10x, fast-forward).

Callbacks (gpiozero when_pressed, RPi.GPIO event callbacks, Flask requests,
threading.Timer) run cooperatively whenever the program is inside sleep(),
pause(), a blocking read with timeout, or another simulator call.
"""

import builtins
import heapq
import io
import json
import os
import re
import sys
import traceback

import _simjs

PROJECT = '/home/pi/project'

EXC = {}  # exception name -> class, registered by shim modules


class SimStopped(KeyboardInterrupt):
    pass


def _raise(r):
    name = r.get('type') or 'RuntimeError'
    msg = r.get('msg') or ''
    if name == 'KeyboardInterrupt':
        raise SimStopped()
    cls = EXC.get(name)
    if cls is None:
        cls = getattr(builtins, name, None)
        if not (isinstance(cls, type) and issubclass(cls, BaseException)):
            cls = RuntimeError
    if issubclass(cls, OSError):
        m = re.match(r'\[Errno (\d+)\] (.*)', msg)
        if m:
            raise cls(int(m.group(1)), m.group(2))
    raise cls(msg)


def check_stop():
    if _simjs.stopped():
        raise SimStopped()


def call(method, **kw):
    check_stop()
    r = json.loads(_simjs.rpc(method, json.dumps(kw)))
    if not r.get('ok'):
        _raise(r)
    return r.get('v')


def post(method, **kw):
    check_stop()
    _simjs.post(method, json.dumps(kw))


def now():
    return _simjs.now()


def log(msg, level='info'):
    _simjs.post('sim.log', json.dumps({'msg': str(msg), 'level': level}))


# ------------------------------------------------------------------ events
_edge_handlers = {}  # pin -> [fn(value, t)]
_http_handler = None
_timers = []  # heap of (when, seq, fn, args, kwargs, owner)
_timer_seq = 0
_dispatching = False


def on_edge(pin, fn):
    _edge_handlers.setdefault(pin, [])
    if fn not in _edge_handlers[pin]:
        _edge_handlers[pin].append(fn)


def off_edge(pin, fn=None):
    if fn is None:
        _edge_handlers.pop(pin, None)
    elif pin in _edge_handlers and fn in _edge_handlers[pin]:
        _edge_handlers[pin].remove(fn)


def set_http_handler(fn):
    global _http_handler
    _http_handler = fn


def schedule(delay, fn, *args, owner=None, **kwargs):
    global _timer_seq
    _timer_seq += 1
    item = [now() + max(0.0, delay), _timer_seq, fn, args, kwargs, owner, True]
    heapq.heappush(_timers, item)
    return item


def cancel(item):
    if item is not None:
        item[6] = False


def next_timer():
    while _timers and not _timers[0][6]:
        heapq.heappop(_timers)
    return _timers[0][0] if _timers else None


def _run_callback(fn, *args):
    try:
        fn(*args)
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception:
        sys.stderr.write('Exception in callback %r:\n' % (getattr(fn, '__name__', fn),))
        traceback.print_exc()


def dispatch():
    """Run pending callbacks (edges, HTTP requests, timers)."""
    global _dispatching
    if _dispatching:
        return
    _dispatching = True
    try:
        if _simjs.has_events():
            events = call('events.take')
            for e in events:
                k = e.get('k')
                if k == 'edge':
                    for fn in list(_edge_handlers.get(e['pin'], ())):
                        _run_callback(fn, e['v'], e['t'])
                elif k == 'http':
                    if _http_handler is not None:
                        _http_handler(e)
                    else:
                        post('http.response', id=e['id'], status=503, body='No web server running')
        t = now()
        while True:
            nt = next_timer()
            if nt is None or nt > t:
                break
            item = heapq.heappop(_timers)
            if item[6]:
                _run_callback(item[2], *item[3], **item[4])
    finally:
        _dispatching = False


def sleep(secs):
    """time.sleep() replacement: waits in simulation time and serves callbacks."""
    secs = float(secs)
    if secs < 0:
        raise ValueError('sleep length must be non-negative')
    end = now() + secs
    while True:
        check_stop()
        dispatch()
        t = now()
        rem = end - t
        if rem <= 0:
            return
        nt = next_timer()
        w = rem if nt is None else max(0.0, min(rem, nt - t))
        r = _simjs.wait(w, _dispatching)
        if r == 2:
            raise SimStopped()


def wait_event(timeout):
    """Wait up to `timeout` simulation seconds, returning early when events arrive."""
    check_stop()
    dispatch()
    t = now()
    nt = next_timer()
    w = max(0.0, timeout) if nt is None else max(0.0, min(timeout, nt - t))
    r = _simjs.wait(w, _dispatching)
    if r == 2:
        raise SimStopped()
    dispatch()


def wait_until(predicate, timeout=None, poll=0.01):
    """Block until predicate() is true (serving callbacks). Returns predicate result."""
    end = None if timeout is None else now() + timeout
    while True:
        v = predicate()
        if v:
            return v
        if end is not None and now() >= end:
            return v
        sleep(poll if end is None else min(poll, max(0.0, end - now())))


def idle_forever():
    run_deferred_threads()
    while True:
        sleep(3600)


# ------------------------------------------------------------------ cooperative threading
_deferred = []
_warned_threads = False


def run_deferred_threads():
    while _deferred:
        th = _deferred.pop(0)
        th._sim_run_now()


def _patch_threading():
    import threading

    orig_init = threading.Thread.__init__

    def start(self):
        global _warned_threads
        if getattr(self, '_sim_started', False):
            raise RuntimeError('threads can only be started once')
        self._sim_started = True
        self._sim_done = False
        if isinstance(self, threading.Timer):
            def fire(th=self):
                if not th.finished.is_set():
                    th.function(*th.args, **th.kwargs)
                    th.finished.set()
                th._sim_done = True
            self._sim_timer = schedule(self.interval, fire)
            return
        target = getattr(self, '_target', None)
        owner = getattr(target, '__self__', None)
        if owner is not None and getattr(owner, '_sim_flask_app', False) and getattr(target, '__name__', '') == 'run':
            owner._sim_serve_background(*self._args, **self._kwargs)
            return
        _deferred.append(self)
        if not _warned_threads:
            _warned_threads = True
            sys.stderr.write(
                "[simulator] threading: background threads run cooperatively — thread '%s' starts when the main "
                "thread blocks (pause(), app.run(), join() or end of script). Prefer gpiozero callbacks or "
                "threading.Timer for periodic work.\n" % self.name)

    def _sim_run_now(self):
        if getattr(self, '_sim_done', False):
            return
        self._sim_done = False
        try:
            self.run()
        finally:
            self._sim_done = True

    def join(self, timeout=None):
        if isinstance(self, threading.Timer):
            wait_until(lambda: getattr(self, '_sim_done', False) or self.finished.is_set(), timeout)
            return
        if self in _deferred:
            _deferred.remove(self)
            self._sim_run_now()

    def is_alive(self):
        return getattr(self, '_sim_started', False) and not getattr(self, '_sim_done', False)

    def timer_cancel(self):
        self.finished.set()
        cancel(getattr(self, '_sim_timer', None))

    threading.Thread.start = start
    threading.Thread._sim_run_now = _sim_run_now
    threading.Thread.join = join
    threading.Thread.is_alive = is_alive
    threading.Timer.cancel = timer_cancel

    def event_wait(self, timeout=None):
        return wait_until(self.is_set, timeout)

    threading.Event.wait = event_wait


# ------------------------------------------------------------------ time & datetime
_TZ = int(_simjs.tz_offset)


def _patch_time():
    import time as _t
    import datetime as _dt

    real_gmtime = _t.gmtime
    real_strftime = _t.strftime

    def localtime(secs=None):
        s = now() if secs is None else secs
        return real_gmtime(s + _TZ)

    def ctime(secs=None):
        return real_strftime('%a %b %d %H:%M:%S %Y', localtime(secs))

    def strftime(fmt, t=None):
        return real_strftime(fmt, localtime() if t is None else t)

    def asctime(t=None):
        return real_strftime('%a %b %d %H:%M:%S %Y', localtime() if t is None else t)

    _t.sleep = sleep
    _t.time = now
    _t.time_ns = lambda: int(now() * 1e9)
    _t.monotonic = now
    _t.monotonic_ns = lambda: int(now() * 1e9)
    _t.perf_counter = now
    _t.perf_counter_ns = lambda: int(now() * 1e9)
    _t.localtime = localtime
    _t.ctime = ctime
    _t.strftime = strftime
    _t.asctime = asctime

    base_dt = _dt.datetime
    base_date = _dt.date
    utc = _dt.timezone.utc

    class datetime(base_dt):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return cls.fromtimestamp(now())
            return base_dt.fromtimestamp(now(), tz)

        @classmethod
        def today(cls):
            return cls.now()

        @classmethod
        def utcnow(cls):
            v = base_dt.fromtimestamp(now(), utc).replace(tzinfo=None)
            return cls(v.year, v.month, v.day, v.hour, v.minute, v.second, v.microsecond)

        @classmethod
        def fromtimestamp(cls, t, tz=None):
            if tz is not None:
                return base_dt.fromtimestamp(t, tz)
            v = base_dt.fromtimestamp(t + _TZ, utc).replace(tzinfo=None)
            return cls(v.year, v.month, v.day, v.hour, v.minute, v.second, v.microsecond)

        def timestamp(self):
            if self.tzinfo is None:
                return base_dt.timestamp(self.replace(tzinfo=utc)) - _TZ
            return base_dt.timestamp(self)

    class date(base_date):
        @classmethod
        def today(cls):
            d = datetime.now()
            return cls(d.year, d.month, d.day)

    datetime.__name__ = 'datetime'
    datetime.__qualname__ = 'datetime'
    datetime.__module__ = 'datetime'
    date.__name__ = 'date'
    date.__module__ = 'datetime'
    _dt.datetime = datetime
    _dt.date = date


# ------------------------------------------------------------------ filesystem views (/sys)
W1 = '/sys/bus/w1/devices'


def _virtual_listing(path):
    p = path.rstrip('/')
    if p == W1:
        return call('w1.list') + ['w1_bus_master1']
    if p.startswith(W1 + '/28-'):
        dev = p[len(W1) + 1:]
        if dev in call('w1.list'):
            return ['w1_slave', 'temperature', 'name']
    return None


def _virtual_file(path):
    p = str(path)
    if p.startswith(W1 + '/'):
        rest = p[len(W1) + 1:].split('/')
        if len(rest) == 2:
            dev, leaf = rest
            txt = call('w1.read', id=dev)
            if txt is None:
                raise FileNotFoundError(2, 'No such file or directory', p)
            if leaf == 'w1_slave':
                return txt
            if leaf == 'temperature':
                return txt.strip().split('t=')[-1] + '\n'
            if leaf == 'name':
                return dev + '\n'
        raise FileNotFoundError(2, 'No such file or directory', p)
    if p == '/sys/class/thermal/thermal_zone0/temp':
        return '%d\n' % int(call('cpu.temp') * 1000)
    if p == '/proc/device-tree/model':
        return 'Raspberry Pi 5 Model B Rev 1.0\x00'
    return None


def _patch_fs():
    import glob as _glob
    import fnmatch

    real_open = builtins.open
    real_listdir = os.listdir
    real_exists = os.path.exists
    real_isdir = os.path.isdir
    real_isfile = os.path.isfile
    real_glob = _glob.glob

    def open_(file, mode='r', *a, **kw):
        if isinstance(file, (str, os.PathLike)):
            p = os.fspath(file)
            if p.startswith('/sys/') or p.startswith('/proc/device-tree'):
                if any(c in mode for c in 'wa+'):
                    if p.startswith('/sys/class/gpio'):
                        raise PermissionError(13, 'The legacy sysfs GPIO interface is not available on Raspberry Pi 5 — use gpiozero', p)
                    raise PermissionError(13, 'Permission denied', p)
                txt = _virtual_file(p)
                if txt is None:
                    raise FileNotFoundError(2, 'No such file or directory', p)
                return io.BytesIO(txt.encode()) if 'b' in mode else io.StringIO(txt)
            if p.startswith('/dev/'):
                raise PermissionError(13, "Direct device access isn't simulated; use serial / smbus2 / spidev / gpiozero", p)
        return real_open(file, mode, *a, **kw)

    def listdir(path='.'):
        v = _virtual_listing(os.fspath(path))
        return list(v) if v is not None else real_listdir(path)

    def exists(path):
        p = os.fspath(path)
        if p.startswith('/sys/'):
            if _virtual_listing(p) is not None:
                return True
            try:
                return _virtual_file(p) is not None
            except FileNotFoundError:
                return False
        return real_exists(path)

    def isdir(path):
        p = os.fspath(path)
        if p.startswith('/sys/'):
            return _virtual_listing(p) is not None
        return real_isdir(path)

    def isfile(path):
        p = os.fspath(path)
        if p.startswith('/sys/'):
            try:
                return _virtual_file(p) is not None
            except FileNotFoundError:
                return False
        return real_isfile(path)

    def glob_(pattern, *a, **kw):
        p = os.fspath(pattern)
        if p.startswith(W1 + '/'):
            parts = p[len(W1) + 1:].split('/')
            out = []
            for d in call('w1.list'):
                if fnmatch.fnmatch(d, parts[0]):
                    if len(parts) == 1:
                        out.append(W1 + '/' + d)
                    elif len(parts) == 2:
                        for leaf in ['w1_slave', 'temperature', 'name']:
                            if fnmatch.fnmatch(leaf, parts[1]):
                                out.append(W1 + '/' + d + '/' + leaf)
            return out
        return real_glob(pattern, *a, **kw)

    def system(cmd):
        c = str(cmd).strip()
        if c.startswith('modprobe') or c.startswith('sudo modprobe'):
            return 0
        if c in ('clear', 'cls'):
            return 0
        sys.stderr.write('[simulator] os.system(%r) is not available in the browser\n' % c)
        return 127

    builtins.open = open_
    io.open = open_
    os.listdir = listdir
    os.path.exists = exists
    os.path.isdir = isdir
    os.path.isfile = isfile
    _glob.glob = glob_
    os.system = system


def _patch_signal():
    import signal

    def pause():
        idle_forever()

    signal.pause = pause


# ------------------------------------------------------------------ driver registry / import hook
# Built-in simulation drivers (modules under /lib/sim). Importing one is announced to the
# simulator (Logs / protocol monitor); importing anything unavailable gets an explanation.
DRIVERS = {}  # top-level module name -> description, filled by install()

NOT_AVAILABLE = {
    'pigpio': 'pigpio does not support the Raspberry Pi 5 (its GPIO is on the RP1 chip). Use gpiozero or lgpio.',
    'wiringpi': 'WiringPi does not support the Raspberry Pi 5. Use gpiozero or lgpio.',
    'Adafruit_GPIO': 'Adafruit_GPIO is deprecated. Use board/busio/digitalio (Blinka) or gpiozero.',
    'adafruit_blinka': 'Import board, busio and digitalio directly (they are built in).',
    'picamera': 'Cameras are not simulated.',
    'picamera2': 'Cameras are not simulated.',
    'cv2': 'OpenCV / cameras are not available in the simulator.',
    'numpy': 'numpy is not loaded in this simulator (no package download). Use plain Python lists and math.',
    'pandas': 'pandas is not available in the simulator.',
    'requests': 'The simulated Pi has no internet access. Use the built-in Flask web server for local web pages.',
    'paho': 'MQTT/networking is not simulated (no internet access).',
    'pymodbus': 'pymodbus is not built in — use minimalmodbus (built in) for Modbus RTU sensors.',
    'smbus3': 'Use smbus2 (built in).',
    'Adafruit_ADS1x15': 'This legacy library is replaced by adafruit_ads1x15 (built in).',
    'Adafruit_BME280': 'Use adafruit_bme280 or bme280 (built in).',
    'luma': 'luma.oled/luma.lcd are not built in — use ssd1306 / st7735 (simulator drivers).',
}


def _announce(top):
    if top in DRIVERS and top not in _announced:
        _announced.add(top)
        try:
            _simjs.post('driver.loaded', json.dumps({'module': top, 'kind': 'built-in simulation driver'}))
        except Exception:
            pass


_announced = set()


_orig_import = builtins.__import__


def _import(name, globals=None, locals=None, fromlist=(), level=0):
    """Announce built-in drivers imported by the user's program (every run)."""
    if level == 0 and globals and str(globals.get('__file__') or '').startswith(PROJECT):
        _announce(name.split('.')[0])
    return _orig_import(name, globals, locals, fromlist, level)


class _MissingFinder:
    """Last on sys.meta_path: reached only when no finder can load the module."""

    @classmethod
    def find_spec(cls, name, path=None, target=None):
        if path is not None:
            return None
        top = name.split('.')[0]
        caller = sys._getframe(1)
        while caller is not None and (caller.f_code.co_filename.startswith('<frozen') or caller.f_code.co_filename == __file__):
            caller = caller.f_back
        # only explain imports written in the user's project (library try/except imports stay quiet)
        if caller is None or not caller.f_code.co_filename.startswith(PROJECT):
            return None
        why = NOT_AVAILABLE.get(top, 'The simulator cannot install packages (there is no pip or internet).')
        supported = ', '.join(sorted(DRIVERS))
        raise ModuleNotFoundError(
            "No module named '%s'. %s Built-in hardware libraries: %s. See Examples → Libraries for the supported classes and functions." % (top, why, supported),
            name=top,
        )


def _scan_drivers():
    root = '/lib/sim'
    try:
        names = os.listdir(root)
    except OSError:
        return
    for n in names:
        if n.startswith('_') or n == '__pycache__':
            continue
        mod = n[:-3] if n.endswith('.py') else n
        if n.endswith('.py') or os.path.isdir(os.path.join(root, n)):
            DRIVERS[mod] = True


def install():
    _patch_time()
    _patch_threading()
    _patch_fs()
    _patch_signal()
    _scan_drivers()
    builtins.__import__ = _import
    sys.meta_path.append(_MissingFinder)


# ------------------------------------------------------------------ program runner
EXPLAIN_SKIP = ('/lib/sim/', '<frozen', '/lib/python3', 'runpy')


def _user_frames(tb):
    frames = traceback.extract_tb(tb)
    return [f for f in frames if f.filename.startswith(PROJECT)]


def _reset_state():
    global _http_handler, _timer_seq, _warned_threads
    _edge_handlers.clear()
    _timers.clear()
    _deferred.clear()
    _http_handler = None
    _warned_threads = False
    for name in list(sys.modules):
        mod = sys.modules[name]
        f = getattr(mod, '__file__', None) or ''
        if f.startswith(PROJECT):
            del sys.modules[name]
    _announced.clear()
    for name, m in list(sys.modules.items()):
        f = getattr(m, '__file__', None) or ''
        if f.startswith('/lib/sim/') and hasattr(m, '_sim_reset'):
            try:
                m._sim_reset()
            except Exception:
                pass


def _shutdown_devices():
    for name, m in list(sys.modules.items()):
        f = getattr(m, '__file__', None) or ''
        if f.startswith('/lib/sim/') and hasattr(m, '_sim_shutdown'):
            try:
                m._sim_shutdown()
            except BaseException:
                pass


def run_main(path):
    import runpy

    _reset_state()
    if PROJECT not in sys.path:
        sys.path.insert(0, PROJECT)
    os.chdir(PROJECT)
    status = 'ok'
    error = None
    try:
        sys.argv = [path]
        runpy.run_path(path, run_name='__main__')
        run_deferred_threads()
        srv = sys.modules.get('flask')
        if srv is not None and getattr(srv, '_background_server', None):
            idle_forever()
    except SimStopped:
        status = 'stopped'
    except KeyboardInterrupt:
        status = 'stopped'
    except SystemExit as e:
        if e.code not in (None, 0):
            sys.stderr.write('SystemExit: %s\n' % (e.code,))
    except BaseException as e:  # noqa: BLE001
        status = 'error'
        error = _describe(e)
        sys.stderr.write(error['traceback'])
    finally:
        try:
            sys.stdout.flush()
        except Exception:
            pass
        _shutdown_devices()
    return json.dumps({'status': status, 'error': error})


def _describe(e):
    tb = e.__traceback__
    frames = _user_frames(tb)
    file = None
    line = None
    if isinstance(e, SyntaxError) and e.filename and str(e.filename).startswith(PROJECT):
        file = os.path.relpath(e.filename, PROJECT)
        line = e.lineno
    elif frames:
        file = os.path.relpath(frames[-1].filename, PROJECT)
        line = frames[-1].lineno
    lines = ['Traceback (most recent call last):\n']
    for f in traceback.extract_tb(tb):
        if f.filename.startswith(PROJECT):
            lines.append('  File "%s", line %d, in %s\n' % (os.path.relpath(f.filename, PROJECT), f.lineno, f.name))
            if f.line:
                lines.append('    %s\n' % f.line.strip())
    if isinstance(e, SyntaxError):
        txt = ''.join(traceback.format_exception_only(type(e), e)).replace(PROJECT + '/', '')
    else:
        txt = '%s: %s\n' % (type(e).__name__, e) if str(e) else '%s\n' % type(e).__name__
    if len(lines) == 1:
        lines = []
    return {
        'type': type(e).__name__,
        'message': str(e),
        'traceback': ''.join(lines) + txt,
        'file': file,
        'line': line,
    }
