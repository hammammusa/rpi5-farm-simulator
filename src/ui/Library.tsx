import { useMemo, useState } from 'react';
import { PARTS, type Fidelity, type PartManifest } from '../engine/parts';
import { snap } from '../engine/geometry';
import { useApp } from '../state/store';
import { useT } from '../i18n';
import { workspaceCenter } from './Workspace';
import { FIDELITY_LABEL, GROUP_ORDER, isFarmPart } from '../catalog/registry';

export const ICON: Record<string, string> = {
  rpi5: '🍓', breadboard: '▦', led: '🔴', rgb_led: '🌈', resistor: '〰', capacitor: '⊣⊢', button: '🔘', switch: '⏻',
  potentiometer: '🎚', buzzer: '🔔', diode: '▷|', npn: 'Q', pnp: 'Q', mosfet: '⫟', power_supply: '🔋', relay_module: '⎍',
  water_pump: '⛲', dosing_pump: '🧪', solenoid_valve: '🚰', fan: '🌀', dc_motor: '⚙', heater: '🔥', humidifier: '💨',
  grow_light: '💡', servo: '↻', dht22: '🌡', bme280: '🌤', ds18b20: '🌡', mhz19b: 'CO₂', ph_sensor: 'pH', ec_sensor: 'EC',
  soil_moisture: '🌱', water_level_analog: '📏', float_switch: '🛟', flow_sensor: '🌊', ldr_module: '☀', bh1750: '🔆',
  leak_sensor: '💧', mcp3008: 'ADC', nextion: '📟', lcd1602_i2c: '🖥', oled_ssd1306: '▣', usb_serial: '🔌',
  dht11: '🌡', am2302: '🌡', bmp280: '🌤', sht31: '🌡', sht35: '🌡', scd30: 'CO₂', scd40: 'CO₂', ccs811: 'VOC', bme680: '🌫',
  tsl2561: '🔆', lm35: '🌡', tmp36: '🌡', ntc: 'Ω°', pt1000: 'Ω°', mq2: '🔥', mq7: 'CO', mq135: '🏭', pms5003: 'PM',
  rain_sensor: '🌧', uv_sensor: 'UV', ppfd_sensor: '☀', pir_sensor: '👁', tds_sensor: 'TDS', turbidity_sensor: '🌫',
  do_sensor: 'O₂', pressure_transducer: '⏲', hcsr04: '📡', overflow_switch: '🛟', soil_resistive: '🌱', acs712: 'A',
  rs485_soil: '🌾', ads1115: 'ADC', pcf8574: 'I/O', mcp23017: 'I/O', tca9548a: 'MUX', ds3231: '⏰', at24c32: 'ROM',
  sd_module: 'SD', hc595: '595', hc08: '&', hc32: '≥1', hc86: '=1', hc04: '¬', pc817: '⇉', level_shifter: '⇅',
  ams1117: '3V3', lm7805: '5V', buck_converter: '⇣', mb102_psu: '🔋', terminal_block: '⊞', dip_switch: '▤', ssr: 'SSR',
  pwm_fan: '🌀', sg90: '↻', mg996r: '↻', stepper_28byj48: '⎈', a4988_nema17: '⎈', drv8825_nema17: '⎈', l298n: 'H',
  tb6612: 'H', irrigation_valve: '🚿', exhaust_fan: '🌀', lcd2004_i2c: '🖥', seven_segment: '8', tm1637: '88', ws2812_strip: '✨',
  tft_st7735: '🖼', max485: '485', reservoir_tank: '🛢', fert_tank_a: 'A', fert_tank_b: 'B', ph_down_tank: 'pH−',
  grow_channel: '🥬', pipe_straight: '━', pipe_elbow: '┓', pipe_tee: '┳',
};

const FIDS: Fidelity[] = ['full', 'functional', 'experimental', 'visual'];
const BUSES = ['I2C', 'SPI', 'UART', 'Analog', '1-Wire', 'GPIO', 'RS-485'];

function matchesBus(m: PartManifest, bus: string) {
  const s = `${(m.interfaces ?? []).join(' ')} ${m.bus ?? ''} ${m.python ?? ''}`.toLowerCase();
  if (bus === 'GPIO') return /gpio|digital/.test(s) || (!m.bus && !/i2c|spi|uart|analog/.test(s) && m.drivers?.includes('gpiozero'));
  return s.includes(bus.toLowerCase());
}

