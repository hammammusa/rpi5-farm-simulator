import { getPart, hasPart, pinsOf, withDefaults } from '../engine/parts';
import { PI5_HEADER } from '../engine/pi5';
import type { PropDef } from '../engine/types';
import { WIRE_COLORS, WIRE_WIDTHS } from '../engine/project';
import type { WireRoute } from '../engine/types';
import { snap } from '../engine/geometry';
import { sim, useSimVersion } from '../state/engine';
import { pinPosition, useApp, viewOf } from '../state/store';
import { issueText, useT } from '../i18n';
import { compName, pinName } from '../state/wiring';
import { IssueCard } from './Problems';
import { PartInspector } from './PartInspector';

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
    const vs = viewOf(doc);
    const netId = sim.net.netOf(w.from);
    const net = netId >= 0 ? sim.net.nets[netId] : null;
    const members = net ? net.pins.filter((p) => doc.components.find((k) => k.id === p.comp)?.type !== 'breadboard') : [];
    const volts = netId >= 0 ? sim.netVoltage(netId) : null;
    const mid = () => {
      const a = pinPosition(doc, w.from);
      const b = pinPosition(doc, w.to);
      if (!a || !b) return { x: 0, y: 0 };
      const pts = [a, ...(w.points ?? []), b];
      const i = Math.floor((pts.length - 1) / 2);
      return { x: snap((pts[i].x + pts[i + 1].x) / 2, 5), y: snap((pts[i].y + pts[i + 1].y) / 2, 5) };
    };
    return (
      <aside className="inspector" aria-label={t('Inspector')} data-testid="wire-inspector">
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
              <button key={n} className={`swatch ${w.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => st.updateWire(w.id, { color: c })} aria-label={n} title={t(n)} data-testid={`wire-color-${n}`} />
            ))}
            <label className="swatch custom" title={t('Custom colour')}>
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(w.color) ? w.color : '#2b7bd6'} onChange={(e) => st.updateWire(w.id, { color: e.target.value })} aria-label={t('Custom colour')} data-testid="wire-color-custom" />
            </label>
          </div>
        </label>
        <label className="field">
          <span>{t('Hex')}</span>
          <input
            dir="ltr"
            value={w.color}
            onChange={(e) => /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(e.target.value) && st.updateWire(w.id, { color: e.target.value })}
            data-testid="wire-color-hex"
          />
        </label>
        <label className="field">
          <span>{t('Thickness')}</span>
          <select value={w.width ?? vs.wireWidth} onChange={(e) => st.updateWire(w.id, { width: Number(e.target.value) })} data-testid="wire-width">
            {WIRE_WIDTHS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('Routing')}</span>
          <select value={w.route ?? 'manual'} onChange={(e) => st.setWireRoute(w.id, e.target.value as WireRoute)} data-testid="wire-route">
            <option value="manual">{t('Manual (straight segments through bends)')}</option>
            <option value="orthogonal">{t('90° orthogonal')}</option>
            <option value="diag45">{t('45° routing')}</option>
            <option value="straight">{t('Straight line')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('Label')}</span>
          <input value={w.label ?? ''} onChange={(e) => st.updateWire(w.id, { label: e.target.value || undefined })} data-testid="wire-label" />
        </label>
        <p className="muted small">
          {t('{n} bend points', { n: w.points?.length ?? 0 })} · {t('drag a handle to move it, double-click a wire to add one, double-click a handle to remove it')}
        </p>
        <div className="row wrap">
          <button onClick={() => st.addBend(w.id, mid())} data-testid="wire-add-bend">
            {t('Add bend point')}
          </button>
          <button onClick={() => w.points?.length && st.removeBendAt(w.id, { x: 0, y: 0 }, w.points.length - 1)} disabled={!w.points?.length} data-testid="wire-remove-bend">
            {t('Remove bend point')}
          </button>
          <button onClick={() => st.autoRouteWire(w.id)} data-testid="wire-autoroute">
            {t('Auto route')}
          </button>
          <button onClick={() => st.setWireRoute(w.id, 'straight')} data-testid="wire-straighten">
            {t('Straighten')}
          </button>
          <button onClick={() => st.setHighlightNet(st.highlightNet ? null : w.from)} data-testid="wire-highlight">
            {t('Highlight net')}
          </button>
          <button className="danger" onClick={() => st.deleteWire(w.id)} data-testid="wire-delete">
            {t('Delete wire')}
          </button>
        </div>
        {net && (
          <>
            <div className="panel-title sub">{t('Electrical net')}</div>
            <div className="kv small" dir="ltr">
              <div>
                <b>{net.name}</b>
                {volts !== null ? ` · ${volts.toFixed(2)} V` : ''}
              </div>
              {members.map((p) => (
                <div key={`${p.comp}:${p.pin}`}>• {compName(doc, p.comp).split(' (')[0]} · {pinName(doc, p.comp, p.pin)}</div>
              ))}
            </div>
            <p className="muted small">{t('Only wire ends connect. Wires drawn across each other are not connected.')}</p>
          </>
        )}
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
  void lang;
  return <PartInspector key={c.id} c={c} PropInput={PropInput} LiveState={LiveState} />;
}

export function LiveState({ type, v }: { type: string; v: Record<string, any> }) {
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
      if ('vin' in v) rows.push(['VIN', `${n(v.vin)} V`]);
      if ('vout' in v) rows.push(['VOUT', `${n(v.vout)} V`]);
      if ('iout' in v) rows.push([t('Output current'), `${n((v.iout ?? 0) * 1000, 0)} mA`]);
      if ('heatW' in v) rows.push([t('Heat'), `${n(v.heatW, 2)} W`]);
      if (Array.isArray(v.ch)) v.ch.forEach((x: any, i: number) => rows.push([type === 'ads1115' ? `A${i}` : `CH${i}`, x === null ? t('floating') : `${n(x, 3)} V`]));
      if ('rpm' in v) rows.push([t('Speed'), `${n(v.rpm, 0)} rpm`]);
      if ('steps' in v) rows.push([t('Steps'), `${n(v.steps, 0)}`]);
      if ('micro' in v) rows.push([t('Microstep'), `1/${v.micro}`]);
      if ('latch' in v) rows.push([t('Output latch'), `0b${Number(v.latch ?? 0).toString(2).padStart(8, '0')}`]);
      if ('levels' in v) rows.push([t('Pin levels'), (v.levels ?? []).join('')]);
      if ('distance' in v) rows.push([t('Distance'), `${n(v.distance, 1)} cm`]);
      if ('motion' in v) rows.push([t('Motion'), v.motion ? t('yes') : t('no')]);
      if (Array.isArray(v.pixels)) rows.push([t('Pixels lit'), `${v.pixels.filter((p: number[]) => p && p[0] + p[1] + p[2] > 0).length}`]);
      if (Array.isArray(v.digits)) rows.push([t('Digits'), v.digits.map((d: number) => d.toString(16).padStart(2, '0')).join(' ')]);
      if ('ec' in v && 'level' in v) rows.push(['EC / pH', `${n(v.ec, 2)} / ${n(v.ph, 2)}`]);
      if ('level' in v && typeof v.level === 'number') rows.push([t('Volume'), `${n(v.level, 2)} L`]);
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
