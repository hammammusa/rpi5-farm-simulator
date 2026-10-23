// Human-readable wiring report (for building the circuit on real hardware).
import { buildNetlist } from '../engine/netlist';
import { getPart, hasPart, pinsOf, withDefaults } from '../engine/parts';
import { PI5_HEADER } from '../engine/pi5';
import type { ProjectDoc } from '../engine/types';

export function compName(doc: ProjectDoc, id: string) {
  const c = doc.components.find((x) => x.id === id);
  if (!c) return id;
  return c.label || `${hasPart(c.type) ? getPart(c.type).name : c.type} (${id})`;
}

export function pinName(doc: ProjectDoc, comp: string, pin: string) {
  const c = doc.components.find((x) => x.id === comp);
  if (!c || !hasPart(c.type)) return pin;
  if (c.type === 'rpi5') {
    const h = PI5_HEADER[Number(pin.slice(1)) - 1];
    return h ? `pin ${h.physical} (${h.name})` : pin;
  }
  const m = getPart(c.type);
  return pinsOf(m, withDefaults(m, c.props)).find((p) => p.id === pin)?.label ?? pin;
}

export function wiringTable(doc: ProjectDoc): string {
  const net = buildNetlist(doc);
  const lines: string[] = [`# Wiring — ${doc.name}`, '', '## Wires', '', '| # | From | To | Colour |', '|---|---|---|---|'];
  doc.wires.forEach((w, i) => {
    lines.push(`| ${i + 1} | ${compName(doc, w.from.comp)} · ${pinName(doc, w.from.comp, w.from.pin)} | ${compName(doc, w.to.comp)} · ${pinName(doc, w.to.comp, w.to.pin)} | ${w.color}${w.label ? ` (${w.label})` : ''} |`);
  });
  lines.push('', '## Breadboard insertions', '');
  if (!net.insertions.length) lines.push('_none_');
  for (const ins of net.insertions) lines.push(`- ${compName(doc, ins.comp)} · ${pinName(doc, ins.comp, ins.pin)} → breadboard hole ${ins.hole}`);
  lines.push('', '## Electrical nets (everything on one line is connected)', '');
  for (const n of net.nets) {
    const real = n.pins.filter((p) => doc.components.find((c) => c.id === p.comp)?.type !== 'breadboard');
    if (real.length < 2) continue;
    lines.push(`- **${n.name}**: ${real.map((p) => `${compName(doc, p.comp)}.${pinName(doc, p.comp, p.pin)}`).join(' — ')}`);
  }
  lines.push('', '## Components', '');
  for (const c of doc.components) {
    if (!hasPart(c.type)) continue;
    const m = getPart(c.type);
    const props = withDefaults(m, c.props);
    const keys = m.props.filter((p) => p.group === 'config').map((p) => `${p.label}: ${props[p.key]}`);
    lines.push(`- ${compName(doc, c.id)}${keys.length ? ` — ${keys.join(', ')}` : ''}`);
  }
  return lines.join('\n') + '\n';
}
