# network module (MicroPython ESP32 API), station interface only. The radio is not simulated:
# the board joins the virtual Wi-Fi access point of a Wiren Board in the same project (SSID and
# password from that controller's settings) and gets an address on its LAN.
from _sched import call
import _sched

STA_IF = 0
AP_IF = 1
STAT_IDLE = 1000
STAT_CONNECTING = 1001
STAT_GOT_IP = 1010
STAT_NO_AP_FOUND = 201
STAT_WRONG_PASSWORD = 202
STAT_BEACON_TIMEOUT = 200
STAT_ASSOC_FAIL = 203
STAT_HANDSHAKE_TIMEOUT = 204


class WLAN:
    def __init__(self, interface_id=STA_IF):
        if interface_id != STA_IF:
            raise NotImplementedError('only the station interface (STA_IF) is simulated')
        self._active = False

    def active(self, is_active=None):
        if is_active is None:
            return self._active
        self._active = bool(is_active)
        if not self._active:
            call('wifi.disconnect')

    def connect(self, ssid=None, key=None, *, bssid=None):
        if not self._active:
            raise OSError('Wifi Not Started')
        call('wifi.connect', ssid=ssid, key=key or '')

    def disconnect(self):
        call('wifi.disconnect')

    def isconnected(self):
        return call('wifi.status')['status'] == STAT_GOT_IP

    def status(self, param=None):
        st = call('wifi.status')
        if param == 'rssi':
            return st.get('rssi', 0)
        return st['status']

    def ifconfig(self, config=None):
        st = call('wifi.status')
        return tuple(st.get('ifconfig', ('0.0.0.0', '0.0.0.0', '0.0.0.0', '0.0.0.0')))

    def scan(self):
        return [(a['ssid'].encode(), b'\x00' * 6, a['channel'], a['rssi'], 3, False) for a in call('wifi.scan')]

    def config(self, *args, **kw):
        if args and args[0] == 'mac':
            return bytes(call('board.uid'))
        return None


def hostname(name=None):
    return 'esp32'
