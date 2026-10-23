import { useRef, useState } from 'react';
import { NX_DEFAULTS, NX_PREFIX, cssToRgb565, makeComponent, rgb565ToCss, type NextionProject, type NextionRuntime, type NxComponent, type NxType } from '../../engine/devices/nextion';
import { sim, useSimVersion } from '../../state/engine';
import { useApp } from '../../state/store';
import { useT } from '../../i18n';
import { NextionScreen, PICS, renderNxComponent } from './NextionScreen';
import { download } from '../../state/persist';
import { farmNextionTemplate } from '../../examples/nextionTemplates';

const PALETTE: { type: NxType; label: string }[] = [
  { type: 'text', label: 'Text (t)' },
  { type: 'button', label: 'Button (b)' },
  { type: 'number', label: 'Number (n)' },
  { type: 'xfloat', label: 'Float (x)' },
  { type: 'progress', label: 'Progress bar (j)' },
  { type: 'gauge', label: 'Gauge (z)' },
  { type: 'dualstate', label: 'Dual-state button (bt)' },
  { type: 'checkbox', label: 'Checkbox (c)' },
  { type: 'slider', label: 'Slider (h)' },
  { type: 'picture', label: 'Picture / icon (p)' },
  { type: 'qr', label: 'QR code (qr)' },
  { type: 'hotspot', label: 'Hotspot (m)' },
  { type: 'variable', label: 'Variable (va)' },
  { type: 'timer', label: 'Timer (tm)' },
];

const SCALE = 2;

const REFERENCE = `Every instruction ends with three 0xFF bytes:
  ser.write(b't0.txt="Pump ON"' + b'\\xff\\xff\\xff')

Supported instructions (simulator subset of the Nextion instruction set):
  t0.txt="text"          set text                 n0.val=25      set number
  j0.val=75              progress 0-100           z0.val=180     gauge angle
  t0.pco=RED / 63488     text colour (RGB565)     t0.bco=2016    background
  n0.val++  n0.val+=5    arithmetic (left-to-right, integers)
  page 1 / page settings change page (local components reset!)
  vis b0,0               hide (1 = show)          tsw b0,0  disable touch
  get t0.txt             → 70 <text> FF FF FF     get n0.val → 71 b0 b1 b2 b3 FF FF FF
  sendme                 → 66 <page> FF FF FF     click b0,1   simulate press
  covx n0.val,t0.txt,0,0 number → text            dim=50  sleep=1  bkcmd=3
  sys0=5  sys1  sys2     global variables         rest   reset (sends 00 00 00 FF FF FF 88 FF FF FF)
  baud=115200            change baud (Pi must reopen at the new rate)
  page1.t0.txt="x"       only for components with vscope=global

Device → Pi:
  65 <page> <id> <1=press|0=release> FF FF FF   touch event ("Send Component ID")
  00 invalid instruction · 02 invalid component · 03 invalid page
  1A invalid variable/attribute · 1C assignment failed · 01 success (bkcmd=1/3)

Touch-event code (in the designer) can use the same instructions plus
  printh 23 02 54 01   send raw bytes      prints t0.txt,0   send a value

NOT supported: .HMI/.TFT import/export, fonts/pictures from files, waveform,
if/while scripting in event code.`;

