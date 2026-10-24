"""adafruit_pm25.uart.PM25_UART(uart) — `uart` is a serial.Serial / busio.UART at 9600 baud."""
from adafruit_pm25 import PM25


class PM25_UART(PM25):
    def __init__(self, uart, reset_pin=None):
        super().__init__()
        self._uart = uart

    def _read_into_buffer(self):
        while True:
            b = self._uart.read(1)
            if not b:
                raise RuntimeError('Unable to read from PM2.5 (no start of frame)')
            if b[0] == 0x42:
                break
        rest = self._uart.read(31)
        if not rest or len(rest) < 31:
            raise RuntimeError('Unable to read from PM2.5 sensor')
        self._buffer = bytearray(b + rest)
