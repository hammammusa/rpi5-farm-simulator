"""w1thermsensor-compatible DS18B20 access via the simulated /sys/bus/w1 interface."""

import enum as _enum
import glob as _glob

from _simcore import sleep as _sleep

BASE = '/sys/bus/w1/devices'


class W1ThermSensorError(Exception):
    pass


class NoSensorFoundError(W1ThermSensorError):
    pass


class SensorNotReadyError(W1ThermSensorError):
    pass


class ResetValueError(W1ThermSensorError):
    pass


class Unit(_enum.Enum):
    DEGREES_C = 'celsius'
    DEGREES_F = 'fahrenheit'
    KELVIN = 'kelvin'


class Sensor(_enum.Enum):
    DS18B20 = 0x28


def _convert(c, unit):
    if unit in (Unit.DEGREES_F, 'fahrenheit'):
        return c * 9 / 5 + 32
    if unit in (Unit.KELVIN, 'kelvin'):
        return c + 273.15
    return c


class W1ThermSensor:
    DEGREES_C = Unit.DEGREES_C
    DEGREES_F = Unit.DEGREES_F
    KELVIN = Unit.KELVIN
    THERM_SENSOR_DS18B20 = Sensor.DS18B20

    def __init__(self, sensor_type=None, sensor_id=None):
        ids = [p.split('/')[-1] for p in _glob.glob(BASE + '/28-*')]
        if sensor_id is None:
            if not ids:
                raise NoSensorFoundError('No DS18B20 temperature sensor found. Check 1-Wire is enabled (dtoverlay=w1-gpio), the probe is wired to GPIO4 and has a 4.7 kΩ pull-up.')
            self.id = ids[0][3:]
        else:
            sid = str(sensor_id)
            if sid.startswith('28-'):
                sid = sid[3:]
            if '28-' + sid not in ids:
                raise NoSensorFoundError('Could not find sensor of type DS18B20 with id %s' % sid)
            self.id = sid
        self.type = Sensor.DS18B20
        self.name = '28-' + self.id

    @classmethod
    def get_available_sensors(cls, types=None):
        return [cls(sensor_id=p.split('/')[-1]) for p in _glob.glob(BASE + '/28-*')]

    def _raw(self):
        try:
            with open('%s/28-%s/w1_slave' % (BASE, self.id)) as f:
                return f.read()
        except FileNotFoundError:
            raise NoSensorFoundError('Sensor 28-%s disappeared (disconnected?)' % self.id)

    def get_temperature(self, unit=Unit.DEGREES_C):
        lines = self._raw().strip().split('\n')
        if not lines[0].endswith('YES'):
            raise SensorNotReadyError('Sensor 28-%s is not yet ready to read temperature (CRC failed)' % self.id)
        c = int(lines[1].split('t=')[1]) / 1000.0
        if c == 85.0:
            raise ResetValueError('Sensor 28-%s yields the reset value of 85 degree millicelsius. Please check the power-supply for the sensor.' % self.id)
        return _convert(c, unit)

    def get_temperatures(self, units):
        c = self.get_temperature()
        return [_convert(c, u) for u in units]

    def __repr__(self):
        return 'W1ThermSensor(sensor_type=DS18B20, sensor_id=%r)' % self.id
