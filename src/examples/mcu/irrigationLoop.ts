// The ESP32 → MQTT → Wiren Board 7 → Modbus relay → pump → Smart Farm irrigation loop:
// circuit, ESP32 MicroPython program and wb-rules script (used by the example library and tests).
import { CircuitBuilder } from '../../engine/project';

export const INTEGRATION_ESP = `import network, time
from machine import Pin, ADC
from umqtt.simple import MQTTClient

wlan = network.WLAN(network.STA_IF)
wlan.active(True)
wlan.connect("WirenBoard-AP", "wirenboard")
while not wlan.isconnected():
    time.sleep_ms(200)
print("Wi-Fi", wlan.ifconfig()[0])

client = MQTTClient("esp32-soil", "192.168.42.1")
client.connect()
base = "/devices/esp32_soil/controls/moisture"
client.publish(base + "/meta/type", "value", retain=True)
client.publish(base + "/meta/readonly", "1", retain=True)

soil = ADC(Pin(34), atten=ADC.ATTN_11DB)
while True:
    volts = soil.read_uv() / 1e6
    moisture = max(0, min(100, (2.9 - volts) / 1.6 * 100))
    client.publish(base, "%.1f" % moisture, retain=True)
    print("moisture %.1f" % moisture)
    time.sleep(1)
`;

export const INTEGRATION_RULES = `// irrigation: the ESP32 soil sensor drives the pump on the WB-MR6C relay (K1)
var DRY = 35;   // % - start watering below
var WET = 45;   // % - stop above

defineRule("irrigation", {
  whenChanged: "esp32_soil/moisture",
  then: function (moisture) {
    var pump = dev["wb-mr6c_32/K1"];
    if (moisture < DRY && !pump) {
      dev["wb-mr6c_32/K1"] = true;
      log("soil {}% < {}% -> pump ON", moisture, DRY);
    } else if (moisture > WET && pump) {
      dev["wb-mr6c_32/K1"] = false;
      log("soil {}% > {}% -> pump OFF", moisture, WET);
    }
  }
});
`;

export function integrationCircuit() {
  const d = new CircuitBuilder()
    .add('wb', 'wb74', 400, 0)
    .add('ps', 'power_supply', 700, 0, { volts: 12, amps: 10 })
    .wire('ps.P', 'wb.VIN1')
    .wire('ps.N', 'wb.GND1')
    .add('mr', 'wb_mr6c', 700, 200, { slave: 32 })
    .wire('mr.VIN', 'ps.P').wire('mr.GND', 'ps.N').wire('mr.A', 'wb.RS1_A').wire('mr.B', 'wb.RS1_B')
    .add('pump', 'water_pump', 900, 200, { role: 'circulation', rate: 4 })
    .wire('ps.P', 'mr.COM1').wire('mr.NO1', 'pump.P').wire('pump.N', 'ps.N')
    .add('esp', 'esp32_devkitc', 0, 0)
    .add('soil', 'soil_moisture', 200, 250, { source: 'farm' })
    .wire('soil.VCC', 'esp.3V3').wire('soil.GND', 'esp.GND1').wire('soil.AO', 'esp.IO34')
    .doc();
  d.farm = { ...d.farm, enabled: true };
  d.files.push({ name: 'esp/main.py', content: INTEGRATION_ESP }, { name: 'wb/rules.js', content: INTEGRATION_RULES });
  d.controllers = { esp: { language: 'micropython', main: 'esp/main.py' }, wb: { language: 'wbrules', main: 'wb/rules.js' } };
  return d;
}

