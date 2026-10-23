"""pyserial-compatible Serial class for the simulator's UARTs.

Ports: /dev/serial0 and /dev/ttyAMA0 (UART0, GPIO14 TX / GPIO15 RX),
/dev/ttyAMA1..4 (UART1..4). Bytes travel over the simulated wires to the
device whose RX/TX pins are connected, with real transmission time
(10 bits per byte at the configured baud rate).
"""

import _simcore
from _simcore import call as _call, post as _post, now as _now

VERSION = '3.5-sim'

PARITY_NONE, PARITY_EVEN, PARITY_ODD, PARITY_MARK, PARITY_SPACE = 'N', 'E', 'O', 'M', 'S'
STOPBITS_ONE, STOPBITS_ONE_POINT_FIVE, STOPBITS_TWO = 1, 1.5, 2
FIVEBITS, SIXBITS, SEVENBITS, EIGHTBITS = 5, 6, 7, 8
XON, XOFF = b'\x11', b'\x13'
LF, CR = b'\n', b'\r'


class SerialException(IOError):
    pass


class SerialTimeoutException(SerialException):
    pass


class PortNotOpenError(SerialException):
    def __init__(self, msg='Attempting to use a port that is not open'):
        super().__init__(msg)


_simcore.EXC.update({'SerialException': SerialException, 'PortNotOpenError': PortNotOpenError})

_open_ports = []


def _sim_reset():
    _open_ports.clear()


def _sim_shutdown():
    for p in list(_open_ports):
        try:
            p.close()
        except BaseException:
            pass


class Serial:
    def __init__(self, port=None, baudrate=9600, bytesize=EIGHTBITS, parity=PARITY_NONE, stopbits=STOPBITS_ONE, timeout=None,
                 xonxoff=False, rtscts=False, write_timeout=None, dsrdtr=False, inter_byte_timeout=None, exclusive=None, **kwargs):
        self._port = port
        self._baud = int(baudrate)
        self.bytesize = bytesize
        self.parity = parity
        self.stopbits = stopbits
        self.timeout = timeout
        self.write_timeout = write_timeout
        self.inter_byte_timeout = inter_byte_timeout
        self.is_open = False
        self._buf = bytearray()
        if port is not None:
            self.open()

    @property
    def port(self):
        return self._port

    @port.setter
    def port(self, p):
        if self.is_open:
            self.close()
        self._port = p

    @property
    def name(self):
        return self._port

    @property
    def baudrate(self):
        return self._baud

    @baudrate.setter
    def baudrate(self, b):
        self._baud = int(b)
        if self.is_open:
            _call('uart.baud', port=self._port, baud=self._baud)

    def open(self):
        if self._port is None:
            raise SerialException('Port must be configured before it can be used.')
        if self.is_open:
            raise SerialException('Port is already open.')
        _call('uart.open', port=self._port, baud=self._baud)
        self.is_open = True
        _open_ports.append(self)

    def close(self):
        if self.is_open:
            self.is_open = False
            if self in _open_ports:
                _open_ports.remove(self)
            try:
                _call('uart.close', port=self._port)
            except BaseException:
                pass

    def __enter__(self):
        if not self.is_open and self._port is not None:
            self.open()
        return self

    def __exit__(self, *exc):
        self.close()

    def _need_open(self):
        if not self.is_open:
            raise PortNotOpenError()

    def write(self, data):
        self._need_open()
        if isinstance(data, str):
            raise TypeError('unicode strings are not supported, please encode to bytes: %r' % (data,))
        b = bytes(data)
        if b:
            _post('uart.write', port=self._port, data=list(b))
        return len(b)

    def _pull(self, maxn):
        r = _call('uart.read', port=self._port, max=maxn)
        self._buf.extend(bytes(r['d']))
        return r['next']

    def _read_impl(self, done):
        """Read until done(buffer) returns an index to cut at, honouring timeout."""
        self._need_open()
        deadline = None if self.timeout is None else _now() + self.timeout
        while True:
            nxt = self._pull(4096)
            cut = done(self._buf)
            if cut is not None:
                out = bytes(self._buf[:cut])
                del self._buf[:cut]
                return out
            t = _now()
            if self.timeout == 0 or (deadline is not None and t >= deadline):
                out = bytes(self._buf)
                self._buf.clear()
                return out
            limit = None if deadline is None else deadline - t
            wait = 0.5 if nxt is None else max(0.0, nxt - t)
            if limit is not None:
                wait = min(wait, limit)
            _simcore.wait_event(wait if wait > 0 else 0.0005)

    def read(self, size=1):
        if size <= 0:
            return b''
        return self._read_impl(lambda b: size if len(b) >= size else None)

    def read_until(self, expected=LF, size=None):
        exp = bytes(expected)

        def done(b):
            i = b.find(exp)
            if i >= 0:
                n = i + len(exp)
                return n if size is None else min(n, size)
            if size is not None and len(b) >= size:
                return size
            return None

        return self._read_impl(done)

    def readline(self, size=-1):
        return self.read_until(LF, None if size is None or size < 0 else size)

    def readlines(self, hint=-1):
        out = []
        while True:
            line = self.readline()
            if not line:
                return out
            out.append(line)

    def read_all(self):
        self._need_open()
        self._pull(1 << 20)
        out = bytes(self._buf)
        self._buf.clear()
        return out

    @property
    def in_waiting(self):
        self._need_open()
        return len(self._buf) + int(_call('uart.available', port=self._port))

    def inWaiting(self):
        return self.in_waiting

    @property
    def out_waiting(self):
        return 0

    def reset_input_buffer(self):
        self._need_open()
        self._buf.clear()
        _call('uart.flush_input', port=self._port)

    flushInput = reset_input_buffer

    def reset_output_buffer(self):
        pass

    flushOutput = reset_output_buffer

    def flush(self):
        pass

    def readable(self):
        return True

    def writable(self):
        return True

    def fileno(self):
        raise SerialException('fileno() is not available in the simulator')

    def __repr__(self):
        return 'Serial<id=0x%x, open=%s>(port=%r, baudrate=%r, bytesize=%r, parity=%r, stopbits=%r, timeout=%r)' % (
            id(self), self.is_open, self._port, self._baud, self.bytesize, self.parity, self.stopbits, self.timeout)


def serial_for_url(url, *args, **kwargs):
    return Serial(url, *args, **kwargs)
