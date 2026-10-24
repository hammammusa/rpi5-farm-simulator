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
