# onewire module (MicroPython API): bus scan returns 8-byte ROM codes.
from _sched import call


class OneWireError(Exception):
    pass


def _rom(rid):
    serial = bytes.fromhex(rid[3:])
    body = bytes([int(rid[:2], 16)]) + bytes(reversed(serial))
    return bytearray(body + bytes([_crc8(body)]))


def _rid(rom):
    return '%02x-%s' % (rom[0], ''.join('%02x' % b for b in reversed(rom[1:7])))


def _crc8(data):
    crc = 0
    for b in data:
        for _ in range(8):
            mix = (crc ^ b) & 1
            crc >>= 1
            if mix:
                crc ^= 0x8C
            b >>= 1
    return crc


class OneWire:
    SEARCH_ROM = 0xF0
    MATCH_ROM = 0x55
    SKIP_ROM = 0xCC

    def __init__(self, pin):
        self._pin = pin._id if hasattr(pin, '_id') else int(pin)
        call('ow.open', pin=self._pin)

    def scan(self):
        return [_rom(r) for r in call('ow.scan', pin=self._pin)]

    def reset(self, required=False):
        present = len(call('ow.scan', pin=self._pin)) > 0
        if required and not present:
            raise OneWireError
        return present

    def crc8(self, data):
        return _crc8(data)
