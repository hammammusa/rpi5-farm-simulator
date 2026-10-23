import { useState } from 'react';
import { PARTS, type PartManifest } from '../engine/parts';
import type { Category } from '../engine/types';
import { snap } from '../engine/geometry';
import { useApp } from '../state/store';
import { useT } from '../i18n';

const CATS: { id: Category; label: string }[] = [
  { id: 'board', label: 'Boards' },
  { id: 'basic', label: 'Breadboard' },
  { id: 'output', label: 'Outputs & LEDs' },
  { id: 'input', label: 'Inputs' },
  { id: 'passive', label: 'Passives' },
  { id: 'semiconductor', label: 'Semiconductors' },
  { id: 'power', label: 'Power' },
  { id: 'sensor', label: 'Sensors' },
  { id: 'actuator', label: 'Actuators & relays' },
  { id: 'interface', label: 'Interfaces (ADC, UART)' },
  { id: 'display', label: 'Displays' },
];

export const ICON: Record<string, string> = {
  rpi5: '🍓', breadboard: '▦', led: '🔴', rgb_led: '🌈', resistor: '〰', capacitor: '⊣⊢', button: '🔘', switch: '⏻',
  potentiometer: '🎚', buzzer: '🔔', diode: '▷|', npn: 'Q', pnp: 'Q', mosfet: '⫟', power_supply: '🔋', relay_module: '⎍',
  water_pump: '⛲', dosing_pump: '🧪', solenoid_valve: '🚰', fan: '🌀', dc_motor: '⚙', heater: '🔥', humidifier: '💨',
  grow_light: '💡', servo: '↻', dht22: '🌡', bme280: '🌤', ds18b20: '🌡', mhz19b: 'CO₂', ph_sensor: 'pH', ec_sensor: 'EC',
  soil_moisture: '🌱', water_level_analog: '📏', float_switch: '🛟', flow_sensor: '🌊', ldr_module: '☀', bh1750: '🔆',
  leak_sensor: '💧', mcp3008: 'ADC', nextion: '📟', lcd1602_i2c: '🖥', oled_ssd1306: '▣', usb_serial: '🔌',
};

export function Library() {
  const t = useT();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const add = (m: PartManifest) => {
    const svg = document.querySelector('[data-testid="workspace"]') as SVGSVGElement | null;
    const g = svg?.querySelector('g[transform]');
    let x = 400,
      y = 300;
    if (svg && g) {
      const r = svg.getBoundingClientRect();
      const tr = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(g.getAttribute('transform') ?? '');
      if (tr) {
        x = (r.width / 2 - +tr[1]) / +tr[3] - m.w / 2;
        y = (r.height / 2 - +tr[2]) / +tr[3] - m.h / 2;
      }
    }
    useApp.getState().addComponent(m.type, snap(x), snap(y));
  };
  const ql = q.trim().toLowerCase();
  const list = PARTS.filter((p) => !p.hidden && (!ql || `${p.name} ${p.type} ${p.description} ${p.interfaces?.join(' ') ?? ''}`.toLowerCase().includes(ql)));
  return (
    <aside className="library" aria-label={t('Component library')}>
      <div className="panel-title">{t('Components')}</div>
      <input className="search" placeholder={t('Search components…')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Search components')} />
      <div className="lib-scroll">
        {CATS.map((cat) => {
          const items = list.filter((p) => p.category === cat.id);
          if (!items.length) return null;
          const collapsed = !ql && open[cat.id] === false;
          return (
            <div key={cat.id} className="lib-cat">
              <button className="lib-cat-head" onClick={() => setOpen({ ...open, [cat.id]: collapsed })} aria-expanded={!collapsed}>
                {collapsed ? '▸' : '▾'} {t(cat.label)} <span className="muted">{items.length}</span>
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
                      title={`${m.name}\n${m.description}`}
                      data-testid={`lib-${m.type}`}
                    >
                      <span className="lib-icon" aria-hidden>
                        {ICON[m.type] ?? '■'}
                      </span>
                      <span className="lib-name">{m.name}</span>
                      {m.support === 'partial' && <span className="badge-partial" title={m.limits}>{t('partial')}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
