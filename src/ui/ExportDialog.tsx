// Export dialog: circuit image (PNG/SVG/PDF), wiring/GPIO/BOM tables (CSV/XLSX/MD),
// complete documentation PDF and the full project ZIP.
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { useT, type Lang } from '../i18n';
import { download } from '../state/persist';
import { DEFAULT_IMAGE, renderCircuitSvg, type CircuitSvg, type ImageOptions } from '../export/circuitImage';
import { BOM_COLUMNS, GPIO_COLUMNS, NET_COLUMNS, POWER_COLUMNS, WIRING_COLUMNS, reportMarkdown } from '../export/report';
import { completePdf, currentReport, exportCircuitImage, fileBase, fullZip, reportXlsx, tableCsv } from '../export/exporter';

type TableId = 'wiring' | 'nets' | 'gpio' | 'bom' | 'power';
const TABLES: [TableId, string][] = [
  ['wiring', 'Wiring table'],
  ['nets', 'Electrical nets'],
  ['gpio', 'GPIO allocation'],
  ['bom', 'Bill of materials'],
  ['power', 'Power'],
];

export default function ExportDialog() {
  const t = useT();
  const doc = useApp((s) => s.doc);
  const lang = useApp((s) => s.lang);
  const selection = useApp((s) => s.selection);
  const close = () => useApp.getState().setExportOpen(false);
  const [opts, setOpts] = useState<ImageOptions>(DEFAULT_IMAGE);
  const [format, setFormat] = useState<'png' | 'svg' | 'pdf'>('png');
  const [table, setTable] = useState<TableId>('wiring');
  const [docLang, setDocLang] = useState<Lang>(lang);
  const [withPdf, setWithPdf] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const set = (p: Partial<ImageOptions>) => setOpts((o) => ({ ...o, ...p }));

  const report = useMemo(() => currentReport(doc, lang), [doc, lang]);
  // the off-screen render cannot run inside React's own render pass: defer it
  const [preview, setPreview] = useState<CircuitSvg | null>(null);
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        setPreview(renderCircuitSvg(doc, { ...opts, scale: 1 }, selection));
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    }, 0);
    return () => clearTimeout(id);
  }, [doc, opts, selection]);
  const previewUrl = useMemo(() => (preview ? URL.createObjectURL(new Blob([preview.svg], { type: 'image/svg+xml' })) : ''), [preview]);
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setError('');
    setStatus('');
    try {
      setStatus(await fn());
    } catch (e: any) {
      setError(`${t('Export failed')}: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  const rows: { cols: [string, string][]; data: Record<string, unknown>[] } =
    table === 'wiring'
      ? { cols: WIRING_COLUMNS, data: report.wiring as any }
      : table === 'nets'
        ? { cols: NET_COLUMNS, data: report.nets as any }
        : table === 'gpio'
          ? { cols: GPIO_COLUMNS, data: report.gpio as any }
          : table === 'bom'
            ? { cols: BOM_COLUMNS, data: report.bom as any }
            : { cols: POWER_COLUMNS, data: report.power as any };
  const base = fileBase(doc);
  const px = preview ? `${Math.round(preview.width * opts.scale)} × ${Math.round(preview.height * opts.scale)} px` : '';

  return (
    <div className="modal-back" onPointerDown={close} data-testid="export-dialog">
      <div className="modal export-modal" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label={t('Export project')}>
        <div className="vp-head">
          <b>⬇ {t('Export project')}</b>
          <button onClick={close} aria-label={t('Close')} data-testid="export-close">
            ✕
          </button>
        </div>

        <section className="exp-section">
          <h3>{t('Circuit image')}</h3>
          <div className="exp-image">
            <div className={`exp-preview bg-${opts.background}`}>{previewUrl && <img src={previewUrl} alt={t('Circuit preview')} data-testid="export-preview" />}</div>
            <div className="exp-opts">
              <label>
                {t('Format')}
                <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)} data-testid="exp-format">
                  <option value="png">PNG</option>
                  <option value="svg">SVG ({t('vector')})</option>
                  <option value="pdf">PDF</option>
                </select>
              </label>
              <label>
                {t('Background')}
                <select value={opts.background} onChange={(e) => set({ background: e.target.value as ImageOptions['background'] })} data-testid="exp-bg">
                  <option value="white">{t('White')}</option>
                  <option value="dark">{t('Dark')}</option>
                  <option value="transparent" disabled={format === 'pdf'}>
                    {t('Transparent')}
                  </option>
                </select>
              </label>
              <label>
                {t('Content')}
                <select value={opts.scope} onChange={(e) => set({ scope: e.target.value as ImageOptions['scope'] })} data-testid="exp-scope">
                  <option value="all">{t('Entire circuit')}</option>
                  <option value="selected" disabled={!selection.length}>
                    {t('Selected components ({n})', { n: selection.length })}
                  </option>
                </select>
              </label>
              <label>
                {t('Resolution')}
                <select value={opts.scale} onChange={(e) => set({ scale: Number(e.target.value) })} disabled={format === 'svg'} data-testid="exp-scale">
                  <option value={1}>1× ({t('screen')})</option>
                  <option value={2}>2× ({t('high')})</option>
                  <option value={4}>4× ({t('print')})</option>
                </select>
              </label>
              <label className="chk">
                <input type="checkbox" checked={opts.grid} onChange={(e) => set({ grid: e.target.checked })} data-testid="exp-grid" /> {t('Grid')}
              </label>
              <label className="chk">
                <input type="checkbox" checked={opts.labels} onChange={(e) => set({ labels: e.target.checked })} data-testid="exp-labels" /> {t('Names, IDs and pin labels')}
              </label>
              <p className="muted small" data-testid="export-image-info">
                {preview && t('{c} components · {w} wires', { c: preview.components, w: preview.wires })}
                {format !== 'svg' && px && ` · ${px}`}
              </p>
              <button
                className="primary"
                disabled={!!busy || !preview}
                data-testid="export-image"
                onClick={() =>
                  void run('image', async () => {
                    const r = await exportCircuitImage(doc, format, format === 'pdf' && opts.background === 'transparent' ? { ...opts, background: 'white' } : opts, selection, lang);
                    download(r.blob, r.name);
                    return `${r.name} (${Math.ceil(r.blob.size / 1024)} KB)`;
                  })
                }
              >
                {busy === 'image' ? t('Exporting…') : t('Export image')}
              </button>
            </div>
          </div>
          <p className="muted small">{t('The image is drawn from the project data at full size, so parts and wires outside the visible area are included.')}</p>
        </section>

        <section className="exp-section">
          <h3>{t('Wiring, GPIO allocation and BOM')}</h3>
          <div className="exp-tabs" role="tablist">
            {TABLES.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={table === id} className={table === id ? 'on' : ''} onClick={() => setTable(id)} data-testid={`exp-tab-${id}`}>
                {t(label)}
              </button>
            ))}
          </div>
          <div className="exp-table-wrap">
            <table className="data-table exp-table" data-testid="export-table" data-rows={rows.data.length}>
              <thead>
                <tr>
                  {rows.cols.map(([, h]) => (
                    <th key={h}>{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.data.map((r, i) => (
                  <tr key={i} className={r.status === 'Error' || r.status === 'Broken' ? 'row-err' : r.status === 'Warning' ? 'row-warn' : ''}>
                    {rows.cols.map(([k]) => {
                      const v = r[k];
                      return (
                        <td key={k} dir="auto">
                          {k === 'colorName' && r.color ? <span className="swatch-dot" style={{ background: String(r.color) }} /> : null}
                          {Array.isArray(v) ? v.join(', ') : String(v ?? '')}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {!rows.data.length && (
                  <tr>
                    <td colSpan={rows.cols.length} className="muted">
                      {t('Nothing to list yet.')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="row wrap">
            <button onClick={() => download(tableCsv(report, table), `${base}-${table}.csv`)} data-testid="export-csv">
              ⬇ CSV
            </button>
            <button onClick={() => download(reportXlsx(report), `${base}-wiring.xlsx`)} data-testid="export-xlsx">
              ⬇ XLSX ({t('all tables')})
            </button>
            <button onClick={() => download(new Blob([reportMarkdown(report)], { type: 'text/markdown' }), `${base}-report.md`)} data-testid="export-md">
              ⬇ Markdown
            </button>
          </div>
        </section>

        <section className="exp-section">
          <h3>{t('Complete project documentation (PDF)')}</h3>
          <label className="exp-desc">
            {t('Project description')}
            <textarea value={doc.description ?? ''} onChange={(e) => useApp.getState().setDescription(e.target.value)} rows={2} placeholder={t('What the project does, where it will be installed…')} data-testid="export-desc" />
          </label>
          <div className="row wrap">
            <label>
              {t('Language')}{' '}
              <select value={docLang} onChange={(e) => setDocLang(e.target.value as Lang)} data-testid="exp-lang">
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </select>
            </label>
            <button
              className="primary"
              disabled={!!busy}
              data-testid="export-pdf-doc"
              onClick={() =>
                void run('pdf', async () => {
                  const { pdf, pages } = await completePdf(doc, docLang, selection);
                  const name = `${base}-documentation-${docLang}.pdf`;
                  download(new Blob([pdf as BlobPart], { type: 'application/pdf' }), name);
                  return `${name} — ${t('{n} pages', { n: pages })}`;
                })
              }
            >
              {busy === 'pdf' ? t('Exporting…') : t('Export Complete Project Documentation')}
            </button>
          </div>
          <p className="muted small">{t('15 sections: title, description, date, Pi model, diagram, components, wiring, GPIO allocation, power, warnings, code, libraries, instructions, limitations and assembly checklist.')}</p>
        </section>

        <section className="exp-section">
          <h3>{t('Full project (ZIP)')}</h3>
          <p className="muted small">{t('Python code, circuit PNG/SVG, wiring CSV/XLSX, BOM, project JSON, README, real-hardware notes, simulation settings and Nextion layout (when used).')}</p>
          <div className="row wrap">
            <label className="chk">
              <input type="checkbox" checked={withPdf} onChange={(e) => setWithPdf(e.target.checked)} data-testid="exp-zip-pdf" /> {t('Include the documentation PDF')}
            </label>
            <button
              className="primary"
              disabled={!!busy}
              data-testid="export-zip-full"
              onClick={() =>
                void run('zip', async () => {
                  const blob = await fullZip(doc, docLang, { includePdf: withPdf });
                  const name = `${base}-project.zip`;
                  download(blob, name);
                  return `${name} (${Math.ceil(blob.size / 1024)} KB)`;
                })
              }
            >
              {busy === 'zip' ? t('Exporting…') : t('Export full ZIP')}
            </button>
          </div>
        </section>
        {status && (
          <p className="ok small" data-testid="export-status">
            ✓ {t('Saved')}: {status}
          </p>
        )}
        {error && (
          <p className="err small" data-testid="export-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
