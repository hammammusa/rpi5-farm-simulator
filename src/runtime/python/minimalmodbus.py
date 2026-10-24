"""minimalmodbus (simulator subset): Instrument(port, slaveaddress) over the simulated pyserial port.

Modbus RTU only: read_register(s) (function 3/4), write_register (6), write_registers (16),
read_long, read_float. Use an auto-direction RS-485 module, or toggle DE/RE yourself.
"""
import struct
import time

import serial

__version__ = '2.1.1-sim'

MODE_RTU = 'rtu'
BYTEORDER_BIG = 0


class ModbusException(IOError):
    pass


class SlaveReportedException(ModbusException):
    pass


class NoResponseError(ModbusException):
    pass


class InvalidResponseError(ModbusException):
    pass


def _crc(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return bytes([crc & 0xFF, (crc >> 8) & 0xFF])


class Instrument:
    def __init__(self, port, slaveaddress, mode=MODE_RTU, close_port_after_each_call=False, debug=False):
        self.address = int(slaveaddress)
        self.mode = mode
        self.debug = debug
        self.clear_buffers_before_each_transaction = True
        self.serial = serial.Serial(port, 19200, timeout=0.05)
        self.serial.baudrate = 19200

    def _communicate(self, request, expected):
        if self.clear_buffers_before_each_transaction:
            self.serial.reset_input_buffer()
        self.serial.write(request)
        deadline = time.time() + max(0.05, self.serial.timeout or 0.05) + 0.2
        resp = b''
        while len(resp) < expected and time.time() < deadline:
            chunk = self.serial.read(expected - len(resp))
            if chunk:
                resp += chunk
            elif resp and len(resp) >= 5 and resp[1] & 0x80:
                break
        if not resp:
            raise NoResponseError('No communication with the instrument (no answer)')
        if len(resp) >= 5 and resp[1] & 0x80:
            resp = resp[:5]
            if _crc(resp[:3]) != resp[3:5]:
                raise InvalidResponseError('CRC error in exception response')
            raise SlaveReportedException('Slave reported exception code %d' % resp[2])
        if len(resp) < expected:
            raise InvalidResponseError('Too short Modbus RTU response (%d bytes)' % len(resp))
        if _crc(resp[:-2]) != resp[-2:]:
            raise InvalidResponseError('CRC error: %r' % resp)
        if resp[0] != self.address:
            raise InvalidResponseError('Wrong return slave address: %d' % resp[0])
        return resp

    def _read(self, register, count, functioncode):
        if functioncode not in (3, 4):
            raise ValueError('Wrong function code: %d' % functioncode)
        req = struct.pack('>BBHH', self.address, functioncode, register, count)
        resp = self._communicate(req + _crc(req), 5 + 2 * count)
        return list(struct.unpack('>%dH' % count, resp[3 : 3 + 2 * count]))

    def read_register(self, registeraddress, number_of_decimals=0, functioncode=3, signed=False):
        v = self._read(registeraddress, 1, functioncode)[0]
        if signed and v & 0x8000:
            v -= 0x10000
        return v / (10 ** number_of_decimals) if number_of_decimals else v

    def read_registers(self, registeraddress, number_of_registers, functioncode=3):
        return self._read(registeraddress, number_of_registers, functioncode)

    def read_long(self, registeraddress, functioncode=3, signed=False, byteorder=BYTEORDER_BIG, number_of_registers=2):
        a, b = self._read(registeraddress, 2, functioncode)
        v = (a << 16) | b
        return v - (1 << 32) if signed and v & 0x80000000 else v

    def read_float(self, registeraddress, functioncode=3, number_of_registers=2, byteorder=BYTEORDER_BIG):
        a, b = self._read(registeraddress, 2, functioncode)
        return struct.unpack('>f', struct.pack('>HH', a, b))[0]

    def write_register(self, registeraddress, value, number_of_decimals=0, functioncode=16, signed=False):
        v = int(round(value * (10 ** number_of_decimals))) & 0xFFFF
        if functioncode == 6:
            req = struct.pack('>BBHH', self.address, 6, registeraddress, v)
        else:
            req = struct.pack('>BBHHBH', self.address, 16, registeraddress, 1, 2, v)
        self._communicate(req + _crc(req), 8)

    def write_registers(self, registeraddress, values):
        req = struct.pack('>BBHHB', self.address, 16, registeraddress, len(values), 2 * len(values)) + b''.join(struct.pack('>H', v & 0xFFFF) for v in values)
        self._communicate(req + _crc(req), 8)
