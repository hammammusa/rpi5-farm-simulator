import { useEffect, useState } from 'react';
import { CHALLENGES, type Challenge } from '../../competition/challenges';
import { runScenario, type ScenarioReport } from '../../tests/host';
import { useApp } from '../../state/store';
import { saveNow } from '../../state/engine';
import { useT } from '../../i18n';
import { download } from '../../state/persist';
import { reportMarkdown } from '../tests/TestsTab';

interface Attempt {
  challenge: string;
  projectId: string;
  started: number;
  deadline: number;
  finished?: number;
  results?: ScenarioReport[];
}

const KEY = 'rpi5sim.competition';
function loadState(): { current: Attempt | null; history: Attempt[] } {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '') || { current: null, history: [] };
  } catch {
    return { current: null, history: [] };
  }
}
function saveState(s: { current: Attempt | null; history: Attempt[] }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export default function CompetitionTab() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const docId = useApp((s) => s.doc.id);
  const [st, setSt] = useState(loadState);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ScenarioReport[] | null>(st.current?.results ?? null);
  const L = (b: { en: string; ar: string }) => (lang === 'ar' ? b.ar : b.en);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const update = (s: typeof st) => {
    setSt(s);
    saveState(s);
  };
  const cur = st.current;
  const ch = cur ? CHALLENGES.find((c) => c.id === cur.challenge) : null;
  const left = cur ? Math.max(0, cur.deadline - now) : 0;

  const start = async (c: Challenge) => {
    await saveNow();
    const d = c.build();
    useApp.getState().loadProject(d);
    useApp.setState({ dirty: true });
    await saveNow();
    setResults(null);
    update({ ...st, current: { challenge: c.id, projectId: d.id, started: Date.now(), deadline: Date.now() + c.minutes * 60_000 } });
    useApp.getState().setTab('circuit');
  };

  const check = async (final: boolean) => {
    if (!ch || !cur) return;
    if (docId !== cur.projectId) {
      alert(t('Open the challenge project first (Projects tab).'));
      return;
    }
    setBusy(true);
    await saveNow();
    const out: ScenarioReport[] = [];
    for (const cp of ch.checkpoints) out.push(await runScenario(cp, 1, true));
    setResults(out);
    setBusy(false);
    if (final) {
      const done = { ...cur, finished: Date.now(), results: out };
      update({ current: null, history: [done, ...st.history].slice(0, 20) });
    } else update({ ...st, current: { ...cur, results: out } });
  };

  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);
  return (
    <div className="page" data-testid="competition-tab">
      <h1>🏆 {t('City Farming Competition Practice Mode')}</h1>
      <p className="muted">
        {t('Training challenges modelled on the City Farming module structure (controller + web interface, Nextion interface, hardware faults). They are not the official competition tasks, and passing the automatic checks does not guarantee official scores.')}
      </p>
      {cur && ch ? (
        <div className="card">
          <div className="row">
            <h3 style={{ flex: 1 }}>{L(ch.title)}</h3>
            <span className={`timer ${left < 5 * 60000 ? 'urgent' : ''}`} data-testid="countdown">
              ⏱ {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
            </span>
          </div>
          <p>{L(ch.brief)}</p>
          <ol>
            {ch.tasks.map((x, i) => (
              <li key={i}>{L(x)}</li>
            ))}
          </ol>
          <div className="row">
            <button onClick={() => void check(false)} disabled={busy} data-testid="checkpoint">
              {busy ? t('Checking…') : t('Check checkpoints now')}
            </button>
            <button className="primary" onClick={() => confirm(t('Finish the challenge and record the result?')) && void check(true)} disabled={busy}>
              {t('Finish & score')}
            </button>
            <button className="danger" onClick={() => update({ ...st, current: null })}>
              {t('Abandon')}
            </button>
          </div>
          {left === 0 && <p className="pill err">{t('Time is up — press "Finish & score".')}</p>}
        </div>
      ) : (
        <div className="cards">
          {CHALLENGES.map((c) => (
            <div key={c.id} className="card">
              <h3>{L(c.title)}</h3>
              <div className="muted small">
                ⏱ {c.minutes} min · {c.checkpoints.length} {t('automatic checkpoints')}
              </div>
              <p className="small">{L(c.brief)}</p>
              <button className="primary" onClick={() => void start(c)} data-testid={`start-${c.id}`}>
                {t('Start challenge')}
              </button>
            </div>
          ))}
        </div>
      )}
      {results && <Results results={results} />}
      {st.history.length > 0 && (
        <>
          <h2>{t('Previous attempts')}</h2>
          <table className="data-table">
            <tbody>
              {st.history.map((a, i) => {
                const c = CHALLENGES.find((x) => x.id === a.challenge);
                const pass = a.results?.filter((r) => r.status === 'PASS').length ?? 0;
                return (
                  <tr key={i}>
                    <td>{c ? L(c.title) : a.challenge}</td>
                    <td>{new Date(a.started).toLocaleString()}</td>
                    <td>{Math.round(((a.finished ?? a.started) - a.started) / 60000)} min</td>
                    <td>
                      {pass}/{a.results?.length ?? 0}
                    </td>
                    <td>
                      {a.results && (
                        <button onClick={() => download(new Blob([reportMarkdown(a.results!, `${c?.title.en} — attempt report`)], { type: 'text/markdown' }), 'challenge-report.md')}>
                          ⬇ {t('Report')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Results({ results }: { results: ScenarioReport[] }) {
  const t = useT();
  const pass = results.filter((r) => r.status === 'PASS').length;
  return (
    <div data-testid="challenge-results">
      <h2>
        {t('Score')}: {pass}/{results.length}
      </h2>
      {results.map((r) => (
        <div key={r.id} className={`issue ${r.status === 'PASS' ? '' : 'issue-error'}`} data-cp={r.id} data-status={r.status}>
          <div className="issue-title">
            {r.status === 'PASS' ? '✅' : '❌'} {r.id} · {r.name}
          </div>
          <div className="issue-explain" dir="ltr">
            {t('Expected')}: {r.expected}
            <br />
            {t('Actual')}: {r.actual} {r.error}
          </div>
        </div>
      ))}
      {pass < results.length && <p className="muted small">{t('Mistake report: each ❌ line shows what the automatic check expected and what your program/circuit actually did.')}</p>}
    </div>
  );
}
