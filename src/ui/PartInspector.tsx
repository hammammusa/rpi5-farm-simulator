// Professional component inspector: identity, simulation level, power/connection
// status, live values, pin-out with what each pin is connected to, Python drivers and
// the ready-made example (insert / load / test).
import { useState } from 'react';
import { getPart, pinsOf, withDefaults, type PartManifest } from '../engine/parts';
import { PI5_HEADER, BCM_TO_PHYS } from '../engine/pi5';
import type { ComponentInstance, PropDef } from '../engine/types';
import { DEFAULT_CODE } from '../engine/project';
import { sim, saveNow, useSimVersion } from '../state/engine';
import { useApp } from '../state/store';
import { useT } from '../i18n';
import { compName, pinName } from '../state/wiring';
import { IssueCard } from './Problems';
import { fidelityBadge } from './Library';
import { DRIVER_BY_MODULE } from '../catalog/drivers';
import { buildPartExample, exampleFor, partScenario, wiringGuide } from '../catalog/examples';
import { runScenario, type ScenarioReport } from '../tests/host';
import { FIDELITY_LABEL } from '../catalog/registry';

type Tab = 'info' | 'pins' | 'python' | 'config';

/** GPIO (BCM) numbers directly wired to each of the part's pins */
export function gpioMap(c: ComponentInstance): { pin: string; bcm: number; phys: number }[] {
  const m = getPart(c.type);
  const out: { pin: string; bcm: number; phys: number }[] = [];
  for (const p of pinsOf(m, withDefaults(m, c.props))) {
    const n = sim.net.netOf({ comp: c.id, pin: p.id });
    if (n < 0) continue;
    for (const [bcm, nn] of sim.net.gpioNet) if (nn === n) out.push({ pin: p.id, bcm, phys: BCM_TO_PHYS[bcm] });
  }
  return out;
}

export function insertExampleCode(type: string, t: (s: string, p?: any) => string) {
  const ex = exampleFor(type);
  if (!ex) return;
  const st = useApp.getState();
  const main = st.doc.files.find((f) => f.name === st.doc.mainFile);
  const trivial = !main || !main.content.trim() || main.content.trim() === DEFAULT_CODE.trim();
  if (trivial) st.setFile(st.doc.mainFile, ex.code);
  else if (window.confirm(t('Replace the code in {file} with the example? Cancel keeps your code and adds the example as a new file.', { file: st.doc.mainFile }))) st.setFile(st.doc.mainFile, ex.code);
  else {
    let name = `${type}_example.py`;
    for (let i = 2; st.doc.files.some((f) => f.name === name); i++) name = `${type}_example_${i}.py`;
    st.addFile(name, ex.code);
  }
  st.setActiveFile(useApp.getState().activeFile);
  st.showToast(t('Example code inserted — open the Python tab to edit it.'));
}

export async function loadCompleteExample(type: string) {
  await saveNow();
  const d = buildPartExample(type);
  d.id = `p${Date.now().toString(36)}${type.slice(0, 4)}`;
  d.createdAt = d.updatedAt = Date.now();
  useApp.getState().loadProject(d);
  useApp.setState({ dirty: true, tab: 'circuit' });
  await saveNow();
}

function Row({ k, v, testid }: { k: string; v: React.ReactNode; testid?: string }) {
  return (
    <tr data-testid={testid}>
      <td>{k}</td>
      <td className="num">{v}</td>
    </tr>
  );
}

// The part test swaps the document, which remounts the inspector; keep the last tab and
// test report outside the component so the result is still shown afterwards.
let lastTab: Tab = 'info';
const REPORTS = new Map<string, ScenarioReport>();

