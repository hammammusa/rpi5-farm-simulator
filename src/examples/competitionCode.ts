// Python + HTML sources of the complete City Farming controller (example 20).
// Written to run unchanged on a real Raspberry Pi 5 with the same wiring
// (pip install gpiozero rpi-lgpio pyserial flask adafruit-circuitpython-dht w1thermsensor).

export const CFG_PY = String.raw`"""Settings with defaults, stored in settings.json next to the program."""
import json
import os

SETTINGS_FILE = "settings.json"

DEFAULTS = {
    "crop": "Lettuce",
    "mode": "AUTO",                 # AUTO | DOSING | TEST | MANUAL
    "light_on": "06:00",            # grow-light start time
    "light_hours": 16,              # photoperiod (hours)
    "irrigation": ["06:00", "10:00", "14:00", "18:00"],
    "irrigation_minutes": 5,
    "thresholds": {
        "temp_min": 18, "temp_max": 26,
        "hum_min": 50, "hum_max": 80,
        "co2_max": 1200,
        "ph_min": 5.5, "ph_max": 6.5,
        "ec_min": 1.0, "ec_max": 2.2,
        "level_min": 25,
    },
    "dose_ml": {"A": 10, "B": 10},
    "pump_flow_ml_min": {"A": 100.0, "B": 100.0},   # calibrate each dosing pump!
    "grow_start": None,             # ISO date of grow day 0
}


def load():
    data = json.loads(json.dumps(DEFAULTS))
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE) as f:
                saved = json.load(f)
            for k, v in saved.items():
                if isinstance(v, dict) and isinstance(data.get(k), dict):
                    data[k].update(v)
                else:
                    data[k] = v
        except (ValueError, OSError) as e:
            print("settings.json unreadable, using defaults:", e)
    return data


def save(settings):
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=2)
`;

