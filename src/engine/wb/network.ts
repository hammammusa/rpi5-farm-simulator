// Virtual Wi-Fi LAN + MQTT sessions of the microcontrollers. The radio and TCP/IP are not
// simulated: an ESP32 "joins" the access point of a powered Wiren Board in the project when
// the SSID and password match (after a short association delay), gets an address on its LAN
// and can open MQTT sessions with that controller's broker (host = its IP or "wirenboard.local",
// port 1883). Losing power on the Wiren Board drops the network and every session.
import { SimError, type Simulator } from '../simulator';
import type { WbSystem } from './wbSystem';

/** MicroPython network.STAT_* and Arduino WL_* status codes */
export const STAT = { IDLE: 1000, CONNECTING: 1001, GOT_IP: 1010, NO_AP_FOUND: 201, WRONG_PASSWORD: 202 } as const;
const WL = { IDLE: 0, NO_SSID_AVAIL: 1, CONNECTED: 3, CONNECT_FAILED: 4, DISCONNECTED: 6 } as const;
const ASSOC_S = 1.2;

interface Wifi {
  status: number;
  ssid: string;
  key: string;
  readyAt: number;
  ap: string | null;
  ip: string;
}

interface Session {
  client: string;
  wb: string;
  inbox: { topic: string; payload: string }[];
}

export class VirtualNetwork {
  private wifi = new Map<string, Wifi>();
  private sessions = new Map<string, Map<string, Session>>();
  private lastClient = new Map<string, string>();
  private nextHost = 50;

  constructor(private sim: Simulator) {}

  private aps(): { wb: WbSystem; ssid: string; pass: string; ip: string }[] {
    const out = [];
    for (const wb of this.sim.wb.values()) {
      if (!wb.powered()) continue;
      const p = this.sim.propsOf(this.sim.comp(wb.id)!);
      out.push({ wb, ssid: String(p.wifiSsid ?? 'WirenBoard-AP'), pass: String(p.wifiPass ?? 'wirenboard'), ip: String(p.ip ?? '192.168.42.1') });
    }
    return out;
  }

  private state(id: string): Wifi {
    let w = this.wifi.get(id);
    if (!w) this.wifi.set(id, (w = { status: STAT.IDLE, ssid: '', key: '', readyAt: 0, ap: null, ip: '0.0.0.0' }));
    return w;
  }

  connectWifi(id: string, ssid: string, key: string, t: number) {
    const w = this.state(id);
    this.dropSessions(id);
    Object.assign(w, { status: STAT.CONNECTING, ssid, key, readyAt: t + ASSOC_S, ap: null, ip: '0.0.0.0' });
    this.sim.pyEvent('bus', `${id}: Wi-Fi connecting to "${ssid}"`);
  }

  disconnectWifi(id: string) {
    this.dropSessions(id);
    Object.assign(this.state(id), { status: STAT.IDLE, ap: null, ip: '0.0.0.0' });
  }

  /** association finishes after a short delay; a vanished access point drops the station */
  private update(id: string, t: number) {
    const w = this.state(id);
    if (w.status === STAT.CONNECTING && t >= w.readyAt) {
      const ap = this.aps().find((a) => a.ssid === w.ssid);
      if (!ap) w.status = STAT.NO_AP_FOUND;
      else if (ap.pass && ap.pass !== w.key) w.status = STAT.WRONG_PASSWORD;
      else {
        w.status = STAT.GOT_IP;
        w.ap = ap.wb.id;
        const base = ap.ip.split('.').slice(0, 3).join('.');
        w.ip = `${base}.${this.nextHost++}`;
        ap.wb.addLog('info', 'hostapd', `station ${id} associated, DHCP lease ${w.ip}`, t);
        this.sim.pyEvent('bus', `${id}: Wi-Fi connected to "${w.ssid}", IP ${w.ip}`);
      }
    }
    if (w.status === STAT.GOT_IP && !this.aps().some((a) => a.wb.id === w.ap)) {
      w.status = STAT.NO_AP_FOUND;
      w.ap = null;
      w.ip = '0.0.0.0';
      this.dropSessions(id);
    }
    return w;
  }

  wifiStatus(id: string, t: number) {
    const w = this.update(id, t);
    const ap = this.aps().find((a) => a.wb.id === w.ap);
    const gw = ap?.ip ?? '0.0.0.0';
    const wl = w.status === STAT.GOT_IP ? WL.CONNECTED : w.status === STAT.NO_AP_FOUND ? WL.NO_SSID_AVAIL : w.status === STAT.WRONG_PASSWORD ? WL.CONNECT_FAILED : w.status === STAT.CONNECTING ? WL.DISCONNECTED : WL.IDLE;
    return { status: w.status, wl, rssi: w.status === STAT.GOT_IP ? -52 : 0, ip: w.ip, ifconfig: [w.ip, '255.255.255.0', gw, gw] };
  }

