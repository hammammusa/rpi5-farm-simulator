# Pi5 FarmSim — Raspberry Pi 5 Virtual Electronics & Smart-Farming Simulator

A browser-based lab, similar in spirit to Tinkercad Circuits, specialised for the **Raspberry Pi 5 Model B (8 GB)**, **Python 3**, the **Nextion Enhanced** touchscreen and **hydroponic smart farming**. It was built as a training environment for the *City Farming — «Профессионалы» 2026* competition.

Everything runs client-side: real CPython 3.13 (Pyodide/WebAssembly) in a Web Worker, a TypeScript circuit engine, and IndexedDB storage. No server is needed, so any static host works.

## What it does

| Area | Implemented |
|---|---|
| Raspberry Pi 5 | Correct 40-pin J8 header (physical + BCM numbering, 3V3/5V/GND, I2C1, SPI0, UART0–4, PWM pins), RP1 reset pulls, on-board 1.8 kΩ I2C pull-ups, 1-Wire overlay option, power-failure fault |
| ESP32-DevKitC V4 | ESP32-WROOM-32 board with the real J2/J3 header (38 pins). Flash pins GPIO6–11 refused, GPIO34–39 input-only without pulls, strapping pins (0/2/5/12/15) checked at boot, 3.3 V-only GPIO (over-voltage/over-current), ADC1/ADC2 (12-bit, attenuation, ADC2 unavailable with Wi-Fi), LEDC PWM, DAC on GPIO25/26, I2C, UART on any pins (GPIO matrix), 1-Wire, WS2812. Several boards per project, each with its own pin table, program folder and Run/Stop/Reset |
| ESP32 MicroPython | The official **MicroPython 1.29 WebAssembly port** in its own worker, with simulator modules `machine` (Pin/irq, PWM, ADC, DAC, I2C/SoftI2C, UART, Timer, reset), `time`/`utime` (simulation time), `dht`, `onewire`, `ds18x20`, `neopixel`, `network` (WLAN STA) and `umqtt.simple`. Tracebacks with file and line |
| ESP32 Arduino C++ | Sketches are **compiled by real Clang/LLD 22** (YoWASP WebAssembly toolchain, ≈105 MB, downloaded once) together with the simulator's Arduino-ESP32 core subset (C++, no source translation): `pinMode/digitalWrite/digitalRead`, `analogRead/analogReadMilliVolts`, `ledcAttach/ledcWrite` (3.x) and `ledcSetup/ledcAttachPin` (2.x), `analogWrite`, `dacWrite`, `attachInterrupt`, `millis/delay`, `Serial/Serial1/Serial2`, `String`, `printf`, `Wire`, `DHT.h`, `OneWire.h` + `DallasTemperature.h`, `Adafruit_NeoPixel.h`, `WiFi.h`, `PubSubClient.h`. .ino prototypes as in the Arduino IDE; compiler errors point at the sketch line; undefined functions are link errors |
| Wiren Board 7.4 | V+ 9…48 V, A1–A4 open-collector outputs (30 V/1 A, over-current protection) with inputs and 0…36.3 V measurement, W1/W2 1-Wire, RS-485-1/2. A virtual MQTT broker with simulated `wb-mqtt-gpio`, `wb-mqtt-adc`, `wb-mqtt-w1` and `wb-mqtt-serial` (Modbus RTU polling, timeouts, `/meta/error`, A/B swap and baud diagnostics); WB-MR6C Modbus relay module. **wb-rules** scripts run in a QuickJS sandbox: `defineRule` (`whenChanged`/`asSoonAs`/`when`/`cron`), `dev[...]`, `defineVirtualDevice`, timers, `trackMqtt`, `publish`, `log`. MQTT monitor tab |
| Multi-controller | ESP32 boards join the Wiren Board Wi-Fi access point and MQTT broker (virtual LAN); ESP32 ↔ Pi and board ↔ board UART links; shared virtual time; 11 library projects for ESP32/WB7 including ESP32 → MQTT → WB7 → Modbus relay → pump → Smart Farm |
| Python | Real CPython 3.13 in a dedicated worker. Run/Stop/Reset, blocking `sleep()` in simulation time, `input()`, multi-file projects, tracebacks limited to your files with line highlighting and bilingual explanations. Stop interrupts Python (KeyboardInterrupt); a program that ignores it is killed and the worker restarted |
| Hardware libraries | `gpiozero` (LED, PWMLED, RGBLED, Button, Buzzer, OutputDevice, DigitalInput/OutputDevice, PWMOutputDevice, Motor, Servo, AngularServo, MCP3008, CPUTemperature, callbacks, blink/pulse, `source`), `RPi.GPIO` (rpi-lgpio compatible), `serial` (pyserial), `smbus2`/`smbus`, `spidev`, `board` + `adafruit_dht`, `Adafruit_DHT` (legacy), `w1thermsensor` + `/sys/bus/w1`, `bme280` (RPi.bme280 API), `RPLCD.i2c`, MicroPython-style `ssd1306`/`framebuf`, `flask` (subset), `schedule`, `signal.pause`, cooperative `threading` (Timer, Flask-in-thread) |
| Circuit engine | Union-find netlist (wires, breadboard strips, pin-in-hole insertion), DC nodal solver with piecewise-linear diodes/LEDs, controlled switches (BJT, MOSFET, relays), PWM phase averaging, current limits/trips |
| Electrical checks | Short circuits, missing ground / open circuits, over-voltage on GPIO (e.g. 12 V or 5 V pull-ups), GPIO over-current, LED without resistor / reversed / burned, GPIO driving a pump/motor, relay supply mismatch, UART TX↔TX, SDA/SCL swap, I2C address conflicts, SPI wiring, missing ADC for analog sensors, missing 1-Wire/DHT pull-ups, no common ground, missing flyback diode, floating inputs, wired-but-unused pins |
| Components (43) | Pi 5, breadboard, LEDs, RGB LED, resistor, capacitor (DC-open), push button, SPDT switch, potentiometer, buzzer, diode, NPN/PNP, logic/standard MOSFET, DC supply, 1/2/4-ch relay modules, water pump, peristaltic dosing pump, solenoid valve, fan, DC motor, heater, humidifier, grow light, servo, DHT22, BME280, DS18B20, MH-Z19B, pH, EC, soil moisture, analog level, float switch, YF-S201 flow meter, LDR module, BH1750, leak sensor, MCP3008, Nextion, LCD1602-I2C, SSD1306 OLED, USB-UART terminal |
| Nextion | NX3224K028 (2.8", 320×240) reference model. Page designer, live screen, touch events over UART (`65 … FF FF FF`), documented instruction subset (`txt/val/pco/bco`, `page`, `vis`, `get`, `sendme`, `click`, `covx`, `dim`, `bkcmd`, `baud` …), return codes, local/global scope, baud mismatch. **.HMI/.TFT files are not supported**; layouts export as JSON |
| Smart farm | Reservoir, A/B/pH-down tanks, circulation, dosing (ml, calibration error), fresh water/drain, leak, plant uptake, EC/pH mixing, room climate (fan, heater, humidifier, lights), CO₂, power/energy, physical alarms (dry run, overflow, A+B together, leak). Event-accurate integration, 1×/2×/5×/10× speed and 600× fast-forward. Heating simulation mode (saved per project): Realistic (THERMAL_MASS 150 000 J/K), Training (12 000 J/K) or Extreme Test (2 500 J/K, hypothetical: beyond the DHT22's −40…80 °C range the sensor reports its limit) |
| Web | In-app browser for `http://raspberrypi.local:5000` that renders pages served by your Flask program, with `fetch`, forms and links bridged to Python; desktop/tablet/phone widths |
| Example library | 161 runnable examples in 16 categories (GPIO, sensors, motors, displays, communication, smart home, robotics, security, industrial, smart farming, energy, digital logic, data & logging, Python challenges, integrated projects, ESP32 & Wiren Board 7). Each has a goal, level, duration, parts list, pre-wired circuit with a default layout, ready code, expected result, test steps, explanation and an automatic check; opens as a private copy. Search, category/level/component filters, sorting, favourites, tried/completed progress and suggested next examples |
| Auto Arrange | One click (or the canvas menu) places the Pi on the left and the parts in labelled functional zones, routes every wire orthogonally around part bodies with track spacing, optionally applies standard wire colours (red +, black GND); connections, settings and code are untouched, Ctrl+Z undoes it, and wires it routed follow their parts when you drag them |
| Competition mode | Timed challenges: Module A (controller + web), Module B (Nextion), and a hardware fault hunt, with automatic checkpoints, score and mistake report |
| Tests | 15 in-app acceptance tests (PART 16), downloadable report; Vitest unit tests (engine, devices, real Python via Node Pyodide, all examples); Playwright end-to-end tests |
| Projects | IndexedDB autosave, create/rename/duplicate/delete, import/export JSON and ZIP (code + wiring table + Nextion layout) |
| UI | Dark/light theme, English + Arabic (RTL, with code kept LTR), resizable dock, keyboard shortcuts, responsive layout |

## Simulation scope and limits

This is a **functional/behavioural** simulator, not SPICE and not a BCM2712 emulator:

* DC steady state only: no capacitor charging, inductive kick or transients (flyback diodes are checked by rule, not simulated).
* Transistors and MOSFETs are switch models; LEDs/diodes are piecewise-linear.
* Sensor protocols are modelled at the level the Python libraries see (register maps for BME280/BH1750/LCD/OLED, bit-accurate MCP3008 SPI, real MH-Z19B frames, w1 sysfs text). DHT22 single-wire timing is not bit-banged.
* Callbacks and Flask requests run cooperatively during `sleep()`/waits, because browsers have no Python threads. Background `threading.Thread` targets other than a Flask server start when the main thread blocks.
* The farm model is a declared, simplified training model (see the Smart Farm tab), not an agronomic or chemical simulation.
* ESP32: the Xtensa CPU, ESP-IDF, FreeRTOS, the boot ROM and the radio are not emulated. MicroPython and Arduino code run functionally (MicroPython interpreter / Clang-compiled WebAssembly) against peripheral models; timing below ~1 ms, the bootloader and partition tables are not modelled. The Arduino core is a documented subset of Arduino-ESP32: other libraries are not available. Wi-Fi and TCP are a virtual LAN (no sockets, HTTP or BLE).
* Wiren Board 7.4: Debian/Linux, the web UI, CAN, the expansion slots and Modbus TCP are not emulated. wb-rules follows the public README API (not every helper module); drivers publish with Wiren Board topic conventions. Python on the Wiren Board is not provided.
* The Nextion model is a documented subset; the practice tasks are modelled on the competition structure but are **not the official tasks**, and passing them does not guarantee competition scores.

## Develop

```bash
npm install          # also copies the Pyodide runtime into public/pyodide
npm run dev          # http://localhost:5173 (COOP/COEP headers set by Vite)
npx vitest run       # unit + Python-runtime + example tests
npm run build && npx playwright test             # end-to-end against the production build
E2E_BASE_URL=https://<deployment>/ npx playwright test   # same suite against production
```

`SharedArrayBuffer` requires cross-origin isolation. Vite sets the headers in dev/preview; `vercel.json` and `public/_headers` set them on Vercel/Netlify/Cloudflare; on GitHub Pages `coi-serviceworker.js` adds them (the page reloads once on the first visit).

## Deploy

`.github/workflows/deploy.yml` tests, builds (with `BASE_PATH=/<repo>/`) and publishes to GitHub Pages on every push to `main`, then runs the Playwright suite (including acceptance test T15) against the live HTTPS site.

## Architecture

```
src/engine/      circuit graph, DC solver, Auto Arrange (layout.ts), part models, validation, farm model, protocol devices (UI-independent)
src/runtime/     Pyodide worker, SharedArrayBuffer bridge, Python shims (src/runtime/python)
src/runtime/mcu/ microcontroller workers (MicroPython host, engine dispatch); src/runtime/arduino/ Clang compile + Arduino core; src/runtime/wb/ wb-rules (QuickJS)
src/engine/boards/, src/engine/wb/  board definitions (Pi 5, ESP32, WB7.4), MQTT broker, Wiren Board drivers, virtual network
src/state/       zustand store, engine singletons, IndexedDB persistence, wiring export
src/ui/          React UI (workspace, inspector, editor, dock, Nextion, farm, web, tests, learn, competition)
src/examples/    20 guided lessons + City Farming controller sources + Nextion templates
src/library/     example library: circuit DSL, the categories, default-layout builder and in-app checks
src/tests/       in-app test host and the 15 acceptance tests
src/competition/ practice challenges and checkpoints
tests/unit       Vitest (engine, devices, real Python through Node Pyodide)
tests/e2e        Playwright
```

New components are added with a `PartManifest` (pins, props schema, faults, `stamp()` for the electrical model, `post()` for visual state and rule checks) registered through `registerPart()`, plus a renderer in `src/ui/parts/PartView.tsx`.