export default function NextionTab() {
  useSimVersion();
  const t = useT();
  const project = useApp((s) => s.doc.nextion);
  const pageId = useApp((s) => s.nextionPage);
  const sel = useApp((s) => s.nextionSel);
  const comps = useApp((s) => s.doc.components);
  const st = useApp.getState();
  const nxComp = comps.find((c) => c.type === 'nextion');
  const [mode, setMode] = useState<'design' | 'live'>(nxComp ? 'live' : 'design');
  const [cmd, setCmd] = useState('t0.txt="Hello"');
  const page = project.pages.find((p) => p.id === pageId) ?? project.pages[0];
  const selected = page.components.find((c) => c.name === sel) ?? null;
  const drag = useRef<{ name: string; kind: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const update = (fn: (p: NextionProject) => NextionProject, history = true) => st.setNextion(fn(structuredClone(project)), history);
  const updateComp = (name: string, patch: (c: NxComponent) => void, history = true) =>
    update((p) => {
      const pg = p.pages.find((x) => x.id === page.id)!;
      const c = pg.components.find((x) => x.name === name);
      if (c) patch(c);
      return p;
    }, history);

  const addComp = (type: NxType) =>
    update((p) => {
      const pg = p.pages.find((x) => x.id === page.id)!;
      const c = makeComponent(pg, type, 20 + ((pg.components.length * 12) % 120), 20 + ((pg.components.length * 18) % 160));
      pg.components.push(c);
      setTimeout(() => st.setNextionSel(c.name));
      return p;
    });

  const addPage = () =>
    update((p) => {
      const id = p.pages.reduce((m, x) => Math.max(m, x.id), -1) + 1;
      p.pages.push({ id, name: `page${id}`, bco: 65535, components: [] });
      setTimeout(() => st.setNextionPage(id));
      return p;
    });

  const onDown = (e: React.PointerEvent, c: NxComponent, kind: 'move' | 'resize') => {
    e.stopPropagation();
    st.setNextionSel(c.name);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    st.setNextion(structuredClone(project), true);
    drag.current = { name: c.name, kind, sx: e.clientX, sy: e.clientY, ox: c.x, oy: c.y, ow: c.w, oh: c.h };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = Math.round((e.clientX - d.sx) / SCALE);
    const dy = Math.round((e.clientY - d.sy) / SCALE);
    updateComp(
      d.name,
      (c) => {
        if (d.kind === 'move') {
          c.x = Math.max(0, Math.min(project.width - c.w, d.ox + dx));
          c.y = Math.max(0, Math.min(project.height - c.h, d.oy + dy));
        } else {
          c.w = Math.max(10, Math.min(project.width - c.x, d.ow + dx));
          c.h = Math.max(10, Math.min(project.height - c.y, d.oh + dy));
        }
      },
      false,
    );
  };

  const rt = nxComp ? (sim.device(nxComp.id) as NextionRuntime | null) : null;
  const nxLog = sim.uartLog.filter((e) => e.peer.startsWith('Nextion')).slice(-60);

  return (
    <div className="nextion-tab">
      <aside className="nx-side">
        <div className="panel-title">{t('Pages')}</div>
        {project.pages.map((p) => (
          <div key={p.id} className={`file ${p.id === page.id ? 'on' : ''}`}>
            <button className="file-name" onClick={() => st.setNextionPage(p.id)} dir="ltr">
              {p.id}: {p.name}
            </button>
          </div>
        ))}
        <div className="row">
          <button onClick={addPage}>＋ {t('Page')}</button>
          <button
            onClick={() => {
              const n = prompt(t('Page name'), page.name);
              if (n) update((p) => ((p.pages.find((x) => x.id === page.id)!.name = n.replace(/\s+/g, '_')), p));
            }}
          >
            {t('Rename')}
          </button>
          {project.pages.length > 1 && (
            <button className="danger" onClick={() => confirm(t('Delete page {p}?', { p: page.name })) && (update((p) => ({ ...p, pages: p.pages.filter((x) => x.id !== page.id) })), st.setNextionPage(project.pages[0].id))}>
              ✕
            </button>
          )}
        </div>
        <label className="field">
          <span>{t('Page colour')}</span>
          <input type="color" value={hex565(page.bco)} onChange={(e) => update((p) => ((p.pages.find((x) => x.id === page.id)!.bco = cssToRgb565(e.target.value)), p), false)} />
        </label>
        <div className="panel-title sub">{t('Add component')}</div>
        <div className="nx-palette">
          {PALETTE.map((p) => (
            <button key={p.type} onClick={() => addComp(p.type)} disabled={mode === 'live'}>
              {t(p.label)}
            </button>
          ))}
        </div>
        <div className="panel-title sub">{t('Project')}</div>
        <div className="row">
          <button onClick={() => confirm(t('Replace the current design with the City Farming template?')) && st.setNextion(farmNextionTemplate(), true)}>{t('Load farm template')}</button>
          <button onClick={() => download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), 'nextion-layout.json')}>{t('Export JSON')}</button>
          <button onClick={() => importRef.current?.click()}>{t('Import JSON')}</button>
          <input
            ref={importRef}
            type="file"
            accept=".json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const j = JSON.parse(await f.text());
                if (!Array.isArray(j.pages)) throw new Error('not a layout');
                st.setNextion(j, true);
              } catch (err) {
                alert(String(err));
              }
            }}
          />
        </div>
        <p className="muted small">{t('Model: NX3224K028 — Nextion Enhanced 2.8", 320×240 (training reference from the 2026 regional equipment list). .HMI/.TFT files are not supported; the layout is exported as JSON.')}</p>
      </aside>

      <section className="nx-center">
        <div className="row">
          <div className="seg">
            <button className={mode === 'design' ? 'on' : ''} onClick={() => setMode('design')}>
              ✎ {t('Design')}
            </button>
            <button className={mode === 'live' ? 'on' : ''} onClick={() => setMode('live')} data-testid="nx-live">
              ▶ {t('Live screen')}
            </button>
          </div>
          {mode === 'live' && !nxComp && <span className="pill warn">{t('Add a Nextion display to the circuit and wire it to UART (GPIO14/15, 5V, GND).')}</span>}
          {mode === 'live' && rt && (
            <span className="muted small" dir="ltr">
              page {rt.page} · baud {rt.baud} · bkcmd {rt.bkcmd} · sys0={rt.sys[0]}
            </span>
          )}
        </div>
        <div className="nx-stage">
          {mode === 'live' ? (
            <div className="nx-bezel">
              <NextionScreen compId={nxComp?.id ?? null} scale={SCALE} interactive />
            </div>
          ) : (
            <div
              className="nx-bezel"
              onPointerMove={onMove}
              onPointerUp={() => (drag.current = null)}
              onPointerDown={() => st.setNextionSel(null)}
            >
              <div className="nx-screen" style={{ width: project.width * SCALE, height: project.height * SCALE, background: rgb565ToCss(page.bco) }} data-testid="nx-design">
                {page.components.map((c) => (
                  <div key={c.id} className={`nx-edit ${sel === c.name ? 'sel' : ''}`} style={{ position: 'absolute', left: c.x * SCALE, top: c.y * SCALE, width: c.w * SCALE, height: c.h * SCALE }} onPointerDown={(e) => onDown(e, c, 'move')}>
                    <div style={{ position: 'absolute', left: -c.x * SCALE, top: -c.y * SCALE }}>{c.type === 'variable' || c.type === 'timer' ? null : renderNxComponent(c, c.attrs, false, SCALE)}</div>
                    {(c.type === 'variable' || c.type === 'timer' || c.type === 'hotspot') && <div className="nx-invisible">{c.name}</div>}
                    <span className="nx-tag">{c.name}</span>
                    {sel === c.name && <span className="nx-resize" onPointerDown={(e) => onDown(e, c, 'resize')} />}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="nx-console">
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (rt) {
                const r = rt.exec(cmd, sim.clock.now(), true);
                st.showToast(r.ok ? t('OK') : `${t('Error')} 0x${r.code.toString(16).padStart(2, '0')}`);
              }
            }}
          >
            <span className="muted small">{t('Test an instruction directly on the display (not via the Pi):')}</span>
            <input value={cmd} onChange={(e) => setCmd(e.target.value)} dir="ltr" style={{ flex: 1 }} />
            <button type="submit" disabled={!rt}>
              {t('Send')}
            </button>
          </form>
          <div className="uart-log" dir="ltr">
            {nxLog.length === 0 && <span className="muted">{t('No UART traffic with the Nextion yet.')}</span>}
            {nxLog.map((e, i) => (
              <div key={i} className={`uart-${e.dir}`}>
                <b>{e.dir === 'tx' ? 'Pi → Nextion' : 'Nextion → Pi'}</b> <code>{e.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}</code>{' '}
                <span className="muted">{e.bytes.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('')}</span>
                {e.note && <span className="uart-note"> ⚠ {e.note}</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className="inspector nx-props">
        {selected && mode === 'design' ? (
          <CompProps c={selected} update={(patch, h) => updateComp(selected.name, patch, h)} onDelete={() => update((p) => ((p.pages.find((x) => x.id === page.id)!.components = p.pages.find((x) => x.id === page.id)!.components.filter((x) => x.name !== selected.name)), p))} pageComps={page.components} />
        ) : (
          <>
            <div className="panel-title">{t('Instruction reference')}</div>
            <pre className="nx-ref" dir="ltr">
              {REFERENCE}
            </pre>
          </>
        )}
      </aside>
    </div>
  );
}

function hex565(c: number) {
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(rgb565ToCss(c))!;
  return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('');
}

const COLOR_ATTRS = new Set(['bco', 'pco', 'bco2', 'pco2']);

function CompProps({ c, update, onDelete, pageComps }: { c: NxComponent; update: (fn: (c: NxComponent) => void, h?: boolean) => void; onDelete: () => void; pageComps: NxComponent[] }) {
  const t = useT();
  const attrs = { ...NX_DEFAULTS[c.type].attrs, ...c.attrs };
  return (
    <div data-testid="nx-props">
      <div className="panel-title">
        {c.name} <span className="muted">id {c.id}</span>
      </div>
      <label className="field">
        <span>objname</span>
        <input
          value={c.name}
          dir="ltr"
          onChange={(e) => {
            const v = e.target.value.replace(/[^\w]/g, '');
            if (v && !pageComps.some((x) => x.name === v && x !== c)) update((x) => (x.name = v));
          }}
        />
      </label>
      <div className="row">
        {(['x', 'y', 'w', 'h'] as const).map((k) => (
          <label key={k} className="mini">
            {k}
            <input type="number" value={c[k]} onChange={(e) => update((x) => (x[k] = Number(e.target.value)))} />
          </label>
        ))}
      </div>
      {Object.keys(attrs).map((k) => (
        <label key={k} className="field">
          <span dir="ltr">{k}</span>
          {COLOR_ATTRS.has(k) ? (
            <div className="row" style={{ margin: 0 }}>
              <input type="color" value={hex565(Number(attrs[k]))} onChange={(e) => update((x) => (x.attrs[k] = cssToRgb565(e.target.value)), false)} />
              <code>{attrs[k]}</code>
            </div>
          ) : k === 'pic' ? (
            <select value={Number(attrs[k])} onChange={(e) => update((x) => (x.attrs[k] = Number(e.target.value)))}>
              {PICS.map((p, i) => (
                <option key={i} value={i}>
                  {i}: {p}
                </option>
              ))}
            </select>
          ) : k === 'vscope' ? (
            <select value={Number(attrs[k])} onChange={(e) => update((x) => (x.attrs[k] = Number(e.target.value)))}>
              <option value={0}>local</option>
              <option value={1}>global</option>
            </select>
          ) : typeof NX_DEFAULTS[c.type].attrs[k] === 'string' ? (
            <input value={String(attrs[k])} onChange={(e) => update((x) => (x.attrs[k] = e.target.value))} dir="ltr" />
          ) : (
            <input type="number" value={Number(attrs[k])} onChange={(e) => update((x) => (x.attrs[k] = Number(e.target.value)))} />
          )}
        </label>
      ))}
      {(['press', 'release'] as const).map((ev) => (
        <div key={ev}>
          <div className="panel-title sub">{ev === 'press' ? t('Touch Press Event') : t('Touch Release Event')}</div>
          <label className="row">
            <input type="checkbox" checked={!!c[ev]?.sendId} onChange={(e) => update((x) => (x[ev] = { sendId: e.target.checked, code: x[ev]?.code ?? '' }))} /> {t('Send Component ID (0x65 … to the Pi)')}
          </label>
          <textarea rows={3} value={c[ev]?.code ?? ''} placeholder={'page 1\nprinth 23 02 54 01'} dir="ltr" onChange={(e) => update((x) => (x[ev] = { sendId: x[ev]?.sendId ?? false, code: e.target.value }), false)} />
        </div>
      ))}
      {c.type === 'timer' && (
        <>
          <div className="panel-title sub">{t('Timer Event')}</div>
          <textarea rows={3} value={c.timer?.code ?? ''} dir="ltr" onChange={(e) => update((x) => (x.timer = { sendId: false, code: e.target.value }), false)} />
        </>
      )}
      <div className="row">
        <button className="danger" onClick={onDelete}>
          {t('Delete component')}
        </button>
      </div>
      <p className="muted small" dir="ltr">
        Python: ser.write(b'{c.name}.{NX_PREFIX[c.type] === 't' || c.type === 'button' ? 'txt="…"' : 'val=…'}' + b'\xff\xff\xff')
      </p>
    </div>
  );
}