export function fidelityBadge(f: Fidelity | undefined, lang: 'en' | 'ar') {
  const L = FIDELITY_LABEL[f ?? 'functional'];
  return (
    <span className={`fid fid-${f}`} title={L.help}>
      {lang === 'ar' ? L.ar : L.en}
    </span>
  );
}

export function Library() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const mode = useApp((s) => s.mode);
  const [q, setQ] = useState('');
  const [fid, setFid] = useState<Fidelity | ''>('');
  const [bus, setBus] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ 'Smart Farming Components': true });
  const add = (m: PartManifest) => {
    const c = workspaceCenter();
    useApp.getState().addComponent(m.type, snap(c.x - m.w / 2), snap(c.y - m.h / 2));
  };
  const ql = q.trim().toLowerCase();
  const list = useMemo(
    () =>
      PARTS.filter(
        (p) =>
          !p.hidden &&
          (!ql || `${p.name} ${p.short ?? ''} ${p.type} ${p.model ?? ''} ${p.manufacturer ?? ''} ${p.description} ${p.interfaces?.join(' ') ?? ''} ${p.drivers?.join(' ') ?? ''} ${p.group}`.toLowerCase().includes(ql)) &&
          (!fid || p.fidelity === fid) &&
          (!bus || matchesBus(p, bus)),
      ),
    [ql, fid, bus],
  );
  const filtering = !!(ql || fid || bus);
  const sections = GROUP_ORDER.map((g) => ({ g, items: g === 'Smart Farming Components' ? list.filter(isFarmPart) : list.filter((p) => p.group === g) })).filter((s) => s.items.length);
  return (
    <aside className="library" aria-label={t('Component library')} data-testid="library">
      <div className="panel-title">
        {t('Components')} <span className="muted small">{PARTS.filter((p) => !p.hidden).length}</span>
      </div>
      <input className="search" placeholder={t('Search name, model, driver, bus…')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Search components')} data-testid="lib-search" />
      <div className="lib-filters">
        <select value={fid} onChange={(e) => setFid(e.target.value as Fidelity | '')} aria-label={t('Simulation level')} data-testid="lib-fidelity">
          <option value="">{t('All levels')}</option>
          {FIDS.map((f) => (
            <option key={f} value={f}>
              {lang === 'ar' ? FIDELITY_LABEL[f].ar : FIDELITY_LABEL[f].en}
            </option>
          ))}
        </select>
        <select value={bus} onChange={(e) => setBus(e.target.value)} aria-label={t('Interface')} data-testid="lib-bus">
          <option value="">{t('All interfaces')}</option>
          {BUSES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
      <div className="lib-scroll">
        {!sections.length && <p className="muted small">{t('No component matches.')}</p>}
        {sections.map(({ g, items }) => {
          const collapsed = !filtering && open[g] !== true && !(g === 'Boards');
          return (
            <div key={g} className={`lib-cat ${g === 'Smart Farming Components' ? 'farm' : ''}`}>
              <button className="lib-cat-head" onClick={() => setOpen({ ...open, [g]: collapsed })} aria-expanded={!collapsed} data-testid={`lib-group-${g}`}>
                {collapsed ? '▸' : '▾'} {t(g)} <span className="muted">{items.length}</span>
              </button>
              {!collapsed && (
                <div className="lib-grid">
                  {items.map((m) => (
                    <button
                      key={m.type}
                      className="lib-item"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-part', m.type);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => add(m)}
                      title={`${m.name}${m.model ? ` — ${m.model}` : ''}\n${m.description}\n${t('Python')}: ${(m.drivers ?? []).join(', ') || '—'}`}
                      data-testid={g === 'Smart Farming Components' && m.group !== g ? `lib-farm-${m.type}` : `lib-${m.type}`}
                    >
                      <span className="lib-icon" aria-hidden>
                        {ICON[m.type] ?? '■'}
                      </span>
                      <span className="lib-text">
                        <span className="lib-name">{m.name}</span>
                        {mode === 'beginner' && <span className="lib-desc">{m.description.split('. ')[0]}.</span>}
                      </span>
                      {m.fidelity !== 'full' && <span className={`fid-dot fid-${m.fidelity}`} title={FIDELITY_LABEL[m.fidelity ?? 'functional'][lang]} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="lib-legend small muted">
        {FIDS.map((f) => (
          <span key={f}>
            <span className={`fid-dot fid-${f}`} /> {lang === 'ar' ? FIDELITY_LABEL[f].ar : FIDELITY_LABEL[f].en}
          </span>
        ))}
      </div>
    </aside>
  );
}
