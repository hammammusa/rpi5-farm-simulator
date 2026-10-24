// Drawings for the extended component library. Common layouts (sensor breakout,
// DIP IC, driver board) are shared; parts with a live visual state (digits, pixels,
// TFT, tanks, shafts) get dedicated renderers. Everything shown comes from the
// simulator's visual state `v` or the device model `dev`.
import { memo, useMemo, type ReactElement } from 'react';
import type { PartProps } from './PartView';
import type { LibraryGroup } from '../../engine/parts';
import { pinsOf } from '../../engine/parts';

const GROUP_COLOR: Partial<Record<LibraryGroup, string>> = {
  'Environmental sensors': '#1d5fa8',
  'Agriculture & water sensors': '#0f7a6b',
  'ADC & I/O expanders': '#5b3fa0',
  'Logic & memory ICs': '#262c33',
  'Motors & drivers': '#a8321d',
  'Actuators & relays': '#2f6e3a',
  Displays: '#24303b',
  Communication: '#6a4c1d',
  Power: '#7a1d4f',
  'LEDs & indicators': '#333',
  'Inputs & switches': '#333',
  Semiconductors: '#262c33',
};

const n = (x: any, d = 1) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—');

/** Generic breakout board: PCB, title, model, a live value and labelled pins. */
function Board({ p, title, sub, color, chip = true }: { p: PartProps; title: string; sub?: string; color?: string; chip?: boolean }) {
  const { m } = p;
  const pins = pinsOf(m, p.props);
  const c = color ?? GROUP_COLOR[m.group ?? 'Communication'] ?? '#1d5fa8';
  return (
    <g>
      <rect x={-6} y={-4} width={m.w + 12} height={m.h + 4} rx={4} fill={c} stroke="#0008" />
      {[4, m.w - 4].map((x) => (
        <circle key={x} cx={x} cy={2} r={2.2} fill="#cfcfcf" opacity={0.8} />
      ))}
      {chip && m.w >= 40 && <rect x={m.w / 2 - 9} y={m.h / 2 - 16} width={18} height={14} rx={1.5} fill="#151515" />}
      <text x={m.w / 2} y={11} className="pt-label" textAnchor="middle" fill="#fff">
        {title}
      </text>
      {sub && (
        <text x={m.w / 2} y={m.h / 2 + 8} className="pt-value" textAnchor="middle" fill="#ffe680">
          {sub}
        </text>
      )}
      {pins.map((pp) => (
        <text key={pp.id} x={pp.x} y={pp.y + (pp.y >= m.h - 12 ? -6 : pp.y <= 2 ? 11 : 3)} dx={pp.x <= 0 ? 6 : pp.x >= m.w ? -6 : 0} className="pt-pin" textAnchor={pp.x <= 0 ? 'start' : pp.x >= m.w ? 'end' : 'middle'} fill="#fff">
          {pp.label.length > 6 ? pp.id : pp.label}
        </text>
      ))}
    </g>
  );
}

/** DIP package drawn the usual way (notch on the left). */
function Dip({ p, title }: { p: PartProps; title: string }) {
  const { m } = p;
  return (
    <g>
      <rect x={-4} y={4} width={m.w + 8} height={22} rx={2} fill="#1d1d1f" stroke="#000" />
      <path d={`M-4 11 a4 4 0 0 1 0 8`} fill="#444" />
      <text x={m.w / 2} y={19} className="pt-label" textAnchor="middle" fill="#ddd">
        {title}
      </text>
    </g>
  );
}

const SEGS: Record<string, string> = {
  a: 'M8 4 h24 l-3 4 h-18z',
  b: 'M33 6 l3 3 v20 l-3 3 l-3 -3 v-17z',
  c: 'M33 38 l3 3 v20 l-3 3 l-3 -3 v-17z',
  d: 'M8 66 h24 l-3 -4 h-18z',
  e: 'M7 38 l-3 3 v20 l3 3 l3 -3 v-17z',
  f: 'M7 6 l-3 3 v20 l3 3 l3 -3 v-17z',
  g: 'M9 35 l3 -3 h16 l3 3 l-3 3 h-16z',
};
const SEG_ORDER = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

