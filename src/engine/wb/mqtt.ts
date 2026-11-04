// Virtual MQTT broker (the Mosquitto broker that runs on the Wiren Board). Topic filters with
// `+` and `#`, retained messages, per-client subscriptions and a message log for the UI.
// Delivery is synchronous inside the simulation; QoS 0 semantics (no persistence/queues).

export interface MqttMessage {
  topic: string;
  payload: string;
  retain: boolean;
  /** client id of the publisher */
  from: string;
  t: number;
}

export type MqttHandler = (m: MqttMessage) => void;

export function topicMatches(filter: string, topic: string): boolean {
  if (filter === '#') return !topic.startsWith('$');
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

export function validTopic(topic: string, filter = false) {
  if (!topic || topic.length > 65535 || topic.includes('\0')) return false;
  if (!filter) return !/[+#]/.test(topic);
  const parts = topic.split('/');
  return parts.every((p, i) => (p.includes('#') ? p === '#' && i === parts.length - 1 : !p.includes('+') || p === '+'));
}

interface Client {
  id: string;
  subs: Set<string>;
  handler: MqttHandler;
}

export class MqttBroker {
  private clients = new Map<string, Client>();
  retained = new Map<string, MqttMessage>();
  log: MqttMessage[] = [];
  /** bumps on every message (UI refresh) */
  version = 0;

  connect(id: string, handler: MqttHandler) {
    this.clients.set(id, { id, subs: new Set(), handler });
  }

  disconnect(id: string) {
    this.clients.delete(id);
  }

  isConnected(id: string) {
    return this.clients.has(id);
  }

  clientIds() {
    return [...this.clients.keys()];
  }

  subscribe(id: string, filter: string, t: number) {
    const c = this.clients.get(id);
    if (!c) throw new Error('not connected');
    if (!validTopic(filter, true)) throw new Error(`invalid topic filter "${filter}"`);
    c.subs.add(filter);
    // retained messages matching the new subscription are delivered at once
    for (const m of this.retained.values()) if (topicMatches(filter, m.topic)) c.handler({ ...m, t });
  }

  unsubscribe(id: string, filter: string) {
    this.clients.get(id)?.subs.delete(filter);
  }

  publish(from: string, topic: string, payload: string, retain: boolean, t: number) {
    if (!validTopic(topic)) throw new Error(`invalid topic "${topic}"`);
    const m: MqttMessage = { topic, payload, retain, from, t };
    if (retain) {
      if (payload === '') this.retained.delete(topic);
      else this.retained.set(topic, m);
    }
    this.log.push(m);
    if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
    this.version++;
    for (const c of [...this.clients.values()]) {
      if ([...c.subs].some((f) => topicMatches(f, topic))) c.handler({ ...m, retain: false });
    }
  }

  reset() {
    this.clients.clear();
    this.retained.clear();
    this.log = [];
    this.version++;
  }
}
