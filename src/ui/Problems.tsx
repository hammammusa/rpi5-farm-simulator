import type { Issue } from '../engine/types';
import { sim, useSimVersion } from '../state/engine';
import { useApp } from '../state/store';
import { issueText, useT } from '../i18n';
import { compName } from '../state/wiring';

export function IssueCard({ issue, compact = false }: { issue: Issue; compact?: boolean }) {
  const lang = useApp((s) => s.lang);
  const doc = useApp((s) => s.doc);
  const txt = issueText(lang, issue.code, issue.params);
  const icon = issue.severity === 'error' ? '⛔' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
  return (
    <div className={`issue issue-${issue.severity}`} data-code={issue.code} onClick={() => issue.comps.length && useApp.getState().select(issue.comps.filter((c) => doc.components.some((x) => x.id === c)))}>
      <div className="issue-title">
        {icon} {txt.title}
      </div>
      {!compact || issue.severity !== 'info' ? <div className="issue-explain">{txt.explain}</div> : null}
      {!compact && issue.comps.length > 0 && <div className="muted small">{issue.comps.map((c) => compName(doc, c)).join(', ')}</div>}
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
