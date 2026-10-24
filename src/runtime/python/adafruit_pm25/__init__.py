"""adafruit_pm25 (simulator): PMS5003 frame parser."""
import struct


class PM25:
    def __init__(self):
        self._buffer = bytearray(32)
        self.aqi_reading = {
            'pm10 standard': None, 'pm25 standard': None, 'pm100 standard': None,
            'pm10 env': None, 'pm25 env': None, 'pm100 env': None,
            'particles 03um': None, 'particles 05um': None, 'particles 10um': None,
            'particles 25um': None, 'particles 50um': None, 'particles 100um': None,
        }

    def _read_into_buffer(self):
        raise NotImplementedError()

    def read(self):
        self._read_into_buffer()
        if not self._buffer.startswith(b'BM'):
            raise RuntimeError('Invalid PM2.5 header')
        frame_len = struct.unpack('>H', self._buffer[2:4])[0]
        if frame_len != 28:
            raise RuntimeError('Invalid PM2.5 frame length')
        checksum = struct.unpack('>H', self._buffer[30:32])[0]
        if checksum != sum(self._buffer[0:30]):
            raise RuntimeError('Invalid PM2.5 checksum')
        w = struct.unpack('>HHHHHHHHHHHH', self._buffer[4:28])
        keys = ['pm10 standard', 'pm25 standard', 'pm100 standard', 'pm10 env', 'pm25 env', 'pm100 env',
                'particles 03um', 'particles 05um', 'particles 10um', 'particles 25um', 'particles 50um', 'particles 100um']
        for k, v in zip(keys, w):
            self.aqi_reading[k] = v
        return self.aqi_reading
