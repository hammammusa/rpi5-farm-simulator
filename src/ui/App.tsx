import { lazy, Suspense, useEffect, useState } from 'react';
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
const ExportDialog = lazy(() => import('./ExportDialog'));
const TestsTab = lazy(() => import('./tests/TestsTab'));
const LearnTab = lazy(() => import('./learn/LearnTab'));
const CompetitionTab = lazy(() => import('./learn/CompetitionTab'));
const ProjectsTab = lazy(() => import('./ProjectsTab'));

function readWidth(key: string) {
  try {
    const v = Number(localStorage.getItem(key));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Drag handle that resizes the panel on one side (widths persist per browser). */
function Splitter({ side, onResize }: { side: 'lib' | 'insp'; onResize(px: number): void }) {
  const [active, setActive] = useState(false);
  return (
    <div
      className={`splitter ${active ? 'active' : ''}`}
      role="separator"
      aria-orientation="vertical"
      data-testid={`splitter-${side}`}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as Element).setPointerCapture(e.pointerId);
        setActive(true);
        const el = (e.target as HTMLElement).parentElement!;
        const rtl = document.documentElement.dir === 'rtl';
        const move = (ev: PointerEvent) => {
          const r = el.getBoundingClientRect();
          const fromLeft = ev.clientX - r.left;
          const fromRight = r.right - ev.clientX;
          const px = side === 'lib' ? (rtl ? fromRight : fromLeft) : rtl ? fromLeft : fromRight;
          onResize(Math.max(160, Math.min(560, px)));
        };
        const up = () => {
          setActive(false);
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    />
  );
}

function CircuitTab() {
  const [lib, setLib] = useState<number | null>(() => readWidth('rpi5sim.libW'));
  const [insp, setInsp] = useState<number | null>(() => readWidth('rpi5sim.inspW'));
  const save = (k: string, v: number) => {
    try {
      localStorage.setItem(k, String(Math.round(v)));
    } catch {
      /* private mode */
    }
  };
  const style = { ...(lib ? { '--lib-w': `${lib}px` } : {}), ...(insp ? { '--insp-w': `${insp}px` } : {}) } as React.CSSProperties;
  return (
    <div className="circuit-tab" style={style}>
      <Library />
      <Splitter side="lib" onResize={(v) => (setLib(v), save('rpi5sim.libW', v))} />
      <div className="center">
        <Workspace />
        <Dock />
      </div>
      <Splitter side="insp" onResize={(v) => (setInsp(v), save('rpi5sim.inspW', v))} />
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
  const exportOpen = useApp((s) => s.exportOpen);
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
      {exportOpen && (
        <Suspense fallback={null}>
          <ExportDialog />
        </Suspense>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