function Digit({ bits, x, color, dp }: { bits: number | Record<string, number>; x: number; color: string; dp?: number }) {
  const lvl = (s: string, i: number) => (typeof bits === 'number' ? ((bits >> i) & 1 ? 1 : 0) : bits[s] ?? 0);
  return (
    <g transform={`translate(${x} 0)`}>
      {SEG_ORDER.map((s, i) => (
        <path key={s} d={SEGS[s]} fill={color} opacity={0.12 + 0.88 * lvl(s, i)} />
      ))}
      {dp !== undefined && <circle cx={38} cy={64} r={2.5} fill={color} opacity={0.12 + 0.88 * dp} />}
    </g>
  );
}

const Tft = memo(function Tft({ dev, powered, w, h }: { dev: any; powered: boolean; w: number; h: number }) {
  const view = dev?.view?.();
  const url = useMemo(() => {
    if (!powered || !view?.on || typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = view.w;
    c.height = view.h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(view.w, view.h);
    for (let i = 0; i < view.w * view.h; i++) {
      let px = view.fb[i];
      if (view.invert) px = ~px & 0xffff;
      img.data[i * 4] = ((px >> 11) & 31) * 8.2;
      img.data[i * 4 + 1] = ((px >> 5) & 63) * 4.05;
      img.data[i * 4 + 2] = (px & 31) * 8.2;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }, [view?.version, powered, view?.on]);
  return (
    <g>
      <rect x={-6} y={-4} width={w + 12} height={h - 4} rx={3} fill="#c01919" />
      <rect x={4} y={6} width={w - 8} height={h - 34} fill="#050505" />
      {url && <image href={url} x={4} y={6} width={w - 8} height={h - 34} preserveAspectRatio="none" style={{ imageRendering: 'pixelated' }} />}
      <text x={w / 2} y={h - 18} className="pt-tiny" textAnchor="middle" fill="#fff">
        1.8&quot; TFT ST7735
      </text>
    </g>
  );
});

function Tank({ p, color, max }: { p: PartProps; color: string; max: number }) {
  const { m, v } = p;
  const lvl = Math.max(0, Math.min(1, (v?.level ?? 0) / max));
  const H = m.h - 20;
  return (
    <g>
      <rect x={0} y={4} width={m.w} height={H} rx={8} fill="#cfd8dc22" stroke="#9fb0c0" strokeWidth={2} />
      <rect x={3} y={4 + H * (1 - lvl)} width={m.w - 6} height={H * lvl} rx={6} fill={color} opacity={0.75} />
      <text x={m.w / 2} y={m.h - 4} className="pt-label" textAnchor="middle" fill="var(--text)">
        {m.short}
      </text>
      <text x={m.w / 2} y={20} className="pt-value" textAnchor="middle" fill="#fff">
        {n(v?.level, 2)} L
      </text>
      {v?.ec !== undefined && (
        <text x={m.w / 2} y={34} className="pt-tiny" textAnchor="middle" fill="#fff">
          EC {n(v.ec, 2)} · pH {n(v.ph, 2)}
        </text>
      )}
    </g>
  );
}

export function extraBody(p: PartProps): ReactElement | null {
  const { comp, m, props, v, dev } = p;
  const t = comp.type;
  const sensorVal = () => {
    for (const d of m.props) if (d.group === 'sensor' && d.type === 'number' && props.source !== 'farm') return `${n(props[d.key], d.step && d.step >= 1 ? 0 : 1)} ${d.unit ?? ''}`;
    if (v?.value !== undefined) return n(v.value, 2);
    return undefined;
  };
  switch (t) {
    case 'seven_segment': {
      const col = { red: '#ff3030', green: '#3f3', blue: '#39f', yellow: '#fd0' }[props.color as string] ?? '#f33';
      return (
        <g>
          <rect x={-4} y={-4} width={m.w + 8} height={m.h + 8} rx={3} fill="#151515" />
          <g transform="translate(5 0)">
            <Digit bits={v?.seg ?? {}} x={0} color={col} dp={v?.seg?.dp ?? 0} />
          </g>
        </g>
      );
    }
    case 'tm1637': {
      const digits: number[] = v?.digits ?? [0, 0, 0, 0];
      const on = !!v?.on;
      return (
        <g>
          <rect x={-4} y={-4} width={m.w + 4} height={m.h + 8} rx={3} fill="#1b4fa0" />
          <rect x={2} y={0} width={104} height={m.h} rx={2} fill="#111" />
          <g transform="translate(6 6) scale(0.52)">
            {digits.map((b, i) => (
              <Digit key={i} bits={on ? b & 0x7f : 0} x={i * 48 + (i >= 2 ? 6 : 0)} color="#ff3a2a" />
            ))}
            <circle cx={99} cy={22} r={3} fill="#ff3a2a" opacity={on && digits[1] & 0x80 ? 1 : 0.12} />
            <circle cx={99} cy={46} r={3} fill="#ff3a2a" opacity={on && digits[1] & 0x80 ? 1 : 0.12} />
          </g>
        </g>
      );
    }
    case 'ws2812_strip': {
      const count = Number(props.count) || 8;
      const px: number[][] = v?.pixels ?? [];
      const step = (m.w - 20) / count;
      return (
        <g>
          <rect x={0} y={4} width={m.w} height={32} rx={3} fill="#f2f2f2" stroke="#bbb" />
          {Array.from({ length: count }, (_, i) => {
            const c = px[i] ?? [0, 0, 0];
            const lit = c[0] + c[1] + c[2] > 0;
            return (
              <g key={i}>
                <rect x={10 + i * step + step / 2 - 6} y={14} width={12} height={12} rx={2} fill={lit ? `rgb(${Math.min(255, c[0] * 2)},${Math.min(255, c[1] * 2)},${Math.min(255, c[2] * 2)})` : '#ddd'} stroke="#999" />
                {lit && <circle cx={10 + i * step + step / 2} cy={20} r={9} fill={`rgb(${c[0]},${c[1]},${c[2]})`} opacity={0.35} className="glow" />}
              </g>
            );
          })}
        </g>
      );
    }
    case 'lcd2004_i2c': {
      const view = dev?.view?.();
      const lines: string[] = v?.powered && view?.on ? view.lines : ['', '', '', ''];
      const bl = v?.powered && view?.backlight;
      return (
        <g>
          <rect x={6} y={0} width={194} height={90} rx={3} fill="#1a4f9a" stroke="#0b2a5a" />
          <rect x={14} y={8} width={178} height={74} rx={2} fill={bl ? '#7fd3ff' : '#2a4a6a'} />
          {lines.map((l, i) => (
            <text key={i} x={18} y={24 + i * 17} className="lcd-text" style={{ fontSize: 13 }}>
              {l}
            </text>
          ))}
        </g>
      );
    }
    case 'tft_st7735':
      return <Tft dev={dev} powered={!!v?.powered} w={m.w} h={m.h} />;
    case 'reservoir_tank':
      return <Tank p={p} color="#2b7bd6" max={40} />;
    case 'fert_tank_a':
      return <Tank p={p} color="#8e5bd6" max={2} />;
    case 'fert_tank_b':
      return <Tank p={p} color="#e6b800" max={2} />;
    case 'ph_down_tank':
      return <Tank p={p} color="#e0393e" max={1} />;
    case 'grow_channel': {
      const k = Number(props.plants) || 6;
      const flow = (v?.flow ?? 0) > 0.05;
      return (
        <g>
          <rect x={0} y={20} width={m.w} height={24} rx={4} fill="#e8e8e8" stroke="#9aa" />
          <rect x={4} y={38} width={m.w - 8} height={4} fill={flow ? '#4fa3ff' : '#cfd8dc'} className={flow ? 'pulse' : ''} />
          {Array.from({ length: k }, (_, i) => {
            const x = 16 + (i * (m.w - 32)) / Math.max(1, k - 1);
            return (
              <g key={i}>
                <circle cx={x} cy={26} r={6} fill="#333" />
                <path d={`M${x} 24 q-10 -14 -2 -22 q4 8 2 22 q8 -12 12 -10 q-4 10 -12 10`} fill={v?.stress?.length ? '#a7a33a' : '#3fae4a'} />
              </g>
            );
          })}
          <text x={m.w - 4} y={56} className="pt-tiny" textAnchor="end" fill="var(--muted)">
            {flow ? `${n(v?.flow, 1)} L/min` : 'no flow'}
          </text>
        </g>
      );
    }
    case 'pipe_straight':
      return <rect x={0} y={4} width={m.w} height={12} rx={4} fill={props.colour} stroke="#6b7b8a" />;
    case 'pipe_elbow':
      return <path d={`M0 4 h40 a16 16 0 0 1 16 16 v40 h-12 v-38 a6 6 0 0 0 -6 -6 h-38z`} fill={props.colour} stroke="#6b7b8a" />;
    case 'pipe_tee':
      return (
        <g fill={props.colour} stroke="#6b7b8a">
          <rect x={0} y={4} width={m.w} height={12} rx={4} />
          <rect x={m.w / 2 - 6} y={10} width={12} height={m.h - 10} rx={4} />
        </g>
      );
    case 'stepper_28byj48':
    case 'a4988_nema17':
    case 'drv8825_nema17': {
      const ang = v?.angle ?? 0;
      const cx = t === 'stepper_28byj48' ? 62 : 50;
      const cy = t === 'stepper_28byj48' ? 30 : 45;
      return (
        <g>
          {t === 'stepper_28byj48' ? (
            <g>
              <rect x={-4} y={22} width={34} height={56} rx={3} fill="#2f6e3a" />
              <text x={13} y={34} className="pt-tiny" textAnchor="middle" fill="#fff">
                ULN2003
              </text>
              {[0, 1, 2, 3].map((k) => (
                <circle key={k} cx={20} cy={44 + k * 7} r={2.4} fill={(v?.coils ?? 0) & (1 << k) ? '#ff3b30' : '#400'} />
              ))}
              <circle cx={cx} cy={cy} r={24} fill="#c9c9c9" stroke="#888" />
            </g>
          ) : (
            <g>
              <rect x={0} y={0} width={m.w} height={m.h} rx={3} fill={t === 'a4988_nema17' ? '#1e6b3a' : '#5b2a8a'} />
              <rect x={18} y={12} width={64} height={64} rx={6} fill="#2a2a2a" stroke="#777" />
              <text x={50} y={86} className="pt-tiny" textAnchor="middle" fill="#fff">
                {m.short} · NEMA 17
              </text>
            </g>
          )}
          <g transform={`rotate(${ang} ${cx} ${cy})`}>
            <circle cx={cx} cy={cy} r={6} fill="#eee" stroke="#555" />
            <rect x={cx - 1.5} y={cy - 20} width={3} height={16} fill="#e33" />
          </g>
          <text x={cx} y={cy + (t === 'stepper_28byj48' ? 38 : 6)} className="pt-value" textAnchor="middle" fill="#ffe680">
            {n(ang, 0)}°
          </text>
        </g>
      );
    }
    case 'pwm_fan': {
      const run = v?.run ?? 0;
      return (
        <g>
          <rect x={0} y={0} width={m.w} height={m.h - 10} rx={6} fill="#222" />
          <g className={run > 0.02 ? 'spin' : ''} style={{ transformOrigin: `${m.w / 2}px ${(m.h - 10) / 2}px`, animationDuration: `${Math.max(0.15, 1.2 / Math.max(0.1, run))}s` }}>
            {[0, 72, 144, 216, 288].map((a) => (
              <path key={a} d={`M${m.w / 2} ${(m.h - 10) / 2} q14 -20 4 -28 q-10 8 -4 28`} fill="#666" transform={`rotate(${a} ${m.w / 2} ${(m.h - 10) / 2})`} />
            ))}
          </g>
          <text x={m.w / 2} y={m.h - 2} className="pt-value" textAnchor="middle" fill="var(--text)">
            {n(v?.rpm, 0)} rpm
          </text>
        </g>
      );
    }
    case 'hcsr04':
      return (
        <g>
          <rect x={0} y={0} width={m.w} height={m.h - 8} rx={3} fill="#1d5fa8" />
          {[18, 52].map((x) => (
            <g key={x}>
              <circle cx={x} cy={16} r={13} fill="#ccc" stroke="#888" />
              <circle cx={x} cy={16} r={8} fill={v?.echo ? '#7fd3ff' : '#444'} />
            </g>
          ))}
          <text x={m.w / 2} y={36} className="pt-value" textAnchor="middle" fill="#ffe680">
            {n(props.source === 'farm' ? v?.distance : props.distance, 1)} cm
          </text>
        </g>
      );
    case 'pir_sensor':
      return (
        <g>
          <rect x={-4} y={-4} width={m.w + 8} height={m.h - 4} rx={3} fill="#2a8a3a" />
          <circle cx={m.w / 2} cy={18} r={16} fill={v?.motion ? '#fff7c2' : '#f0f0f0'} stroke="#bbb" />
          <text x={m.w / 2} y={22} className="pt-tiny" textAnchor="middle" fill="#555">
            PIR
          </text>
        </g>
      );
    case 'ssr':
      return (
        <g>
          <rect x={4} y={0} width={m.w - 8} height={m.h - 10} rx={4} fill="#d8d8d8" stroke="#888" />
          <text x={m.w / 2} y={18} className="pt-label" textAnchor="middle" fill="#333">
            SSR
          </text>
          <circle cx={m.w / 2} cy={32} r={4} fill={v?.on ? '#ff3b30' : '#600'} />
        </g>
      );
    case 'dip_switch':
      return (
        <g>
          <rect x={-4} y={4} width={m.w + 8} height={22} rx={2} fill="#c0392b" />
          {[1, 2, 3, 4].map((k) => (
            <g key={k} className="press-target" data-sw={k - 1}>
              <rect x={(k - 1) * 10 - 3} y={8} width={6} height={14} fill="#fff" />
              <rect x={(k - 1) * 10 - 3} y={props[`sw${k}`] ? 8 : 15} width={6} height={7} fill="#333" />
            </g>
          ))}
        </g>
      );
    case 'terminal_block':
      return (
        <g>
          {Array.from({ length: Number(props.positions) || 2 }, (_, i) => (
            <g key={i}>
              <rect x={i * 10 - 5} y={4} width={10} height={32} fill="#1e88e5" stroke="#0d47a1" />
              <circle cx={i * 10} cy={14} r={3} fill="#ccc" />
            </g>
          ))}
        </g>
      );
    default:
      break;
  }
  if (m.pins && /^hc0|^hc3|^hc8|^hc595|^pc817/.test(t)) return <Dip p={p} title={m.short ?? t} />;
  if (m.fidelity === 'visual') return <Board p={p} title={m.short ?? m.name} sub="visual only" color="#555" chip={false} />;
  const val = v?.powered === false && m.props.some((d) => d.group === 'sensor') ? 'no power' : sensorVal();
  return <Board p={p} title={m.short ?? m.name} sub={val} />;
}
