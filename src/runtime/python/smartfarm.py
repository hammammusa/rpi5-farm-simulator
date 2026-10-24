"""smartfarm — high-level Raspberry Pi 5 smart-farming hardware API.

    from smartfarm import DHT22, PHSensor, ADS1115, Pump, Relay

    dht = DHT22(4)                     # data pin GPIO4
    adc = ADS1115()                    # I2C ADC at 0x48
    ph = PHSensor(adc, channel=0)      # analog pH board on A0
    pump = Pump(17, active_high=False) # active-LOW relay on GPIO17

    t, h = dht.read()
    print(f"{t:.1f} °C {h:.0f} %RH  pH {ph.read():.2f}")
    pump.on()

Every class is a thin wrapper around the standard Raspberry Pi libraries (gpiozero,
adafruit-circuitpython-*, smbus2, pyserial, w1thermsensor, RPLCD). This file only uses
their public APIs, so the same module also works on a real Raspberry Pi 5 when those
libraries are installed (see the exported README for the pip commands).

Analog sensors convert voltages with the calibration of the module listed in each class.
Real probes must be calibrated: pass your own `calibration=` values.
"""

import math
import time

__version__ = '1.0.0'

__all__ = [
    'SensorError', 'scan_i2c',
    'DHT22', 'DHT11', 'AM2302', 'DS18B20', 'BME280', 'BMP280', 'SHT31', 'SCD30', 'SCD4X', 'CCS811', 'BME680', 'TSL2561', 'BH1750', 'MHZ19', 'PMS5003',
    'ADS1115', 'MCP3008', 'AnalogSensor', 'PHSensor', 'ECSensor', 'TDSSensor', 'TurbiditySensor', 'DOSensor', 'SoilMoisture', 'WaterLevel',
    'PressureSensor', 'Thermistor', 'RTD', 'LM35', 'TMP36', 'MQSensor', 'UVSensor', 'PPFDSensor', 'CurrentSensor',
    'Ultrasonic', 'TankLevel', 'FloatSwitch', 'LeakSensor', 'RainSensor', 'MotionSensor', 'FlowMeter',
    'Relay', 'Pump', 'DosingPump', 'Valve', 'Fan', 'PWMFan', 'Heater', 'GrowLight', 'Humidifier', 'LED', 'Buzzer', 'Servo',
    'DCMotor', 'Stepper28BYJ', 'StepperDriver', 'ShiftRegister', 'SevenSegment', 'Display4', 'LEDStrip', 'LCD', 'OLED', 'Nextion',
    'PCF8574', 'MCP23017', 'I2CMux', 'RTC', 'EEPROM', 'ModbusSoilSensor', 'NutrientMonitor',
]


class SensorError(RuntimeError):
    """A sensor did not answer or returned an invalid reading."""


def _i2c():
    import board
    import busio

    return busio.I2C(board.SCL, board.SDA)


def scan_i2c():
    """List the 7-bit addresses that answer on I2C bus 1 (like `i2cdetect -y 1`)."""
    i2c = _i2c()
    while not i2c.try_lock():
        pass
    try:
        return i2c.scan()
    finally:
        i2c.unlock()


def _pin(p):
    import board

    return getattr(board, 'D%d' % int(p))


# ====================================================================== digital sensors
class _DHT:
    _kind = 'DHT22'

    def __init__(self, pin):
        import adafruit_dht

        self.pin = int(pin)
        self._dev = getattr(adafruit_dht, self._kind)(_pin(self.pin))

    def read(self, retries=3):
        """Return (temperature °C, humidity %). Retries a few times like real DHT code must."""
        last = None
        for _ in range(retries):
            try:
                t = self._dev.temperature
                h = self._dev.humidity
                if t is not None and h is not None:
                    return t, h
            except RuntimeError as e:
                last = e
            time.sleep(2.0)
        raise SensorError('%s on GPIO%d: %s' % (self._kind, self.pin, last or 'no data'))

    @property
    def temperature(self):
        return self.read()[0]

    @property
    def humidity(self):
        return self.read()[1]

    def close(self):
        self._dev.exit()


class DHT22(_DHT):
    """DHT22 temperature/humidity (adafruit_dht). `DHT22(4)` = data on GPIO4."""

    _kind = 'DHT22'


class AM2302(DHT22):
    """AM2302 = wired DHT22."""


class DHT11(_DHT):
    """DHT11 (0–50 °C, 20–90 %RH, whole numbers)."""

    _kind = 'DHT11'


class DS18B20:
    """DS18B20 1-Wire probe (w1thermsensor). Enable `dtoverlay=w1-gpio` (GPIO4) and fit a 4.7 kΩ pull-up."""

    def __init__(self, sensor_id=None):
        from w1thermsensor import W1ThermSensor

        try:
            self._dev = W1ThermSensor(sensor_id=sensor_id) if sensor_id else W1ThermSensor()
        except Exception as e:  # NoSensorFoundError
            raise SensorError('DS18B20: %s' % e)

    @staticmethod
    def all():
        from w1thermsensor import W1ThermSensor

        return [DS18B20(s.id) for s in W1ThermSensor.get_available_sensors()]

    @property
    def id(self):
        return self._dev.id

    def read(self):
        try:
            return self._dev.get_temperature()
        except Exception as e:
            raise SensorError('DS18B20: %s' % e)

    temperature = property(read)


