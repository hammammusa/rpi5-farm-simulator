import { useEffect, useRef, useState } from 'react';
import { BCM_TO_PHYS, HARDWARE_PWM_PINS } from '../engine/pi5';
import { sim, submitStdin, useSimVersion } from '../state/engine';
import { useApp, type DockTab } from '../state/store';
import { issueText, pyErrorText, useT } from '../i18n';
import { compName } from '../state/wiring';
import { BusMonitor, EventMonitor, SensorMonitor } from './Monitors';
import { Problems } from './Problems';
import { getPart } from '../engine/parts';
import type { SerialTerminal } from '../engine/devices/serialTerm';
import { CodePane } from './CodePane';

export function Terminal() {
  const t = useT();
  const term = useApp((s) => s.term);
  const pyError = useApp((s) => s.pyError);
  const stdinPending = useApp((s) => s.stdinPending);
  const lang = useApp((s) => s.lang);
  const ref = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [term, pyError]);
  return (
    <div className="terminal-wrap">
      <div className="terminal" ref={ref} dir="ltr" data-testid="terminal" role="log" aria-live="polite">
        {term.map((l, i) => (
          <span key={i} className={`t-${l.kind}`}>
            {l.text}
          </span>
        ))}
        {pyError && (
          <div className="py-error" data-testid="py-error">
            <div className="py-error-title">
              {pyError.type}: {pyError.message}
            </div>
            {pyError.line && (
              <div>
                {t('Line')} {pyError.line} {t('in')} {pyError.file}
              </div>
            )}
            <div className="py-error-hint" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
              💡 {pyErrorText(lang, pyError.type) || t('Read the last line of the traceback: it names the error type and the problem.')}
            </div>
          </div>
        )}
      </div>
      {stdinPending && (
        <form
          className="stdin"
          onSubmit={(e) => {
            e.preventDefault();
            submitStdin(input);
            setInput('');
          }}
        >
          <span>input() ›</span>
          <input autoFocus value={input} onChange={(e) => setInput(e.target.value)} aria-label={t('Program input')} dir="ltr" />
          <button type="submit">{t('Send')}</button>
        </form>
      )}
    </div>
  );
}

export function GpioMonitor() {
  useSimVersion();
  const t = useT();
  const doc = useApp((s) => s.doc);
  const [onlyUsed, setOnlyUsed] = useState(true);
  const pi = doc.components.find((c) => c.type === 'rpi5');
  const piVis = pi ? sim.vis.get(pi.id) : undefined;
  const rows = sim.gpioStateTable().map((r) => {
    const netId = sim.net.gpioNet.get(r.bcm);
    const net = netId === undefined ? null : sim.net.nets[netId];
    const attached = net ? [...net.comps].filter((c) => c !== pi?.id).map((c) => compName(doc, c)) : [];
    const ma: number | undefined = piVis?.gpio?.[r.bcm]?.ma;
    const issues = netId === undefined ? [] : sim.issues.filter((i) => i.pins?.some((p) => sim.net.netOf(p) === netId));
    const driving = r.mode === 'output' || r.mode === 'pwm';
    const state = !attached.length
      ? t('not connected')
      : driving
        ? `${t('driving')}${ma !== undefined ? ` ${ma.toFixed(1)} mA` : ''}`
        : r.mode === 'alt'
          ? t('bus')
          : r.v === null
            ? t('floating')
            : t('input');
    return { ...r, attached, state, issues };
  });
  const shown = onlyUsed ? rows.filter((r) => r.owner || r.attached.length || r.mode !== 'input') : rows;
  return (
    <div className="gpio-monitor" data-testid="gpio-monitor">
      <label className="small">
        <input type="checkbox" checked={onlyUsed} onChange={(e) => setOnlyUsed(e.target.checked)} data-testid="gpio-only-used" /> {t('Only pins that are wired or used by the code')}
      </label>
      <table className="data-table" dir="ltr">
        <thead>
          <tr>
            <th>BCM</th>
            <th>{t('Pin')}</th>
            <th>{t('Mode')}</th>
            <th>{t('Level')}</th>
            <th>{t('Voltage')}</th>
            <th>{t('Pull')}</th>
            <th>PWM</th>
            <th>{t('Used by')}</th>
            <th>{t('Attached component')}</th>
            <th>{t('Electrical state')}</th>
            <th>{t('Warnings')}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.bcm} className={`${r.owner ? 'used' : ''} ${r.issues.some((i) => i.severity === 'error') ? 'row-err' : r.issues.length ? 'row-warn' : ''}`} data-gpio={r.bcm}>
              <td>GPIO{r.bcm}</td>
              <td>{BCM_TO_PHYS[r.bcm]}</td>
              <td>{r.mode === 'alt' ? r.alt : r.mode.toUpperCase()}</td>
              <td className={r.level ? 'lvl-hi' : 'lvl-lo'}>{r.mode === 'pwm' ? '~' : r.level ? 'HIGH' : 'LOW'}</td>
              <td className="num">{r.v === null ? '—' : `${r.v.toFixed(2)} V`}</td>
              <td>{r.mode === 'input' ? r.pull : ''}</td>
              <td>{r.mode === 'pwm' ? `${Math.round(r.pwmDuty * 100)}% @ ${r.pwmFreq}Hz${HARDWARE_PWM_PINS.includes(r.bcm) ? ' (HW)' : ''}` : ''}</td>
              <td className="muted">{r.owner ?? ''}</td>
              <td data-testid={`gpio-attached-${r.bcm}`}>{r.attached.join(', ') || '—'}</td>
              <td>{r.state}</td>
              <td className="small">{r.issues.map((i) => `${i.severity === 'error' ? '⛔' : '⚠'} ${issueText(lang(), i.code, i.params).title}`).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const lang = () => useApp.getState().lang;

const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const ascii = (b: number[]) => b.map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '·')).join('');

