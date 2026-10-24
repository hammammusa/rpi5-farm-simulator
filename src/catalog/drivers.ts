// Built-in Hardware Driver Registry (documentation side). Each entry describes a Python
// module that is pre-installed in the simulator: what it is compatible with, which
// classes/functions are implemented (an automated test checks every name exists), and
// what to install on a real Raspberry Pi 5.

export interface ApiDoc {
  /** dotted name inside the module, e.g. 'LED', 'LED.blink', 'SMBus.read_byte_data' */
  name: string;
  sig?: string;
  doc: string;
}

export interface DriverInfo {
  module: string;
  title: string;
  /** compatible = same API as the real library (subset listed); simulator = simulator-specific API */
  kind: 'compatible' | 'simulator';
  real: { install: string; note?: string };
  apis: ApiDoc[];
  limits?: string;
}

const a = (name: string, doc: string, sig?: string): ApiDoc => ({ name, doc, sig });

export const DRIVERS: DriverInfo[] = [
  {
    module: 'gpiozero',
    title: 'gpiozero — high-level GPIO devices',
    kind: 'compatible',
    real: { install: 'Pre-installed on Raspberry Pi OS (sudo apt install python3-gpiozero)', note: 'On a Pi 5 gpiozero uses the lgpio pin factory automatically.' },
    apis: [
      a('LED', 'Digital LED on a GPIO.', 'LED(pin, *, active_high=True, initial_value=False)'),
      a('LED.on', 'Turn the LED on.', 'on()'),
      a('LED.off', 'Turn the LED off.', 'off()'),
      a('LED.toggle', 'Reverse the state.', 'toggle()'),
      a('LED.blink', 'Blink in the background.', 'blink(on_time=1, off_time=1, n=None, background=True)'),
      a('LED.is_lit', 'True while lit.'),
      a('PWMLED', 'LED with PWM brightness (value 0–1).', 'PWMLED(pin, *, active_high=True, initial_value=0, frequency=100)'),
      a('PWMLED.pulse', 'Fade in and out.', 'pulse(fade_in_time=1, fade_out_time=1, n=None, background=True)'),
      a('RGBLED', 'Three-colour LED, color = (r, g, b) 0–1.', 'RGBLED(red, green, blue, *, active_high=True, pwm=True)'),
      a('Button', 'Push button with internal pull-up by default.', 'Button(pin, *, pull_up=True, bounce_time=None, hold_time=1)'),
      a('Button.is_pressed', 'True while pressed.'),
      a('Button.when_pressed', 'Callback run when the button is pressed.'),
      a('Button.wait_for_press', 'Block until pressed.', 'wait_for_press(timeout=None)'),
      a('Buzzer', 'Active buzzer.', 'Buzzer(pin, *, active_high=True)'),
      a('Buzzer.beep', 'Beep in the background.', 'beep(on_time=1, off_time=1, n=None, background=True)'),
      a('OutputDevice', 'Generic digital output (relays!).', 'OutputDevice(pin, *, active_high=True, initial_value=False)'),
      a('DigitalOutputDevice', 'Digital output with blink().'),
      a('PWMOutputDevice', 'PWM output, value 0–1.', 'PWMOutputDevice(pin, *, active_high=True, initial_value=0, frequency=100)'),
      a('DigitalInputDevice', 'Generic digital input.', 'DigitalInputDevice(pin, *, pull_up=False, bounce_time=None)'),
      a('DigitalInputDevice.when_activated', 'Callback on activation (edge).'),
      a('MotionSensor', 'PIR motion sensor.', 'MotionSensor(pin, *, pull_up=False)'),
      a('LineSensor', 'Line/IR sensor input.'),
      a('Motor', 'DC motor on an H-bridge.', 'Motor(forward, backward, *, enable=None, pwm=True)'),
      a('Motor.forward', 'Run forwards at speed 0–1.', 'forward(speed=1)'),
      a('Motor.backward', 'Run backwards at speed 0–1.', 'backward(speed=1)'),
      a('Motor.stop', 'Stop the motor.', 'stop()'),
      a('Servo', 'Servo, value −1…1.', 'Servo(pin, *, initial_value=0, min_pulse_width=1/1000, max_pulse_width=2/1000, frame_width=20/1000)'),
      a('AngularServo', 'Servo positioned in degrees.', 'AngularServo(pin, *, min_angle=-90, max_angle=90, min_pulse_width=1/1000, max_pulse_width=2/1000)'),
      a('AngularServo.angle', 'Angle in degrees.'),
      a('MCP3008', 'MCP3008 ADC channel over SPI.', 'MCP3008(channel=0, *, differential=False, max_voltage=3.3, device=0)'),
      a('MCP3008.voltage', 'Channel voltage in volts.'),
      a('MCP3008.value', 'Reading 0–1.'),
      a('CPUTemperature', 'Pi CPU temperature.', 'CPUTemperature()'),
      a('DistanceSensor', 'HC-SR04 ultrasonic ranger (use a divider on ECHO).', 'DistanceSensor(echo, trigger, *, max_distance=1, threshold_distance=0.3)'),
      a('DistanceSensor.distance', 'Distance in metres (≤ max_distance).'),
      a('LEDBoard', 'A group of LEDs.', 'LEDBoard(*pins, pwm=False, active_high=True, initial_value=False)'),
      a('LEDCharDisplay', 'One 7-segment digit.', 'LEDCharDisplay(a, b, c, d, e, f, g, *, dp=None, active_high=True)'),
    ],
    limits: 'Callbacks run cooperatively while the program sleeps/waits (browsers have no real Python threads). Pin factories other than the simulator are not selectable.',
  },
  {
    module: 'RPi',
    title: 'RPi.GPIO — classic GPIO API (rpi-lgpio compatible)',
    kind: 'compatible',
    real: { install: 'sudo apt install python3-rpi-lgpio', note: 'The original RPi.GPIO does not support the Pi 5; rpi-lgpio provides the same API.' },
    apis: [
      a('GPIO.setmode', 'GPIO.BCM or GPIO.BOARD numbering.', 'setmode(mode)'),
      a('GPIO.setup', 'Configure a channel.', 'setup(channel, direction, pull_up_down=PUD_OFF, initial=None)'),
      a('GPIO.output', 'Write HIGH/LOW.', 'output(channel, value)'),
      a('GPIO.input', 'Read a channel.', 'input(channel)'),
      a('GPIO.PWM', 'Software PWM.', 'PWM(channel, frequency)'),
      a('GPIO.add_event_detect', 'Edge callbacks.', 'add_event_detect(channel, edge, callback=None, bouncetime=None)'),
      a('GPIO.wait_for_edge', 'Block until an edge.', 'wait_for_edge(channel, edge, bouncetime=None, timeout=None)'),
      a('GPIO.cleanup', 'Release channels.', 'cleanup(channel=None)'),
    ],
  },
  {
    module: 'lgpio',
    title: 'lgpio — low-level GPIO/I2C/SPI/serial',
    kind: 'compatible',
    real: { install: 'sudo apt install python3-lgpio', note: 'Header GPIOs are on gpiochip 0 (gpiochip 4 on older Pi 5 kernels).' },
    apis: [
      a('gpiochip_open', 'Open the GPIO chip.', 'gpiochip_open(gpiochip)'),
      a('gpio_claim_output', 'Claim a GPIO as output.', 'gpio_claim_output(handle, gpio, level=0, lFlags=0)'),
      a('gpio_claim_input', 'Claim a GPIO as input.', 'gpio_claim_input(handle, gpio, lFlags=0)'),
      a('gpio_write', 'Write a level.', 'gpio_write(handle, gpio, level)'),
      a('gpio_read', 'Read a level.', 'gpio_read(handle, gpio)'),
      a('tx_pwm', 'Software PWM.', 'tx_pwm(handle, gpio, pwm_frequency, pwm_duty_cycle)'),
      a('tx_servo', 'Servo pulses.', 'tx_servo(handle, gpio, pulse_width, servo_frequency=50)'),
      a('callback', 'Edge callback.', 'callback(handle, gpio, edge=RISING_EDGE, func=None)'),
      a('i2c_open', 'Open an I2C device.', 'i2c_open(i2c_bus, i2c_address, i2c_flags=0)'),
      a('i2c_read_byte_data', 'Read a register.', 'i2c_read_byte_data(handle, reg)'),
      a('i2c_write_byte_data', 'Write a register.', 'i2c_write_byte_data(handle, reg, byte_val)'),
      a('spi_open', 'Open SPI.', 'spi_open(spi_device, spi_channel, baud, spi_flags=0)'),
      a('spi_xfer', 'Full-duplex transfer.', 'spi_xfer(handle, data)'),
      a('serial_open', 'Open a serial port.', 'serial_open(tty, baud, ser_flags=0)'),
      a('error', 'Exception raised on errors (e.g. "GPIO busy").'),
    ],
  },
  {
    module: 'smbus2',
    title: 'smbus2 — I2C bus 1',
    kind: 'compatible',
    real: { install: 'pip install smbus2' },
    apis: [
      a('SMBus', 'Open I2C bus 1.', 'SMBus(bus=1)'),
      a('SMBus.read_byte', 'Read one byte.', 'read_byte(i2c_addr)'),
      a('SMBus.write_byte', 'Write one byte.', 'write_byte(i2c_addr, value)'),
      a('SMBus.read_byte_data', 'Read a register.', 'read_byte_data(i2c_addr, register)'),
      a('SMBus.write_byte_data', 'Write a register.', 'write_byte_data(i2c_addr, register, value)'),
      a('SMBus.read_i2c_block_data', 'Read a block.', 'read_i2c_block_data(i2c_addr, register, length)'),
      a('SMBus.write_i2c_block_data', 'Write a block.', 'write_i2c_block_data(i2c_addr, register, data)'),
      a('SMBus.i2c_rdwr', 'Combined transfers (i2c_msg).', 'i2c_rdwr(*msgs)'),
      a('i2c_msg', 'Message for i2c_rdwr.', 'i2c_msg.write(addr, data) / i2c_msg.read(addr, n)'),
    ],
  },
  { module: 'smbus', title: 'smbus — legacy alias of smbus2.SMBus', kind: 'compatible', real: { install: 'sudo apt install python3-smbus' }, apis: [a('SMBus', 'I2C bus.', 'SMBus(1)')] },
  {
    module: 'spidev',
    title: 'spidev — SPI0 (CE0 / CE1)',
    kind: 'compatible',
    real: { install: 'pip install spidev (enable SPI in raspi-config)' },
    apis: [a('SpiDev', 'SPI device.', 'SpiDev()'), a('SpiDev.open', 'Open /dev/spidev0.N.', 'open(bus, device)'), a('SpiDev.xfer2', 'Full-duplex transfer.', 'xfer2(list_of_bytes)')],
  },
  {
    module: 'serial',
    title: 'pyserial — UART ports',
    kind: 'compatible',
    real: { install: 'sudo apt install python3-serial (enable the serial port in raspi-config, disable the login shell)' },
    apis: [
      a('Serial', 'Open a port (/dev/serial0 = GPIO14/15).', 'Serial(port, baudrate=9600, timeout=None)'),
      a('Serial.write', 'Send bytes.', 'write(data)'),
      a('Serial.read', 'Read up to n bytes.', 'read(size=1)'),
      a('Serial.readline', 'Read up to newline.', 'readline()'),
      a('Serial.read_until', 'Read up to a terminator.', 'read_until(expected=b"\\n", size=None)'),
      a('Serial.in_waiting', 'Bytes waiting.'),
      a('Serial.reset_input_buffer', 'Discard received data.', 'reset_input_buffer()'),
    ],
  },
  {
    module: 'board',
    title: 'board — Blinka pin names (Raspberry Pi 5)',
    kind: 'compatible',
    real: { install: 'pip install adafruit-blinka' },
    apis: [a('D4', 'GPIO4 (D0–D27 available).'), a('SCL', 'GPIO3 (I2C1 SCL).'), a('SDA', 'GPIO2 (I2C1 SDA).'), a('SCK', 'GPIO11 (SPI0 clock).'), a('MOSI', 'GPIO10.'), a('MISO', 'GPIO9.'), a('CE0', 'GPIO8.'), a('TX', 'GPIO14.'), a('RX', 'GPIO15.')],
  },
  {
    module: 'busio',
    title: 'busio — Blinka I2C / SPI / UART',
    kind: 'compatible',
    real: { install: 'pip install adafruit-blinka' },
    apis: [
      a('I2C', 'Hardware I2C1.', 'I2C(board.SCL, board.SDA)'),
      a('I2C.scan', 'List answering addresses.', 'scan()'),
      a('I2C.writeto', 'Write bytes.', 'writeto(address, buffer)'),
      a('I2C.readfrom_into', 'Read into a buffer.', 'readfrom_into(address, buffer)'),
      a('I2C.writeto_then_readfrom', 'Write then read (repeated start).', 'writeto_then_readfrom(address, out, in_)'),
      a('SPI', 'Hardware SPI0.', 'SPI(board.SCK, MOSI=board.MOSI, MISO=board.MISO)'),
      a('UART', 'UART0 on GPIO14/15.', 'UART(board.TX, board.RX, baudrate=9600)'),
    ],
  },
  {
    module: 'digitalio',
    title: 'digitalio — Blinka digital pins',
    kind: 'compatible',
    real: { install: 'pip install adafruit-blinka' },
    apis: [a('DigitalInOut', 'A GPIO pin.', 'DigitalInOut(board.D17)'), a('DigitalInOut.switch_to_output', 'Make it an output.', 'switch_to_output(value=False)'), a('DigitalInOut.value', 'Read/write the level.'), a('Direction', 'INPUT / OUTPUT.'), a('Pull', 'UP / DOWN.')],
  },
  {
    module: 'adafruit_bus_device',
    title: 'adafruit_bus_device — I2CDevice / SPIDevice helpers',
    kind: 'compatible',
    real: { install: 'pip install adafruit-circuitpython-busdevice' },
    apis: [a('i2c_device.I2CDevice', 'Probe-checked I2C device wrapper.', 'I2CDevice(i2c, address)'), a('spi_device.SPIDevice', 'SPI device with chip select.', 'SPIDevice(spi, chip_select)')],
  },
  {
    module: 'adafruit_dht',
    title: 'adafruit_dht — DHT11/DHT22/AM2302',
    kind: 'compatible',
    real: { install: 'pip install adafruit-circuitpython-dht && sudo apt install libgpiod2' },
    apis: [a('DHT22', 'DHT22 / AM2302.', 'DHT22(board.D4)'), a('DHT11', 'DHT11.', 'DHT11(board.D4)'), a('DHT22.temperature', '°C; raises RuntimeError on a failed read — retry.'), a('DHT22.humidity', '%RH.'), a('DHT22.exit', 'Release the pin.', 'exit()')],
  },
  { module: 'Adafruit_DHT', title: 'Adafruit_DHT — legacy DHT API', kind: 'compatible', real: { install: 'Deprecated — use adafruit-circuitpython-dht on a Pi 5' }, apis: [a('read_retry', 'Read with retries.', 'read_retry(sensor, pin)'), a('DHT22', 'Sensor constant.')] },
  { module: 'w1thermsensor', title: 'w1thermsensor — DS18B20 (1-Wire)', kind: 'compatible', real: { install: 'pip install w1thermsensor (dtoverlay=w1-gpio in /boot/firmware/config.txt)' }, apis: [a('W1ThermSensor', 'First (or given) sensor.', 'W1ThermSensor(sensor_id=None)'), a('W1ThermSensor.get_temperature', 'Temperature in °C.', 'get_temperature()'), a('W1ThermSensor.get_available_sensors', 'All sensors on the bus.', 'get_available_sensors()')] },
  { module: 'bme280', title: 'bme280 — RPi.bme280 API', kind: 'compatible', real: { install: 'pip install RPi.bme280' }, apis: [a('load_calibration_params', 'Read calibration.', 'load_calibration_params(bus, address)'), a('sample', 'Measure T/RH/P.', 'sample(bus, address, compensation_params)')] },
  { module: 'adafruit_bme280', title: 'adafruit_bme280 — BME280', kind: 'compatible', real: { install: 'pip install adafruit-circuitpython-bme280' }, apis: [a('basic.Adafruit_BME280_I2C', 'BME280 on I2C.', 'Adafruit_BME280_I2C(i2c, address=0x77)'), a('basic.Adafruit_BME280_I2C.temperature', '°C.'), a('basic.Adafruit_BME280_I2C.relative_humidity', '%RH.'), a('basic.Adafruit_BME280_I2C.pressure', 'hPa.')] },
  { module: 'adafruit_bmp280', title: 'adafruit_bmp280 — BMP280', kind: 'compatible', real: { install: 'pip install adafruit-circuitpython-bmp280' }, apis: [a('Adafruit_BMP280_I2C', 'BMP280 on I2C.', 'Adafruit_BMP280_I2C(i2c, address=0x77)'), a('Adafruit_BMP280_I2C.pressure', 'hPa.'), a('Adafruit_BMP280_I2C.altitude', 'Metres (uses sea_level_pressure).')] },
  { module: 'adafruit_sht31d', title: 'adafruit_sht31d — SHT31/SHT35', kind: 'compatible', real: { install: 'pip install adafruit-circuitpython-sht31d' }, apis: [a('SHT31D', 'Sensor on I2C.', 'SHT31D(i2c, address=0x44)'), a('SHT31D.temperature', '°C.'), a('SHT31D.relative_humidity', '%RH.'), a('SHT31D.heater', 'Heater on/off.')] },
  { module: 'adafruit_scd30', title: 'adafruit_scd30 — Sensirion SCD30', kind: 'compatible', real: { install: 'pip install adafruit-circuitpython-scd30' }, apis: [a('SCD30', 'Sensor.', 'SCD30(i2c)'), a('SCD30.data_available', 'New data ready.'), a('SCD30.CO2', 'ppm.'), a('SCD30.temperature', '°C.'), a('SCD30.relative_humidity', '%RH.')] },
  { module: 'adafruit_scd4x', title: 'adafruit_scd4x — Sensirion SCD40/SCD41', kind: 'compatible', real: { install: 'pip install adafruit-circuitpython-scd4x' }, apis: [a('SCD4X', 'Sensor.', 'SCD4X(i2c)'), a('SCD4X.start_periodic_measurement', 'Start measuring (5 s period).', 'start_periodic_measurement()'), a('SCD4X.data_ready', 'New data ready.'), a('SCD4X.CO2', 'ppm.')] },
  { module: 'adafruit_ccs811', title: 'adafruit_ccs811 — ams CCS811', kind: 'compatible', real: { install: 'pip install adafruit-circuitpython-ccs811' }, apis: [a('CCS811', 'Sensor (tie nWAKE low).', 'CCS811(i2c, address=0x5A)'), a('CCS811.eco2', 'ppm.'), a('CCS811.tvoc', 'ppb.'), a('CCS811.data_ready', 'New data ready.')] },
  { module: 'adafruit_bme680', title: 'adafruit_bme680 — Bosch BME680', kind: 'compatible', real: { install: 'pip install adafruit-circuitpython-bme680' }, apis: [a('Adafruit_BME680_I2C', 'Sensor.', 'Adafruit_BME680_I2C(i2c, address=0x77)'), a('Adafruit_BME680_I2C.gas', 'Gas resistance in Ω.')], limits: 'Simulated with a simplified register layout (Functional Model).' },
  { module: 'adafruit_tsl2561', title: 'adafruit_tsl2561 — ams TSL2561', kind: 'compatible', real: { install: 'pip install adafruit-circuitpython-tsl2561' }, apis: [a('TSL2561', 'Sensor.', 'TSL2561(i2c, address=0x39)'), a('TSL2561.lux', 'Lux (None if saturated).'), a('TSL2561.gain', '0 = 1×, 1 = 16×.'), a('TSL2561.integration_time', '0/1/2 = 13.7/101/402 ms.')] },
  { module: 'adafruit_ads1x15', title: 'adafruit_ads1x15 — ADS1115 16-bit ADC', kind: 'compatible', real: { install: 'pip install adafruit-circuitpython-ads1x15' }, apis: [a('ads1115.ADS1115', 'ADC on I2C.', 'ADS1115(i2c, gain=1, address=0x48)'), a('ads1115.P0', 'Channel A0 (P0–P3).'), a('analog_in.AnalogIn', 'Channel reader.', 'AnalogIn(ads, ADS.P0)'), a('analog_in.AnalogIn.voltage', 'Volts.'), a('analog_in.AnalogIn.value', 'Raw signed 16-bit code.')] },
  { module: 'adafruit_pcf8574', title: 'adafruit_pcf8574 — PCF8574 expander', kind: 'compatible', real: { install: 'pip install adafruit-circuitpython-pcf8574' }, apis: [a('PCF8574', 'Expander.', 'PCF8574(i2c, address=0x20)'), a('PCF8574.write_gpio', 'Write all 8 bits.', 'write_gpio(val)'), a('PCF8574.read_gpio', 'Read all 8 bits.', 'read_gpio()'), a('PCF8574.get_pin', 'One pin as DigitalInOut.', 'get_pin(n)')] },
  { module: 'adafruit_mcp230xx', title: 'adafruit_mcp230xx — MCP23017 expander', kind: 'compatible', real: { install: 'pip install adafruit-circuitpython-mcp230xx' }, apis: [a('mcp23017.MCP23017', 'Expander.', 'MCP23017(i2c, address=0x20)'), a('mcp23017.MCP23017.get_pin', 'Pin 0–15.', 'get_pin(n)'), a('mcp23017.MCP23017.gpio', 'All 16 pins.')] },
  { module: 'adafruit_tca9548a', title: 'adafruit_tca9548a — I2C multiplexer', kind: 'compatible', real: { install: 'pip install adafruit-circuitpython-tca9548a' }, apis: [a('TCA9548A', 'Multiplexer; tca[n] is a bus.', 'TCA9548A(i2c, address=0x70)')] },
  { module: 'adafruit_ds3231', title: 'adafruit_ds3231 — DS3231 RTC', kind: 'compatible', real: { install: 'pip install adafruit-circuitpython-ds3231' }, apis: [a('DS3231', 'RTC.', 'DS3231(i2c)'), a('DS3231.datetime', 'time.struct_time get/set.'), a('DS3231.temperature', 'Board temperature °C.')] },
  { module: 'adafruit_pm25', title: 'adafruit_pm25 — PMS5003', kind: 'compatible', real: { install: 'pip install adafruit-circuitpython-pm25' }, apis: [a('uart.PM25_UART', 'PMS5003 on a UART.', 'PM25_UART(uart)'), a('uart.PM25_UART.read', 'Dict of PM values and counts.', 'read()')] },
  { module: 'neopixel', title: 'neopixel — WS2812B strips', kind: 'compatible', real: { install: 'pip install adafruit-circuitpython-neopixel adafruit-blinka-raspberry-pi5-neopixel', note: 'The Pi 5 needs the Pi 5 NeoPixel helper package.' }, apis: [a('NeoPixel', 'Strip.', 'NeoPixel(board.D18, n, brightness=1.0, auto_write=True)'), a('NeoPixel.fill', 'All pixels one colour.', 'fill((r, g, b))'), a('NeoPixel.show', 'Send the frame.', 'show()')] },
  { module: 'tm1637', title: 'tm1637 — 4-digit display (raspberrypi-tm1637 API)', kind: 'compatible', real: { install: 'pip install raspberrypi-tm1637' }, apis: [a('TM1637', 'Display.', 'TM1637(clk, dio, brightness=7)'), a('TM1637.show', 'Show 4 characters.', 'show(string, colon=False)'), a('TM1637.number', 'Show an integer.', 'number(n)'), a('TM1637.temperature', 'Show °C.', 'temperature(t)')] },
  { module: 'minimalmodbus', title: 'minimalmodbus — Modbus RTU master (subset)', kind: 'compatible', real: { install: 'pip install minimalmodbus' }, apis: [a('Instrument', 'Slave device.', 'Instrument(port, slaveaddress)'), a('Instrument.read_register', 'Read one register.', 'read_register(address, number_of_decimals=0, functioncode=3, signed=False)'), a('Instrument.read_registers', 'Read several.', 'read_registers(address, count, functioncode=3)'), a('Instrument.write_register', 'Write one register.', 'write_register(address, value, number_of_decimals=0, functioncode=16)')] },
  { module: 'RPLCD', title: 'RPLCD — HD44780 character LCDs over I2C', kind: 'compatible', real: { install: 'pip install RPLCD smbus2' }, apis: [a('i2c.CharLCD', 'LCD on a PCF8574 backpack.', "CharLCD('PCF8574', 0x27, cols=16, rows=2)"), a('i2c.CharLCD.write_string', 'Write text.', 'write_string(text)'), a('i2c.CharLCD.cursor_pos', '(row, col).'), a('i2c.CharLCD.clear', 'Clear the screen.', 'clear()')] },
  { module: 'ssd1306', title: 'ssd1306 — MicroPython-style OLED driver', kind: 'simulator', real: { install: 'Use adafruit-circuitpython-ssd1306 or luma.oled on a real Pi (API differs slightly)' }, apis: [a('SSD1306_I2C', 'OLED.', 'SSD1306_I2C(128, 64, SMBus(1), addr=0x3C)'), a('SSD1306_I2C.text', 'Draw text.', 'text(s, x, y, c=1)'), a('SSD1306_I2C.show', 'Send the frame.', 'show()')] },
  { module: 'framebuf', title: 'framebuf — MicroPython frame buffer', kind: 'simulator', real: { install: 'Not on Raspberry Pi OS — use PIL or adafruit_framebuf' }, apis: [a('FrameBuffer', 'Frame buffer.')] },
  { module: 'st7735', title: 'st7735 — ST7735 TFT (simulator subset, experimental)', kind: 'simulator', real: { install: 'pip install st7735 (Pimoroni, PIL-based) or luma.lcd — port the drawing calls' }, apis: [a('ST7735', 'Display on SPI0 + DC.', 'ST7735(port=0, cs=0, dc=24, rst=None)'), a('ST7735.fill', 'Fill.', 'fill(color565)'), a('ST7735.text', 'Text.', 'text(s, x, y, color)'), a('color565', 'RGB → RGB565.', 'color565(r, g, b)')] },
  { module: 'flask', title: 'flask — web server subset', kind: 'compatible', real: { install: 'sudo apt install python3-flask' }, apis: [a('Flask', 'App.', 'Flask(__name__)'), a('jsonify', 'JSON response.'), a('request', 'Request object.')] },
  { module: 'schedule', title: 'schedule — job scheduling', kind: 'compatible', real: { install: 'pip install schedule' }, apis: [a('every', 'Schedule a job.', 'every(10).seconds.do(job)'), a('run_pending', 'Run due jobs.', 'run_pending()')] },
  {
    module: 'smartfarm',
    title: 'smartfarm — one import for all supported farm hardware',
    kind: 'simulator',
    real: { install: 'Copy lib/smartfarm.py from the exported ZIP next to your program and install the libraries listed in the README (it only uses their public APIs).' },
    apis: [
      a('DHT22', 'DHT22: read() → (°C, %RH).', 'DHT22(pin)'),
      a('DHT11', 'DHT11.', 'DHT11(pin)'),
      a('DS18B20', '1-Wire probe: read() → °C.', 'DS18B20(sensor_id=None)'),
      a('BME280', 'read() → (°C, %RH, hPa).', 'BME280(address=0x76)'),
      a('SHT31', 'read() → (°C, %RH).', 'SHT31(address=0x44)'),
      a('SCD30', 'read() → (ppm, °C, %RH).', 'SCD30()'),
      a('SCD4X', 'read() → (ppm, °C, %RH).', 'SCD4X()'),
      a('BH1750', 'read() → lux.', 'BH1750(address=0x23)'),
      a('MHZ19', 'read() → CO₂ ppm.', "MHZ19(port='/dev/serial0')"),
      a('PMS5003', 'read() → (PM1, PM2.5, PM10).', "PMS5003(port='/dev/serial0')"),
      a('ADS1115', 'voltage(channel).', 'ADS1115(address=0x48, gain=1)'),
      a('MCP3008', 'voltage(channel).', 'MCP3008(device=0, vref=3.3)'),
      a('PHSensor', 'read() → pH; calibrate(v7, v4).', 'PHSensor(adc, channel=0, slope=3.5, offset=0)'),
      a('ECSensor', 'read() → mS/cm.', 'ECSensor(adc, channel=0, temperature=25)'),
      a('TDSSensor', 'read() → ppm.', 'TDSSensor(adc, channel=0, temperature=25)'),
      a('SoilMoisture', 'read() → %.', 'SoilMoisture(adc, channel=0, dry=2.9, wet=1.3)'),
      a('WaterLevel', 'read() → %.', 'WaterLevel(adc, channel=0)'),
      a('Thermistor', 'read() → °C (β equation).', 'Thermistor(adc, channel=0, r_fixed=10000, r25=10000, beta=3950)'),
      a('Ultrasonic', 'read() → cm.', 'Ultrasonic(trigger=23, echo=24)'),
      a('TankLevel', 'percent() from an Ultrasonic.', 'TankLevel(ultrasonic, sensor_height_cm=43, full_cm=40)'),
      a('FloatSwitch', 'is_closed.', 'FloatSwitch(pin)'),
      a('FlowMeter', 'flow_lpm(window=1), litres().', 'FlowMeter(pin, k=7.5)'),
      a('Relay', 'on()/off()/run_for(s); value = True/False switches it.', 'Relay(pin, active_high=False)'),
      a('Relay.value', '1 while on; assign True/False to switch.'),
      a('Pump', 'Relay-switched pump.', 'Pump(pin, active_high=False)'),
      a('DosingPump', 'dose(ml).', 'DosingPump(pin, flow_ml_per_min=100)'),
      a('GrowLight', 'on(level)/off().', 'GrowLight(pin, pwm=True)'),
      a('PWMFan', 'speed = 0–1, rpm().', 'PWMFan(pwm, tach=None)'),
      a('Servo', 'angle = degrees.', 'Servo(pin)'),
      a('DCMotor', 'forward()/backward()/stop().', 'DCMotor(forward, backward, enable=None)'),
      a('Stepper28BYJ', 'rotate(degrees).', 'Stepper28BYJ(pins, delay=0.002)'),
      a('StepperDriver', 'rotate(degrees) on STEP/DIR.', 'StepperDriver(step, dir, enable=None)'),
      a('LCD', 'write(text, row, col).', 'LCD(address=0x27, cols=16, rows=2)'),
      a('Nextion', 'set_text(name, text), page(n).', "Nextion(port='/dev/serial0', baud=9600)"),
      a('ModbusSoilSensor', 'read() → dict.', "ModbusSoilSensor(port='/dev/serial0', slave=1, baud=9600, de_pin=None)"),
      a('NutrientMonitor', 'Combined EC/pH/temp/level with alarms.', 'NutrientMonitor(ec=..., ph=..., water_temp=..., level=...)'),
      a('scan_i2c', 'List I2C addresses.', 'scan_i2c()'),
    ],
  },
];

export const DRIVER_BY_MODULE = new Map(DRIVERS.map((d) => [d.module, d]));

/** Real-hardware notes for the libraries a program imports (used in exports). */
export function realHardwareNotes(code: string): { module: string; install: string; note?: string; simulatorOnly: boolean }[] {
  const mods = new Set<string>();
  for (const m of code.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w., ]+))/gm)) {
    const names = m[1] ? [m[1]] : m[2].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]);
    for (const n of names) mods.add(n.split('.')[0]);
  }
  const out: { module: string; install: string; note?: string; simulatorOnly: boolean }[] = [];
  for (const m of mods) {
    const d = DRIVER_BY_MODULE.get(m);
    if (d) out.push({ module: m, install: d.real.install, note: d.real.note, simulatorOnly: d.kind === 'simulator' });
  }
  return out;
}