class _AdafruitI2C:
    def __init__(self, factory, *args, **kwargs):
        try:
            self._dev = factory(_i2c(), *args, **kwargs)
        except (ValueError, OSError, RuntimeError) as e:
            raise SensorError('%s: %s' % (self.__class__.__name__, e))

    def _get(self, attr):
        try:
            return getattr(self._dev, attr)
        except (OSError, RuntimeError) as e:
            raise SensorError('%s: %s' % (self.__class__.__name__, e))


class BME280(_AdafruitI2C):
    """BME280 (adafruit_bme280). `BME280(address=0x76)`."""

    def __init__(self, address=0x76):
        from adafruit_bme280 import basic

        super().__init__(basic.Adafruit_BME280_I2C, address=address)

    temperature = property(lambda s: s._get('temperature'))
    humidity = property(lambda s: s._get('relative_humidity'))
    pressure = property(lambda s: s._get('pressure'))

    def read(self):
        return self.temperature, self.humidity, self.pressure


class BMP280(_AdafruitI2C):
    """BMP280 pressure/temperature (adafruit_bmp280). `BMP280(address=0x76)`."""

    def __init__(self, address=0x76):
        import adafruit_bmp280

        super().__init__(adafruit_bmp280.Adafruit_BMP280_I2C, address=address)

    temperature = property(lambda s: s._get('temperature'))
    pressure = property(lambda s: s._get('pressure'))
    altitude = property(lambda s: s._get('altitude'))

    def read(self):
        return self.temperature, self.pressure


class SHT31(_AdafruitI2C):
    """SHT31/SHT35 (adafruit_sht31d). `SHT31(address=0x44)`."""

    def __init__(self, address=0x44):
        import adafruit_sht31d

        super().__init__(adafruit_sht31d.SHT31D, address=address)

    temperature = property(lambda s: s._get('temperature'))
    humidity = property(lambda s: s._get('relative_humidity'))

    def read(self):
        return self.temperature, self.humidity


class SCD30(_AdafruitI2C):
    """Sensirion SCD30 CO₂/T/RH (adafruit_scd30). New data every 2 s."""

    def __init__(self):
        import adafruit_scd30

        super().__init__(adafruit_scd30.SCD30)

    def read(self, timeout=5):
        end = time.time() + timeout
        while not self._get('data_available'):
            if time.time() > end:
                raise SensorError('SCD30: no new data')
            time.sleep(0.5)
        return self._get('CO2'), self._get('temperature'), self._get('relative_humidity')

    co2 = property(lambda s: s.read()[0])


class SCD4X(_AdafruitI2C):
    """Sensirion SCD40/SCD41 (adafruit_scd4x). New data every 5 s."""

    def __init__(self):
        import adafruit_scd4x

        super().__init__(adafruit_scd4x.SCD4X)
        self._dev.start_periodic_measurement()

    def read(self, timeout=10):
        end = time.time() + timeout
        while not self._get('data_ready'):
            if time.time() > end:
                raise SensorError('SCD4x: no new data (did start_periodic_measurement run?)')
            time.sleep(1)
        return self._get('CO2'), self._get('temperature'), self._get('relative_humidity')

    co2 = property(lambda s: s.read()[0])


class CCS811(_AdafruitI2C):
    """ams CCS811 eCO₂/TVOC (adafruit_ccs811). Tie nWAKE (WAK) to GND."""

    def __init__(self, address=0x5A):
        import adafruit_ccs811

        super().__init__(adafruit_ccs811.CCS811, address=address)

    def read(self, timeout=5):
        end = time.time() + timeout
        while not self._get('data_ready'):
            if time.time() > end:
                raise SensorError('CCS811: no new data')
            time.sleep(0.2)
        return self._get('eco2'), self._get('tvoc')


class BME680(_AdafruitI2C):
    """Bosch BME680 (adafruit_bme680) — temperature, humidity, pressure, gas resistance."""

    def __init__(self, address=0x77):
        import adafruit_bme680

        super().__init__(adafruit_bme680.Adafruit_BME680_I2C, address=address)

    def read(self):
        return self._get('temperature'), self._get('relative_humidity'), self._get('pressure'), self._get('gas')


class TSL2561(_AdafruitI2C):
    """ams TSL2561 light sensor (adafruit_tsl2561) → lux."""

    def __init__(self, address=0x39):
        import adafruit_tsl2561

        super().__init__(adafruit_tsl2561.TSL2561, address=address)

    def read(self):
        lux = self._get('lux')
        if lux is None:
            raise SensorError('TSL2561: sensor saturated (reduce gain/integration time)')
        return lux

    lux = property(read)


