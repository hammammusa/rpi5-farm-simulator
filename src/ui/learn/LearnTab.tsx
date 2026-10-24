import { useMemo, useState } from 'react';
import type { Example } from '../../examples';
import { uid } from '../../engine/project';
import { getPart, hasPart } from '../../engine/parts';
import { useApp } from '../../state/store';
import { saveNow } from '../../state/engine';
import { runScenario, type ScenarioReport } from '../../tests/host';
import { useT } from '../../i18n';
import { CATEGORIES, LIBRARY, libraryEntry, libraryTypes, type Bi, type Cat, type LibraryEntry, type Level } from '../../library';
import { Docs } from './Docs';

const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];
const LEVEL_RANK: Record<Level, number> = { beginner: 0, intermediate: 1, advanced: 2 };
type Sort = 'number' | 'easy' | 'hard' | 'fewest' | 'most';
type Status = 'all' | 'fav' | 'tried' | 'done' | 'new';

// ------------------------------------------------------------------ progress (per browser)
const KEY = 'rpi5sim.library';
interface Progress {
  fav: string[];
  tried: string[];
  done: string[];
}
function loadProgress(): Progress {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { fav: p.fav ?? [], tried: p.tried ?? [], done: p.done ?? [] };
  } catch {
    return { fav: [], tried: [], done: [] };
  }
}
function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode: progress lives for this session only */
  }
}
const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
// the store is module-level so the results and the selection survive switching tabs
let progressCache: Progress | null = null;
const REPORTS: Record<string, ScenarioReport[]> = {};
let lastSel: string | null = null;

/** Opens an example as a private copy (new project id, saved on its own). */
export async function openEntry(e: LibraryEntry) {
  await saveNow();
  const d = e.build();
  d.id = uid('p');
  d.createdAt = d.updatedAt = Date.now();
  useApp.getState().loadProject(d);
  useApp.setState({ dirty: true });
  await saveNow();
  useApp.getState().setTab('circuit');
  const p = progressCache ?? loadProgress();
  progressCache = { ...p, tried: toggle(p.tried, e.id, true) };
  saveProgress(progressCache);
}

export async function openExample(ex: Example) {
  const e = libraryEntry(ex.id);
  if (e) await openEntry(e);
}

const isOpen = (e: LibraryEntry, exampleId: string | undefined) => exampleId === e.id || exampleId === `lib:${e.id}`;

/** suggestions: the next examples in the same category, then ones that reuse the same parts at the same or next level */
function suggestions(e: LibraryEntry, p: Progress): LibraryEntry[] {
  const fresh = (x: LibraryEntry) => x.id !== e.id && !p.done.includes(x.id);
  const rank = LEVEL_RANK[e.level];
  const sameCat = LIBRARY.filter((x) => fresh(x) && x.cat === e.cat && LEVEL_RANK[x.level] >= rank).sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.n - b.n);
  const mine = new Set(e.types.filter((t) => t !== 'rpi5' && t !== 'resistor'));
  const shared = (x: LibraryEntry) => x.types.filter((t) => mine.has(t)).length;
  const related = LIBRARY.filter((x) => fresh(x) && x.cat !== e.cat && shared(x) > 0 && LEVEL_RANK[x.level] - rank >= 0 && LEVEL_RANK[x.level] - rank <= 1).sort((a, b) => shared(b) - shared(a) || a.n - b.n);
  return [...sameCat.slice(0, 2), ...related.slice(0, 2)].slice(0, 4);
}

