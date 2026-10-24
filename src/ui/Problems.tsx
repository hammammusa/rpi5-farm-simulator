import type { Issue } from '../engine/types';
import { sim, useSimVersion } from '../state/engine';
import { useApp } from '../state/store';
import { issueText, useT } from '../i18n';
import { compName } from '../state/wiring';
import { checkHint } from '../i18n/checks';
import { pinText } from '../export/report';

export function IssueCard({ issue, compact = false }: { issue: Issue; compact?: boolean }) {
  const lang = useApp((s) => s.lang);
  const doc = useApp((s) => s.doc);
  const t = useT();
  const txt = issueText(lang, issue.code, issue.params);
  const icon = issue.severity === 'error' ? '⛔' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
  return (
    <div className={`issue issue-${issue.severity}`} data-code={issue.code} onClick={() => issue.comps.length && useApp.getState().select(issue.comps.filter((c) => doc.components.some((x) => x.id === c)))}>
      <div className="issue-title">
        {icon} {txt.title}
      </div>
      {!compact || issue.severity !== 'info' ? <div className="issue-explain">{txt.explain}</div> : null}
      {!compact && issue.comps.length > 0 && <div className="muted small">{issue.comps.map((c) => compName(doc, c)).join(', ')}</div>}
      {!compact && <AffectedConnections issue={issue} />}
      {!compact && issue.severity !== 'info' && (
        <div className="issue-check small">
          🔎 <b>{t('How to check')}:</b> {checkHint(issue.code, lang)}
        </div>
      )}
    </div>
  );
}

/** the pins an issue refers to, the net each one is on and the wires of that net */
function AffectedConnections({ issue }: { issue: Issue }) {
  const t = useT();
  const doc = useApp((s) => s.doc);
  if (!issue.pins?.length) return null;
  const seen = new Set<number>();
  const rows = issue.pins.flatMap((p) => {
    const n = sim.net.netOf(p);
    if (n < 0 || seen.has(n)) return [];
    seen.add(n);
    const c = doc.components.find((x) => x.id === p.comp);
    const wires = doc.wires.filter((w) => sim.net.netOf(w.from) === n);
    const name = sim.net.nets[n].name;
    return [{ p, label: `${compName(doc, p.comp)} · ${pinText(c, p.pin)}`, net: /^Net \d+$/.test(name) ? `N${n}` : name, wires }];
  });
  if (!rows.length) return null;
  return (
    <div className="issue-conn small" data-testid="issue-connections">
      <b>{t('Affected connection')}:</b>
      {rows.map((r) => (
        <div key={r.label} className="row" style={{ margin: 0 }}>
          <span dir="ltr">
            {r.label} — {t('net')} {r.net}
            {r.wires.length > 0 && ' — '}
            {r.wires.map((w) => (
              <span key={w.id} className="wire-chip">
                <span className="swatch-dot" style={{ background: w.color }} />
                {w.id}{' '}
              </span>
            ))}
          </span>
          <button
            className="small"
            onClick={(e) => {
              e.stopPropagation();
              useApp.getState().setHighlightNet(r.p);
              useApp.getState().select(issue.comps.filter((c) => doc.components.some((x) => x.id === c)));
              useApp.getState().setTab('circuit');
            }}
          >
            {t('Show in circuit')}
          </button>
        </div>
      ))}
    </div>
  );
}

export function Problems() {
  useSimVersion();
  const t = useT();
  const pyError = useApp((s) => s.pyError);
  const lang = useApp((s) => s.lang);
  const issues = sim.issues;
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <div className="problems" data-testid="problems">
      <div className="problems-head">
        <span className="pill err">{issues.filter((i) => i.severity === 'error').length} {t('errors')}</span>
        <span className="pill warn">{issues.filter((i) => i.severity === 'warning').length} {t('warnings')}</span>
        <span className="pill">{issues.filter((i) => i.severity === 'info').length} {t('notes')}</span>
        <span className="muted small">{t('Electrical problems come from the circuit; Python errors from your code.')}</span>
      </div>
      {pyError && (
        <div className="issue issue-error">
          <div className="issue-title">🐍 {t('Python error')}: {pyError.type}{pyError.line ? ` (${pyError.file}:${pyError.line})` : ''}</div>
          <div className="issue-explain" dir="ltr">{pyError.message}</div>
          {pyError.line && <PyErrorLine file={pyError.file} line={pyError.line} />}
        </div>
      )}
      {!sorted.length && !pyError && <p className="muted">✅ {t('No problems detected in the circuit.')}</p>}
      <div className="issue-grid">
        {sorted.map((i) => (
          <IssueCard key={i.key} issue={i} />
        ))}
      </div>
      {void lang}
    </div>
  );
}

/** the source line a Python error points at */
function PyErrorLine({ file, line }: { file?: string; line: number }) {
  const t = useT();
  const doc = useApp((s) => s.doc);
  const f = doc.files.find((x) => x.name === (file ?? doc.mainFile)) ?? doc.files.find((x) => x.name === doc.mainFile);
  const src = f?.content.split('\n')[line - 1];
  if (src === undefined) return null;
  return (
    <div className="small" data-testid="py-error-line">
      {t('Line')} {line}:{' '}
      <code dir="ltr">{src.trim()}</code>
    </div>
  );
}
