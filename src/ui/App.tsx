import { lazy, Suspense, useEffect } from 'react';
import { useApp } from '../state/store';
import { runProgram, saveNow, startLoop, startRuntime, stopProgram, restoreLast } from '../state/engine';
import { useT } from '../i18n';
import { TopBar } from './TopBar';
import { Library } from './Library';
import { Workspace } from './Workspace';
import { Inspector } from './Inspector';
import { Dock } from './Dock';
import { CodePane } from './CodePane';

const NextionTab = lazy(() => import('./nextion/NextionTab'));
const FarmTab = lazy(() => import('./farm/FarmTab'));
const WebTab = lazy(() => import('./web/WebTab'));
const TestsTab = lazy(() => import('./tests/TestsTab'));
const LearnTab = lazy(() => import('./learn/LearnTab'));
const CompetitionTab = lazy(() => import('./learn/CompetitionTab'));
const ProjectsTab = lazy(() => import('./ProjectsTab'));

function CircuitTab() {
  return (
    <div className="circuit-tab">
      <Library />
      <div className="center">
        <Workspace />
        <Dock />
      </div>
      <Inspector />
    </div>
  );
}

function PythonTab() {
  return (
    <div className="python-tab">
      <div className="center">
        <CodePane />
        <Dock withCode={false} />
      </div>
    </div>
  );
}

export function App() {
  const tab = useApp((s) => s.tab);
  const theme = useApp((s) => s.theme);
  const lang = useApp((s) => s.lang);
  const toast = useApp((s) => s.toast);
  const t = useT();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [theme, lang]);

  useEffect(() => {
    startLoop();
    void restoreLast().finally(() => startRuntime());
    const kd = (e: KeyboardEvent) => {
      const rs = useApp.getState().runtimeState;
      if (e.key === 'F5' && e.shiftKey) {
        e.preventDefault();
        void stopProgram();
      } else if (e.key === 'F5') {
        e.preventDefault();
        if (rs !== 'running') void runProgram();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (rs !== 'running') void runProgram();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        const tg = e.target as HTMLElement;
        if (tg.closest('.cm-editor') || tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA') return;
        e.preventDefault();
        useApp.getState().undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        const tg = e.target as HTMLElement;
        if (tg.closest('.cm-editor') || tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA') return;
        e.preventDefault();
        useApp.getState().redo();
      }
    };
    window.addEventListener('keydown', kd);
    const before = (e: BeforeUnloadEvent) => {
      if (useApp.getState().dirty) {
        void saveNow();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', before);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('beforeunload', before);
    };
  }, []);

  return (
    <div className="app">
      <TopBar />
      <main className="main">
        {tab === 'circuit' && <CircuitTab />}
        {tab === 'python' && <PythonTab />}
        <Suspense fallback={<div className="loading">{t('Loading…')}</div>}>
          {tab === 'nextion' && <NextionTab />}
          {tab === 'farm' && <FarmTab />}
          {tab === 'web' && <WebTab />}
          {tab === 'tests' && <TestsTab />}
          {tab === 'learn' && <LearnTab />}
          {tab === 'competition' && <CompetitionTab />}
          {tab === 'projects' && <ProjectsTab />}
        </Suspense>
      </main>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