export const HW_PY = String.raw`"""Hardware access: relays, dosing pumps (with interlock), sensors."""
import time

import adafruit_dht
import board
import serial
from gpiozero import Button, MCP3008, OutputDevice
from w1thermsensor import W1ThermSensor


class Relays:
    """4-channel active-LOW relay board."""
    PINS = {"pump": 17, "light": 27, "fan": 22, "heater": 23}

    def __init__(self):
        self.dev = {n: OutputDevice(p, active_high=False, initial_value=False) for n, p in self.PINS.items()}

    def set(self, name, on):
        self.dev[name].value = bool(on)

    def get(self, name):
        return bool(self.dev[name].value)

    def states(self):
        return {n: self.get(n) for n in self.dev}

    def all_off(self):
        for d in self.dev.values():
            d.off()


class Dosing:
    """Non-blocking dosing queue. Only ONE dosing pump may run at a time (interlock)."""

    def __init__(self, flows):
        self.pumps = {"A": OutputDevice(5, active_high=False), "B": OutputDevice(6, active_high=False)}
        self.flows = flows
        self.queue = []
        self.active = None          # (name, ml, started)
        self.until = 0.0
        self.history = []

    def request(self, name, ml):
        name = name.upper()
        if name not in self.pumps:
            raise ValueError("unknown pump " + name)
        ml = float(ml)
        if not 0 < ml <= 200:
            raise ValueError("dose must be 0..200 ml")
        self.queue.append((name, ml))

    def busy(self):
        return self.active is not None or bool(self.queue)

    def running(self):
        return self.active[0] if self.active else None

    def stop_all(self):
        self.queue.clear()
        for p in self.pumps.values():
            p.off()
        self.active = None

    def update(self):
        now = time.time()
        if self.active and now >= self.until:
            name, ml, started = self.active
            self.pumps[name].off()
            self.history.append({"pump": name, "ml": ml, "seconds": round(now - started, 1)})
            print("Dosing %s finished: %.1f ml in %.1f s" % (name, ml, now - started))
            self.active = None
        if self.active is None and self.queue:
            name, ml = self.queue.pop(0)
            if any(p.value for p in self.pumps.values()):
                raise RuntimeError("interlock violated: another dosing pump is on")
            seconds = ml / self.flows[name] * 60.0
            self.pumps[name].on()
            self.active = (name, ml, now)
            self.until = now + seconds
            print("Dosing %s: %.1f ml -> pump on for %.1f s" % (name, ml, seconds))


class Sensors:
    def __init__(self):
        self.dht = adafruit_dht.DHT22(board.D16)
        self.adc_ph = MCP3008(channel=0)
        self.adc_ec = MCP3008(channel=1)
        self.adc_level = MCP3008(channel=2)
        self.float_ok = Button(24)                 # closed = water above the switch
        self.co2_port = serial.Serial("/dev/ttyAMA4", 9600, timeout=0.3)   # dtoverlay=uart4
        try:
            self.water_probe = W1ThermSensor()
        except Exception as e:  # noqa: BLE001
            print("DS18B20 not found:", e)
            self.water_probe = None
        self.values = {"temp": None, "hum": None, "co2": None, "ph": None, "ec": None, "level": None, "water_temp": None, "water_ok": True}
        self.errors = {}

    def _avg(self, ch, n=5):
        return sum(ch.voltage for _ in range(n)) / n

    def _co2(self):
        cmd = bytes([0xFF, 0x01, 0x86, 0, 0, 0, 0, 0, 0x79])
        self.co2_port.reset_input_buffer()
        self.co2_port.write(cmd)
        r = self.co2_port.read(9)
        if len(r) != 9 or r[0] != 0xFF or r[1] != 0x86:
            raise RuntimeError("no answer from MH-Z19B")
        if (0xFF - (sum(r[1:8]) & 0xFF) + 1) & 0xFF != r[8]:
            raise RuntimeError("MH-Z19B checksum error")
        return r[2] * 256 + r[3]

    def read_all(self):
        v = self.values
        try:
            v["temp"] = self.dht.temperature
            v["hum"] = self.dht.humidity
            self.errors.pop("dht", None)
        except RuntimeError as e:
            self.errors["dht"] = str(e)
        try:
            v["co2"] = self._co2()
            self.errors.pop("co2", None)
        except RuntimeError as e:
            self.errors["co2"] = str(e)
        if self.water_probe is not None:
            try:
                v["water_temp"] = round(self.water_probe.get_temperature(), 1)
                self.errors.pop("water_temp", None)
            except Exception as e:  # noqa: BLE001
                self.errors["water_temp"] = str(e)
        wt = v["water_temp"] if v["water_temp"] is not None else 25.0
        v["ph"] = round(3.5 * self._avg(self.adc_ph), 2)
        v["ec"] = round(self._avg(self.adc_ec) / 0.5 / (1 + 0.02 * (wt - 25)), 2)
        v["level"] = round(self._avg(self.adc_level) / 3.0 * 100, 1)
        v["water_ok"] = self.float_ok.is_pressed
        return v
`;

export const NX_PY = String.raw`"""Nextion NX3224K028 helper: commands end with FF FF FF; touch events are 65 page id event FF FF FF."""
import serial

END = b"\xff\xff\xff"

# (page, component id) -> name, from the Nextion layout in the Nextion tab
TOUCH = {
    (0, 23): "goto_control", (0, 24): "goto_settings", (0, 25): "goto_qr",
    (1, 2): "pump", (1, 3): "light", (1, 4): "fan", (1, 5): "heater",
    (1, 6): "auto", (1, 7): "manual", (1, 9): "back",
    (2, 8): "reset_day", (2, 9): "back",
    (3, 4): "back",
}
GOTO = {"goto_control": 1, "goto_settings": 2, "goto_qr": 3, "back": 0}


class Nextion:
    def __init__(self, port="/dev/serial0", baud=9600):
        self.ser = serial.Serial(port, baud, timeout=0)
        self.buf = b""
        self.page = 0

    def cmd(self, text):
        self.ser.write(text.encode("utf-8") + END)

    def txt(self, name, value):
        self.cmd('%s.txt="%s"' % (name, str(value).replace('"', "'")))

    def val(self, name, value):
        self.cmd("%s.val=%d" % (name, int(value)))

    def events(self):
        """Return a list of touch-event names received since the last call."""
        self.buf += self.ser.read(256)
        out = []
        while END in self.buf:
            frame, self.buf = self.buf.split(END, 1)
            if len(frame) == 4 and frame[0] == 0x65 and frame[3] == 1:
                name = TOUCH.get((frame[1], frame[2]))
                if name:
                    if name in GOTO:
                        self.page = GOTO[name]
                    out.append(name)
            elif len(frame) == 2 and frame[0] == 0x66:
                self.page = frame[1]
            elif len(frame) == 1 and frame[0] not in (0x00, 0x01, 0x88):
                print("Nextion error code 0x%02X" % frame[0])
        return out
`;

