// SVG bodies for every component, drawn in local coordinates (before rotation).
// Every animated/lit state comes from the simulator's computed visual state `v`.
import { memo, useMemo } from 'react';
import type { ComponentInstance } from '../../engine/types';
import type { PartManifest } from '../../engine/parts';
import { NextionScreen } from '../nextion/NextionScreen';

export interface PartProps {
  comp: ComponentInstance;
  m: PartManifest;
  props: Record<string, any>;
  v: Record<string, any> | undefined;
  dev: any;
  running: boolean;
  /** bumps when a display device's internal state changes */
  ver?: number;
}

const LED_RGB: Record<string, [number, number, number]> = {
  red: [255, 40, 40],
  green: [40, 230, 70],
  yellow: [255, 220, 40],
  blue: [50, 120, 255],
  white: [255, 255, 245],
};

const BAND = ['#000', '#8b4513', '#e00', '#f80', '#ff0', '#0a0', '#00f', '#90f', '#888', '#fff'];
function bands(ohms: number) {
  const s = String(Math.round(ohms));
  const d1 = +s[0];
  const d2 = +(s[1] ?? 0);
  const mult = Math.max(0, s.length - 2);
  return [BAND[d1], BAND[d2], BAND[mult] ?? '#000', '#c9a227'];
}

function Spin({ on, speed = 1, cx, cy, children }: { on: boolean; speed?: number; cx: number; cy: number; children: React.ReactNode }) {
  const dur = on ? Math.max(0.15, 1.2 / Math.max(0.1, Math.abs(speed))) : 0;
  return (
    <g
      className={on ? 'spin' : ''}
      style={{ transformOrigin: `${cx}px ${cy}px`, animationDuration: `${dur}s`, animationDirection: speed < 0 ? 'reverse' : 'normal' }}
    >
      {children}
    </g>
  );
}

function Module({ w, h, color = '#1d5fa8', label, sub }: { w: number; h: number; color?: string; label: string; sub?: string }) {
  return (
    <g>
      <rect x={-6} y={0} width={w + 6} height={h - 12} rx={4} fill={color} stroke="#0008" />
      <text x={w / 2 - 3} y={14} className="pt-label" textAnchor="middle" fill="#fff">
        {label}
      </text>
      {sub && (
        <text x={w / 2 - 3} y={27} className="pt-value" textAnchor="middle" fill="#ffe680">
          {sub}
        </text>
      )}
    </g>
  );
}

function fmt(v: any, d = 1) {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—';
}

function Pi5() {
  return (
    <g>
      <rect x={0} y={0} width={340} height={230} rx={12} fill="#1e7a3c" stroke="#0e4d24" strokeWidth={2} />
      {[
        [14, 14],
        [326, 14],
        [14, 216],
        [236, 216],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={6} fill="#d9d9d9" stroke="#999" />
      ))}
      {/* GPIO header housing */}
      <rect x={33} y={13} width={204} height={24} rx={2} fill="#111" />
      <text x={36} y={50} className="pt-tiny" fill="#fff">
        1
      </text>
      <text x={222} y={10} className="pt-tiny" fill="#fff">
        40
      </text>
      <text x={250} y={30} className="pt-tiny" fill="#cfe">
        J8 GPIO
      </text>
      {/* SoC */}
      <rect x={110} y={90} width={70} height={70} rx={4} fill="#c8c8c8" stroke="#888" />
      <text x={145} y={122} className="pt-label" textAnchor="middle" fill="#333">
        BCM2712
      </text>
      <text x={145} y={136} className="pt-tiny" textAnchor="middle" fill="#555">
        Cortex-A76
      </text>
      <rect x={196} y={92} width={42} height={26} rx={2} fill="#222" />
      <text x={217} y={109} className="pt-tiny" textAnchor="middle" fill="#ccc">
        8GB
      </text>
      <rect x={200} y={140} width={34} height={34} rx={2} fill="#333" />
      <text x={217} y={160} className="pt-tiny" textAnchor="middle" fill="#ccc">
        RP1
      </text>
      {/* ports on the right */}
      <rect x={300} y={20} width={44} height={42} rx={2} fill="#b0b0b0" stroke="#777" />
      <rect x={300} y={70} width={44} height={36} rx={2} fill="#b0b0b0" stroke="#777" />
      <rect x={306} y={78} width={34} height={8} fill="#1f5fd1" />
      <rect x={306} y={92} width={34} height={8} fill="#1f5fd1" />
      <rect x={300} y={114} width={44} height={36} rx={2} fill="#b0b0b0" stroke="#777" />
      <rect x={306} y={122} width={34} height={8} fill="#111" />
      <rect x={306} y={136} width={34} height={8} fill="#111" />
      <text x={322} y={46} className="pt-tiny" textAnchor="middle" fill="#333">
        ETH
      </text>
      {/* bottom: USB-C, 2x micro HDMI */}
      <rect x={30} y={214} width={26} height={18} rx={4} fill="#aaa" stroke="#777" />
      <text x={43} y={208} className="pt-tiny" textAnchor="middle" fill="#fff">
        USB-C 5V
      </text>
      <rect x={80} y={216} width={20} height={14} rx={2} fill="#aaa" />
      <rect x={112} y={216} width={20} height={14} rx={2} fill="#aaa" />
      <text x={106} y={208} className="pt-tiny" textAnchor="middle" fill="#fff">
        HDMI0 · HDMI1
      </text>
      <circle cx={18} cy={190} r={6} fill="#222" stroke="#666" />
      <text x={28} y={193} className="pt-tiny" fill="#fff">
        PWR
      </text>
      <rect x={160} y={176} width={34} height={8} fill="#ddd" />
      <rect x={160} y={190} width={34} height={8} fill="#ddd" />
      <text x={20} y={80} className="pt-title" fill="#fff">
        Raspberry Pi 5
      </text>
      <text x={20} y={96} className="pt-tiny" fill="#cfe">
        Model B · 8GB · © 2023
      </text>
    </g>
  );
}