export function UartMonitor() {
  useSimVersion();
  const t = useT();
  const doc = useApp((s) => s.doc);
  const [mode, setMode] = useState<'hex' | 'ascii'>('hex');
  const [text, setText] = useState('');
  const terms = doc.components.filter((c) => c.type === 'usb_serial');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  });
  return (
    <div className="uart-monitor" data-testid="uart-monitor">
      <div className="row">
        <span className="muted small">{t('Every byte on the simulated UART wires (Pi TX → device, device → Pi RX).')}</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as any)} aria-label={t('Display mode')}>
          <option value="hex">HEX</option>
          <option value="ascii">ASCII</option>
        </select>
        <button onClick={() => (sim.uartLog = [])}>{t('Clear')}</button>
      </div>
      <div className="uart-log" ref={ref} dir="ltr">
        {sim.uartLog.slice(-300).map((e, i) => (
          <div key={i} className={`uart-${e.dir}`}>
            <span className="muted">{new Date(e.t * 1000).toISOString().slice(11, 23)}</span> <b>{e.dir === 'tx' ? `Pi ${e.port} → ${e.peer}` : `${e.peer} → Pi ${e.port}`}</b>{' '}
            <code>{mode === 'hex' ? hex(e.bytes) : ascii(e.bytes)}</code>
            {e.note && <span className="uart-note"> ⚠ {e.note}</span>}
          </div>
        ))}
      </div>
      {terms.map((c) => {
        const d = sim.device(c.id) as SerialTerminal | null;
        return (
          <div key={c.id} className="serial-term">
            <div className="muted small">{t('PC serial terminal')} ({c.label || getPart(c.type).name})</div>
            <pre dir="ltr">{d?.view().text.slice(-2000)}</pre>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sim.serialType(c.id, text + '\n');
                setText('');
              }}
              className="row"
            >
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Type and press Enter to send to the Pi')} dir="ltr" />
              <button type="submit">{t('Send')}</button>
            </form>
          </div>
        );
      })}
    </div>
  );
}

export function Logs() {
  useSimVersion();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  });
  return (
    <div className="logs" ref={ref} dir="ltr" data-testid="logs">
      {sim.logs.slice(-300).map((l, i) => (
        <div key={i} className={`log-${l.level}`}>
          <span className="muted">{new Date(l.t * 1000).toISOString().slice(11, 23)}</span> {l.msg}
        </div>
      ))}
    </div>
  );
}

export function Dock({ withCode = true }: { withCode?: boolean }) {
  useSimVersion();
  const t = useT();
  const tab = useApp((s) => s.dockTab);
  const open = useApp((s) => s.dockOpen);
  const errs = sim.issues.filter((i) => i.severity === 'error').length;
  const warns = sim.issues.filter((i) => i.severity === 'warning').length;
  const [h, setH] = useState(() => Number(localStorageGet('rpi5sim.dockH') ?? 280));
  const mode = useApp((s) => s.mode);
  // Beginner mode keeps the essentials (never hides problems); Advanced adds protocol inspection and logs
  const tabs: [DockTab, string][] = [
    ...(withCode ? ([['code', 'Code']] as [DockTab, string][]) : []),
    ['terminal', 'Terminal'],
    ['problems', 'Problems'],
    ['gpio', 'GPIO monitor'],
    ['sensors', 'Sensor readings'],
    ['events', 'Python events'],
    ['uart', 'UART monitor'],
    ...(mode === 'advanced'
      ? ([
          ['bus', 'I2C / SPI monitor'],
          ['logs', 'Simulation log'],
        ] as [DockTab, string][])
      : []),
  ];
  const cur = (!withCode && tab === 'code') || !tabs.some(([id]) => id === tab) ? 'terminal' : tab;
  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY;
    const h0 = h;
    const move = (ev: PointerEvent) => setH(Math.max(120, Math.min(window.innerHeight - 160, h0 + y0 - ev.clientY)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      localStorageSet('rpi5sim.dockH', String(h));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <section className={`dock ${open ? '' : 'closed'}`} style={{ height: open ? h : undefined }} aria-label={t('Development tools')}>
      {open && <div className="resize-h" onPointerDown={startResize} role="separator" aria-orientation="horizontal" />}
      <div className="dock-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={cur === id && open} className={cur === id && open ? 'on' : ''} onClick={() => useApp.getState().setDock(id, cur === id ? !open : true)} data-testid={`dock-${id}`}>
            {t(label)}
            {id === 'problems' && (errs || warns) ? <span className={`count ${errs ? 'err' : 'warn'}`}>{errs + warns}</span> : null}
          </button>
        ))}
        <span className="flex" />
        <button onClick={() => useApp.getState().toggleDock()} aria-label={open ? t('Collapse panel') : t('Expand panel')}>
          {open ? '▾' : '▴'}
        </button>
      </div>
      {open && (
        <div className="dock-body">
          {cur === 'code' && <CodePane compact />}
          {cur === 'terminal' && <Terminal />}
          {cur === 'problems' && <Problems />}
          {cur === 'gpio' && <GpioMonitor />}
          {cur === 'uart' && <UartMonitor />}
          {cur === 'logs' && <Logs />}
          {cur === 'bus' && <BusMonitor />}
          {cur === 'sensors' && <SensorMonitor />}
          {cur === 'events' && <EventMonitor />}
        </div>
      )}
    </section>
  );
}

function localStorageGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localStorageSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