class BH1750:
    """ROHM BH1750 lux meter over smbus2 (one-time high-resolution mode)."""

    def __init__(self, address=0x23, bus=1):
        from smbus2 import SMBus

        self.address = address
        self._bus = SMBus(bus)
        try:
            self._bus.write_byte(address, 0x01)  # power on
        except OSError as e:
            raise SensorError('BH1750 at 0x%02x: %s' % (address, e))

    def read(self):
        try:
            hi, lo = self._bus.read_i2c_block_data(self.address, 0x20, 2)
        except OSError as e:
            raise SensorError('BH1750: %s' % e)
        return ((hi << 8) | lo) / 1.2

    lux = property(read)


class MHZ19:
    """Winsen MH-Z19B CO₂ over UART (9600 baud). Sensor TX → Pi RX (GPIO15), RX → Pi TX (GPIO14)."""

    def __init__(self, port='/dev/serial0'):
        import serial

        self._s = serial.Serial(port, 9600, timeout=1)

    def read(self):
        self._s.reset_input_buffer()
        self._s.write(bytes([0xFF, 0x01, 0x86, 0, 0, 0, 0, 0, 0x79]))
        r = self._s.read(9)
        if len(r) != 9 or r[0] != 0xFF or r[1] != 0x86:
            raise SensorError('MH-Z19B: no answer (check TX/RX crossing and 5 V power)')
        if (0xFF - (sum(r[1:8]) & 0xFF) + 1) & 0xFF != r[8]:
            raise SensorError('MH-Z19B: checksum error')
        return r[2] * 256 + r[3]

    co2 = property(read)


class PMS5003:
    """Plantower PMS5003 on UART (adafruit_pm25). Returns PM1.0/PM2.5/PM10 (µg/m³, standard)."""

    def __init__(self, port='/dev/serial0'):
        import serial
        from adafruit_pm25.uart import PM25_UART

        self._dev = PM25_UART(serial.Serial(port, 9600, timeout=2))

    def read(self):
        try:
            d = self._dev.read()
        except RuntimeError as e:
            raise SensorError('PMS5003: %s' % e)
        return d['pm10 standard'], d['pm25 standard'], d['pm100 standard']


# ====================================================================== ADCs and analog sensors
class ADS1115:
    """TI ADS1115 16-bit ADC (adafruit_ads1x15). `ADS1115(address=0x48, gain=1)` → ±4.096 V range."""

    def __init__(self, address=0x48, gain=1):
        from adafruit_ads1x15 import ads1115
        from adafruit_ads1x15.analog_in import AnalogIn

        try:
            self._ads = ads1115.ADS1115(_i2c(), gain=gain, address=address)
        except (ValueError, OSError) as e:
            raise SensorError('ADS1115 at 0x%02x: %s' % (address, e))
        self._AnalogIn = AnalogIn

    def voltage(self, channel):
        if not 0 <= channel <= 3:
            raise ValueError('ADS1115 channel must be 0–3')
        try:
            return self._AnalogIn(self._ads, channel).voltage
        except OSError as e:
            raise SensorError('ADS1115: %s' % e)


class MCP3008:
    """Microchip MCP3008 10-bit SPI ADC (gpiozero). Vref = 3.3 V."""

    def __init__(self, device=0, vref=3.3):
        self.device = device
        self.vref = vref
        self._ch = {}

    def voltage(self, channel):
        from gpiozero import MCP3008 as _M

        if channel not in self._ch:
            self._ch[channel] = _M(channel=channel, device=self.device, max_voltage=self.vref)
        return self._ch[channel].voltage


class AnalogSensor:
    """Base class: an analog module read through an ADC channel (`adc` is an ADS1115 or MCP3008)."""

    unit = 'V'

    def __init__(self, adc, channel=0, divider=1.0):
        self.adc = adc
        self.channel = channel
        self.divider = float(divider)  # e.g. 1.5 for a 10k/20k divider on a 5 V output

    def voltage(self):
        return self.adc.voltage(self.channel) * self.divider

    def convert(self, v):
        return v

    def read(self):
        return self.convert(self.voltage())

    @property
    def value(self):
        return self.read()


class PHSensor(AnalogSensor):
    """Analog pH board (SEN0161-style). Default calibration pH = 3.5 × V. Use calibrate(v7, v4) with buffers."""

    unit = 'pH'

    def __init__(self, adc, channel=0, slope=3.5, offset=0.0, **kw):
        super().__init__(adc, channel, **kw)
        self.slope, self.offset = slope, offset

    def calibrate(self, v_at_ph7, v_at_ph4):
        self.slope = (7.0 - 4.0) / (v_at_ph7 - v_at_ph4)
        self.offset = 7.0 - self.slope * v_at_ph7

    def convert(self, v):
        return self.slope * v + self.offset


