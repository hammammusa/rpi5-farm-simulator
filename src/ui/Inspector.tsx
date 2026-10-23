import { getPart, hasPart, pinsOf, withDefaults } from '../engine/parts';
import { PI5_HEADER } from '../engine/pi5';
import type { PropDef } from '../engine/types';
import { WIRE_COLORS } from '../engine/project';
import { sim, useSimVersion } from '../state/engine';
import { useApp } from '../state/store';
import { issueText, useT } from '../i18n';
import { compName, pinName } from '../state/wiring';
import { IssueCard } from './Problems';

function PropInput({ def, value, onChange }: { def: PropDef; value: any; onChange: (v: any, history?: boolean) => void }) {
  if (def.type === 'boolean')
    return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} aria-label={def.label} />;
  if (def.type === 'select')
    return (
      <select value={String(value)} onChange={(e) => {
        const opt = def.options!.find((o) => String(o.value) === e.target.value);
        onChange(opt ? opt.value : e.target.value);
      }} aria-label={def.label}>
        {def.options!.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    );
  if (def.type === 'number') {
    const slider = def.min !== undefined && def.max !== undefined && def.max - def.min <= 100000;
    return (
      <div className="num-input">
        {slider && (
          <input
            type="range"
            min={def.min}
            max={def.max}
            step={def.step ?? 0.1}
            value={Number(value)}
            onChange={(e) => onChange(Number(e.target.value), false)}
            onPointerUp={() => onChange(Number(value), true)}
            aria-label={def.label}
          />
        )}
        <input
          type="number"
          min={def.min}
          max={def.max}
          step={def.step ?? 0.1}
          value={Number(value)}
          onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))}
          aria-label={`${def.label} value`}
        />
        {def.unit && <span className="unit">{def.unit}</span>}
      </div>
    );
  }
  return <input type="text" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} aria-label={def.label} />;
}

