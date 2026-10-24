"""Adafruit Blinka `busio` for the Raspberry Pi 5 simulator: I2C on bus 1 (board.SCL/board.SDA),
SPI0 (board.SCK/MOSI/MISO) and UART (wraps the simulated /dev/serial0).

Every transfer is a real bus transaction against the simulated devices, so a missing
device raises OSError(121) / ValueError exactly where the real Blinka would.
"""

from _simcore import call as _call
import board as _board

__version__ = '8.0.0-sim'


def _pin_id(p):
    return int(getattr(p, 'id', p))


class _Lockable:
    def __init__(self):
        self._locked = False

    def try_lock(self):
        if self._locked:
            return False
        self._locked = True
        return True

    def unlock(self):
        self._locked = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.deinit()


def _buf(buffer, start, end):
    end = len(buffer) if end is None else end
    return [int(b) & 0xff for b in bytes(buffer[start:end])]


class I2C(_Lockable):
    """Hardware I2C1 (GPIO3 = SCL, GPIO2 = SDA)."""

    def __init__(self, scl, sda, *, frequency=100000, timeout=255):
        super().__init__()
        if (_pin_id(scl), _pin_id(sda)) != (3, 2):
            raise ValueError('No Hardware I2C on (scl,sda)=(%s, %s)\nValid I2C ports: ((1, SCL, SDA),)' % (scl, sda))
        self.frequency = frequency
        self._bus = 1

    def deinit(self):
        self._locked = False

    def scan(self):
        return list(_call('i2c.scan'))

    def writeto(self, address, buffer, *, start=0, end=None):
        _call('i2c', bus=self._bus, addr=int(address), write=_buf(buffer, start, end), read=0)

    def readfrom_into(self, address, buffer, *, start=0, end=None):
        end = len(buffer) if end is None else end
        data = _call('i2c', bus=self._bus, addr=int(address), write=None, read=end - start)
        for i, b in enumerate(data):
            buffer[start + i] = b

    def writeto_then_readfrom(self, address, buffer_out, buffer_in, *, out_start=0, out_end=None, in_start=0, in_end=None):
        in_end = len(buffer_in) if in_end is None else in_end
        data = _call('i2c', bus=self._bus, addr=int(address), write=_buf(buffer_out, out_start, out_end), read=in_end - in_start)
        for i, b in enumerate(data):
            buffer_in[in_start + i] = b


class SPI(_Lockable):
    """Hardware SPI0. Chip select is a digitalio pin (board.CE0 → spidev0.0, board.CE1 → spidev0.1)."""

    def __init__(self, clock, MOSI=None, MISO=None):
        super().__init__()
        if _pin_id(clock) != 11:
            raise ValueError('No Hardware SPI on (SCLK, MOSI, MISO)=(%s, %s, %s)' % (clock, MOSI, MISO))
        self.baudrate = 100000
        self._open = set()

    def configure(self, *, baudrate=100000, polarity=0, phase=0, bits=8):
        self.baudrate = baudrate

    def deinit(self):
        self._locked = False

    def _dev(self):
        import digitalio

        low = [p for p in digitalio._outputs_low() if p in (8, 7)]
        dev = 1 if 7 in low and 8 not in low else 0
        if dev not in self._open:
            _call('spi.open', bus=0, dev=dev)
            self._open.add(dev)
        return dev

    def write(self, buf, *, start=0, end=None):
        _call('spi.xfer', dev=self._dev(), data=_buf(buf, start, end))

    def readinto(self, buf, *, start=0, end=None, write_value=0):
        end = len(buf) if end is None else end
        r = _call('spi.xfer', dev=self._dev(), data=[write_value & 0xff] * (end - start))
        for i, b in enumerate(r):
            buf[start + i] = b

    def write_readinto(self, buffer_out, buffer_in, *, out_start=0, out_end=None, in_start=0, in_end=None):
        r = _call('spi.xfer', dev=self._dev(), data=_buf(buffer_out, out_start, out_end))
        for i, b in enumerate(r):
            buffer_in[in_start + i] = b


class UART:
    """busio.UART on the PL011 UART0 (board.TX/board.RX) — wraps the simulated pyserial port."""

    class Parity:
        ODD = 'O'
        EVEN = 'E'

    def __init__(self, tx, rx, *, baudrate=9600, bits=8, parity=None, stop=1, timeout=1, receiver_buffer_size=64):
        import serial

        if (_pin_id(tx), _pin_id(rx)) != (14, 15):
            raise ValueError('No Hardware UART on (TX, RX)=(%s, %s); use board.TX / board.RX' % (tx, rx))
        self._s = serial.Serial('/dev/serial0', baudrate, timeout=timeout)

    @property
    def baudrate(self):
        return self._s.baudrate

    @baudrate.setter
    def baudrate(self, v):
        self._s.baudrate = v

    @property
    def in_waiting(self):
        return self._s.in_waiting

    def read(self, nbytes=None):
        data = self._s.read(nbytes if nbytes is not None else max(1, self._s.in_waiting))
        return data or None

    def readinto(self, buf):
        data = self._s.read(len(buf))
        buf[: len(data)] = data
        return len(data) or None

    def readline(self):
        return self._s.readline() or None

    def write(self, buf):
        return self._s.write(bytes(buf))

    def reset_input_buffer(self):
        self._s.reset_input_buffer()

    def deinit(self):
        self._s.close()


_ = _board
