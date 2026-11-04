// Protocol and program monitors for the dock: I2C/SPI traffic, sensor values
// delivered to Python, and the sequence of Python execution events.
import { useEffect, useRef, useState } from 'react';
import { sim, useSimVersion } from '../state/engine';
import { useApp } from '../state/store';
import { useT } from '../i18n';
import { compName } from '../state/wiring';

const time = (t: number) => new Date(t * 1000).toISOString().slice(11, 23);
const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

function useAutoScroll() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  });
  return ref;
}

export function BusMonitor() {
  useSimVersion();
  const t = useT();
  const [bus, setBus] = useState<'' | 'I2C1' | 'SPI0'>('');
  const ref = useAutoScroll();
  const rows = sim.busLog.filter((e) => !bus || e.bus === bus).slice(-300);
  return (
    <div className="monitor" data-testid="bus-monitor">
      <div className="row">
        <span className="muted small">{t('Every I2C and SPI transaction between the Pi and the devices: address, direction and bytes.')}</span>
        <select value={bus} onChange={(e) => setBus(e.target.value as typeof bus)} aria-label={t('Bus')}>
          <option value="">I2C + SPI</option>
          <option value="I2C1">I2C1</option>
          <option value="SPI0">SPI0</option>
        </select>
        <button onClick={() => (sim.busLog = [])}>{t('Clear')}</button>
      </div>
      <div className="mon-log" ref={ref} dir="ltr">
        {!rows.length && <p className="muted">{t('No bus traffic yet — run a program that talks to an I2C or SPI device.')}</p>}
        <table className="data-table">
          <tbody>
            {rows.map((e, i) => (
              <tr key={i} className={e.note ? 'row-warn' : ''} data-bus={e.bus}>
                <td className="muted">{time(e.t)}</td>
                <td>{e.bus}</td>
                <td>{e.addr}</td>
                <td>{e.dir === 'w' ? 'WRITE →' : e.dir === 'r' ? '← READ' : '⇄'}</td>
                <td>
                  <code>{hex(e.bytes)}</code>
                </td>
                <td>{e.peer}</td>
                <td className="muted">{e.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SensorMonitor() {
  useSimVersion();
  const t = useT();
  const doc = useApp((s) => s.doc);
  const ref = useAutoScroll();
  const last = new Map<string, { t: number; what: string; value: string }>();
  for (const r of sim.readLog) last.set(`${r.comp}|${r.what}`, r);
  return (
    <div className="monitor" data-testid="sensor-monitor">
      <div className="row">
        <span className="muted small">{t('Values the simulated sensors delivered to your Python program (latest first, then the full history).')}</span>
        <button onClick={() => (sim.readLog = [])}>{t('Clear')}</button>
      </div>
      <div className="mon-cards">
        {[...last.entries()].map(([k, r]) => (
          <div key={k} className="mon-card" data-sensor={k.split('|')[0]}>
            <div className="muted small">{compName(doc, k.split('|')[0])}</div>
            <b dir="ltr">{r.value}</b>
            <div className="muted small">
              {r.what} · {time(r.t)}
            </div>
          </div>
        ))}
        {!last.size && <p className="muted">{t('No sensor has been read yet.')}</p>}
      </div>
      <div className="mon-log" ref={ref} dir="ltr">
        {sim.readLog.slice(-200).map((r, i) => (
          <div key={i}>
            <span className="muted">{time(r.t)}</span> <b>{compName(doc, r.comp)}</b> {r.what}: {r.value}
          </div>
        ))}
      </div>
    </div>
  );
}

const ICON = { run: '▶', import: '📦', gpio: '⚡', bus: '🔌', error: '⛔', end: '■' } as const;

export function EventMonitor() {
  useSimVersion();
  const t = useT();
  const ref = useAutoScroll();
  return (
    <div className="monitor" data-testid="event-monitor">
      <div className="row">
        <span className="muted small">{t('What your program did, in order: start, imported libraries, pins it claimed, buses it opened, errors and the end.')}</span>
        <button onClick={() => (sim.pyEvents = [])}>{t('Clear')}</button>
      </div>
      <div className="mon-log" ref={ref} dir="ltr">
        {!sim.pyEvents.length && <p className="muted">{t('Run the program to see its events.')}</p>}
        {sim.pyEvents.map((e, i) => (
          <div key={i} className={`ev ev-${e.kind}`} data-kind={e.kind}>
            <span className="muted">{time(e.t)}</span> {ICON[e.kind]} {e.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

/** MQTT broker of a Wiren Board: devices and controls (live, writable ones clickable), message log, publish */
export function MqttMonitor() {
  useSimVersion();
  const t = useT();
  const ref = useAutoScroll();
  const wbs = [...sim.wb.values()];
  const [sel, setSel] = useState('');
  const [topic, setTopic] = useState('/devices/wb-gpio/controls/A1_OUT/on');
  const [payload, setPayload] = useState('1');
  const [retain, setRetain] = useState(false);
  const [err, setErr] = useState('');
  const wb = wbs.find((w) => w.id === sel) ?? wbs[0];
  if (!wb) return <div className="monitor muted">{t('Add a Wiren Board 7.4 to the project: its MQTT broker carries the devices of every controller (ESP32 boards publish to it over Wi-Fi).')}</div>;
  if (!wb.powered()) return <div className="monitor muted">{t('The Wiren Board is not powered: connect 9…48 V DC to V+ and GND. Its MQTT broker runs only while it is on.')}</div>;
  const now = () => sim.clock.now();
  const pub = (tp: string, pl: string, r = false) => {
    try {
      wb.broker.publish('ui', tp, pl, r, now());
      setErr('');
    } catch (e: any) {
      setErr(e.message);
    }
  };
  // /devices/<dev>/controls/<ctl> → value, with type / readonly / error from the meta topics
  const devices = new Map<string, { ctl: string; value: string; type: string; readonly: boolean; error: string }[]>();
  const ret = wb.broker.retained;
  for (const [tp, m] of ret) {
    const mm = /^\/devices\/([^/]+)\/controls\/([^/]+)$/.exec(tp);
    if (!mm) continue;
    const list = devices.get(mm[1]) ?? [];
    list.push({ ctl: mm[2], value: m.payload, type: ret.get(tp + '/meta/type')?.payload ?? '', readonly: ret.get(tp + '/meta/readonly')?.payload === '1', error: ret.get(tp + '/meta/error')?.payload ?? '' });
    devices.set(mm[1], list);
  }
  return (
    <div className="monitor mqtt-monitor" data-testid="mqtt-monitor">
      <div className="row">
        {wbs.length > 1 && (
          <select value={wb.id} onChange={(e) => setSel(e.target.value)}>
            {wbs.map((w) => (
              <option key={w.id} value={w.id}>
                {w.id}
              </option>
            ))}
          </select>
        )}
        <span className="muted small">
          {t('Broker')} {String(sim.propsOf(sim.comp(wb.id)!).ip ?? '192.168.42.1')}:1883 · {t('clients')}: {wb.broker.clientIds().join(', ')}
        </span>
      </div>
      <div className="mqtt-cols">
        <div className="mqtt-devices" dir="ltr">
          {[...devices.entries()].map(([dev, ctls]) => (
            <div key={dev} className="mqtt-dev">
              <div className="mqtt-dev-name">{dev}</div>
              {ctls.map((c) => (
                <div key={c.ctl} className={'mqtt-ctl' + (c.error ? ' err' : '')} data-topic={`/devices/${dev}/controls/${c.ctl}`}>
                  <span>{c.ctl}</span>
                  {c.type === 'switch' && !c.readonly ? (
                    <button className={'small ' + (c.value === '1' ? 'on' : '')} onClick={() => pub(`/devices/${dev}/controls/${c.ctl}/on`, c.value === '1' ? '0' : '1')}>
                      {c.value === '1' ? 'ON' : 'OFF'}
                    </button>
                  ) : (
                    <b>{c.type === 'switch' ? (c.value === '1' ? 'ON' : 'OFF') : c.value}</b>
                  )}
                  {c.error && <span className="muted small"> ⚠ {c.error === 'r' ? t('read error') : c.error === 'w' ? t('write error') : c.error}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="mon-log" ref={ref} dir="ltr">
          {wb.broker.log.slice(-150).map((m, i) => (
            <div key={i} className="ev">
              <span className="muted">{time(m.t)}</span> <span className="muted">{m.from}</span> {m.topic} <b>{m.payload}</b>
              {m.retain ? <span className="muted"> (retained)</span> : null}
            </div>
          ))}
        </div>
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          pub(topic, payload, retain);
        }}
      >
        <input value={topic} onChange={(e) => setTopic(e.target.value)} dir="ltr" aria-label={t('Topic')} style={{ flex: 2 }} />
        <input value={payload} onChange={(e) => setPayload(e.target.value)} dir="ltr" aria-label={t('Payload')} style={{ flex: 1 }} />
        <label className="small">
          <input type="checkbox" checked={retain} onChange={(e) => setRetain(e.target.checked)} /> retain
        </label>
        <button type="submit">{t('Publish')}</button>
        {err && <span className="err small">{err}</span>}
      </form>
    </div>
  );
}
