import { useEffect, useState } from 'react';
import { cancelFastForward, fastForward, runProgram, saveNow, setSpeed, sim, stopProgram, resetSimulation } from '../state/engine';
import { useApp, type Tab } from '../state/store';
import { useT } from '../i18n';

export const TABS: [Tab, string, string][] = [
  ['circuit', 'Circuit', '⚡'],
  ['python', 'Python', '🐍'],
  ['nextion', 'Nextion', '📟'],
  ['farm', 'Smart Farm', '🌱'],
  ['web', 'Web', '🌐'],
  ['tests', 'Tests', '✅'],
  ['learn', 'Examples', '📚'],
  ['competition', 'Competition', '🏆'],
  ['projects', 'Projects', '💾'],
];

export const SPEEDS = [1, 2, 5, 10];

export function useSimClock() {
  const [now, setNow] = useState(() => sim.clock.nowMs());
  useEffect(() => {
    const id = setInterval(() => setNow(sim.clock.nowMs()), 250);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function TopBar() {
  const t = useT();
  const mode = useApp((s) => s.mode);
  const tab = useApp((s) => s.tab);
  const name = useApp((s) => s.doc.name);
  const rs = useApp((s) => s.runtimeState);
  const detail = useApp((s) => s.runtimeDetail);
  const dirty = useApp((s) => s.dirty);
  const savedAt = useApp((s) => s.savedAt);
  const theme = useApp((s) => s.theme);
  const lang = useApp((s) => s.lang);
  const speed = useApp((s) => s.speed);
  const now = useSimClock();
  const st = useApp.getState();
  const running = rs === 'running' || rs === 'stopping';
  const ff = useApp((s) => s.ff);

  const d = new Date(now);
  return (
    <header className="topbar">
      <div className="brand" title="Raspberry Pi 5 Virtual Electronics & Smart Farming Simulator">
        <span className="logo" aria-hidden>
          🍓
        </span>
        <span className="brand-text">
          Pi5 <b>FarmSim</b>
        </span>
      </div>
      <input className="project-name" value={name} onChange={(e) => st.rename(e.target.value)} aria-label={t('Project name')} />
      <span className={`save-state ${dirty ? 'dirty' : ''}`} title={savedAt ? new Date(savedAt).toLocaleTimeString() : ''}>
        {dirty ? t('unsaved') : savedAt ? t('saved') : ''}
      </span>
      <nav className="tabs" role="tablist" aria-label={t('Sections')}>
        {TABS.map(([id, label, icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => st.setTab(id)} data-testid={`tab-${id}`}>
            <span aria-hidden>{icon}</span> <span className="tab-label">{t(label)}</span>
          </button>
        ))}
      </nav>
      <div className="run-controls">
        {!running ? (
          <button className="run" onClick={() => void runProgram()} disabled={rs === 'failed'} title={t('Run (F5 / Ctrl+Enter)')} data-testid="run">
            ▶ {t('Run')}
          </button>
        ) : (
          <button className="stop" onClick={() => void stopProgram()} title={t('Stop (Shift+F5)')} data-testid="stop">
            ■ {t('Stop')}
          </button>
        )}
        <button onClick={() => resetSimulation()} title={t('Reset simulation (burned parts, devices, farm)')} data-testid="reset">
          ↺
        </button>
        <select value={ff ? 'ff' : speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label={t('Simulation speed')} data-testid="speed" disabled={ff !== null}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
          {ff !== null && <option value="ff">600× ⏩</option>}
        </select>
        <button
          onClick={() => (ff ? cancelFastForward() : fastForward(sim.clock.nowMs() + 3600_000))}
          title={ff ? t('Stop fast-forward') : t('Fast-forward 1 hour (600×, events stay in order)')}
          className={ff ? 'on' : ''}
          data-testid="ff"
        >
          ⏩
        </button>
        <span className="sim-clock" dir="ltr" title={t('Simulation clock')} data-testid="sim-clock">
          {d.toLocaleDateString(lang === 'ar' ? 'ar' : undefined, { day: '2-digit', month: 'short' })} {d.toLocaleTimeString(undefined, { hour12: false })}
        </span>
        <span className={`rt-state rt-${rs}`} title={detail} data-testid="runtime-state">
          {rs === 'loading' ? '⏳ ' + t('Python loading') : rs === 'ready' ? '● ' + t('Ready') : rs === 'running' ? '▶ ' + t('Running') : rs === 'stopping' ? '… ' + t('Stopping') : '⚠ ' + t('Python unavailable')}
        </span>
      </div>
      <div className="prefs">
        <button
          className="mode-toggle"
          onClick={() => st.setMode(mode === 'beginner' ? 'advanced' : 'beginner')}
          title={mode === 'beginner' ? t('Beginner mode: pin explanations, wiring hints and plain-language errors. Click for Advanced mode (protocol monitors, logs, technical detail).') : t('Advanced mode: protocol inspection, simulation log and technical detail. Click for Beginner mode.')}
          data-testid="mode-toggle"
          data-mode={mode}
        >
          {mode === 'beginner' ? `🎓 ${t('Beginner')}` : `🛠 ${t('Advanced')}`}
        </button>
        <button onClick={() => st.setExportOpen(true)} title={t('Export project: image, wiring table, BOM, PDF, ZIP')} aria-label={t('Export project')} data-testid="export-btn">
          ⬇
        </button>
        <button onClick={() => void saveNow()} title={t('Save (Ctrl+S)')} aria-label={t('Save')}>
          💾
        </button>
        <button onClick={() => st.setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={t('Toggle dark/light mode')} title={t('Toggle dark/light mode')}>
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <button onClick={() => st.setLang(lang === 'en' ? 'ar' : 'en')} aria-label="Language / اللغة" title="English / العربية" data-testid="lang">
          {lang === 'en' ? 'ع' : 'EN'}
        </button>
      </div>
    </header>
  );
}