export const WEB_PY = String.raw`"""Local web interface (Flask). On a real Pi open http://<pi-ip>:5000 from a phone."""
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
ctl = None          # the Controller, attached by main.py


def attach(controller):
    global ctl
    ctl = controller


@app.route("/")
def index():
    return render_template("index.html", crop=ctl.settings["crop"])


@app.route("/api/state")
def api_state():
    return jsonify(ctl.snapshot())


@app.route("/api/settings", methods=["POST"])
def api_settings():
    data = request.get_json(silent=True) or {}
    ctl.update_settings(data)
    return jsonify(ok=True, settings=ctl.settings)


@app.route("/api/mode", methods=["POST"])
def api_mode():
    mode = (request.get_json(silent=True) or {}).get("mode", "AUTO")
    ok, msg = ctl.set_mode(mode)
    return jsonify(ok=ok, message=msg), (200 if ok else 400)


@app.route("/api/dose", methods=["POST"])
def api_dose():
    data = request.get_json(silent=True) or {}
    ok, msg = ctl.start_dosing(data.get("A", 0), data.get("B", 0))
    return jsonify(ok=ok, message=msg), (200 if ok else 400)


@app.route("/api/relay", methods=["POST"])
def api_relay():
    data = request.get_json(silent=True) or {}
    ok, msg = ctl.manual_relay(data.get("name"), data.get("on"))
    return jsonify(ok=ok, message=msg), (200 if ok else 400)


@app.route("/api/test", methods=["POST"])
def api_test():
    ok, msg = ctl.set_mode("TEST")
    return jsonify(ok=ok, message=msg)


@app.route("/api/reset_day", methods=["POST"])
def api_reset_day():
    ctl.reset_grow_day()
    return jsonify(ok=True)
`;