function Breadboard({ props }: { props: Record<string, any> }) {
  const cols = props.size === 'full' ? 60 : 30;
  const w = 20 + cols * 10;
  return (
    <g>
      <rect x={0} y={0} width={w + 10} height={210} rx={6} className="bb-body" />
      <rect x={6} y={103} width={w - 2} height={14} className="bb-channel" />
      <line x1={10} y1={4} x2={w} y2={4} stroke="#2a62d6" strokeWidth={1.5} />
      <line x1={10} y1={26} x2={w} y2={26} stroke="#d92b2b" strokeWidth={1.5} />
      <line x1={10} y1={184} x2={w} y2={184} stroke="#d92b2b" strokeWidth={1.5} />
      <line x1={10} y1={206} x2={w} y2={206} stroke="#2a62d6" strokeWidth={1.5} />
      <text x={6} y={13} className="pt-tiny bb-text">
        −
      </text>
      <text x={5} y={23} className="pt-tiny bb-text">
        +
      </text>
      <text x={5} y={193} className="pt-tiny bb-text">
        +
      </text>
      <text x={6} y={203} className="pt-tiny bb-text">
        −
      </text>
      {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((r, i) => (
        <text key={r} x={4} y={(i < 5 ? 53 : 63) + i * 10} className="pt-tiny bb-text">
          {r}
        </text>
      ))}
      {Array.from({ length: cols / 5 }, (_, i) => (i + 1) * 5).map((c) => (
        <text key={c} x={10 + c * 10} y={42} className="pt-tiny bb-text" textAnchor="middle">
          {c}
        </text>
      ))}
    </g>
  );
}

function Led({ props, v }: { props: any; v: any }) {
  const [r, g, b] = LED_RGB[props.color] ?? LED_RGB.red;
  const br = v?.burned ? 0 : v?.brightness ?? 0;
  const fill = v?.burned ? '#3a3a3a' : `rgba(${r},${g},${b},${0.35 + 0.65 * br})`;
  return (
    <g>
      <line x1={0} y1={22} x2={0} y2={40} stroke="#aaa" strokeWidth={2} />
      <path d="M10 22 L10 30 L10 40" stroke="#aaa" strokeWidth={2} fill="none" />
      {br > 0 && <circle cx={5} cy={12} r={10 + 12 * br} fill={`rgba(${r},${g},${b},${0.25 * br})`} className="glow" />}
      <path d="M-4 22 L-4 10 A9 9 0 0 1 14 10 L14 22 Z" fill={fill} stroke="#0005" />
      <rect x={-5} y={20} width={20} height={3} fill={fill} stroke="#0004" />
      {v?.burned && <text x={5} y={14} textAnchor="middle" className="pt-tiny" fill="#fff">✕</text>}
    </g>
  );
}