class ECSensor(AnalogSensor):
    """Analog EC board. EC25 = V / 0.5 / (1 + 0.02·(T − 25)) in mS/cm."""

    unit = 'mS/cm'

    def __init__(self, adc, channel=0, temperature=25.0, k=0.5, **kw):
        super().__init__(adc, channel, **kw)
        self.temperature, self.k = temperature, k

    def convert(self, v):
        return v / self.k / (1 + 0.02 * (self.temperature - 25.0))


class TDSSensor(AnalogSensor):
    """Gravity TDS meter: ppm = (133.42 Vc³ − 255.86 Vc² + 857.39 Vc) × 0.5, Vc = V / (1 + 0.02 (T − 25))."""

    unit = 'ppm'

    def __init__(self, adc, channel=0, temperature=25.0, **kw):
        super().__init__(adc, channel, **kw)
        self.temperature = temperature

    def convert(self, v):
        vc = v / (1 + 0.02 * (self.temperature - 25.0))
        return (133.42 * vc ** 3 - 255.86 * vc ** 2 + 857.39 * vc) * 0.5


class TurbiditySensor(AnalogSensor):
    """Gravity turbidity probe (5 V output — use `divider=`): NTU = −1120.4 V² + 5742.3 V − 4352.9."""

    unit = 'NTU'

    def convert(self, v):
        if v >= 4.2:
            return 0.0
        return max(0.0, -1120.4 * v * v + 5742.3 * v - 4352.9)


class DOSensor(AnalogSensor):
    """Galvanic DO probe: DO = V / Vsat × DOsat(T) (mg/L). Calibrate `vsat` in air-saturated water."""

    unit = 'mg/L'

    def __init__(self, adc, channel=0, temperature=25.0, vsat=1.6, **kw):
        super().__init__(adc, channel, **kw)
        self.temperature, self.vsat = temperature, vsat

    def convert(self, v):
        T = self.temperature
        sat = 14.62 - 0.3898 * T + 0.006969 * T * T - 0.00005897 * T ** 3
        return v / self.vsat * sat


class SoilMoisture(AnalogSensor):
    """Capacitive soil sensor v1.2: dry 2.9 V → 0 %, wet 1.3 V → 100 % (set `dry=`/`wet=` from your soil)."""

    unit = '%'

    def __init__(self, adc, channel=0, dry=2.9, wet=1.3, **kw):
        super().__init__(adc, channel, **kw)
        self.dry, self.wet = dry, wet

    def convert(self, v):
        return max(0.0, min(100.0, 100.0 * (self.dry - v) / (self.dry - self.wet)))


class WaterLevel(AnalogSensor):
    """Analog level sensor: level % = 100 × V / 3.0."""

    unit = '%'

    def __init__(self, adc, channel=0, full_volts=3.0, **kw):
        super().__init__(adc, channel, **kw)
        self.full_volts = full_volts

    def convert(self, v):
        return max(0.0, min(100.0, 100.0 * v / self.full_volts))


class PressureSensor(AnalogSensor):
    """0.5–4.5 V pressure transmitter (use `divider=`): kPa = (V − 0.5) / 4 × range."""

    unit = 'kPa'

    def __init__(self, adc, channel=0, range_kpa=1200, **kw):
        super().__init__(adc, channel, **kw)
        self.range_kpa = range_kpa

    def convert(self, v):
        return max(0.0, (v - 0.5) / 4.0 * self.range_kpa)


class Thermistor(AnalogSensor):
    """NTC in a divider: VCC — R_fixed — node — NTC — GND (node to the ADC). Steinhart β equation."""

    unit = '°C'

    def __init__(self, adc, channel=0, r_fixed=10000.0, r25=10000.0, beta=3950.0, vcc=3.3, ntc_on_top=False, **kw):
        super().__init__(adc, channel, **kw)
        self.r_fixed, self.r25, self.beta, self.vcc, self.top = r_fixed, r25, beta, vcc, ntc_on_top

    def resistance(self, v=None):
        v = self.voltage() if v is None else v
        v = min(max(v, 1e-4), self.vcc - 1e-4)
        return self.r_fixed * (self.vcc - v) / v if self.top else self.r_fixed * v / (self.vcc - v)

    def convert(self, v):
        r = self.resistance(v)
        return 1.0 / (1.0 / 298.15 + math.log(r / self.r25) / self.beta) - 273.15


class RTD(Thermistor):
    """PT100/PT1000 in a divider (same topology as Thermistor). T = (R/R0 − 1) / 0.00385."""

    def __init__(self, adc, channel=0, r0=1000.0, r_fixed=1000.0, vcc=3.3, **kw):
        super().__init__(adc, channel, r_fixed=r_fixed, vcc=vcc, **kw)
        self.r0 = r0

    def convert(self, v):
        return (self.resistance(v) / self.r0 - 1.0) / 0.00385


class LM35(AnalogSensor):
    """LM35: T = V / 0.010 (powered from 5 V)."""

    unit = '°C'

    def convert(self, v):
        return v / 0.010


class TMP36(AnalogSensor):
    """TMP36: T = (V − 0.5) / 0.010."""

    unit = '°C'

    def convert(self, v):
        return (v - 0.5) / 0.010


