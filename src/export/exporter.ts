// High-level export actions used by the Export dialog: circuit image (PNG/SVG/PDF),
// tables (CSV/XLSX/Markdown), the complete documentation PDF and the full ZIP.
import { strToU8, zipSync } from 'fflate';
import SMARTFARM_PY from '../runtime/python/smartfarm.py?raw';
import { CURRENT_SCHEMA } from '../engine/project';
import type { ProjectDoc } from '../engine/types';
import { translate, type Lang } from '../i18n';
import { sim } from '../state/engine';
import { wiringTable } from '../state/wiring';
import { renderCircuitSvg, svgToCanvas, circuitPng, safeScale, DEFAULT_IMAGE, type ImageOptions } from './circuitImage';
import { renderDocument, type Column } from './docPdf';
import {
  BOM_COLUMNS,
  GPIO_COLUMNS,
  NET_COLUMNS,
  POWER_COLUMNS,
  WIRING_COLUMNS,
  buildReport,
  reportMarkdown,
  toCsv,
  type ProjectReport,
} from './report';
import { buildXlsx, type Sheet } from './xlsx';

// handle for automated browser checks (export every example); present once the export module is loaded
(globalThis as any).__rpi5export = { renderCircuitSvg, circuitPng, buildReport, DEFAULT_IMAGE };

export const fileBase = (doc: ProjectDoc) => doc.name.replace(/[^\w؀-ۿ-]+/g, '_').replace(/^_+|_+$/g, '') || 'project';

export function currentReport(doc: ProjectDoc, lang: Lang): ProjectReport {
  return buildReport(doc, { lang, sim });
}

// ------------------------------------------------------------------ image
export async function exportCircuitImage(doc: ProjectDoc, format: 'png' | 'svg' | 'pdf', opts: ImageOptions, selection: string[], lang: Lang) {
  const svg = renderCircuitSvg(doc, opts, selection);
  const base = fileBase(doc);
  if (format === 'svg') return { blob: new Blob([svg.svg], { type: 'image/svg+xml' }), name: `${base}-circuit.svg`, info: svg };
  if (format === 'png') return { blob: await circuitPng(svg, opts.scale), name: `${base}-circuit.png`, info: svg };
  const bg = opts.background === 'dark' ? '#11171d' : '#ffffff';
  const canvas = await svgToCanvas(svg, Math.max(opts.scale, 2), bg);
  const t = (s: string, p?: Record<string, string | number>) => translate(lang, s, p);
  const { pdf } = await renderDocument(
    lang === 'ar',
    (n, total) => `${doc.name} — ${t('page {n} of {total}', { n, total })}`,
    (w) => {
      w.newPage(svg.width >= svg.height ? 'landscape' : 'portrait');
      w.heading(`${doc.name} — ${t('Circuit diagram')}`);
      w.image(canvas, svg.width, svg.height, t('{c} components · {w} wires · exported {d}', { c: svg.components, w: svg.wires, d: new Date().toISOString().slice(0, 10) }));
    },
    { title: `${doc.name} — circuit`, lang },
  );
  return { blob: new Blob([pdf as BlobPart], { type: 'application/pdf' }), name: `${base}-circuit.pdf`, info: svg };
}

// ------------------------------------------------------------------ tables
const cell = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : typeof v === 'number' ? v : String(v));

export function reportSheets(r: ProjectReport): Sheet[] {
  const t = (s: string) => translate(r.lang, s);
  const sheet = <T,>(name: string, rows: T[], cols: [keyof T, string][]): Sheet => ({
    name: t(name),
    header: cols.map(([, h]) => t(h)),
    rows: rows.map((row) => cols.map(([k]) => cell(row[k]) as string | number)),
    rtl: r.lang === 'ar',
  });
  return [
    sheet('Wiring', r.wiring, WIRING_COLUMNS),
    sheet('Nets', r.nets, NET_COLUMNS),
    sheet('GPIO allocation', r.gpio, GPIO_COLUMNS),
    sheet('Bill of materials', r.bom, BOM_COLUMNS),
    sheet('Power', r.power, POWER_COLUMNS),
  ];
}