function RgbLed({ v }: { v: any }) {
  const c = `rgb(${Math.round(60 + 195 * (v?.R ?? 0))},${Math.round(60 + 195 * (v?.G ?? 0))},${Math.round(60 + 195 * (v?.B ?? 0))})`;
  const lit = (v?.R ?? 0) + (v?.G ?? 0) + (v?.B ?? 0) > 0;
  return (
    <g>
      {[0, 10, 20, 30].map((x) => (
        <line key={x} x1={x} y1={22} x2={x} y2={40} stroke="#aaa" strokeWidth={2} />
      ))}
      {lit && <circle cx={15} cy={10} r={20} fill={c} opacity={0.3} />}
      <path d="M3 22 L3 8 A12 12 0 0 1 27 8 L27 22 Z" fill={lit ? c : '#dde'} stroke="#0005" />
      <text x={15} y={48} className="pt-tiny" textAnchor="middle">
        R C G B
      </text>
    </g>
  );
}

function Resistor({ props }: { props: any }) {
  const b = bands(Number(props.ohms) || 220);
  return (
    <g>
      <line x1={0} y1={0} x2={40} y2={0} stroke="#aaa" strokeWidth={2} />
      <rect x={8} y={-5} width={24} height={10} rx={4} fill="#e7cf9f" stroke="#a38a5a" />
      {b.map((c, i) => (
        <rect key={i} x={11 + i * 5 + (i === 3 ? 2 : 0)} y={-5} width={2.5} height={10} fill={c} />
      ))}
    </g>
  );
}