export function Inspector() {
  useSimVersion();
  const t = useT();
  const lang = useApp((s) => s.lang);
  const doc = useApp((s) => s.doc);
  const selection = useApp((s) => s.selection);
  const selectedWire = useApp((s) => s.selectedWire);
  const st = useApp.getState();

  if (selectedWire) {
    const w = doc.wires.find((x) => x.id === selectedWire);
    if (!w) return <aside className="inspector" />;
    return (
      <aside className="inspector" aria-label={t('Inspector')}>
        <div className="panel-title">{t('Wire')}</div>
        <div className="kv" dir="ltr">
          <div>{compName(doc, w.from.comp)} · {pinName(doc, w.from.comp, w.from.pin)}</div>
          <div>↓</div>
          <div>{compName(doc, w.to.comp)} · {pinName(doc, w.to.comp, w.to.pin)}</div>
        </div>
        <label className="field">
          <span>{t('Colour')}</span>
          <div className="swatches">
            {Object.entries(WIRE_COLORS).map(([n, c]) => (
              <button key={n} className={`swatch ${w.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => st.updateWire(w.id, { color: c })} aria-label={n} />
            ))}
          </div>
        </label>
        <label className="field">
          <span>{t('Label')}</span>
          <input value={w.label ?? ''} onChange={(e) => st.updateWire(w.id, { label: e.target.value || undefined })} />
        </label>
        <div className="row">
          <button onClick={() => st.updateWire(w.id, { points: undefined })}>{t('Straighten')}</button>
          <button className="danger" onClick={() => st.deleteWire(w.id)}>
            {t('Delete wire')}
          </button>
        </div>
      </aside>
    );
  }

  if (selection.length !== 1) {
    const issues = sim.issues.filter((i) => i.severity !== 'info');
    return (
      <aside className="inspector" aria-label={t('Inspector')}>
        <div className="panel-title">{selection.length > 1 ? t('{n} components selected', { n: selection.length }) : t('Circuit check')}</div>
        {selection.length > 1 && (
          <div className="row">
            <button onClick={() => st.rotateSelected()}>{t('Rotate')}</button>
            <button onClick={() => st.duplicateSelected()}>{t('Duplicate')}</button>
            <button className="danger" onClick={() => st.deleteSelected()}>
              {t('Delete')}
            </button>
          </div>
        )}
        <p className="muted small">{t('Select a part to see its pins, settings, live readings and faults.')}</p>
        <div className="stat-row">
          <span className={`pill ${issues.some((i) => i.severity === 'error') ? 'err' : issues.length ? 'warn' : 'ok'}`}>
            {issues.length ? t('{n} problems', { n: issues.length }) : t('No electrical problems found')}
          </span>
        </div>
        {issues.slice(0, 8).map((i) => (
          <IssueCard key={i.key} issue={i} compact />
        ))}
        <div className="panel-title sub">{t('Simulation scope')}</div>
        <p className="muted small">
          {t('Functional/behavioural simulation: a DC nodal solver for voltages and currents plus protocol models for GPIO, PWM, I2C, SPI, UART and 1-Wire. It is not a full SPICE or BCM2712 CPU emulation; your code runs in real CPython (Pyodide).')}
        </p>
      </aside>
    );
  }

  const c = doc.components.find((x) => x.id === selection[0]);
  if (!c || !hasPart(c.type)) return <aside className="inspector" />;
  const m = getPart(c.type);
  const props = withDefaults(m, c.props);
  const v = sim.vis.get(c.id) ?? {};
  const myIssues = sim.issues.filter((i) => i.comps.includes(c.id));
  const groups: { id: string; label: string }[] = [
    { id: 'sensor', label: 'Live values (change while running)' },
    { id: 'config', label: 'Configuration' },
    { id: 'farm', label: 'Smart Farm link' },
  ];
  const pins = pinsOf(m, props);
  return (
    <aside className="inspector" aria-label={t('Inspector')} data-testid="inspector">
      <div className="panel-title">{m.name}</div>
      <p className="muted small">{m.description}</p>
      {m.support === 'partial' && m.limits && <p className="limits small">⚠ {m.limits}</p>}
      {m.support === 'full' && m.limits && <p className="muted small">ℹ {m.limits}</p>}
      <label className="field">
        <span>{t('Label')}</span>
        <input value={c.label ?? ''} placeholder={c.id} onChange={(e) => st.setLabel(c.id, e.target.value)} />
      </label>
      {(m.voltage || m.python) && (
        <div className="kv small">
          {m.voltage && (
            <div>
              <b>{t('Voltage')}:</b> {m.voltage}
            </div>
          )}
          {m.interfaces && (
            <div>
              <b>{t('Interface')}:</b> {m.interfaces.join(', ')}
            </div>
          )}
          {m.python && (
            <div dir="ltr">
              <b>Python:</b> <code>{m.python}</code>
            </div>
          )}
        </div>
      )}
      {groups.map((g) => {
        const defs = m.props.filter((p) => (p.group ?? 'config') === g.id && (!p.visible || p.visible(props)));
        if (!defs.length && !(g.id === 'sensor' && m.props.some((p) => p.key === 'source'))) return null;
        return (
          <div key={g.id}>
            <div className="panel-title sub">{t(g.label)}</div>
            {defs.map((d) => (
              <label key={d.key} className="field" title={d.help}>
                <span>{t(d.label)}</span>
                <PropInput def={d} value={props[d.key]} onChange={(val, h = true) => st.setProp(c.id, d.key, val, h)} />
              </label>
            ))}
          </div>
        );
      })}
      {m.faults && m.faults.length > 1 && (
        <>
          <div className="panel-title sub">{t('Fault injection')}</div>
          <label className="field">
            <span>{t('Fault')}</span>
            <select value={props.fault ?? 'none'} onChange={(e) => st.setProp(c.id, 'fault', e.target.value)} data-testid="fault-select">
              {m.faults.map((f) => (
                <option key={f.id} value={f.id}>
                  {t(f.label)}
                </option>
              ))}
            </select>
          </label>
          {props.fault && props.fault !== 'none' && <p className="muted small">{m.faults.find((f) => f.id === props.fault)?.help}</p>}
        </>
      )}
      <div className="panel-title sub">{t('Live state')}</div>
      <LiveState type={c.type} v={v} />
      {myIssues.length > 0 && (
        <>
          <div className="panel-title sub">{t('Problems')}</div>
          {myIssues.map((i) => (
            <IssueCard key={i.key} issue={i} compact />
          ))}
        </>
      )}
      {c.type !== 'breadboard' && (
        <>
          <div className="panel-title sub">{t('Pins')}</div>
          <table className="pin-table" dir="ltr">
            <tbody>
              {pins.map((p) => {
                const n = sim.net.netOf({ comp: c.id, pin: p.id });
                const net = n >= 0 ? sim.net.nets[n] : null;
                const others = net ? net.pins.filter((x) => x.comp !== c.id && doc.components.find((k) => k.id === x.comp)?.type !== 'breadboard') : [];
                const vv = n >= 0 ? sim.netVoltage(n) : null;
                const label = c.type === 'rpi5' ? `${p.id.slice(1)} ${p.label}` : p.label;
                if (c.type === 'rpi5' && !others.length) return null;
                return (
                  <tr key={p.id}>
                    <td>{label}</td>
                    <td className="muted">{others.length ? others.slice(0, 2).map((x) => `${compName(doc, x.comp).split(' (')[0]}.${pinName(doc, x.comp, x.pin)}`).join(', ') : '—'}</td>
                    <td className="num">{vv !== null && others.length ? `${vv.toFixed(2)}V` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {c.type === 'rpi5' && <p className="muted small">{t('Only connected header pins are listed. Hover a pin in the workspace for details.')}</p>}
        </>
      )}
      <div className="row">
        <button onClick={() => st.rotateSelected()}>{t('Rotate')}</button>
        <button onClick={() => st.duplicateSelected()}>{t('Duplicate')}</button>
        <button className="danger" onClick={() => st.deleteSelected()}>
          {t('Delete')}
        </button>
      </div>
      {void lang}
    </aside>
  );
}

function LiveState({ type, v }: { type: string; v: Record<string, any> }) {
  const t = useT();
  const rows: [string, string][] = [];
  const n = (x: any, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—');
  switch (type) {
    case 'rpi5':
      rows.push([t('3.3 V rail'), `${n((v.i3v3 ?? 0) * 1000, 0)} mA`], [t('5 V rail'), `${n((v.i5v ?? 0) * 1000, 0)} mA`]);
      break;
    case 'led':
      rows.push([t('Current'), `${n(v.ma, 1)} mA`], [t('Brightness'), `${Math.round((v.brightness ?? 0) * 100)} %`]);
      if (v.burned) rows.push([t('State'), t('BURNED')]);
      break;
    case 'resistor':
      rows.push([t('Current'), `${n(v.ma, 2)} mA`], [t('Power'), `${n(v.mw, 1)} mW`]);
      break;
    case 'relay_module':
      (v.ch ?? []).forEach((c: any, i: number) => rows.push([`CH${i + 1}`, c.energised ? t('ON (COM–NO closed)') : t('OFF (COM–NC closed)')]));
      rows.push([t('Coil supply'), v.powered ? t('OK') : t('too low')]);
      break;
    case 'power_supply':
      rows.push([t('Output'), v.on ? t('ON') : t('OFF')], [t('Current'), `${n(v.amps, 2)} A`], [t('Power'), `${n(v.watts, 1)} W`]);
      break;
    case 'mcp3008':
      rows.push([t('Powered'), v.powered ? t('yes') : t('no')], ['VREF', `${n(v.vref)} V`]);
      (v.ch ?? []).forEach((x: number, i: number) => rows.push([`CH${i}`, `${n(x)} V`]));
      break;
    default:
      if ('run' in v) rows.push([t('Running'), v.run ? `${Math.round(Math.abs(v.run) * 100)} %${v.run < 0 ? ' ⟲' : ''}` : t('stopped')], [t('Voltage'), `${n(v.v, 1)} V`], [t('Current'), `${n(v.amps, 2)} A`]);
      if ('powered' in v) rows.push([t('Powered'), v.powered ? `${t('yes')} (${n(v.vs, 1)} V)` : t('no')]);
      if ('aout' in v) rows.push([t('Analog out'), `${n(v.aout)} V`]);
      if ('angle' in v) rows.push([t('Angle'), `${n(v.angle, 0)}°`]);
      if ('pressed' in v) rows.push([t('Pressed'), v.pressed ? t('yes') : t('no')]);
      if ('closed' in v) rows.push([t('Contact'), v.closed ? t('closed') : t('open')]);
      if ('doLow' in v) rows.push(['DO', v.doLow ? 'LOW' : 'HIGH']);
      if ('hz' in v) rows.push([t('Pulses'), `${n(v.hz, 1)} Hz`]);
  }
  if (!rows.length) return <p className="muted small">—</p>;
  return (
    <table className="pin-table" dir="ltr">
      <tbody>
        {rows.map(([k, val]) => (
          <tr key={k}>
            <td>{k}</td>
            <td className="num">{val}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function issueTitle(lang: 'en' | 'ar', code: string, params?: Record<string, any>) {
  return issueText(lang, code, params).title;
}

void PI5_HEADER;