export default function LearnTab() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const current = useApp((s) => s.doc.exampleId);
  const [progress, setProgressState] = useState<Progress>(() => (progressCache ??= loadProgress()));
  const [sel, setSelState] = useState<string>(() => lastSel ?? libraryEntry(current?.replace(/^lib:/, '') ?? '')?.id ?? LIBRARY[0].id);
  const [, setReportsTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Cat | 'all'>('all');
  const [level, setLevel] = useState<Level | 'all'>('all');
  const [comp, setComp] = useState('all');
  const [status, setStatus] = useState<Status>('all');
  const [sort, setSort] = useState<Sort>('number');
  const L = (b: Bi) => (lang === 'ar' ? b[1] : b[0]);
  const types = useMemo(() => libraryTypes(), []);
  const setSel = (id: string) => {
    lastSel = id;
    setSelState(id);
  };
  const setProgress = (p: Progress) => {
    progressCache = p;
    saveProgress(p);
    setProgressState(p);
  };

  const list = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out = LIBRARY.filter((e) => {
      if (cat !== 'all' && e.cat !== cat) return false;
      if (level !== 'all' && e.level !== level) return false;
      if (comp !== 'all' && !e.types.includes(comp)) return false;
      if (status === 'fav' && !progress.fav.includes(e.id)) return false;
      if (status === 'tried' && !progress.tried.includes(e.id)) return false;
      if (status === 'done' && !progress.done.includes(e.id)) return false;
      if (status === 'new' && (progress.tried.includes(e.id) || progress.done.includes(e.id))) return false;
      if (!words.length) return true;
      const hay = `${e.n} ${e.title[0]} ${e.title[1]} ${e.goal[0]} ${e.goal[1]} ${e.types.map((x) => (hasPart(x) ? `${x} ${getPart(x).name}` : x)).join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const by: Record<Sort, (a: LibraryEntry, b: LibraryEntry) => number> = {
      number: (a, b) => a.n - b.n,
      easy: (a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.minutes - b.minutes || a.n - b.n,
      hard: (a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.minutes - a.minutes || a.n - b.n,
      fewest: (a, b) => a.partCount - b.partCount || a.n - b.n,
      most: (a, b) => b.partCount - a.partCount || a.n - b.n,
    };
    return out.sort(by[sort]);
  }, [q, cat, level, comp, status, sort, progress]);

  const e = sel === '__docs' ? null : (libraryEntry(sel) ?? LIBRARY[0]);
  const reports = e ? REPORTS[e.id] : undefined;
  const fav = !!e && progress.fav.includes(e.id);
  const done = !!e && progress.done.includes(e.id);

  const check = async () => {
    if (!e) return;
    setBusy(true);
    const keep = isOpen(e, useApp.getState().doc.exampleId);
    const original = structuredClone(useApp.getState().doc);
    const out: ScenarioReport[] = [];
    for (const s of e.scenarios()) out.push(await runScenario(s, 1, keep));
    if (!keep) useApp.getState().loadProject(original);
    REPORTS[e.id] = out;
    setReportsTick((n) => n + 1);
    if (out.length && out.every((r) => r.status === 'PASS')) {
      const p = progressCache ?? progress;
      setProgress({ ...p, tried: toggle(p.tried, e.id, true), done: toggle(p.done, e.id, true) });
    }
    setBusy(false);
  };

  const grouped = sort === 'number' && cat === 'all';
  const item = (x: LibraryEntry) => (
    <button key={x.id} className={`learn-item ${x.id === sel ? 'on' : ''}`} onClick={() => setSel(x.id)} data-testid={`example-${x.n}`} data-id={x.id}>
      <span className="num">{x.n}</span>
      <span className="learn-item-title">{L(x.title)}</span>
      <span className={`lvl-dot lvl-${x.level}`} title={t(x.level)} />
      {progress.fav.includes(x.id) && <span title={t('Favourite')}>★</span>}
      {progress.done.includes(x.id) ? <span title={t('Completed')}>✔</span> : progress.tried.includes(x.id) ? <span title={t('Tried')}>◐</span> : null}
      {isOpen(x, current) && <span className="badge">{t('open')}</span>}
    </button>
  );

  return (
    <div className="learn-tab">
      <aside className="learn-list">
        <button className={`learn-item ${sel === '__docs' ? 'on' : ''}`} onClick={() => setSel('__docs')} data-testid="docs-link" style={{ marginTop: 8 }}>
          📖 {t('Python & hardware reference')}
        </button>
        <div className="lib-filters">
          <input type="search" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder={t('Search examples, parts…')} data-testid="lib-search" />
          <select value={cat} onChange={(ev) => setCat(ev.target.value as Cat | 'all')} data-testid="lib-cat" aria-label={t('Category')}>
            <option value="all">{t('All categories')}</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {lang === 'ar' ? c.ar : c.en} ({LIBRARY.filter((x) => x.cat === c.id).length})
              </option>
            ))}
          </select>
          <div className="row">
            <select value={level} onChange={(ev) => setLevel(ev.target.value as Level | 'all')} data-testid="lib-level" aria-label={t('Difficulty')}>
              <option value="all">{t('All levels')}</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(l)}
                </option>
              ))}
            </select>
            <select value={status} onChange={(ev) => setStatus(ev.target.value as Status)} data-testid="lib-status" aria-label={t('Progress')}>
              <option value="all">{t('All examples')}</option>
              <option value="fav">★ {t('Favourites')}</option>
              <option value="new">{t('Not tried yet')}</option>
              <option value="tried">◐ {t('Tried')}</option>
              <option value="done">✔ {t('Completed')}</option>
            </select>
          </div>
          <select value={comp} onChange={(ev) => setComp(ev.target.value)} data-testid="lib-comp" aria-label={t('Component')}>
            <option value="all">{t('Any component')}</option>
            {types
              .filter((x) => x.type !== 'rpi5')
              .map((x) => (
                <option key={x.type} value={x.type}>
                  {x.name} ({x.count})
                </option>
              ))}
          </select>
          <select value={sort} onChange={(ev) => setSort(ev.target.value as Sort)} data-testid="lib-sort" aria-label={t('Sort')}>
            <option value="number">{t('Sort: by number')}</option>
            <option value="easy">{t('Sort: easiest first')}</option>
            <option value="hard">{t('Sort: hardest first')}</option>
            <option value="fewest">{t('Sort: fewest components')}</option>
            <option value="most">{t('Sort: most components')}</option>
          </select>
          <div className="muted small" data-testid="lib-count">
            {list.length} / {LIBRARY.length} {t('examples')} · ✔ {progress.done.length} · ★ {progress.fav.length}
          </div>
        </div>
        {!list.length && <div className="muted small">{t('No example matches these filters.')}</div>}
        {grouped
          ? CATEGORIES.map((c) => {
              const xs = list.filter((x) => x.cat === c.id);
              if (!xs.length) return null;
              return (
                <div key={c.id}>
                  <div className="panel-title sub">
                    {c.icon} {lang === 'ar' ? c.ar : c.en}
                  </div>
                  {xs.map(item)}
                </div>
              );
            })
          : list.map(item)}
      </aside>
      {!e ? (
        <Docs />
      ) : (
        <article className="page learn-detail" data-testid="lib-detail" data-id={e.id}>
          <h1>
            {e.n}. {L(e.title)}
          </h1>
          <div className="lib-chips">
            <span className="chip">
              {CATEGORIES.find((c) => c.id === e.cat)?.icon} {lang === 'ar' ? CATEGORIES.find((c) => c.id === e.cat)?.ar : CATEGORIES.find((c) => c.id === e.cat)?.en}
            </span>
            <span className="chip">
              <span className={`lvl-dot lvl-${e.level}`} /> {t(e.level)}
            </span>
            <span className="chip">⏱ {e.minutes} {t('min')}</span>
            <span className="chip">🧩 {e.partCount} {t('components')}</span>
          </div>
          <p>
            <b>{t('Goal')}:</b> {L(e.goal)}
          </p>
          <div className="row">
            <button className="primary" onClick={() => void openEntry(e)} data-testid="open-example" title={t('Opens a private copy; the original example is never changed.')}>
              {t('Open this example')}
            </button>
            <button onClick={() => void check()} disabled={busy} data-testid="check-example">
              {busy ? t('Checking…') : isOpen(e, current) ? t('Check my project') : t('Run automated check')}
            </button>
            <button onClick={() => setProgress({ ...progress, fav: toggle(progress.fav, e.id, !fav) })} data-testid="lib-fav" aria-pressed={fav}>
              {fav ? '★' : '☆'} {t('Favourite')}
            </button>
            <button onClick={() => setProgress({ ...progress, done: toggle(progress.done, e.id, !done) })} data-testid="lib-done" aria-pressed={done}>
              {done ? '✔' : '○'} {t('Completed')}
            </button>
          </div>
          {reports?.map((r) => (
            <div key={r.id} className={`issue ${r.status === 'PASS' ? '' : 'issue-error'}`} data-check={r.status}>
              <div className="issue-title">
                {r.status === 'PASS' ? '✅' : '❌'} {r.name} — {r.status}
              </div>
              <div className="issue-explain" dir="ltr">
                {t('Expected')}: {r.expected}
                <br />
                {t('Actual')}: {r.actual} {r.error}
              </div>
            </div>
          ))}
          <h2>{t('Components')}</h2>
          <ul data-testid="lib-parts">
            {e.spec
              ? [{ type: 'rpi5', n: 1 }, ...[...e.spec.parts.reduce((m, p) => m.set(p[1], (m.get(p[1]) ?? 0) + 1), new Map<string, number>())].map(([type, n]) => ({ type, n }))].map(({ type, n }) => (
                  <li key={type}>
                    {n > 1 ? `${n} × ` : ''}
                    {getPart(type).name}
                    {type === 'resistor' ? ` (${[...new Set(e.spec!.parts.filter((p) => p[1] === 'resistor').map((p) => `${p[2].ohms >= 1000 ? `${p[2].ohms / 1000} kΩ` : `${p[2].ohms} Ω`}`))].join(', ')})` : ''}
                  </li>
                ))
              : e.legacy!.parts.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <h2>{t('Expected result')}</h2>
          <p>{L(e.result)}</p>
          <h2>{t('Test steps')}</h2>
          <ol>
            {e.steps.map((s, i) => (
              <li key={i}>{L(s)}</li>
            ))}
          </ol>
          {e.spec && (
            <>
              <h2>{t('How it works')}</h2>
              <p>{L(e.explain)}</p>
            </>
          )}
          <h2>{t('Automatic test')}</h2>
          <p className="muted" dir="ltr">
            {e.scenarios().map((s) => s.expected).join(' · ')}
          </p>
          <h2>{t('Code')}</h2>
          {(e.spec ? [{ name: 'main.py', content: e.code }, ...Object.entries(e.spec.files ?? {}).map(([name, content]) => ({ name, content }))] : e.build().files).map((f) => (
            <details key={f.name} open={f.name === 'main.py'}>
              <summary dir="ltr">{f.name}</summary>
              <pre className="code-view" dir="ltr">
                {f.content}
              </pre>
            </details>
          ))}
          <h2>{t('Try next')}</h2>
          <div className="lib-next" data-testid="lib-next">
            {suggestions(e, progress).map((x) => (
              <button key={x.id} onClick={() => setSel(x.id)} data-id={x.id}>
                <span className="num">{x.n}</span> {L(x.title)} <span className={`lvl-dot lvl-${x.level}`} />
              </button>
            ))}
          </div>
        </article>
      )}
    </div>
  );
}