function body(p: PartProps) {
  const { comp, props, v, dev } = p;
  switch (comp.type) {
    case 'rpi5':
      return <Pi5 />;
    case 'breadboard':
      return <Breadboard props={props} />;
    case 'led':
      return <Led props={props} v={v} />;
    case 'rgb_led':
      return <RgbLed v={v} />;
    case 'resistor':
      return <Resistor props={props} />;
    case 'capacitor':
      return (
        <g>
          <line x1={0} y1={14} x2={0} y2={20} stroke="#aaa" strokeWidth={2} />
          <line x1={10} y1={14} x2={10} y2={20} stroke="#aaa" strokeWidth={2} />
          {props.kind === 'ceramic' ? (
            <ellipse cx={5} cy={8} rx={8} ry={7} fill="#e0a030" />
          ) : (
            <g>
              <rect x={-4} y={-6} width={18} height={20} rx={3} fill="#1a3d7a" />
              <rect x={9} y={-6} width={4} height={20} fill="#cfd8e6" />
            </g>
          )}
        </g>
      );
    case 'button':
      return (
        <g>
          <rect x={-3} y={4} width={26} height={22} rx={2} fill="#333" stroke="#111" />
          <circle cx={10} cy={15} r={7} fill={v?.pressed ? '#a00' : '#e33'} stroke="#600" className="press-target" />
        </g>
      );
    case 'switch':
      return (
        <g className="press-target">
          <rect x={-4} y={2} width={28} height={14} rx={2} fill="#3a3a3a" />
          <rect x={props.position === 'A' ? -2 : 12} y={4} width={12} height={10} rx={1} fill="#ddd" />
        </g>
      );
    case 'potentiometer': {
      const ang = -135 + 2.7 * Number(props.position ?? 50);
      return (
        <g>
          <rect x={-4} y={0} width={28} height={26} rx={3} fill="#2154a6" />
          <circle cx={10} cy={13} r={10} fill="#ddd" stroke="#888" />
          <line x1={10} y1={13} x2={10 + 8 * Math.sin((ang * Math.PI) / 180)} y2={13 - 8 * Math.cos((ang * Math.PI) / 180)} stroke="#333" strokeWidth={2.5} />
        </g>
      );
    }
    case 'buzzer':
      return (
        <g>
          <circle cx={10} cy={14} r={14} fill="#111" />
          <circle cx={10} cy={14} r={3} fill="#444" />
          <text x={-1} y={6} className="pt-tiny" fill="#fff">
            +
          </text>
          {v?.on && (
            <g className="pulse">
              <path d="M28 4 Q34 14 28 24" stroke="#fb4" strokeWidth={2} fill="none" />
              <path d="M33 0 Q42 14 33 28" stroke="#fb4" strokeWidth={2} fill="none" />
            </g>
          )}
        </g>
      );
    case 'diode':
      return (
        <g>
          <line x1={0} y1={0} x2={40} y2={0} stroke="#aaa" strokeWidth={2} />
          <rect x={10} y={-5} width={20} height={10} rx={2} fill="#111" />
          <rect x={25} y={-5} width={3} height={10} fill="#ccc" />
        </g>
      );
    case 'npn':
    case 'pnp':
      return (
        <g>
          {[0, 10, 20].map((x) => (
            <line key={x} x1={x} y1={18} x2={x} y2={30} stroke="#aaa" strokeWidth={2} />
          ))}
          <path d="M-4 18 L-4 6 A14 12 0 0 1 24 6 L24 18 Z" fill="#111" />
          <text x={10} y={14} className="pt-tiny" textAnchor="middle" fill="#ddd">
            {comp.type === 'npn' ? '2N2222' : '2N2907'}
          </text>
          <text x={10} y={42} className="pt-tiny" textAnchor="middle">
            E B C
          </text>
        </g>
      );
    case 'mosfet':
      return (
        <g>
          {[0, 10, 20].map((x) => (
            <line key={x} x1={x} y1={26} x2={x} y2={40} stroke="#aaa" strokeWidth={2} />
          ))}
          <rect x={-6} y={-6} width={32} height={10} fill="#bbb" />
          <circle cx={10} cy={-1} r={3} fill="#666" />
          <rect x={-6} y={4} width={32} height={22} fill="#111" />
          <text x={10} y={18} className="pt-tiny" textAnchor="middle" fill={v?.on ? '#7f7' : '#ddd'}>
            {props.model}
          </text>
          <text x={10} y={50} className="pt-tiny" textAnchor="middle">
            G D S
          </text>
        </g>
      );
    case 'power_supply':
      return (
        <g>
          <rect x={0} y={0} width={90} height={60} rx={5} fill="#2c2f36" stroke="#000" />
          <rect x={8} y={10} width={50} height={22} rx={2} fill={v?.on ? '#0b2' : '#222'} />
          <text x={33} y={26} className="pt-value" textAnchor="middle" fill={v?.on ? '#dfd' : '#555'}>
            {v?.on ? `${Number(props.volts).toFixed(1)}V` : 'OFF'}
          </text>
          <text x={33} y={48} className="pt-tiny" textAnchor="middle" fill="#bbb">
            {v?.on ? `${fmt(v?.amps, 2)} A` : ''}
          </text>
          <text x={80} y={23} className="pt-tiny" fill="#f66">
            +
          </text>
          <text x={80} y={43} className="pt-tiny" fill="#9cf">
            −
          </text>
        </g>
      );
    case 'relay_module': {
      const n = Number(props.channels) || 1;
      const h = Math.max(50, n * 40);
      return (
        <g>
          <rect x={0} y={0} width={120} height={h} rx={4} fill="#13509e" stroke="#0a2c58" />
          {Array.from({ length: n }, (_, k) => {
            const ch = v?.ch?.[k];
            return (
              <g key={k} transform={`translate(0 ${k * 40})`}>
                <rect x={44} y={6} width={46} height={28} rx={2} fill="#1f6fe0" stroke="#0a3d8a" />
                <text x={67} y={18} className="pt-tiny" textAnchor="middle" fill="#fff">
                  SRD-{props.coil}VDC
                </text>
                <text x={67} y={29} className="pt-tiny" textAnchor="middle" fill="#cde">
                  {ch?.energised ? 'NO ● COM' : 'NC ● COM'}
                </text>
                <circle cx={34} cy={12} r={3.5} fill={ch?.active ? '#f33' : '#422'} />
                <rect x={102} y={4} width={18} height={32} fill="#1a8a3a" />
              </g>
            );
          })}
          <text x={8} y={h - 6} className="pt-tiny" fill="#fff">
            {props.trigger === 'low' ? 'LOW trig' : 'HIGH trig'}
          </text>
        </g>
      );
    }
    case 'water_pump':
      return (
        <g>
          <rect x={6} y={8} width={70} height={46} rx={10} fill="#262a33" stroke="#000" />
          <circle cx={46} cy={31} r={17} fill="#3b6fb6" />
          <Spin on={(v?.run ?? 0) > 0 && !v?.noFlow} speed={v?.run} cx={46} cy={31}>
            {[0, 60, 120].map((a) => (
              <rect key={a} x={44} y={16} width={4} height={30} fill="#9cf" transform={`rotate(${a} 46 31)`} />
            ))}
          </Spin>
          <text x={14} y={22} className="pt-tiny" fill="#ddd">
            PUMP
          </text>
          <text x={14} y={66} className="pt-tiny" fill={v?.run ? '#6f6' : '#999'}>
            {v?.run ? (v?.noFlow ? 'NO FLOW' : `ON ${props.rate}L/min`) : 'OFF'}
          </text>
        </g>
      );
    case 'dosing_pump':
      return (
        <g>
          <rect x={6} y={4} width={60} height={50} rx={6} fill="#e8e8e8" stroke="#888" />
          <circle cx={36} cy={28} r={18} fill="#c8d6e8" stroke="#567" />
          <Spin on={Math.abs(v?.run ?? 0) > 0 && !v?.noFlow} speed={v?.run} cx={36} cy={28}>
            {[0, 120, 240].map((a) => (
              <circle key={a} cx={36} cy={14} r={4} fill="#567" transform={`rotate(${a} 36 28)`} />
            ))}
          </Spin>
          <text x={10} y={66} className="pt-tiny" fill={v?.run ? '#6f6' : '#999'}>
            {v?.run ? `ON ${props.rate}ml/min` : 'OFF'}
          </text>
        </g>
      );
    case 'solenoid_valve':
      return (
        <g>
          <rect x={6} y={26} width={60} height={14} fill="#c9a227" />
          <rect x={22} y={4} width={28} height={24} rx={3} fill="#222" />
          <text x={36} y={19} className="pt-tiny" textAnchor="middle" fill={v?.run ? '#6f6' : '#aaa'}>
            {v?.run ? 'OPEN' : 'CLOSED'}
          </text>
        </g>
      );
    case 'fan':
      return (
        <g>
          <rect x={6} y={0} width={64} height={64} rx={6} fill="#1c1c1c" stroke="#000" />
          <circle cx={38} cy={32} r={28} fill="#2c2c2c" />
          <Spin on={(v?.run ?? 0) > 0} speed={v?.run} cx={38} cy={32}>
            {[0, 72, 144, 216, 288].map((a) => (
              <ellipse key={a} cx={38} cy={16} rx={7} ry={14} fill="#666" transform={`rotate(${a} 38 32)`} />
            ))}
          </Spin>
          <circle cx={38} cy={32} r={6} fill="#999" />
        </g>
      );
    case 'dc_motor':
      return (
        <g>
          <rect x={6} y={10} width={44} height={30} rx={6} fill="#aaa" stroke="#666" />
          <Spin on={Math.abs(v?.run ?? 0) > 0} speed={v?.run} cx={58} cy={25}>
            <circle cx={58} cy={25} r={7} fill="#ddd" stroke="#777" />
            <rect x={57} y={18} width={2} height={7} fill="#333" />
          </Spin>
        </g>
      );
    case 'heater': {
      const on = (v?.run ?? 0) > 0;
      return (
        <g>
          <rect x={6} y={6} width={74} height={34} rx={4} fill="#444" />
          <path d="M14 23 h8 l4 -10 l8 20 l8 -20 l8 20 l8 -20 l4 10 h8" stroke={on ? '#ff5a1f' : '#888'} strokeWidth={3} fill="none" className={on ? 'glow' : ''} />
        </g>
      );
    }
    case 'humidifier': {
      const on = (v?.run ?? 0) > 0;
      return (
        <g>
          <rect x={6} y={20} width={50} height={26} rx={6} fill="#e8f0f8" stroke="#89a" />
          {on && (
            <g className="mist">
              <circle cx={20} cy={14} r={6} fill="#cde8ff" />
              <circle cx={32} cy={8} r={8} fill="#cde8ff" />
              <circle cx={44} cy={14} r={6} fill="#cde8ff" />
            </g>
          )}
        </g>
      );
    }
    case 'grow_light': {
      const r = Math.max(0, Math.min(1, v?.run ?? 0));
      return (
        <g>
          {r > 0 && <rect x={0} y={20} width={120} height={30} fill={`rgba(255,80,220,${0.25 * r})`} className="glow" />}
          <rect x={6} y={2} width={110} height={18} rx={4} fill="#333" />
          {Array.from({ length: 10 }, (_, i) => (
            <circle key={i} cx={16 + i * 10} cy={11} r={3.5} fill={r > 0 ? (i % 3 ? `rgba(255,60,200,${0.4 + 0.6 * r})` : `rgba(80,120,255,${0.4 + 0.6 * r})`) : '#555'} />
          ))}
        </g>
      );
    }
    case 'servo': {
      const a = v?.angle ?? 0;
      return (
        <g>
          <rect x={8} y={8} width={56} height={30} rx={3} fill="#1d64c9" />
          <circle cx={48} cy={23} r={7} fill="#eee" />
          <rect x={46} y={0} width={4} height={24} rx={2} fill="#fff" stroke="#888" transform={`rotate(${a} 48 23)`} />
          <text x={22} y={27} className="pt-tiny" fill="#fff">
            {Math.round(a)}°
          </text>
        </g>
      );
    }
    case 'dht22':
      return (
        <g>
          <rect x={-4} y={0} width={28} height={38} rx={2} fill="#f2f2f2" stroke="#999" />
          {Array.from({ length: 5 }, (_, i) => (
            <rect key={i} x={0} y={4 + i * 6} width={20} height={3} fill="#bbb" />
          ))}
          <text x={10} y={-4} className="pt-value" textAnchor="middle">
            {fmt(v?.temperature)}° {fmt(v?.humidity, 0)}%
          </text>
        </g>
      );
    case 'bme280':
      return <Module w={40} h={52} color="#5b2c91" label="BME280" sub={`${fmt(v?.temperature)}° ${fmt(v?.humidity, 0)}%`} />;
    case 'bh1750':
      return <Module w={40} h={52} color="#1d5fa8" label="BH1750" sub={`${fmt(v?.lux, 0)} lx`} />;
    case 'ds18b20':
      return (
        <g>
          <rect x={4} y={-24} width={12} height={34} rx={6} fill="#bbb" stroke="#777" />
          <path d="M10 10 L10 30" stroke="#222" strokeWidth={6} />
          <text x={22} y={-8} className="pt-value">
            {fmt(v?.temperature)}°C
          </text>
        </g>
      );
    case 'mhz19b':
      return (
        <g>
          <rect x={6} y={4} width={64} height={44} rx={3} fill="#c9a227" stroke="#8a6d10" />
          <text x={38} y={22} className="pt-label" textAnchor="middle" fill="#222">
            MH-Z19B
          </text>
          <text x={38} y={38} className="pt-value" textAnchor="middle" fill="#222">
            {fmt(v?.co2, 0)} ppm
          </text>
        </g>
      );
    case 'ph_sensor':
      return <Module w={30} h={62} color="#0f6d6d" label="pH" sub={`${fmt(v?.value, 2)}`} />;
    case 'ec_sensor':
      return <Module w={30} h={62} color="#6d3a0f" label="EC" sub={`${fmt(v?.value, 2)}`} />;
    case 'soil_moisture':
      return <Module w={30} h={62} color="#222" label="SOIL" sub={`${fmt(v?.value, 0)}%`} />;
    case 'water_level_analog':
      return <Module w={30} h={62} color="#a32020" label="LEVEL" sub={`${fmt(v?.value, 0)}%`} />;
    case 'ldr_module':
      return <Module w={40} h={62} color="#1d5fa8" label="LDR" sub={`${fmt(v?.value, 0)} lx`} />;
    case 'leak_sensor':
      return <Module w={40} h={62} color="#a32020" label="LEAK" sub={v?.value >= 0.5 ? 'WET' : 'dry'} />;
    case 'float_switch':
      return (
        <g>
          <rect x={4} y={0} width={14} height={30} rx={3} fill="#ddd" stroke="#888" />
          <circle cx={11} cy={v?.closed ? 8 : 22} r={6} fill="#f2f2f2" stroke="#777" />
          <text x={24} y={14} className="pt-value">
            {fmt(v?.level, 0)}%
          </text>
          <text x={24} y={26} className="pt-tiny">
            {v?.closed ? 'closed' : 'open'}
          </text>
        </g>
      );
    case 'flow_sensor':
      return (
        <g>
          <rect x={6} y={10} width={64} height={24} rx={4} fill="#111" />
          <rect x={0} y={16} width={6} height={12} fill="#555" />
          <rect x={70} y={16} width={6} height={12} fill="#555" />
          <text x={38} y={26} className="pt-value" textAnchor="middle" fill="#ddd">
            {fmt(v?.flow)} L/min
          </text>
        </g>
      );
    case 'mcp3008':
      return (
        <g>
          <rect x={-4} y={5} width={78} height={20} rx={2} fill="#1a1a1a" />
          <path d="M-4 11 A4 4 0 0 1 -4 19" fill="#555" />
          <text x={35} y={19} className="pt-tiny" textAnchor="middle" fill="#ddd">
            MCP3008
          </text>
        </g>
      );
    case 'nextion':
      return (
        <g>
          <rect x={10} y={0} width={220} height={180} rx={6} fill="#141414" stroke="#000" />
          <foreignObject x={30} y={18} width={180} height={135}>
            <div style={{ width: 180, height: 135 }}>
              <NextionScreen compId={comp.id} scale={180 / 320} interactive={p.running} />
            </div>
          </foreignObject>
          <text x={120} y={170} className="pt-tiny" textAnchor="middle" fill="#888">
            NEXTION NX3224K028
          </text>
        </g>
      );
    case 'lcd1602_i2c': {
      const view = dev?.view?.();
      const lines: string[] = v?.powered && view?.on ? view.lines : ['', ''];
      const bl = v?.powered && view?.backlight;
      return (
        <g>
          <rect x={6} y={0} width={154} height={70} rx={3} fill="#1a7a3a" stroke="#0b4a20" />
          <rect x={14} y={12} width={138} height={44} rx={2} fill={bl ? '#9be36a' : '#4a6a3a'} />
          {lines.map((l, i) => (
            <text key={i} x={18} y={30 + i * 18} className="lcd-text">
              {l.replace(/ /g, ' ')}
            </text>
          ))}
        </g>
      );
    }
    case 'oled_ssd1306':
      return <Oled dev={dev} powered={!!v?.powered} />;
    case 'usb_serial':
      return (
        <g>
          <rect x={6} y={0} width={70} height={40} rx={3} fill="#b3261e" />
          <rect x={76} y={10} width={16} height={20} fill="#ccc" />
          <text x={40} y={24} className="pt-tiny" textAnchor="middle" fill="#fff">
            USB-UART 3.3V
          </text>
        </g>
      );
    default:
      return <rect width={p.m.w} height={p.m.h} fill="#888" />;
  }
}

