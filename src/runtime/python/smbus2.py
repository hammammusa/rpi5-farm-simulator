"""smbus2-compatible I2C access to the simulator's bus 1 (GPIO2 SDA / GPIO3 SCL).

A missing or unpowered device raises OSError(121, 'Remote I/O error') just like
on a real Raspberry Pi.
"""

from _simcore import call as _call

__version__ = '0.5.0-sim'


class i2c_msg:
    def __init__(self, addr, flags, buf):
        self.addr = addr
        self.flags = flags
        self.buf = list(buf)
        self.len = len(self.buf)

    @staticmethod
    def write(address, buf):
        if isinstance(buf, str):
            buf = buf.encode()
        return i2c_msg(address, 0, buf)

    @staticmethod
    def read(address, length):
        return i2c_msg(address, 1, [0] * length)

    def __iter__(self):
        return iter(self.buf)

    def __len__(self):
        return self.len

    def __bytes__(self):
        return bytes(self.buf)


class SMBus:
    def __init__(self, bus=None, force=False):
        self.bus = None
        self.force = force
        if bus is not None:
            self.open(bus)

    def open(self, bus):
        if isinstance(bus, str):
            bus = int(bus.rsplit('-', 1)[-1])
        self.bus = int(bus)

    def close(self):
        self.bus = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def _io(self, addr, write=None, read=0):
        if self.bus is None:
            raise IOError('Bus not open')
        return _call('i2c', bus=self.bus, addr=int(addr), write=None if write is None else [int(x) & 0xff for x in write], read=int(read))

    def write_quick(self, i2c_addr, force=None):
        self._io(i2c_addr, [], 0)

    def read_byte(self, i2c_addr, force=None):
        return self._io(i2c_addr, None, 1)[0]

    def write_byte(self, i2c_addr, value, force=None):
        self._io(i2c_addr, [value], 0)

    def read_byte_data(self, i2c_addr, register, force=None):
        return self._io(i2c_addr, [register], 1)[0]

    def write_byte_data(self, i2c_addr, register, value, force=None):
        self._io(i2c_addr, [register, value], 0)

    def read_word_data(self, i2c_addr, register, force=None):
        lo, hi = self._io(i2c_addr, [register], 2)
        return lo | (hi << 8)

    def write_word_data(self, i2c_addr, register, value, force=None):
        self._io(i2c_addr, [register, value & 0xff, (value >> 8) & 0xff], 0)

    def read_i2c_block_data(self, i2c_addr, register, length, force=None):
        if length > 32:
            raise ValueError('Desired block length over 32 bytes')
        return list(self._io(i2c_addr, [register], length))

    def write_i2c_block_data(self, i2c_addr, register, data, force=None):
        if len(data) > 32:
            raise ValueError('Data length cannot exceed 32 bytes')
        self._io(i2c_addr, [register] + list(data), 0)

    def read_block_data(self, i2c_addr, register, force=None):
        return self.read_i2c_block_data(i2c_addr, register, 32)

    def i2c_rdwr(self, *msgs):
        for m in msgs:
            if m.flags & 1:
                m.buf = list(self._io(m.addr, None, m.len))
            else:
                self._io(m.addr, m.buf, 0)


def scan(bus=1):
    """Simulator helper: list responding addresses (like `i2cdetect -y 1`)."""
    return _call('i2c.scan')
