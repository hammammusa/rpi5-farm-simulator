// Every user-visible string of the export feature (dialog, report tables, PDF), the monitors,
// the problems panel and project management has an Arabic translation.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { AR } from '../../src/i18n';

const FILES = ['src/export/report.ts', 'src/export/exporter.ts', 'src/ui/ExportDialog.tsx', 'src/ui/Monitors.tsx', 'src/ui/Problems.tsx', 'src/ui/ProjectsTab.tsx', 'src/ui/Dock.tsx', 'src/ui/TopBar.tsx', 'src/state/engine.ts', 'src/ui/learn/LearnTab.tsx', 'src/ui/Workspace.tsx'];

export function exportStrings(): string[] {
  const out = new Set<string>();
  for (const f of FILES) {
    const src = readFileSync(f, 'utf8');
    // t('…') / translate(lang, '…') calls
    for (const m of src.matchAll(/\b(?:t|translate\(\w+,)\s*\(?\s*'((?:[^'\\]|\\.)+)'/g)) out.add(m[1].replace(/\\'/g, "'"));
    // table column titles and tab labels: ['key', 'Title'] pairs
    for (const m of src.matchAll(/\[\s*'\w+'\s*,\s*'([A-Z#](?:[^'\\]|\\.)*)'\s*\]/g)) out.add(m[1].replace(/\\'/g, "'"));
    for (const m of src.matchAll(/\bn\(\d+,\s*'((?:[^'\\]|\\.)+)'\)/g)) out.add(m[1]);
  }
  // sheet names and direction labels passed as variables
  for (const s of ['Wiring', 'Nets', 'Power', 'Output', 'Input', 'PWM output', 'Bidirectional', 'Recovered unsaved changes from the last session.']) out.add(s);
  return [...out].filter((s) => /[A-Za-z]/.test(s) && s !== '#');
}

test('export strings are translated to Arabic', () => {
  const missing = exportStrings().filter((s) => !AR[s]);
  expect(missing).toEqual([]);
});
