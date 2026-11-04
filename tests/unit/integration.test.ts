// End-to-end: ESP32 sensor node (real MicroPython) → virtual Wi-Fi → MQTT broker on the
// Wiren Board → wb-rules (QuickJS) → wb-mqtt-serial → WB-MR6C relay (Modbus RTU) → pump →
// Smart Farm model → the soil moisture the ESP32 measures changes → the rule switches off.
import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../../src/engine/project';
import { WbRulesEngine } from '../../src/runtime/wb/wbRules';
import { McuHarness } from './mcuharness';
import { integrationCircuit } from '../../src/examples/mcu/irrigationLoop';

describe('ESP32 → MQTT → Wiren Board 7 → Modbus relay → pump → Smart Farm', () => {
  it('closes the irrigation loop', async () => {
    const d = integrationCircuit();
    const h = new McuHarness(d);
    const logs: string[] = [];
    const rules = new WbRulesEngine(h.sim, 'wb', { log: (lv, t) => logs.push(`${lv}: ${t}`) });
    h.sim.wb.get('wb')!.onLog = (l) => logs.push(`${l.level}: [${l.src}] ${l.msg}`);
    h.advance(0.3);
    const r = await rules.start(d.files, 'wb/rules.js');
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    const m0 = h.sim.farm.read('tray.moisture');
    let pumpOnAt = -1;
    let pumpOffAt = -1;
    h.onWait = (hh, t) => {
      rules.poll();
      const run = (hh.sim.vis.get('pump')?.run ?? 0) > 0.5;
      if (run && pumpOnAt < 0) pumpOnAt = t;
      if (!run && pumpOnAt >= 0 && pumpOffAt < 0) pumpOffAt = t;
    };
    const res = await h.runMicroPython('esp', 60);
    rules.stop();
    expect(res.status, res.stderr + res.error?.traceback).toBe('stopped');
    expect(res.stdout).toMatch(/Wi-Fi 192\.168\.42\.\d+/);
    expect(pumpOnAt).toBeGreaterThan(0);
    expect(logs.join('\n')).toMatch(/pump ON/);
    expect(h.sim.farm.read('tray.moisture')).toBeGreaterThan(m0 + 10);
    expect(pumpOffAt).toBeGreaterThan(pumpOnAt);
    expect(logs.join('\n')).toMatch(/pump OFF/);
    // the broker saw the ESP32's readings as a Wiren Board device
    expect(h.sim.wb.get('wb')!.broker.retained.get('/devices/esp32_soil/controls/moisture')).toBeDefined();
  }, 120_000);
});

describe('Arduino C++ ESP32 ↔ Wiren Board over MQTT (WiFi.h + PubSubClient.h)', () => {
  it('the sketch receives commands from wb-rules and publishes readings back', async () => {
    const d = new CircuitBuilder()
      .add('wb', 'wb74', 400, 0)
      .add('ps', 'power_supply', 700, 0, { volts: 24, amps: 5 })
      .wire('ps.P', 'wb.VIN1')
      .wire('ps.N', 'wb.GND1')
      .add('esp', 'esp32_devkitc', 0, 0)
      .add('r', 'resistor', 200, 0, { ohms: 330 })
      .add('led', 'led', 300, 0)
      .wire('esp.IO23', 'r.1').wire('r.2', 'led.A').wire('led.K', 'esp.GND2')
      .doc();
    d.files.push(
      {
        name: 'esp/main.ino',
        content: `#include <WiFi.h>
#include <PubSubClient.h>

WiFiClient net;
PubSubClient mqtt(net);
int received = 0;

void onMessage(char *topic, uint8_t *payload, unsigned int len) {
  digitalWrite(23, payload[0] == '1' ? HIGH : LOW);
  received++;
  Serial.printf("cmd %s = %s\\n", topic, (char *)payload);
}

void setup() {
  Serial.begin(115200);
  pinMode(23, OUTPUT);
  WiFi.begin("WirenBoard-AP", "wirenboard");
  while (WiFi.status() != WL_CONNECTED) delay(100);
  Serial.print("IP ");
  Serial.println(WiFi.localIP());
  mqtt.setServer("192.168.42.1", 1883);
  mqtt.setCallback(onMessage);
  if (!mqtt.connect("esp32-arduino")) Serial.println("connect failed");
  mqtt.subscribe("farm/cmd/led");
}

void loop() {
  mqtt.loop();
  static unsigned long last = 0;
  if (millis() - last > 1000) {
    last = millis();
    char buf[32];
    snprintf(buf, sizeof buf, "%d", received);
    mqtt.publish("farm/esp/received", buf);
  }
  delay(20);
}
`,
      },
      {
        name: 'wb/rules.js',
        content: `var n = 0;
setInterval(function () { n++; publish("farm/cmd/led", n % 2 ? "1" : "0"); }, 700);
trackMqtt("farm/esp/received", function (msg) { log("esp32 got {} commands", msg.value); });
`,
      },
    );
    d.controllers = { esp: { language: 'arduino', main: 'esp/main.ino' }, wb: { language: 'wbrules', main: 'wb/rules.js' } };
    const h = new McuHarness(d);
    const logs: string[] = [];
    const rules = new WbRulesEngine(h.sim, 'wb', { log: (lv, t) => logs.push(`${lv}: ${t}`) });
    h.advance(0.3);
    expect((await rules.start(d.files, 'wb/rules.js')).ok).toBe(true);
    const levels: number[] = [];
    h.onWait = (hh) => {
      rules.poll();
      const on = (hh.sim.vis.get('led')?.brightness ?? 0) > 0.2 ? 1 : 0;
      if (levels[levels.length - 1] !== on) levels.push(on);
    };
    const r = await h.runArduino('esp', 6);
    rules.stop();
    expect(r.compile.ok, r.compile.log).toBe(true);
    expect(r.status, r.error?.message).toBe('stopped');
    expect(r.stdout).toMatch(/IP 192\.168\.42\.\d+/);
    expect(r.stdout).toContain('cmd farm/cmd/led = 1');
    expect(levels.filter((x) => x === 1).length).toBeGreaterThanOrEqual(2);
    expect(logs.join('\n')).toMatch(/esp32 got [1-9]\d* commands/);
  }, 120_000);
});