class MQSensor(AnalogSensor):
    """MQ-2/MQ-7/MQ-135 analog output, inverse of the simulator's model c = k·x/(1−x), x = V/Vcc."""

    unit = 'ppm'
    K = {'mq2': 1000.0, 'mq7': 300.0, 'mq135': 2000.0}

    def __init__(self, adc, channel=0, model='mq135', vcc=5.0, **kw):
        super().__init__(adc, channel, **kw)
        self.k = self.K.get(model, 1000.0)
        self.vcc = vcc

    def convert(self, v):
        x = min(0.999, max(0.0, v / self.vcc))
        return self.k * x / (1 - x)


class UVSensor(AnalogSensor):
    """GUVA-S12SD: UV index = V / 0.1."""

    unit = 'UVI'

    def convert(self, v):
        return v / 0.1


class PPFDSensor(AnalogSensor):
    """0–2.5 V quantum sensor: PPFD (µmol/m²/s) = 1000 × V."""

    unit = 'µmol/m²/s'

    def convert(self, v):
        return 1000.0 * v


class CurrentSensor(AnalogSensor):
    """ACS712 (5 A: 0.185 V/A) powered from 5 V; zero current = VCC/2. Use `divider=` for a 3.3 V ADC."""

    unit = 'A'

    def __init__(self, adc, channel=0, sensitivity=0.185, vcc=5.0, **kw):
        super().__init__(adc, channel, **kw)
        self.sensitivity, self.vcc = sensitivity, vcc

    def convert(self, v):
        return (v - self.vcc / 2) / self.sensitivity


# ====================================================================== switches, level and flow
class Ultrasonic:
    """HC-SR04 (gpiozero.DistanceSensor). Put a divider on ECHO. `read()` returns centimetres."""

    def __init__(self, trigger=23, echo=24, max_distance=4.0):
        from gpiozero import DistanceSensor

        self._d = DistanceSensor(echo=echo, trigger=trigger, max_distance=max_distance)

    def read(self):
        d = self._d.distance
        if d >= self._d.max_distance:
            raise SensorError('HC-SR04: no echo / out of range (check TRIG/ECHO wiring and 5 V power)')
        return d * 100.0

    distance_cm = property(read)


class TankLevel:
    """Water level from an ultrasonic sensor mounted `sensor_height_cm` above the tank bottom."""

    def __init__(self, ultrasonic, sensor_height_cm=43.0, full_cm=40.0):
        self.u = ultrasonic
        self.height = sensor_height_cm
        self.full = full_cm

    def level_cm(self):
        return max(0.0, self.height - self.u.read())

    def percent(self):
        return max(0.0, min(100.0, 100.0 * self.level_cm() / self.full))


class _Switch:
    def __init__(self, pin, pull_up=True, active_low=True):
        from gpiozero import DigitalInputDevice

        self._d = DigitalInputDevice(pin, pull_up=pull_up)
        self._active_low = active_low

    @property
    def active(self):
        v = bool(self._d.value)
        # DigitalInputDevice already inverts when pull_up=True
        return v


class FloatSwitch(_Switch):
    """Float switch between GPIO and GND (internal pull-up). `is_closed` is True when the reed contact closes."""

    @property
    def is_closed(self):
        return self.active


class LeakSensor(_Switch):
    """LM393 water/leak board: DO LOW = water detected."""

    @property
    def wet(self):
        return self.active


class RainSensor(LeakSensor):
    """LM393 rain board: DO LOW = rain."""

    @property
    def raining(self):
        return self.active


class MotionSensor:
    """HC-SR501 PIR (gpiozero.MotionSensor)."""

    def __init__(self, pin):
        from gpiozero import MotionSensor as _M

        self._m = _M(pin, pull_up=False)

    @property
    def motion(self):
        return self._m.motion_detected


class FlowMeter:
    """YF-S201 hall flow meter: f(Hz) = 7.5 × Q(L/min). Counts pulses with a GPIO callback."""

    def __init__(self, pin, k=7.5):
        from gpiozero import DigitalInputDevice

        self.k = k
        self.pulses = 0
        self._d = DigitalInputDevice(pin, pull_up=True)
        self._d.when_deactivated = self._tick
        self._t0 = time.time()
        self._p0 = 0

    def _tick(self):
        self.pulses += 1

    def litres(self):
        return self.pulses / (self.k * 60.0)

    def flow_lpm(self, window=1.0):
        """Average flow over the last `window` seconds (blocks for that long)."""
        p0 = self.pulses
        time.sleep(window)
        return (self.pulses - p0) / window / self.k