export const MAIN_PY = String.raw`"""City Farming controller (training project for "Professionals" 2026 — City Farming).

Modes
  AUTO     lighting schedule, irrigation schedule, climate thresholds, protection
  DOSING   doses fertilizer A then B (ml) with interlock, then returns to AUTO
  TEST     switches every relay channel on for 2 s in turn, then returns to AUTO
  MANUAL   relays controlled from the Nextion / web page (protection still active)
"""
import datetime
import threading
import time

import config
import web
from hardware import Dosing, Relays, Sensors
from nextion import Nextion

TEST_SEQUENCE = ["pump", "light", "fan", "heater", "A", "B"]


def hm(text):
    h, m = text.split(":")
    return int(h) * 60 + int(m)


class Controller:
    def __init__(self):
        self.settings = config.load()
        if not self.settings.get("grow_start"):
            self.settings["grow_start"] = datetime.date.today().isoformat()
            config.save(self.settings)
        self.relays = Relays()
        self.dosing = Dosing(self.settings["pump_flow_ml_min"])
        self.sensors = Sensors()
        self.nx = Nextion()
        self.values = {}
        self.alerts = []
        self.test_step = None
        self.test_until = 0
        self.last_read = 0
        self.last_screen = 0
        self.log = []

    # ---------------------------------------------------------------- helpers
    def note(self, text):
        stamp = datetime.datetime.now().strftime("%H:%M:%S")
        print(stamp, text)
        self.log = (self.log + [stamp + " " + text])[-20:]

    @property
    def mode(self):
        return self.settings["mode"]

    def grow_day(self):
        start = datetime.date.fromisoformat(self.settings["grow_start"])
        return max(0, min(40, (datetime.date.today() - start).days))

    def reset_grow_day(self):
        self.settings["grow_start"] = datetime.date.today().isoformat()
        config.save(self.settings)
        self.note("grow day counter reset to 0")

    def minutes_now(self):
        n = datetime.datetime.now()
        return n.hour * 60 + n.minute + n.second / 60

    def light_wanted(self):
        start = hm(self.settings["light_on"])
        end = start + self.settings["light_hours"] * 60
        now = self.minutes_now()
        return start <= now < end or start <= now + 1440 < end

    def irrigation_wanted(self):
        now = self.minutes_now()
        dur = self.settings["irrigation_minutes"]
        return any(hm(t) <= now < hm(t) + dur for t in self.settings["irrigation"])

    def next_irrigation(self):
        now = self.minutes_now()
        times = sorted(hm(t) for t in self.settings["irrigation"])
        for t in times:
            if t > now:
                return "%02d:%02d" % divmod(t, 60)
        return ("%02d:%02d" % divmod(times[0], 60)) if times else "--:--"

    # ---------------------------------------------------------------- commands (web / Nextion)
    def set_mode(self, mode):
        mode = str(mode).upper()
        if mode not in ("AUTO", "DOSING", "TEST", "MANUAL"):
            return False, "unknown mode"
        if mode == "DOSING":
            return self.start_dosing(self.settings["dose_ml"]["A"], self.settings["dose_ml"]["B"])
        if mode == "TEST":
            self.dosing.stop_all()
            self.relays.all_off()
            self.test_step = -1
            self.test_until = 0
        self.settings["mode"] = mode
        config.save(self.settings)
        self.note("mode -> " + mode)
        return True, mode

    def start_dosing(self, ml_a, ml_b):
        if self.dosing.busy():
            return False, "dosing already running"
        try:
            if float(ml_a) > 0:
                self.dosing.request("A", ml_a)
            if float(ml_b) > 0:
                self.dosing.request("B", ml_b)
        except ValueError as e:
            self.dosing.stop_all()
            return False, str(e)
        self.settings["mode"] = "DOSING"
        self.note("dosing started: A %s ml, B %s ml" % (ml_a, ml_b))
        return True, "dosing started"

    def manual_relay(self, name, on):
        if self.mode != "MANUAL":
            return False, "switch to MANUAL mode first"
        if name not in self.relays.PINS:
            return False, "unknown relay"
        if name == "pump" and on and not self.values.get("water_ok", True):
            return False, "blocked: water level too low"
        self.relays.set(name, on)
        self.note("manual %s %s" % (name, "ON" if on else "OFF"))
        return True, "ok"

    def update_settings(self, data):
        for key in ("crop", "light_on", "light_hours", "irrigation", "irrigation_minutes"):
            if key in data:
                self.settings[key] = data[key]
        if "thresholds" in data:
            self.settings["thresholds"].update(data["thresholds"])
        if "dose_ml" in data:
            self.settings["dose_ml"].update(data["dose_ml"])
        config.save(self.settings)
        self.note("settings updated")

    # ---------------------------------------------------------------- control logic
    def protection(self):
        v = self.values
        low = (not v.get("water_ok", True)) or (v.get("level") is not None and v["level"] < self.settings["thresholds"]["level_min"])
        if low and self.relays.get("pump"):
            self.relays.set("pump", False)
            self.note("PROTECTION: low water -> pump OFF")
        return low

    def automatic(self, low_water):
        th = self.settings["thresholds"]
        v = self.values
        self.relays.set("light", self.light_wanted())
        self.relays.set("pump", self.irrigation_wanted() and not low_water)
        t = v.get("temp")
        if t is not None:
            hot = t > th["temp_max"] or (v.get("hum") or 0) > th["hum_max"] or (v.get("co2") or 0) > th["co2_max"]
            if hot:
                self.relays.set("fan", True)
            elif t < th["temp_max"] - 1 and (v.get("co2") or 0) < th["co2_max"] - 100:
                self.relays.set("fan", False)
            if t < th["temp_min"]:
                self.relays.set("heater", True)
            elif t > th["temp_min"] + 1:
                self.relays.set("heater", False)

    def run_test(self):
        now = time.time()
        if now < self.test_until:
            return
        self.relays.all_off()
        self.dosing.stop_all()
        self.test_step += 1
        if self.test_step >= len(TEST_SEQUENCE):
            self.note("relay test finished")
            self.test_step = None
            self.settings["mode"] = "AUTO"
            return
        name = TEST_SEQUENCE[self.test_step]
        if name in ("A", "B"):
            self.dosing.pumps[name].on()
        elif name == "pump" and not self.values.get("water_ok", True):
            self.note("TEST: pump skipped (low water)")
        else:
            self.relays.set(name, True)
        self.note("TEST channel %s ON for 2 s" % name)
        self.test_until = now + 2

    def compute_alerts(self, low_water):
        th = self.settings["thresholds"]
        v = self.values
        a = []
        if low_water:
            a.append("LOW WATER")
        for key, lo, hi, label in (("temp", "temp_min", "temp_max", "TEMP"), ("hum", "hum_min", "hum_max", "HUMIDITY"),
                                   ("ph", "ph_min", "ph_max", "pH"), ("ec", "ec_min", "ec_max", "EC")):
            if v.get(key) is not None and not th[lo] <= v[key] <= th[hi]:
                a.append("%s %s" % (label, v[key]))
        if v.get("co2") is not None and v["co2"] > th["co2_max"]:
            a.append("CO2 %d" % v["co2"])
        for name in self.sensors.errors:
            a.append("SENSOR %s" % name.upper())
        if a != self.alerts and a:
            self.note("ALERT: " + ", ".join(a))
        self.alerts = a

    def step(self):
        now = time.time()
        if now - self.last_read >= 2:
            self.values = dict(self.sensors.read_all())
            self.last_read = now
        low_water = self.protection()
        self.dosing.update()
        if self.mode == "AUTO":
            self.automatic(low_water)
        elif self.mode == "DOSING":
            self.automatic(low_water)
            if not self.dosing.busy():
                self.settings["mode"] = "AUTO"
                self.note("dosing complete -> AUTO")
        elif self.mode == "TEST":
            self.run_test()
        self.compute_alerts(low_water)
        self.handle_touch()
        if now - self.last_screen >= 1:
            self.update_screen()
            self.last_screen = now

    # ---------------------------------------------------------------- Nextion
    def handle_touch(self):
        for ev in self.nx.events():
            if ev in ("pump", "light", "fan", "heater"):
                ok, msg = self.manual_relay(ev, not self.relays.get(ev))
                if not ok:
                    self.nx.txt("tMode", msg)
            elif ev == "auto":
                self.set_mode("AUTO")
            elif ev == "manual":
                self.set_mode("MANUAL")
            elif ev == "reset_day":
                self.reset_grow_day()
            self.last_screen = 0

    def update_screen(self):
        nx = self.nx
        v = self.values
        fmt = lambda x, f="%.1f": "--" if x is None else f % x
        if nx.page == 0:
            nx.txt("tTime", datetime.datetime.now().strftime("%H:%M:%S"))
            nx.txt("tTemp", fmt(v.get("temp")))
            nx.txt("tHum", fmt(v.get("hum"), "%.0f"))
            nx.txt("tCO2", fmt(v.get("co2"), "%d"))
            nx.txt("tPH", fmt(v.get("ph"), "%.2f"))
            nx.txt("tEC", fmt(v.get("ec"), "%.2f"))
            lvl = v.get("level") or 0
            nx.val("jLevel", max(0, min(100, lvl)))
            nx.val("nLevel", lvl)
            nx.val("nDay", self.grow_day())
            nx.txt("tMode", self.mode)
            nx.txt("tNext", self.next_irrigation())
            nx.txt("tAlarm", ", ".join(self.alerts)[:30] if self.alerts else "OK")
            nx.cmd("tAlarm.bco=%d" % (63488 if self.alerts else 2016))
        elif nx.page == 1:
            for name, comp in (("pump", "btPump"), ("light", "btLight"), ("fan", "btFan"), ("heater", "btHeat")):
                nx.val(comp, self.relays.get(name))
            nx.txt("tMode", "Mode: " + self.mode)
        elif nx.page == 2:
            th = self.settings["thresholds"]
            nx.txt("tCrop", self.settings["crop"])
            nx.txt("tThr", "T %s-%s  pH %s-%s  EC %s-%s" % (th["temp_min"], th["temp_max"], th["ph_min"], th["ph_max"], th["ec_min"], th["ec_max"]))
            nx.val("nDay", self.grow_day())

    def snapshot(self):
        return {
            "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "mode": self.mode,
            "crop": self.settings["crop"],
            "grow_day": self.grow_day(),
            "values": self.values,
            "relays": self.relays.states(),
            "dosing": {"running": self.dosing.running(), "queue": self.dosing.queue, "history": self.dosing.history[-5:]},
            "next_irrigation": self.next_irrigation(),
            "alerts": self.alerts,
            "settings": self.settings,
            "log": self.log[-8:],
        }


controller = Controller()
web.attach(controller)
threading.Thread(target=web.app.run, kwargs={"host": "0.0.0.0", "port": 5000}, daemon=True).start()
controller.note("controller started, crop %s, grow day %d" % (controller.settings["crop"], controller.grow_day()))

while True:
    controller.step()
    time.sleep(0.25)
`;