  scan() {
    return this.aps().map((a, i) => ({ ssid: a.ssid, channel: 6 + i, rssi: -48 - i * 7 }));
  }

  // ---------------------------------------------------------------- MQTT sessions
  private wbFor(id: string, host: string, port: number, t: number): WbSystem {
    const w = this.update(id, t);
    if (w.status !== STAT.GOT_IP) throw new SimError('OSError', '[Errno 113] EHOSTUNREACH (Wi-Fi is not connected)');
    const ap = this.aps().find((a) => a.wb.id === w.ap)!;
    const names = [ap.ip, 'wirenboard.local', 'wirenboard', `${ap.wb.id}.local`];
    if (!names.includes(host)) throw new SimError('OSError', `[Errno 113] EHOSTUNREACH (no broker at ${host}; the Wiren Board is ${ap.ip})`);
    if (port !== 1883) throw new SimError('OSError', `[Errno 104] ECONNRESET (nothing listens on port ${port}; MQTT uses 1883)`);
    return ap.wb;
  }

  mqttConnect(id: string, client: string, host: string, port: number, t: number) {
    const wb = this.wbFor(id, host, port || 1883, t);
    const cid = client || `esp32-${id}`;
    const ses: Session = { client: cid, wb: wb.id, inbox: [] };
    // MQTT: a second connection with the same client id takes over the session
    wb.broker.connect(cid, (m) => {
      ses.inbox.push({ topic: m.topic, payload: m.payload });
      if (ses.inbox.length > 200) ses.inbox.shift();
      this.sim.controllers.get(id)?.pushEvent({ k: 'mqtt', topic: m.topic, payload: m.payload, t: m.t, client: cid } as any);
    });
    let s = this.sessions.get(id);
    if (!s) this.sessions.set(id, (s = new Map()));
    s.set(cid, ses);
    this.lastClient.set(id, cid);
    wb.addLog('info', 'mosquitto', `New client connected from ${this.state(id).ip} as ${cid}`, t);
    return 0;
  }

  private session(id: string, client?: string): Session {
    const cid = client ?? this.lastClient.get(id);
    const ses = cid ? this.sessions.get(id)?.get(cid) : undefined;
    const wb = ses && this.sim.wb.get(ses.wb);
    if (!ses || !wb || !wb.broker.isConnected(ses.client)) throw new SimError('OSError', '[Errno 128] ENOTCONN (MQTT client is not connected)');
    return ses;
  }

  connected(id: string, client?: string) {
    try {
      this.session(id, client);
      return true;
    } catch {
      return false;
    }
  }

  publish(id: string, topic: string, payload: string, retain: boolean, t: number, client?: string) {
    const ses = this.session(id, client);
    try {
      this.sim.wb.get(ses.wb)!.broker.publish(ses.client, topic, payload, retain, t);
    } catch (e: any) {
      throw new SimError('ValueError', e.message);
    }
  }

  subscribe(id: string, topic: string, t: number, client?: string) {
    const ses = this.session(id, client);
    try {
      this.sim.wb.get(ses.wb)!.broker.subscribe(ses.client, topic, t);
    } catch (e: any) {
      throw new SimError('ValueError', e.message);
    }
  }

  unsubscribe(id: string, topic: string, client?: string) {
    const ses = this.session(id, client);
    this.sim.wb.get(ses.wb)!.broker.unsubscribe(ses.client, topic);
  }

  /** next queued message of the controller's session (Arduino PubSubClient.loop) */
  next(id: string, client?: string) {
    try {
      return this.session(id, client).inbox.shift() ?? null;
    } catch {
      return null;
    }
  }

  mqttDisconnect(id: string, client?: string) {
    const cid = client ?? this.lastClient.get(id);
    const ses = cid ? this.sessions.get(id)?.get(cid) : undefined;
    if (!ses) return;
    this.sim.wb.get(ses.wb)?.broker.disconnect(ses.client);
    this.sessions.get(id)!.delete(ses.client);
  }

  private dropSessions(id: string) {
    for (const ses of this.sessions.get(id)?.values() ?? []) this.sim.wb.get(ses.wb)?.broker.disconnect(ses.client);
    this.sessions.delete(id);
  }

  /** the program on a controller ended: its station and sessions go away */
  dropController(id: string) {
    this.dropSessions(id);
    this.wifi.delete(id);
    this.lastClient.delete(id);
  }

  reset() {
    for (const id of [...this.wifi.keys()]) this.dropController(id);
    this.sessions.clear();
    this.nextHost = 50;
  }
}