# ====================================================================== actuators
class Relay:
    """Relay channel (gpiozero.OutputDevice). Most hobby relay boards are active-LOW: Relay(17, active_high=False)."""

    def __init__(self, pin, active_high=False, initial=False):
        from gpiozero import OutputDevice

        self._d = OutputDevice(pin, active_high=active_high, initial_value=initial)

    def on(self):
        self._d.on()

    def off(self):
        self._d.off()

    def toggle(self):
        self._d.toggle()

    @property
    def is_on(self):
        return bool(self._d.value)

    @property
    def value(self):
        """1 while switched on (like gpiozero); assigning True/False switches it."""
        return int(bool(self._d.value))

    @value.setter
    def value(self, on):
        if on:
            self._d.on()
        else:
            self._d.off()

    def run_for(self, seconds):
        self.on()
        try:
            time.sleep(seconds)
        finally:
            self.off()


class Pump(Relay):
    """Pump switched by a relay/MOSFET."""


class Valve(Relay):
    """Solenoid valve switched by a relay/MOSFET."""


class Heater(Relay):
    """Heater switched by a relay/SSR."""


class Humidifier(Relay):
    """Humidifier switched by a relay/MOSFET."""


class Fan(Relay):
    """On/off fan switched by a relay/MOSFET."""


class DosingPump(Relay):
    """Peristaltic pump: dose(ml) runs it for ml / flow_ml_per_min minutes."""

    def __init__(self, pin, flow_ml_per_min=100.0, active_high=False):
        super().__init__(pin, active_high=active_high)
        self.flow = float(flow_ml_per_min)

    def dose(self, ml):
        self.run_for(60.0 * ml / self.flow)


class GrowLight:
    """Dimmable grow light through a logic-level MOSFET (PWM) or a relay (`pwm=False`)."""

    def __init__(self, pin, pwm=True, active_high=True, frequency=1000):
        from gpiozero import OutputDevice, PWMOutputDevice

        self._pwm = pwm
        self._d = PWMOutputDevice(pin, active_high=active_high, frequency=frequency) if pwm else OutputDevice(pin, active_high=active_high)

    def on(self, level=1.0):
        if self._pwm:
            self._d.value = level
        else:
            self._d.on()

    def off(self):
        self._d.off()


class PWMFan:
    """4-wire PWM fan: speed 0–1 on `pwm` (25 kHz), optional tachometer on `tach` (needs a pull-up)."""

    def __init__(self, pwm, tach=None, pulses_per_rev=2):
        from gpiozero import DigitalInputDevice, PWMOutputDevice

        self._p = PWMOutputDevice(pwm, frequency=25000)
        self._ppr = pulses_per_rev
        self._count = 0
        if tach is not None:
            self._t = DigitalInputDevice(tach, pull_up=True)
            self._t.when_deactivated = self._tick

    def _tick(self):
        self._count += 1

    @property
    def speed(self):
        return self._p.value

    @speed.setter
    def speed(self, v):
        self._p.value = max(0.0, min(1.0, v))

    def rpm(self, window=1.0):
        c0 = self._count
        time.sleep(window)
        return (self._count - c0) / window / self._ppr * 60.0


class LED:
    def __init__(self, pin):
        from gpiozero import LED as _L

        self._l = _L(pin)

    def on(self):
        self._l.on()

    def off(self):
        self._l.off()

    def blink(self, on_time=0.5, off_time=0.5):
        self._l.blink(on_time, off_time)


class Buzzer(LED):
    pass


class Servo:
    """Hobby servo on a GPIO (gpiozero.AngularServo, 0.5–2.5 ms)."""

    def __init__(self, pin, min_angle=-90, max_angle=90):
        from gpiozero import AngularServo

        self._s = AngularServo(pin, min_angle=min_angle, max_angle=max_angle, min_pulse_width=0.0005, max_pulse_width=0.0025)

    @property
    def angle(self):
        return self._s.angle

    @angle.setter
    def angle(self, a):
        self._s.angle = a


class DCMotor:
    """DC motor on an H-bridge (L298N/TB6612) via gpiozero.Motor: DCMotor(forward=23, backward=24, enable=12)."""

    def __init__(self, forward, backward, enable=None, standby=None):
        from gpiozero import Motor, OutputDevice

        self._stby = OutputDevice(standby, initial_value=True) if standby is not None else None
        self._m = Motor(forward=forward, backward=backward, enable=enable)

    def forward(self, speed=1.0):
        self._m.forward(speed)

    def backward(self, speed=1.0):
        self._m.backward(speed)

    def stop(self):
        self._m.stop()


class Stepper28BYJ:
    """28BYJ-48 + ULN2003 on four GPIOs (half-step sequence, 4096 steps per revolution)."""

    SEQ = [(1, 0, 0, 0), (1, 1, 0, 0), (0, 1, 0, 0), (0, 1, 1, 0), (0, 0, 1, 0), (0, 0, 1, 1), (0, 0, 0, 1), (1, 0, 0, 1)]
    STEPS_PER_REV = 4096

    def __init__(self, pins, delay=0.002):
        from gpiozero import OutputDevice

        self._coils = [OutputDevice(p) for p in pins]
        self.delay = delay
        self._i = 0

    def step(self, n):
        d = 1 if n >= 0 else -1
        for _ in range(abs(n)):
            self._i = (self._i + d) % 8
            for c, v in zip(self._coils, self.SEQ[self._i]):
                c.value = v
            time.sleep(self.delay)

    def rotate(self, degrees):
        self.step(int(round(degrees / 360.0 * self.STEPS_PER_REV)))

    def release(self):
        for c in self._coils:
            c.off()