const Oled = memo(function Oled({ dev, powered }: { dev: any; powered: boolean }) {
  const view = dev?.view?.();
  const url = useMemo(() => {
    if (!powered || !view?.on || typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(128, 64);
    for (let page = 0; page < 8; page++)
      for (let x = 0; x < 128; x++) {
        const b = view.ram[page * 128 + x];
        for (let bit = 0; bit < 8; bit++) {
          const on = ((b >> bit) & 1) !== (view.inverse ? 1 : 0);
          const i = ((page * 8 + bit) * 128 + x) * 4;
          img.data[i] = on ? 140 : 0;
          img.data[i + 1] = on ? 210 : 0;
          img.data[i + 2] = on ? 255 : 0;
          img.data[i + 3] = 255;
        }
      }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }, [view?.version, powered, view?.on]);
  return (
    <g>
      <rect x={-4} y={0} width={114} height={66} rx={3} fill="#0c2a5c" />
      <rect x={4} y={4} width={100} height={52} fill="#000" />
      {url && <image href={url} x={4} y={4} width={100} height={52} style={{ imageRendering: 'pixelated' }} />}
    </g>
  );
});

export const PartBody = memo(function PartBody(p: PartProps) {
  return <g className={`part part-${p.comp.type}`}>{body(p)}</g>;
});