export const INDEX_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>City Farm controller</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #f2f5f3; color: #1d2a22; }
  header { background: #1c6b4a; color: #fff; padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  header h1 { font-size: 18px; margin: 0; flex: 1; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; padding: 12px; }
  .card { background: #fff; border-radius: 10px; padding: 10px 12px; box-shadow: 0 1px 3px #0002; }
  .card b { display: block; font-size: 22px; }
  .card span { color: #5a6b60; font-size: 12px; }
  section { padding: 0 12px 12px; }
  .panel { background: #fff; border-radius: 10px; padding: 12px; margin-bottom: 10px; box-shadow: 0 1px 3px #0002; }
  .panel h2 { font-size: 15px; margin: 0 0 8px; }
  button { padding: 8px 12px; border-radius: 8px; border: 1px solid #1c6b4a; background: #fff; color: #1c6b4a; font-weight: 600; margin: 2px; }
  button.on { background: #1c6b4a; color: #fff; }
  input { padding: 6px; border-radius: 6px; border: 1px solid #b9c7be; width: 80px; }
  .alerts { color: #b42318; font-weight: 700; }
  .ok { color: #1c6b4a; font-weight: 700; }
  .relay { display: inline-block; margin: 3px; padding: 5px 10px; border-radius: 99px; background: #e5ece8; }
  .relay.on { background: #2fbf71; color: #fff; }
  ul { margin: 4px 0; padding-left: 18px; font-size: 13px; }
  @media (max-width: 500px) { .grid { grid-template-columns: 1fr 1fr; } header h1 { font-size: 16px; } }
</style>
</head>
<body>
<header>
  <h1>🌱 City Farm · <span id="crop">{{ crop }}</span></h1>
  <div>🕒 <span id="time">--</span></div>
  <div>Mode: <b id="mode">--</b></div>
  <div>Day <b id="day">0</b>/40</div>
</header>
<div class="grid">
  <div class="card"><span>Air temperature</span><b id="temp">--</b></div>
  <div class="card"><span>Humidity %</span><b id="hum">--</b></div>
  <div class="card"><span>CO2 ppm</span><b id="co2">--</b></div>
  <div class="card"><span>Water level %</span><b id="level">--</b></div>
  <div class="card"><span>pH</span><b id="ph">--</b></div>
  <div class="card"><span>EC mS/cm</span><b id="ec">--</b></div>
  <div class="card"><span>Water temp °C</span><b id="wt">--</b></div>
  <div class="card"><span>Next irrigation</span><b id="next">--</b></div>
</div>
<section>
  <div class="panel"><h2>Alerts</h2><div id="alerts" class="ok">OK</div></div>
  <div class="panel"><h2>Relays</h2><div id="relays"></div>
    <div><button onclick="relay('pump')">Pump</button><button onclick="relay('light')">Light</button><button onclick="relay('fan')">Fan</button><button onclick="relay('heater')">Heater</button> <small>(MANUAL mode only)</small></div>
  </div>
  <div class="panel"><h2>Mode</h2>
    <button onclick="mode('AUTO')">Auto</button><button onclick="mode('MANUAL')">Manual</button><button onclick="post('/api/test', {})">Test relays</button>
  </div>
  <div class="panel"><h2>Fertilizer dosing</h2>
    A <input id="doseA" type="number" value="10"> ml &nbsp; B <input id="doseB" type="number" value="10"> ml
    <button onclick="dose()">Start dosing</button><div id="dosing"></div>
  </div>
  <div class="panel"><h2>Settings</h2>
    Crop <input id="setCrop" style="width:120px"> Light on <input id="lightOn" style="width:70px"> for <input id="lightHours" type="number"> h<br>
    Irrigation times <input id="irr" style="width:220px"> (comma separated) for <input id="irrMin" type="number"> min<br>
    Temp <input id="tmin" type="number"> – <input id="tmax" type="number"> °C &nbsp; pH <input id="phmin" type="number" step="0.1"> – <input id="phmax" type="number" step="0.1"> &nbsp; EC <input id="ecmin" type="number" step="0.1"> – <input id="ecmax" type="number" step="0.1">
    <div><button onclick="saveSettings()">Save settings</button><button onclick="post('/api/reset_day', {})">Reset grow day</button></div>
  </div>
  <div class="panel"><h2>Log</h2><ul id="log"></ul></div>
</section>
<script>
var last = null, filled = false;
function $(id) { return document.getElementById(id); }
function fmt(v, d) { return v === null || v === undefined ? '--' : Number(v).toFixed(d); }
function post(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json(); }).then(function (j) { if (j.message) $('dosing').textContent = j.message; refresh(); });
}
function mode(m) { post('/api/mode', { mode: m }); }
function relay(n) { post('/api/relay', { name: n, on: !(last && last.relays[n]) }); }
function dose() { post('/api/dose', { A: Number($('doseA').value), B: Number($('doseB').value) }); }
function saveSettings() {
  post('/api/settings', {
    crop: $('setCrop').value, light_on: $('lightOn').value, light_hours: Number($('lightHours').value),
    irrigation: $('irr').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    irrigation_minutes: Number($('irrMin').value),
    thresholds: { temp_min: Number($('tmin').value), temp_max: Number($('tmax').value), ph_min: Number($('phmin').value),
                  ph_max: Number($('phmax').value), ec_min: Number($('ecmin').value), ec_max: Number($('ecmax').value) }
  });
}
function refresh() {
  fetch('/api/state').then(function (r) { return r.json(); }).then(function (s) {
    last = s;
    var v = s.values;
    $('time').textContent = s.time; $('mode').textContent = s.mode; $('day').textContent = s.grow_day; $('crop').textContent = s.crop;
    $('temp').textContent = fmt(v.temp, 1); $('hum').textContent = fmt(v.hum, 0); $('co2').textContent = fmt(v.co2, 0);
    $('level').textContent = fmt(v.level, 0) + (v.water_ok ? '' : ' ⚠'); $('ph').textContent = fmt(v.ph, 2); $('ec').textContent = fmt(v.ec, 2);
    $('wt').textContent = fmt(v.water_temp, 1); $('next').textContent = s.next_irrigation;
    $('alerts').textContent = s.alerts.length ? s.alerts.join(' · ') : 'OK';
    $('alerts').className = s.alerts.length ? 'alerts' : 'ok';
    $('relays').innerHTML = Object.keys(s.relays).map(function (k) { return '<span class="relay ' + (s.relays[k] ? 'on' : '') + '">' + k + '</span>'; }).join('')
      + (s.dosing.running ? '<span class="relay on">dosing ' + s.dosing.running + '</span>' : '');
    $('log').innerHTML = s.log.map(function (l) { return '<li>' + l + '</li>'; }).join('');
    if (!filled) {
      filled = true; var st = s.settings, th = st.thresholds;
      $('setCrop').value = st.crop; $('lightOn').value = st.light_on; $('lightHours').value = st.light_hours;
      $('irr').value = st.irrigation.join(', '); $('irrMin').value = st.irrigation_minutes;
      $('tmin').value = th.temp_min; $('tmax').value = th.temp_max; $('phmin').value = th.ph_min; $('phmax').value = th.ph_max;
      $('ecmin').value = th.ec_min; $('ecmax').value = th.ec_max;
    }
  }).catch(function (e) { $('alerts').textContent = 'Controller offline: ' + e; });
}
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>
`;

/** Example 19: smaller Flask dashboard. */
export const DASH_PY = String.raw`"""Hydroponic farm dashboard: sensors + pump protection + Flask web page."""
import threading
import time

import adafruit_dht
import board
from flask import Flask, jsonify, render_template
from gpiozero import Button, MCP3008, OutputDevice

dht = adafruit_dht.DHT22(board.D16)
ph_ch, ec_ch, level_ch = MCP3008(0), MCP3008(1), MCP3008(2)
water_ok = Button(24)
pump = OutputDevice(17, active_high=False, initial_value=False)
state = {"temp": None, "hum": None, "ph": None, "ec": None, "level": None, "pump": False, "alerts": []}

app = Flask(__name__)


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/state")
def api_state():
    return jsonify(state)


def control_loop():
    while True:
        try:
            state["temp"], state["hum"] = dht.temperature, dht.humidity
        except RuntimeError:
            pass
        state["ph"] = round(3.5 * ph_ch.voltage, 2)
        state["ec"] = round(ec_ch.voltage / 0.5, 2)
        state["level"] = round(level_ch.voltage / 3.0 * 100, 1)
        alerts = []
        if water_ok.is_pressed:
            pump.on()
        else:
            pump.off()
            alerts.append("LOW WATER - pump stopped")
        if state["ph"] < 5.5 or state["ph"] > 6.5:
            alerts.append("pH out of range")
        state["pump"] = bool(pump.value)
        state["alerts"] = alerts
        time.sleep(2)


threading.Thread(target=app.run, kwargs={"host": "0.0.0.0", "port": 5000}, daemon=True).start()
control_loop()
`;

export const DASH_HTML = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Farm dashboard</title>
<style>
body{font-family:system-ui;margin:16px;background:#f4f7f5}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
.c{background:#fff;border-radius:10px;padding:10px;box-shadow:0 1px 3px #0002}.c b{font-size:24px;display:block}
#alerts{margin-top:12px;font-weight:700;color:#b42318}
</style></head>
<body>
<h1>🌿 Hydroponic farm</h1>
<div class="grid">
 <div class="c">Temp °C<b id="temp">--</b></div><div class="c">Humidity %<b id="hum">--</b></div>
 <div class="c">pH<b id="ph">--</b></div><div class="c">EC<b id="ec">--</b></div>
 <div class="c">Level %<b id="level">--</b></div><div class="c">Pump<b id="pump">--</b></div>
</div>
<div id="alerts"></div>
<script>
function upd(){fetch('/api/state').then(function(r){return r.json()}).then(function(s){
 ['temp','hum','ph','ec','level'].forEach(function(k){document.getElementById(k).textContent=s[k]===null?'--':s[k]});
 document.getElementById('pump').textContent=s.pump?'ON':'OFF';
 document.getElementById('alerts').textContent=s.alerts.join(' · ');});}
upd();setInterval(upd,2000);
</script></body></html>
`;