class StepperDriver:
    """STEP/DIR driver (A4988/DRV8825). `microsteps` must match the MS/M pins."""

    def __init__(self, step, dir, enable=None, steps_per_rev=200, microsteps=1, delay=0.001):
        from gpiozero import OutputDevice

        self._step = OutputDevice(step)
        self._dir = OutputDevice(dir)
        self._en = OutputDevice(enable, active_high=False, initial_value=True) if enable is not None else None
        self.steps_per_rev = steps_per_rev * microsteps
        self.delay = delay

    def move(self, steps):
        self._dir.value = steps >= 0
        for _ in range(abs(int(steps))):
            self._step.on()
            time.sleep(self.delay / 2)
            self._step.off()
            time.sleep(self.delay / 2)

    def rotate(self, degrees):
        self.move(int(round(degrees / 360.0 * self.steps_per_rev)))


class ShiftRegister:
    """74HC595 bit-banged on three GPIOs: write(byte) shifts MSB first and latches."""

    def __init__(self, data, clock, latch):
        from gpiozero import OutputDevice

        self._d, self._c, self._l = OutputDevice(data), OutputDevice(clock), OutputDevice(latch)

    def write(self, value, bits=8):
        self._l.off()
        for i in reversed(range(bits)):
            self._d.value = (value >> i) & 1
            self._c.on()
            self._c.off()
        self._l.on()
        self._l.off()


class SevenSegment:
    """Single digit on 7 (or 8 with DP) GPIOs (gpiozero.LEDCharDisplay)."""

    def __init__(self, a, b, c, d, e, f, g, dp=None, common='cathode'):
        from gpiozero import LEDCharDisplay

        self._d = LEDCharDisplay(a, b, c, d, e, f, g, dp=dp, active_high=(common == 'cathode'))

    def show(self, ch):
        self._d.value = str(ch)


class Display4:
    """TM1637 4-digit display."""

    def __init__(self, clk, dio, brightness=7):
        import tm1637

        self._t = tm1637.TM1637(clk=clk, dio=dio, brightness=brightness)

    def show(self, text, colon=False):
        self._t.show(str(text), colon)

    def number(self, n):
        self._t.number(n)

    def temperature(self, t):
        self._t.temperature(t)


class LEDStrip:
    """WS2812B strip (neopixel). Colours are (r, g, b) tuples 0–255."""

    def __init__(self, pin, count, brightness=0.3):
        import neopixel

        self._p = neopixel.NeoPixel(_pin(pin), count, brightness=brightness, auto_write=False)

    def fill(self, rgb):
        self._p.fill(rgb)
        self._p.show()

    def set(self, i, rgb):
        self._p[i] = rgb

    def show(self):
        self._p.show()


class LCD:
    """I2C character LCD (RPLCD). `LCD(address=0x27, cols=16, rows=2)`."""

    def __init__(self, address=0x27, cols=16, rows=2):
        from RPLCD.i2c import CharLCD

        self._l = CharLCD('PCF8574', address, cols=cols, rows=rows)

    def clear(self):
        self._l.clear()

    def write(self, text, row=0, col=0):
        self._l.cursor_pos = (row, col)
        self._l.write_string(text)


class OLED:
    """SSD1306 128×64 OLED (MicroPython-style ssd1306 driver on smbus2)."""

    def __init__(self, address=0x3C):
        import ssd1306
        from smbus2 import SMBus

        self._o = ssd1306.SSD1306_I2C(128, 64, SMBus(1), addr=address)

    def text(self, s, x=0, y=0):
        self._o.text(s, x, y, 1)

    def clear(self):
        self._o.fill(0)

    def show(self):
        self._o.show()


class Nextion:
    """Nextion HMI on UART: set(component, text/value), page(n), and read touch events."""

    END = b'\xff\xff\xff'

    def __init__(self, port='/dev/serial0', baud=9600):
        import serial

        self._s = serial.Serial(port, baud, timeout=0.1)

    def send(self, cmd):
        self._s.write(cmd.encode('latin-1') + self.END)

    def set_text(self, name, text):
        self.send('%s.txt="%s"' % (name, str(text).replace('"', "'")))

    def set_value(self, name, value):
        self.send('%s.val=%d' % (name, int(value)))

    def page(self, n):
        self.send('page %s' % n)

    def read_event(self):
        """Return (page, component_id, pressed) for a touch event, or None."""
        data = self._s.read_until(self.END)
        if len(data) >= 7 and data[0] == 0x65:
            return data[1], data[2], bool(data[3])
        return None


class PCF8574:
    def __init__(self, address=0x20):
        import adafruit_pcf8574

        self._p = adafruit_pcf8574.PCF8574(_i2c(), address)

    def write(self, value):
        self._p.write_gpio(value)

    def read(self):
        return self._p.read_gpio()

    def pin(self, n):
        return self._p.get_pin(n)