export function PartInspector({ c, PropInput, LiveState }: { c: ComponentInstance; PropInput: (p: { def: PropDef; value: any; onChange: (v: any, h?: boolean) => void }) => React.ReactElement; LiveState: (p: { type: string; v: Record<string, any> }) => React.ReactElement }) {
  useSimVersion();
  const t = useT();
  const lang = useApp((s) => s.lang);
  const mode = useApp((s) => s.mode);
  const doc = useApp((s) => s.doc);
  const [tab, setTabState] = useState<Tab>(lastTab);
  const setTab = (k: Tab) => setTabState((lastTab = k));
  const [report, setReport] = useState<ScenarioReport | null>(() => REPORTS.get(c.id) ?? null);
  const [busy, setBusy] = useState(false);
  const st = useApp.getState();
  const m: PartManifest = getPart(c.type);
  const props = withDefaults(m, c.props);
  const v = sim.vis.get(c.id) ?? {};
  const rt = sim.rt.get(c.id) ?? {};
  const myIssues = sim.issues.filter((i) => i.comps.includes(c.id));
  const pins = pinsOf(m, props);
  const gp = gpioMap(c);
  const ex = exampleFor(c.type);
  const connectedPins = pins.filter((p) => {
    const n = sim.net.netOf({ comp: c.id, pin: p.id });
    return n >= 0 && [...sim.net.nets[n].comps].some((x) => x !== c.id);
  }).length;
  const owners = [...new Set(gp.map((g) => sim.claims.get(g.bcm)).filter(Boolean))] as string[];
  const peerName = c.label || m.name;
  const busTalk = sim.busLog.filter((e) => e.peer === peerName || e.peer === m.name).slice(-1)[0];
  const lastRead = rt.lastRead !== undefined ? `${new Date(rt.lastRead * 1000).toLocaleTimeString()} — ${rt.lastValue ?? ''}` : busTalk ? `${new Date(busTalk.t * 1000).toLocaleTimeString()} — ${busTalk.bus} ${busTalk.addr} ${busTalk.dir}` : '—';
  const powered = v.powered === undefined ? null : !!v.powered;
  const groups: { id: string; label: string }[] = [
    { id: 'sensor', label: 'Live values (change while running)' },
    { id: 'config', label: 'Configuration' },
    { id: 'farm', label: 'Smart Farm link' },
  ];
  const drivers = (m.drivers ?? []).map((d) => DRIVER_BY_MODULE.get(d === 'RPi.GPIO' ? 'RPi' : d)).filter(Boolean);

  const test = async () => {
    const sc = partScenario(c.type);
    if (!sc) return;
    setBusy(true);
    const original = structuredClone(useApp.getState().doc);
    const rep = await runScenario(sc, 4);
    REPORTS.set(c.id, rep);
    useApp.getState().loadProject(original);
    useApp.getState().select([c.id]);
    setReport(rep);
    setBusy(false);
  };

  return (
    <aside className="inspector" aria-label={t('Inspector')} data-testid="inspector">
      <div className="panel-title">{m.name}</div>
      <div className="insp-head">
        {fidelityBadge(m.fidelity, lang)}
        {m.model && <span className="muted small">{m.model}</span>}
        {m.manufacturer && <span className="muted small">· {m.manufacturer}</span>}
      </div>
      <div className="kv small" dir="ltr">
        <span className="muted">ID</span> <code data-testid="comp-id">{c.id}</code>
      </div>
      <div className="insp-tabs" role="tablist">
        {(
          [
            ['info', 'Overview'],
            ['pins', 'Pins'],
            ['python', 'Python'],
            ['config', 'Settings'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} data-testid={`insp-tab-${k}`}>
            {t(l)}
            {k === 'info' && myIssues.some((i) => i.severity === 'error') ? ' ⛔' : ''}
          </button>
        ))}
      </div>

      {tab === 'info' && (
        <>
          <p className="muted small">{m.description}</p>
          {m.limits && <p className={`small ${m.fidelity === 'full' ? 'muted' : 'limits'}`}>{m.fidelity === 'full' ? 'ℹ' : '⚠'} {m.limits}</p>}
          <label className="field">
            <span>{t('Label')}</span>
            <input value={c.label ?? ''} placeholder={c.id} onChange={(e) => st.setLabel(c.id, e.target.value)} />
          </label>
          <table className="pin-table" dir="ltr" data-testid="insp-status">
            <tbody>
              {m.voltage && <Row k={t('Operating voltage')} v={m.voltage} />}
              {m.interfaces && <Row k={t('Protocol')} v={m.interfaces.join(', ')} />}
              <Row k={t('Connected GPIO')} v={gp.length ? gp.map((g) => `${g.pin}→GPIO${g.bcm} (pin ${g.phys})`).join(', ') : '—'} testid="insp-gpio" />
              <Row k={t('Power')} v={powered === null ? '—' : powered ? `${t('yes')}${typeof v.vs === 'number' ? ` (${v.vs.toFixed(2)} V)` : ''}` : t('no')} testid="insp-power" />
              <Row k={t('Connection')} v={`${connectedPins}/${pins.filter((p) => p.kind !== 'hole').length} ${t('pins wired')}${myIssues.length ? ` · ${t('{n} problems', { n: myIssues.length })}` : ''}`} />
              <Row k={t('Simulation')} v={`${FIDELITY_LABEL[m.fidelity ?? 'functional'][lang]}`} />
              <Row k={t('Driver library')} v={(m.drivers ?? []).join(', ') || '—'} />
              <Row k={t('Active Python driver')} v={owners.length ? owners.join(', ') : sim.running ? t('not used by the program') : t('program not running')} testid="insp-driver" />
              <Row k={t('Last read')} v={lastRead} testid="insp-lastread" />
            </tbody>
          </table>
          {groups.slice(0, 1).map((g) => {
            const defs = m.props.filter((p) => (p.group ?? 'config') === g.id && (!p.visible || p.visible(props)));
            if (!defs.length && !m.props.some((p) => p.key === 'source')) return null;
            return (
              <div key={g.id}>
                <div className="panel-title sub">{t(g.label)}</div>
                {m.props
                  .filter((p) => p.key === 'source')
                  .concat(defs.filter((d) => d.key !== 'source'))
                  .map((d) => (
                    <label key={d.key} className="field" title={d.help}>
                      <span>{t(d.label)}</span>
                      <PropInput def={d} value={props[d.key]} onChange={(val, h = true) => st.setProp(c.id, d.key, val, h)} />
                    </label>
                  ))}
              </div>
            );
          })}
          <div className="panel-title sub">{t('Live state')}</div>
          <LiveState type={c.type} v={v} />
          <div className="panel-title sub">{t('Wiring validation')}</div>
          {myIssues.length ? myIssues.map((i) => <IssueCard key={i.key} issue={i} compact />) : <p className="muted small">✓ {t('No electrical problems found for this part.')}</p>}
          {mode === 'beginner' && m.commonErrors?.length ? (
            <>
              <div className="panel-title sub">{t('Common mistakes')}</div>
              <ul className="small muted">
                {m.commonErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}

      {tab === 'pins' && c.type !== 'breadboard' && (
        <>
          <table className="pin-table" dir="ltr" data-testid="insp-pinout">
            <thead>
              <tr>
                <th>{t('Pin')}</th>
                <th>{t('Connected to')}</th>
                <th>V</th>
              </tr>
            </thead>
            <tbody>
              {pins.map((p) => {
                const nId = sim.net.netOf({ comp: c.id, pin: p.id });
                const net = nId >= 0 ? sim.net.nets[nId] : null;
                const others = net ? net.pins.filter((x) => x.comp !== c.id && doc.components.find((k) => k.id === x.comp)?.type !== 'breadboard') : [];
                const vv = nId >= 0 ? sim.netVoltage(nId) : null;
                if (c.type === 'rpi5' && !others.length) return null;
                const label = c.type === 'rpi5' ? `${p.id.slice(1)} ${p.label}` : p.label;
                const g = gp.find((x) => x.pin === p.id);
                return (
                  <tr key={p.id} title={p.desc}>
                    <td>
                      <b>{label}</b>
                      <div className="muted tiny">
                        {p.kind}
                        {p.desc && c.type !== 'rpi5' ? ` · ${p.desc}` : ''}
                      </div>
                    </td>
                    <td className="muted">
                      {g ? `GPIO${g.bcm} / pin ${g.phys}` : others.length ? others.slice(0, 3).map((x) => `${compName(doc, x.comp).split(' (')[0]}.${pinName(doc, x.comp, x.pin)}`).join(', ') : '—'}
                    </td>
                    <td className="num">{vv !== null && others.length ? `${vv.toFixed(2)}` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {c.type === 'rpi5' && <p className="muted small">{t('Only connected header pins are listed. Hover a pin in the workspace for details.')}</p>}
          {c.type === 'rpi5' && (
            <details>
              <summary className="small">{t('Full 40-pin header')}</summary>
              <table className="pin-table" dir="ltr">
                <tbody>
                  {PI5_HEADER.map((h) => (
                    <tr key={h.physical}>
                      <td>{h.physical}</td>
                      <td>{h.name}</td>
                      <td className="muted">{h.alts.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}

      {tab === 'python' && (
        <>
          {m.python && (
            <p className="small" dir="ltr">
              <code>{m.python}</code>
            </p>
          )}
          {ex && (
            <>
              <div className="panel-title sub">{t('Example')}: {ex.title}</div>
              <pre className="code-sample" dir="ltr" data-testid="insp-example-code">
                {ex.code}
              </pre>
              <div className="row wrap">
                <button className="primary" onClick={() => insertExampleCode(c.type, t)} data-testid="insert-example">
                  {t('Insert Example Code')}
                </button>
                <button onClick={() => void loadCompleteExample(c.type)} data-testid="load-example">
                  {t('Load Complete Example')}
                </button>
                <button onClick={() => void test()} disabled={busy} data-testid="test-part">
                  {busy ? t('Testing…') : t('Test simulation')}
                </button>
              </div>
              {report && (
                <p className={`small ${report.status === 'PASS' ? 'ok' : 'err'}`} data-testid="test-part-result">
                  {report.status} — {report.actual || report.error}
                </p>
              )}
              <div className="panel-title sub">{t('Wiring guide')}</div>
              <ul className="small" dir="ltr">
                {wiringGuide(c.type).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <p className="small muted">
                {t('Expected output')}: <code dir="ltr">{String(ex.expect).slice(1, -1).replace(/\\/g, '').slice(0, 80)}</code>
              </p>
            </>
          )}
          {drivers.length > 0 && <div className="panel-title sub">{t('Driver / API reference')}</div>}
          {drivers.map((d) => (
            <details key={d!.module} className="small driver-doc">
              <summary>
                <code>{d!.module}</code> — {d!.title.split(' — ')[1] ?? d!.title} {d!.kind === 'simulator' && <span className="badge">{t('simulator API')}</span>}
              </summary>
              <ul dir="ltr">
                {d!.apis.slice(0, 14).map((a) => (
                  <li key={a.name}>
                    <code>{a.sig ?? a.name}</code> — {a.doc}
                  </li>
                ))}
              </ul>
              <p className="muted">
                {t('On a real Raspberry Pi 5')}: <code dir="ltr">{d!.real.install}</code>
              </p>
            </details>
          ))}
          {m.commonErrors?.length ? (
            <>
              <div className="panel-title sub">{t('Common errors')}</div>
              <ul className="small muted">
                {m.commonErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}

      {tab === 'config' && (
        <>
          {groups.slice(1).map((g) => {
            const defs = m.props.filter((p) => (p.group ?? 'config') === g.id && (!p.visible || p.visible(props)));
            if (!defs.length) return null;
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
          <label className="field">
            <span>{t('Lock position')}</span>
            <input type="checkbox" checked={!!c.locked} onChange={() => st.toggleLock([c.id])} />
          </label>
        </>
      )}

      <div className="row">
        <button onClick={() => st.rotateSelected()}>{t('Rotate')}</button>
        <button onClick={() => st.duplicateSelected()}>{t('Duplicate')}</button>
        <button className="danger" onClick={() => st.deleteSelected()}>
          {t('Delete')}
        </button>
      </div>
    </aside>
  );
}
