# umqtt.simple (micropython-lib API): MQTT 3.1.1 client over the virtual network. Messages go
# through the virtual broker (the Mosquitto of a Wiren Board in the project); subscribed
# messages are delivered by check_msg()/wait_msg() or while the program sleeps.
from _sched import call
import _sched


class MQTTException(Exception):
    pass


def _s(x):
    return x.decode() if isinstance(x, (bytes, bytearray)) else str(x)


class MQTTClient:
    def __init__(self, client_id, server, port=0, user=None, password=None, keepalive=0, ssl=False, ssl_params={}):
        self.client_id = _s(client_id)
        self.server = _s(server)
        self.port = port or 1883
        self.user = user
        self.pswd = password
        self.keepalive = keepalive
        self._cb = None
        self._inbox = []
        self._lw = None

    def set_callback(self, f):
        self._cb = f

    def set_last_will(self, topic, msg, retain=False, qos=0):
        self._lw = (_s(topic), _s(msg), retain)

    def connect(self, clean_session=True):
        rc = call('mqtt.connect', client=self.client_id, host=self.server, port=self.port, user=_s(self.user) if self.user else None, password=_s(self.pswd) if self.pswd else None, will=self._lw)
        if rc:
            raise MQTTException(rc)
        if self not in _sched._mqtt:
            _sched._mqtt.append(self)
        return 0

    def disconnect(self):
        call('mqtt.disconnect', client=self.client_id)
        if self in _sched._mqtt:
            _sched._mqtt.remove(self)

    def ping(self):
        call('mqtt.ping', client=self.client_id)

    def publish(self, topic, msg, retain=False, qos=0):
        call('mqtt.publish', client=self.client_id, topic=_s(topic), payload=_s(msg), retain=bool(retain))

    def subscribe(self, topic, qos=0):
        call('mqtt.subscribe', client=self.client_id, topic=_s(topic))

    def _deliver(self, topic, payload):
        self._inbox.append((topic, payload))

    def _drain(self):
        while self._inbox:
            topic, payload = self._inbox.pop(0)
            if self._cb:
                self._cb(topic.encode(), payload.encode())

    def check_msg(self):
        _sched._run_events()
        call('mqtt.ping', client=self.client_id)
        self._drain()

    def wait_msg(self):
        while not self._inbox:
            _sched.wait_ms(50)
            call('mqtt.ping', client=self.client_id)
        self._drain()