class MCP23017:
    def __init__(self, address=0x20):
        from adafruit_mcp230xx.mcp23017 import MCP23017 as _M

        self._m = _M(_i2c(), address=address)

    def pin(self, n, output=False, value=False, pull_up=False):
        import digitalio

        p = self._m.get_pin(n)
        if output:
            p.switch_to_output(value=value)
        else:
            p.switch_to_input(pull=digitalio.Pull.UP if pull_up else None)
        return p


class I2CMux:
    """TCA9548A: mux[n] is an I2C bus object for channel n (pass it to adafruit drivers)."""

    def __init__(self, address=0x70):
        import adafruit_tca9548a

        self._t = adafruit_tca9548a.TCA9548A(_i2c(), address)

    def __getitem__(self, n):
        return self._t[n]


class RTC:
    """DS3231 real-time clock (adafruit_ds3231)."""

    def __init__(self):
        import adafruit_ds3231

        self._r = adafruit_ds3231.DS3231(_i2c())

    @property
    def datetime(self):
        return self._r.datetime

    @datetime.setter
    def datetime(self, t):
        self._r.datetime = t

    @property
    def temperature(self):
        return self._r.temperature


class EEPROM:
    """AT24C32/AT24C256 (2-byte addresses, 32-byte pages) over smbus2."""

    def __init__(self, address=0x50):
        from smbus2 import SMBus, i2c_msg

        self.address = address
        self._bus = SMBus(1)
        self._msg = i2c_msg

    def write(self, mem_addr, data):
        data = bytes(data)
        while data:
            n = min(len(data), 32 - (mem_addr % 32))
            self._bus.i2c_rdwr(self._msg.write(self.address, [mem_addr >> 8, mem_addr & 0xFF] + list(data[:n])))
            time.sleep(0.005)
            mem_addr += n
            data = data[n:]

    def read(self, mem_addr, n):
        w = self._msg.write(self.address, [mem_addr >> 8, mem_addr & 0xFF])
        r = self._msg.read(self.address, n)
        self._bus.i2c_rdwr(w, r)
        return bytes(list(r))


class ModbusSoilSensor:
    """RS-485 7-in-1 soil probe via MAX485 (minimalmodbus). `de_pin` drives DE+/RE (None = auto-direction board)."""

    REGS = ('moisture', 'temperature', 'ec', 'ph', 'n', 'p', 'k')

    def __init__(self, port='/dev/serial0', slave=1, baud=9600, de_pin=None):
        import minimalmodbus

        self._i = minimalmodbus.Instrument(port, slave)
        self._i.serial.baudrate = baud
        self._i.serial.timeout = 0.3
        self._de = None
        if de_pin is not None:
            from gpiozero import OutputDevice

            self._de = OutputDevice(de_pin)
            self._i._communicate = self._dir_wrap(self._i._communicate)

    def _dir_wrap(self, fn):
        def comm(request, expected):
            self._de.on()
            self._i.serial.write(request)
            time.sleep(len(request) * 10.0 / self._i.serial.baudrate + 0.002)
            self._de.off()
            orig_write = self._i.serial.write
            self._i.serial.write = lambda b: len(b)
            try:
                return fn(request, expected)
            finally:
                self._i.serial.write = orig_write

        return comm

    def read(self):
        import minimalmodbus

        try:
            r = self._i.read_registers(0, 7, functioncode=3)
        except minimalmodbus.ModbusException as e:
            raise SensorError('Modbus soil sensor: %s' % e)
        t = r[1] - 0x10000 if r[1] & 0x8000 else r[1]
        return {'moisture': r[0] / 10.0, 'temperature': t / 10.0, 'ec': r[2], 'ph': r[3] / 10.0, 'n': r[4], 'p': r[5], 'k': r[6]}


class NutrientMonitor:
    """Combines EC, pH, water-temperature and level sensors into one reading with alarm limits."""

    def __init__(self, ec=None, ph=None, water_temp=None, level=None, limits=None):
        self.ec, self.ph, self.water_temp, self.level = ec, ph, water_temp, level
        self.limits = limits or {'ec': (1.0, 2.0), 'ph': (5.5, 6.5), 'temp': (18.0, 24.0), 'level': (25.0, 100.0)}

    def read(self):
        out = {}
        if self.water_temp is not None:
            out['temp'] = self.water_temp.read()
            if isinstance(self.ec, (ECSensor, TDSSensor)):
                self.ec.temperature = out['temp']
        if self.ec is not None:
            out['ec'] = self.ec.read()
        if self.ph is not None:
            out['ph'] = self.ph.read()
        if self.level is not None:
            out['level'] = self.level.read() if not isinstance(self.level, TankLevel) else self.level.percent()
        out['alarms'] = [k for k, (lo, hi) in self.limits.items() if k in out and not lo <= out[k] <= hi]
        return out
