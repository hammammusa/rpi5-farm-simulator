import { useApp } from '../../state/store';

const ROWS: [string, string, string][] = [
  ['gpiozero', 'LED, PWMLED, RGBLED, Buzzer, OutputDevice, DigitalOutputDevice, PWMOutputDevice, Motor, Servo, AngularServo, InputDevice, DigitalInputDevice, Button, MotionSensor, LineSensor, MCP3008, CPUTemperature; on/off/toggle/blink/pulse, value, is_active, when_pressed/released/held/activated/deactivated, wait_for_*, source', 'Callbacks run during sleep()/pause()/waits instead of a background thread. Pin factory is the simulator (lgpio on a real Pi 5).'],
  ['RPi.GPIO', 'setmode, setup, output, input, cleanup, PWM, add_event_detect/callback, event_detected, wait_for_edge', 'Behaves like rpi-lgpio. The original RPi.GPIO does NOT run on a Pi 5 — install rpi-lgpio there.'],
  ['serial (pyserial)', 'Serial(port, baud, timeout), write, read, read_until, readline(s), in_waiting, reset_input_buffer, close; ports /dev/serial0, /dev/ttyAMA0–4', 'Transmission time is 10 bits/byte at the chosen baud. A baud mismatch garbles bytes.'],
  ['smbus2 / smbus', 'read/write_byte(_data), read/write_word_data, read/write_i2c_block_data, write_quick, i2c_rdwr + i2c_msg; bus 1', 'Missing devices raise OSError 121 like a real Pi.'],
  ['spidev', 'SpiDev().open(0, 0|1), xfer/xfer2/xfer3, readbytes, writebytes', 'Only spidev0.0/0.1 (SPI0).'],
  ['adafruit_dht + board', 'DHT22/DHT11(board.Dn).temperature/.humidity, exit()', '2 s minimum read interval; RuntimeError on failures (catch and retry).'],
  ['w1thermsensor, /sys/bus/w1', 'W1ThermSensor().get_temperature(), glob/open of 28-*/w1_slave', 'Enable 1-Wire on the Pi (Inspector) and add a 4.7 kΩ pull-up.'],
  ['bme280', 'load_calibration_params, sample (RPi.bme280 API)', 'Real register map + datasheet compensation.'],
  ['RPLCD.i2c', 'CharLCD("PCF8574", 0x27).write_string, clear, cursor_pos, backlight_enabled', 'HD44780 decoded from PCF8574 bytes.'],
  ['ssd1306 + framebuf', 'SSD1306_I2C(128, 64, SMBus(1)).text/pixel/line/rect/fill/show', 'MicroPython-style API adapted to smbus2.'],
  ['flask', 'Flask, route/get/post, request (args, form, json, get_json), jsonify, render_template(templates/), redirect, url_for, abort, Response, errorhandler, static/', 'Served to the in-app browser; requests run during sleep()/app.run().'],
  ['schedule', 'every(n).seconds/minutes/hours/days, .at("HH:MM"), weekdays, run_pending, clear, cancel_job, CancelJob', 'Uses simulation time.'],
  ['time, datetime', 'sleep, time, monotonic, localtime, strftime; datetime.now/today, date.today', 'All in simulation time (follows speed and fast-forward).'],
  ['threading', 'Timer, Lock, Event; Thread(target=app.run) for Flask', 'Cooperative: other Thread targets start when the main thread blocks (pause(), app.run(), join(), end of script).'],
  ['Standard library', 'json, math, random, statistics, re, csv, collections, os.path, glob, io, …', 'Files your program writes (settings.json, logs) appear in the file list after the run.'],
];

export function Docs() {
  const lang = useApp((s) => s.lang);
  return (
    <article className="page learn-detail" data-testid="docs">
      <h1>{lang === 'ar' ? 'مرجع بايثون والعتاد المدعوم' : 'Supported Python & hardware reference'}</h1>
      <p className="muted">
        {lang === 'ar'
          ? 'هذه محاكاة وظيفية: يعمل كودك على CPython 3.13 حقيقي في المتصفح، وتُنفّذ مكتبات العتاد على محرك المحاكاة. الجدول يوضح الدوال المدعومة والاختلافات عن Raspberry Pi 5 الحقيقي.'
          : 'This is a functional simulation: your code runs on real CPython 3.13 in the browser and the hardware libraries talk to the simulation engine. The table lists what is supported and how it differs from a real Raspberry Pi 5.'}
      </p>
      <table className="data-table report">
        <thead>
          <tr>
            <th>Module</th>
            <th>Supported</th>
            <th>Differences / notes</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([m, s, n]) => (
            <tr key={m}>
              <td dir="ltr">
                <code>{m}</code>
              </td>
              <td className="small" dir="ltr">
                {s}
              </td>
              <td className="small">{n}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Raspberry Pi 5 specifics</h2>
      <ul>
        <li>GPIO is 3.3 V logic and not 5 V tolerant. There is no analog input — use an ADC such as the MCP3008.</li>
        <li>GPIO is provided by the RP1 chip: use gpiozero (lgpio) or rpi-lgpio, not the classic RPi.GPIO.</li>
        <li>UART0 on GPIO14/15 is /dev/serial0 once enabled (dtparam=uart0=on); extra UARTs: ttyAMA1 (GPIO0/1), ttyAMA2 (4/5), ttyAMA3 (8/9), ttyAMA4 (12/13).</li>
        <li>Hardware PWM pins: GPIO12, 13, 18, 19. gpiozero also does software PWM on any pin.</li>
        <li>I2C bus 1: GPIO2 (SDA) and GPIO3 (SCL) with on-board 1.8 kΩ pull-ups. SPI0: MOSI 10, MISO 9, SCLK 11, CE0 8, CE1 7.</li>
      </ul>
      <h2>Not simulated</h2>
      <ul>
        <li>Raspberry Pi OS, the BCM2712 CPU, the Linux kernel, camera, HDMI, USB devices, Wi-Fi/Ethernet (the web server is reachable only from the in-app browser).</li>
        <li>Transient electronics (capacitor charging, inductive spikes, motor start-up current), the linear region of transistors.</li>
        <li>Nextion .HMI/.TFT files, Nextion scripting beyond the listed instructions.</li>
        <li>Python C-extension packages that are not part of the Pyodide standard library (numpy, pandas… are not bundled).</li>
      </ul>
      <h2>Keyboard shortcuts</h2>
      <ul dir="ltr">
        <li>F5 / Ctrl+Enter run · Shift+F5 stop · Ctrl+S save · Ctrl+Z / Ctrl+Y undo/redo</li>
        <li>Workspace: R rotate · Ctrl+D duplicate · Delete · Ctrl+A select all · arrows move · +/− zoom · 0 fit · Esc cancel wire · Space+drag pan</li>
      </ul>
    </article>
  );
}
