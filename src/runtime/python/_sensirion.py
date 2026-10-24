"""Sensirion helpers: CRC-8 (poly 0x31, init 0xFF) and 16-bit command transfers with CRC-checked words."""
import time


def crc8(data):
    crc = 0xFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = ((crc << 1) ^ 0x31) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc


class SensirionDevice:
    def __init__(self, i2c, address):
        from adafruit_bus_device.i2c_device import I2CDevice

        self._dev = I2CDevice(i2c, address)

    def _cmd(self, cmd, args=(), delay=0.0):
        out = [(cmd >> 8) & 0xFF, cmd & 0xFF]
        for a in args:
            w = [(a >> 8) & 0xFF, a & 0xFF]
            out += w + [crc8(w)]
        with self._dev as d:
            d.write(bytes(out))
        if delay:
            time.sleep(delay)

    def _read_words(self, n):
        buf = bytearray(3 * n)
        with self._dev as d:
            d.readinto(buf)
        words = []
        for i in range(n):
            chunk = buf[3 * i : 3 * i + 2]
            if crc8(chunk) != buf[3 * i + 2]:
                raise RuntimeError('CRC check failed while reading data')
            words.append((chunk[0] << 8) | chunk[1])
        return words