export const reportXlsx = (r: ProjectReport) => new Blob([buildXlsx(reportSheets(r)) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

export function tableCsv(r: ProjectReport, which: 'wiring' | 'nets' | 'gpio' | 'bom' | 'power') {
  const csv =
    which === 'wiring'
      ? toCsv(r.wiring, WIRING_COLUMNS, r.lang)
      : which === 'nets'
        ? toCsv(r.nets, NET_COLUMNS, r.lang)
        : which === 'gpio'
          ? toCsv(r.gpio, GPIO_COLUMNS, r.lang)
          : which === 'bom'
            ? toCsv(r.bom, BOM_COLUMNS, r.lang)
            : toCsv(r.power, POWER_COLUMNS, r.lang);
  return new Blob([csv], { type: 'text/csv;charset=utf-8' });
}

// ------------------------------------------------------------------ complete documentation
const cols = <T,>(c: [keyof T, string][], w: number[], t: (s: string) => string): Column[] => c.map(([, h], i) => ({ title: t(h), w: w[i] ?? 1 }));

export async function completePdf(doc: ProjectDoc, lang: Lang, selection: string[] = []): Promise<{ pdf: Uint8Array; pages: number }> {
  const r = currentReport(doc, lang);
  const t = (s: string, p?: Record<string, string | number>) => translate(lang, s, p);
  const svg = renderCircuitSvg(doc, { background: 'white', scope: 'all', grid: false, labels: true, scale: 2 }, selection);
  // raster resolution: about 1.5 image pixels per printed pixel of a landscape A4 page
  const canvas = await svgToCanvas(svg, safeScale(svg.width, svg.height, Math.min(4, Math.max(1.5, 2800 / svg.width))));
  const n = (i: number, s: string) => `${i}. ${t(s)}`;
  const bullet = r.lang === 'ar' ? '◂' : '▸';
  return renderDocument(
    lang === 'ar',
    (p, total) => `${r.title} — ${t('page {n} of {total}', { n: p, total })} · ${t('Raspberry Pi 5 Virtual Electronics & Smart Farming Simulator')}`,
    (w) => {
      // 1–4: title, description, date, Pi model
      w.title(r.title, t('Complete project documentation'));
      w.heading(n(1, 'Project title'));
      w.paragraph(r.title);
      w.heading(n(2, 'Project description'));
      w.paragraph(r.description || t('No description was entered for this project (Export → Project description).'), { color: r.description ? undefined : '#5d6b78' });
      w.heading(n(3, 'Export date'));
      w.paragraph(r.date);
      w.heading(n(4, 'Raspberry Pi model'));
      w.paragraph(r.piModel);
      w.keyValues([
        [t('Components'), String(doc.components.length)],
        [t('Wires'), String(doc.wires.length)],
        [t('Python files'), r.files.map((f) => f.name).join(', ') || '—'],
        [t('Electrical warnings'), r.warnings.length ? `${r.warnings.filter((x) => x.severity === 'error').length} ${t('errors')}, ${r.warnings.filter((x) => x.severity === 'warning').length} ${t('warnings')}` : t('none')],
      ]);
      // 5: diagram on its own page
      w.newPage(svg.width >= svg.height ? 'landscape' : 'portrait');
      w.heading(n(5, 'Circuit diagram'));
      w.image(canvas, svg.width, svg.height, t('{c} components · {w} wires · exported {d}', { c: svg.components, w: svg.wires, d: r.date }));
      // 6: components
      w.newPage('landscape');
      w.heading(n(6, 'Components list'));
      w.table(cols(BOM_COLUMNS, [0.35, 2, 2, 0.4, 2.6, 1.6, 1.1, 1, 2.6], t), r.bom.map((b) => BOM_COLUMNS.map(([k]) => String(cell(b[k])))), { zebra: true });
      // 7: wiring + nets
      w.newPage('landscape');
      w.heading(n(7, 'Wiring table'));
      w.paragraph(t('One row per physical connection (wire or breadboard insertion). Parts in series (resistors, relays, ADCs, breadboard strips) appear as separate rows, so no connection is hidden.'), { size: 8, color: '#5d6b78' });
      w.table(
        cols(WIRING_COLUMNS, [0.95, 1.15, 1.3, 0.75, 0.9, 0.75, 0.65, 1.3, 0.85, 0.9, 0.7, 1.05, 0.8, 0.95, 2.4], t),
        r.wiring.map((x) => WIRING_COLUMNS.map(([k]) => String(cell(x[k])))),
        { size: 6.3, zebra: true },
      );
      w.heading(t('Electrical nets (every member of every net)'), 2);
      w.table(cols(NET_COLUMNS, [1, 1.3, 1, 6, 2], t), r.nets.map((x) => NET_COLUMNS.map(([k]) => String(cell(x[k])))), { size: 7, zebra: true });
      // 8: GPIO
      w.heading(n(8, 'Raspberry Pi 5 GPIO allocation'));
      w.table(cols(GPIO_COLUMNS, [0.8, 0.6, 1.8, 0.9, 2.6, 2, 2.6], t), r.gpio.map((x) => GPIO_COLUMNS.map(([k]) => String(cell(x[k])))), { size: 7, zebra: true });
      // 9: power
      w.newPage('portrait');
      w.heading(n(9, 'Power requirements'));
      if (r.power.length) w.table(cols(POWER_COLUMNS, [0.7, 1.6, 4, 1, 1], t), r.power.map((x) => POWER_COLUMNS.map(([k]) => String(cell(x[k])))), { size: 7.5 });
      else w.paragraph(t('No supply rail is wired to any part.'));
      w.paragraph(t('Currents are the simulator’s DC solution at export time (outputs as they were at that moment). The budgets are the simulator’s planning limits, not official ratings; size real supplies with margin and check the datasheets.'), { size: 8, color: '#5d6b78' });
      // 10: warnings
      w.heading(n(10, 'Electrical warnings'));
      if (!r.warnings.length) w.paragraph(t('No electrical problems found.'));
      for (const x of r.warnings) {
        w.paragraph(`${x.severity === 'error' ? '⛔' : x.severity === 'warning' ? '⚠' : 'ℹ'} ${x.title}${x.comps ? ` (${x.comps})` : ''}`, { size: 9.5 });
        if (x.explain) w.paragraph(x.explain, { size: 8.5, color: '#5d6b78', indent: 14 });
      }
      // 11: code
      w.heading(n(11, 'Python code'));
      if (!r.files.length) w.paragraph(t('This project has no Python files.'));
      for (const f of r.files) w.code(f.name, f.content);
      // 12: libraries
      w.heading(n(12, 'Required real-hardware libraries'));
      if (!r.libraries.length) w.paragraph(t('The code imports no hardware library.'));
      for (const l of r.libraries) w.paragraph(`${l.module}${l.simulatorOnly ? ` — ${t('simulator-only module')}` : ''}: ${l.install}${l.note ? ` (${l.note})` : ''}`, { bullet });
      // 13: instructions
      w.heading(n(13, 'Execution instructions'));
      r.instructions.forEach((s, i) => w.paragraph(s, { bullet: `${i + 1}.` }));
      // 14: limitations
      w.heading(n(14, 'Known simulation limitations'));
      w.list(r.limitations, bullet);
      // 15: checklist
      w.heading(n(15, 'Assembly checklist'));
      w.list(r.checklist, '☐');
    },
    { title: r.title, subject: t('Complete project documentation'), lang },
  );
}

// ------------------------------------------------------------------ README + ZIP
function readme(doc: ProjectDoc, r: ProjectReport, files: string[]) {
  const libs = r.libraries;
  return [
    `# ${doc.name}`,
    '',
    doc.description ?? '',
    '',
    'Exported from the Raspberry Pi 5 Virtual Electronics & Smart Farming Simulator.',
    `Export date: ${r.date}`,
    '',
    '## Contents',
    '',
    ...files.map((f) => `- \`${f}\``),
    '',
    '## Running the code on a real Raspberry Pi 5',
    '',
    ...r.instructions.map((s, i) => `${i + 1}. ${s}`),
    '',
    '## Libraries',
    '',
    ...(libs.length
      ? libs.map((l) => `- **${l.module}**${l.simulatorOnly ? ' (simulator-only module — see below)' : ''}: ${l.install}${l.note ? ` — ${l.note}` : ''}`)
      : ['- The code imports no hardware library.']),
    '',
    'The simulator runs the same Python, but the hardware libraries inside it are simulator implementations of the public APIs listed above. ' +
      'Install the real packages on the Pi; nothing else in your code should need to change unless a library is marked simulator-only.',
    '',
    '## Known simulation limitations',
    '',
    ...r.limitations.map((s) => `- ${s}`),
    '',
    '## Re-import',
    '',
    'Open the simulator → Projects → Import JSON/ZIP and choose this ZIP (or `project.json`). Files in `code/` replace the embedded copies.',
    '',
  ].join('\n');
}

export async function fullZip(doc: ProjectDoc, lang: Lang, o: { includePdf?: boolean } = {}): Promise<Blob> {
  const r = currentReport(doc, lang);
  const svg = renderCircuitSvg(doc, { background: 'white', scope: 'all', grid: false, labels: true, scale: 2 });
  const png = new Uint8Array(await (await circuitPng(svg, 2)).arrayBuffer());
  const json = (v: unknown) => strToU8(JSON.stringify(v, null, 2));
  const files: Record<string, Uint8Array> = {
    'project.json': json({ format: 'rpi5-farm-simulator', version: CURRENT_SCHEMA, project: doc }),
    'circuit/circuit.png': png,
    'circuit/circuit.svg': strToU8(svg.svg),
    'wiring/wiring.csv': strToU8(toCsv(r.wiring, WIRING_COLUMNS, lang)),
    'wiring/nets.csv': strToU8(toCsv(r.nets, NET_COLUMNS, lang)),
    'wiring/gpio_allocation.csv': strToU8(toCsv(r.gpio, GPIO_COLUMNS, lang)),
    'wiring/power.csv': strToU8(toCsv(r.power, POWER_COLUMNS, lang)),
    'wiring/wiring.xlsx': buildXlsx(reportSheets(r)),
    'wiring/wiring.md': strToU8(wiringTable(doc)),
    'bom/bom.csv': strToU8(toCsv(r.bom, BOM_COLUMNS, lang)),
    'docs/report.md': strToU8(reportMarkdown(r)),
    'simulation.json': json({ sim: doc.sim, farm: doc.farm, view: doc.view, mainFile: doc.mainFile, schema: doc.schema }),
  };
  for (const f of doc.files) files[`code/${f.name}`] = strToU8(f.content);
  if (/^\s*(from\s+smartfarm\s+import|import\s+smartfarm)/m.test(doc.files.map((f) => f.content).join('\n'))) files['lib/smartfarm.py'] = strToU8(SMARTFARM_PY);
  const hasNextion = doc.components.some((c) => c.type === 'nextion') || !!doc.nextion?.pages?.some((p) => p.components.length);
  if (hasNextion) files['nextion/nextion.json'] = json(doc.nextion);
  files['REAL_HARDWARE.md'] = strToU8(
    [
      '# Running on a real Raspberry Pi 5',
      '',
      ...r.instructions.map((s, i) => `${i + 1}. ${s}`),
      '',
      '## Library notes',
      '',
      ...(r.libraries.length ? r.libraries.map((l) => `- ${l.module}: ${l.install}${l.note ? ` — ${l.note}` : ''}${l.simulatorOnly ? ' **(simulator-only: port this code before using real hardware)**' : ''}`) : ['- No hardware library is imported.']),
      ...(hasNextion ? ['', '## Nextion', '', '`nextion/nextion.json` describes the pages and components. A Nextion Editor .HMI file is not generated — re-create the layout in Nextion Editor using these names, ids and positions.'] : []),
      '',
    ].join('\n'),
  );
  if (o.includePdf !== false) files['docs/project.pdf'] = (await completePdf(doc, lang)).pdf;
  const names = Object.keys(files).sort();
  files['README.md'] = strToU8(readme(doc, r, ['README.md', ...names]));
  return new Blob([zipSync(files, { level: 6 }) as BlobPart], { type: 'application/zip' });
}
