import { FARM_ROLE_LABELS, type FarmConfig, type FarmRole } from '../../engine/farm';
import { cancelFastForward, fastForward, sim, useSimVersion } from '../../state/engine';
import { useApp } from '../../state/store';
import { alarmText, useT } from '../../i18n';
import { Dock } from '../Dock';

function nextTime(hh: number, mm = 0) {
  const d = new Date(sim.clock.nowMs());
  const t = new Date(d);
  t.setHours(hh, mm, 0, 0);
  if (t.getTime() <= d.getTime()) t.setDate(t.getDate() + 1);
  return t.getTime();
}

export default function FarmTab() {
  useSimVersion();
  const t = useT();
  const lang = useApp((s) => s.lang);
  const cfg = useApp((s) => s.doc.farm);
  const comps = useApp((s) => s.doc.components);
  const ff = useApp((s) => s.ff);
  const st = useApp.getState();
  const s = sim.farm.state;
  const r = s.reservoir;
  const level = sim.farm.levelPct();
  const drives = sim.farm.drives;
  const run = (role: FarmRole) => drives.filter((d) => d.role === role).reduce((m, d) => Math.max(m, Math.abs(d.run)), 0);
  const flowing = (role: FarmRole) => drives.some((d) => d.role === role && (s.flows[d.comp] ?? 0) > 0.001);
  const set = (fn: (c: FarmConfig) => void) => {
    const c = structuredClone(cfg);
    fn(c);
    st.setFarm(c);
  };
  const setLive = (fn: () => void) => {
    fn();
    sim.evaluate();
  };
  const roles = comps.filter((c) => c.props?.role && c.props.role !== 'none');
  const fan = run('fan');
  const light = run('grow_light');
  const pumpOn = flowing('circulation');
  const plantSize = 0.6 + Math.min(1, s.totals.circulatedL / 2000) * 0.6;
  const stressed = s.stress.length > 0;
  const tankH = 120;

  return (
    <div className="farm-tab">
      <div className="farm-main">
        <div className="farm-head row">
          <h1 style={{ margin: 0, fontSize: 18 }}>🌱 {t('Smart Farming Simulation')}</h1>
          <label className="row">
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => set((c) => (c.enabled = e.target.checked))} data-testid="farm-enabled" /> {t('Farm model enabled')}
          </label>
          <span className="muted small">{t('Crop')}:</span>
          <input value={cfg.crop} onChange={(e) => set((c) => (c.crop = e.target.value))} style={{ width: 110 }} />
          <span className="flex" />
          {ff ? (
            <button onClick={cancelFastForward}>⏹ {t('Stop fast-forward')}</button>
          ) : (
            <>
              <button onClick={() => fastForward(sim.clock.nowMs() + 600_000)}>⏩ +10 min</button>
              <button onClick={() => fastForward(sim.clock.nowMs() + 3600_000)}>⏩ +1 h</button>
              <button onClick={() => fastForward(nextTime(6))}>⏩ {t('to 06:00')}</button>
            </>
          )}
        </div>
        {!cfg.enabled && <p className="pill warn">{t('The farm model is disabled for this project. Enable it to simulate tanks, dosing and climate.')}</p>}
        <svg viewBox="0 0 900 430" className="farm-svg" role="img" aria-label={t('Hydroponic farm diagram')} data-testid="farm-svg">
          <defs>
            <linearGradient id="water" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#5fb4ff" />
              <stop offset="1" stopColor="#1f6fd1" />
            </linearGradient>
          </defs>
          {/* grow room */}
          <rect x={250} y={20} width={630} height={250} rx={12} className="farm-room" />
          <text x={262} y={40} className="farm-label">
            {t('Grow room')} · {s.air.temp.toFixed(1)}°C · {s.air.humidity.toFixed(0)}% RH · {Math.round(s.air.co2)} ppm CO₂
          </text>
          {/* grow light */}
          <rect x={330} y={52} width={470} height={14} rx={4} fill="#333" />
          {light > 0 && <polygon points="330,66 800,66 850,200 280,200" fill={`rgba(255,80,220,${0.18 * light})`} />}
          <text x={810} y={63} className="farm-label">{light > 0 ? `💡 ${Math.round(light * 100)}%` : '💡 off'}</text>
          {/* NFT channels with plants */}
          {[0, 1, 2].map((i) => {
            const y = 120 + i * 45;
            return (
              <g key={i}>
                <rect x={300} y={y} width={520} height={16} rx={6} fill="#ddd" stroke="#999" />
                <rect x={302} y={y + 9} width={516} height={5} rx={2} fill={s.inTransitL > 0.05 ? 'url(#water)' : '#ccc'} className={pumpOn ? 'flow-anim' : ''} />
                {Array.from({ length: 8 }, (_, k) => (
                  <g key={k} transform={`translate(${330 + k * 62} ${y}) scale(${plantSize})`}>
                    <path d="M0 0 C-14 -6 -16 -22 -4 -26 C-2 -14 0 -10 0 0 Z" fill={stressed ? '#a3a33a' : '#3fae4b'} />
                    <path d="M0 0 C14 -6 16 -22 4 -26 C2 -14 0 -10 0 0 Z" fill={stressed ? '#8e9a2f' : '#2f9a3e'} />
                    <path d="M0 0 C-4 -12 0 -30 0 -34 C1 -24 4 -12 0 0 Z" fill={stressed ? '#9fb03a' : '#4cc35a'} />
                  </g>
                ))}
              </g>
            );
          })}
          {/* fan */}
          <g transform="translate(845 120)">
            <circle r={22} fill="#222" />
            <g className={fan > 0 ? 'spin' : ''} style={{ animationDuration: `${fan > 0 ? 0.4 / fan : 0}s` }}>
              {[0, 90, 180, 270].map((a) => (
                <ellipse key={a} cx={0} cy={-10} rx={5} ry={10} fill="#888" transform={`rotate(${a})`} />
              ))}
            </g>
            <text y={38} textAnchor="middle" className="farm-label">
              {t('Fan')}
            </text>
          </g>
          {/* heater + humidifier */}
          <g transform="translate(845 200)">
            <rect x={-20} y={-12} width={40} height={24} rx={4} fill={run('heater') > 0 ? '#ff5a1f' : '#555'} />
            <text y={30} textAnchor="middle" className="farm-label">
              {t('Heater')}
            </text>
          </g>
          <g transform="translate(270 230)">
            <rect x={-14} y={-10} width={28} height={20} rx={4} fill="#dfe8f0" />
            {run('humidifier') > 0 && <circle cy={-18} r={9} fill="#cde8ff" className="mist" />}
            <text y={26} textAnchor="middle" className="farm-label">
              {t('Humidifier')}
            </text>
          </g>
          {/* reservoir */}
          <g transform="translate(40 280)">
            <rect x={0} y={0} width={180} height={tankH} rx={8} className="tank" />
            <rect x={3} y={3 + (tankH - 6) * (1 - level / 100)} width={174} height={(tankH - 6) * (level / 100)} rx={6} fill="url(#water)" opacity={0.85} />
            <text x={90} y={-8} textAnchor="middle" className="farm-label">
              {t('Nutrient reservoir')} · {r.volumeL.toFixed(1)} / {cfg.reservoir.capacityL} L
            </text>
            <text x={90} y={60} textAnchor="middle" className="farm-big">
              {level.toFixed(0)}%
            </text>
            <text x={90} y={80} textAnchor="middle" className="farm-label">
              EC {r.ec.toFixed(2)} · pH {r.ph.toFixed(2)} · {r.tempC.toFixed(1)}°C
            </text>
            <line x1={0} y1={tankH - (tankH * cfg.intakeMinL) / cfg.reservoir.capacityL} x2={180} y2={tankH - (tankH * cfg.intakeMinL) / cfg.reservoir.capacityL} stroke="#f05252" strokeDasharray="4 3" />
          </g>
          {/* circulation pipe: reservoir -> channels */}
          <path d="M200 300 L200 112 L300 112" className={`pipe ${pumpOn ? 'pipe-flow' : ''}`} />
          <path d="M820 205 L860 205 L860 260 L230 260 L230 300" className={`pipe ${s.inTransitL > 0.05 ? 'pipe-flow slow' : ''}`} />
          <g transform="translate(200 210)">
            <circle r={16} fill={pumpOn ? '#2f8cff' : run('circulation') > 0 ? '#f05252' : '#555'} />
            <text y={4} textAnchor="middle" className="farm-label" fill="#fff">
              P
            </text>
            <text x={22} y={4} className="farm-label">
              {pumpOn ? `${s.flowLpm.toFixed(1)} L/min` : run('circulation') > 0 ? t('DRY / NO FLOW') : t('pump off')}
            </text>
          </g>
          {/* dosing tanks */}
          {(
            [
              ['A', s.tankA, cfg.tankA.capacityL, 'dose_a', '#e0a030'],
              ['B', s.tankB, cfg.tankB.capacityL, 'dose_b', '#b05ad8'],
              ['pH−', s.phDown, cfg.phDown.capacityL, 'ph_down', '#e05050'],
            ] as const
          ).map(([name, vol, cap, role, color], i) => {
            const x = 300 + i * 120;
            const f = Math.max(0, Math.min(1, vol / cap));
            const on = flowing(role as FarmRole);
            return (
              <g key={name} transform={`translate(${x} 300)`}>
                <rect x={0} y={0} width={70} height={90} rx={6} className="tank" />
                <rect x={3} y={3 + 84 * (1 - f)} width={64} height={84 * f} rx={4} fill={color} opacity={0.8} />
                <text x={35} y={-6} textAnchor="middle" className="farm-label">
                  {t('Tank')} {name} · {(vol * 1000).toFixed(0)} ml
                </text>
                <path d={`M35 90 L35 110 L${150 - x - 0} 110`} className={`pipe thin ${on ? 'pipe-flow' : ''}`} transform="translate(0 0)" />
                <circle cx={35} cy={100} r={8} fill={on ? color : '#555'} />
              </g>
            );
          })}
          <path d="M220 410 L180 410" className="pipe thin" />
          {/* fresh water & drain */}
          <g transform="translate(40 250)">
            <text x={0} y={0} className="farm-label">
              {t('Fresh water')} {flowing('fresh_water') ? '▼ ' + t('filling') : ''}
            </text>
          </g>
          <text x={40} y={420} className="farm-label">
            {t('Drain')} {flowing('drain') ? '▼ ' + t('draining') : ''}
          </text>
          {s.leakActive && (
            <text x={130} y={420} className="farm-label" fill="#f05252">
              💧 {t('LEAK')}
            </text>
          )}
        </svg>
        <div className="farm-dock">
          <Dock withCode={false} />
        </div>
      </div>
      <aside className="inspector farm-side">
        <div className="panel-title">{t('Physical alarms (from the farm model)')}</div>
        {s.alarms.length === 0 && <p className="muted small">✅ {t('No physical alarms.')}</p>}
        {s.alarms.map((a) => {
          const tx = alarmText(lang, a.id, a.params);
          return (
            <div key={a.id} className={`issue issue-${a.severity}`} data-alarm={a.id}>
              <div className="issue-title">🚨 {tx.title}</div>
              <div className="issue-explain">{tx.explain}</div>
            </div>
          );
        })}
        {s.alarms.some((a) => a.id === 'AB_SIMULTANEOUS') && <button onClick={() => (sim.farm.clearLatched(), sim.evaluate())}>{t('Acknowledge A+B alarm')}</button>}
        <p className="muted small">{t('Program alerts are whatever YOUR code prints or shows on the Nextion/web page. These physical alarms show what really happened in the model — e.g. a pump that kept running dry because the protection code was missing.')}</p>

        <div className="panel-title sub">{t('Readings')}</div>
        <table className="pin-table" dir="ltr">
          <tbody>
            {(
              [
                ['Air temperature', `${s.air.temp.toFixed(1)} °C`],
                ['Humidity', `${s.air.humidity.toFixed(0)} %`],
                ['CO₂', `${Math.round(s.air.co2)} ppm`],
                ['Light', `${Math.round(s.air.lux)} lux`],
                ['Water level', `${level.toFixed(1)} % (${r.volumeL.toFixed(2)} L)`],
                ['Water temperature', `${r.tempC.toFixed(1)} °C`],
                ['EC', `${r.ec.toFixed(2)} mS/cm`],
                ['pH', r.ph.toFixed(2)],
                ['Flow', `${s.flowLpm.toFixed(2)} L/min`],
                ['Dosed A / B', `${s.totals.doseAml.toFixed(1)} / ${s.totals.doseBml.toFixed(1)} ml`],
                ['pH-down dosed', `${s.totals.phDownml.toFixed(1)} ml`],
                ['Power now', `${s.powerW.toFixed(1)} W`],
                ['Energy', `${s.totals.energyWh.toFixed(2)} Wh`],
                ['Plant stress', s.stress.length ? s.stress.join(', ') : 'none'],
              ] as const
            ).map(([k, v]) => (
              <tr key={k}>
                <td>{t(k)}</td>
                <td className="num" data-reading={k}>
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="panel-title sub">{t('Farm actuators in the circuit')}</div>
        {roles.length === 0 && <p className="muted small">{t('No actuators are linked yet. Select a pump, valve, fan, heater or light in the circuit and set its "Smart Farm role".')}</p>}
        {roles.map((c) => {
          const d = drives.find((x) => x.comp === c.id);
          return (
            <div key={c.id} className="small row" style={{ margin: 2 }}>
              <span className={`dot ${d && Math.abs(d.run) > 0.05 ? 'on' : ''}`} /> {c.label || c.id}: {t(FARM_ROLE_LABELS[c.props.role as FarmRole])}
            </div>
          );
        })}

        <div className="panel-title sub">{t('Scenario controls (live)')}</div>
        <Slider label={t('Reservoir level')} unit="%" min={0} max={100} value={level} onChange={(v) => setLive(() => (r.volumeL = (cfg.reservoir.capacityL * v) / 100))} testid="farm-level" />
        <Slider label="EC" unit="mS/cm" min={0} max={5} step={0.05} value={r.ec} onChange={(v) => setLive(() => (r.ec = v))} />
        <Slider label="pH" unit="" min={3} max={9} step={0.05} value={r.ph} onChange={(v) => setLive(() => (r.ph = v))} />
        <Slider label={t('Air temperature')} unit="°C" min={0} max={45} step={0.5} value={s.air.temp} onChange={(v) => setLive(() => (s.air.temp = v))} testid="farm-airtemp" />
        <Slider label={t('Humidity')} unit="%" min={5} max={99} value={s.air.humidity} onChange={(v) => setLive(() => (s.air.humidity = v))} />
        <Slider label="CO₂" unit="ppm" min={300} max={3000} step={10} value={s.air.co2} onChange={(v) => setLive(() => (s.air.co2 = v))} />
        <Slider label={t('Outdoor temperature')} unit="°C" min={-10} max={45} step={0.5} value={cfg.env.outdoorTemp} onChange={(v) => set((c) => (c.env.outdoorTemp = v))} />
        <Slider label={t('Outdoor humidity')} unit="%" min={5} max={99} value={cfg.env.outdoorHumidity} onChange={(v) => set((c) => (c.env.outdoorHumidity = v))} />
        <div className="row">
          <button onClick={() => setLive(() => ((s.tankA = cfg.tankA.capacityL), (s.tankB = cfg.tankB.capacityL), (s.phDown = cfg.phDown.capacityL)))}>{t('Refill A/B/pH tanks')}</button>
          <label className="row">
            <input type="checkbox" checked={cfg.leak} onChange={(e) => set((c) => (c.leak = e.target.checked))} /> {t('Inject leak')}
          </label>
          <button onClick={() => (sim.farm.reset(cfg, sim.clock.now()), sim.evaluate())}>{t('Reset farm state')}</button>
        </div>

        <div className="panel-title sub">{t('Initial configuration')}</div>
        <NumField label={t('Reservoir capacity')} unit="L" value={cfg.reservoir.capacityL} onChange={(v) => set((c) => (c.reservoir.capacityL = v))} />
        <NumField label={t('Initial volume')} unit="L" value={cfg.reservoir.volumeL} onChange={(v) => set((c) => (c.reservoir.volumeL = v))} />
        <NumField label={t('Pump intake minimum')} unit="L" value={cfg.intakeMinL} onChange={(v) => set((c) => (c.intakeMinL = v))} />
        <NumField label={t('Stock EC (A and B)')} unit="mS/cm" value={cfg.tankA.ecStock} onChange={(v) => set((c) => ((c.tankA.ecStock = v), (c.tankB.ecStock = v)))} />
        <NumField label={t('Plant water uptake')} unit="L/day" value={cfg.consumptionLPerDay} onChange={(v) => set((c) => (c.consumptionLPerDay = v))} />

        <details className="small">
          <summary>{t('Model assumptions and limits')}</summary>
          <ul>
            <li>{t('Perfectly mixed reservoir; EC mixes linearly by volume with the stock-solution EC.')}</li>
            <li>{t('Each ml of A or B per litre lowers pH by 0.15; pH-down lowers 0.6 per ml/L (linear, clamped 3–9).')}</li>
            <li>{t('Plants take up water at a constant rate; EC drifts −0.05/day and pH +0.1/day.')}</li>
            <li>{t('Room air: one thermal mass (150 kJ/K), 1 h exchange with outdoors, 5 min with the fan on.')}</li>
            <li>{t('Pump flow = rated flow × electrical run fraction; no flow when the reservoir is below the intake (dry run) or the pump is faulted.')}</li>
            <li>{t('This is a training model, not an agronomic or chemical simulation. Dosing accuracy is best at ≤10× speed.')}</li>
          </ul>
        </details>
      </aside>
    </div>
  );
}

function Slider({ label, unit, min, max, step = 1, value, onChange, testid }: { label: string; unit: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void; testid?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="num-input">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testid} />
        <span className="unit" style={{ minWidth: 70, textAlign: 'end' }} dir="ltr">
          {value.toFixed(step < 1 ? 2 : 0)} {unit}
        </span>
      </div>
    </label>
  );
}

function NumField({ label, unit, value, onChange }: { label: string; unit: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="num-input">
        <input type="number" value={value} onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} />
        <span className="unit">{unit}</span>
      </div>
    </label>
  );
}
