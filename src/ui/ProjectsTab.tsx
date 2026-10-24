import { useEffect, useRef, useState } from 'react';
import { newProject, uid } from '../engine/project';
import { useApp } from '../state/store';
import { saveNow } from '../state/engine';
import { deleteProject, download, exportJson, exportZip, importFile, listProjects, loadProject, saveProject, type ProjectMeta } from '../state/persist';
import { wiringTable } from '../state/wiring';
import { useT } from '../i18n';
import { EXAMPLES } from '../examples';
import { openExample } from './learn/LearnTab';

export default function ProjectsTab() {
  const t = useT();
  const doc = useApp((s) => s.doc);
  const lang = useApp((s) => s.lang);
  const [list, setList] = useState<ProjectMeta[]>([]);
  const [q, setQ] = useState('');
  const [tpl, setTpl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = async () => setList(await listProjects());
  useEffect(() => {
    void saveNow().then(refresh);
  }, []);

  const open = async (id: string) => {
    await saveNow();
    const d = await loadProject(id);
    if (d) {
      useApp.getState().loadProject(d);
      useApp.getState().setTab('circuit');
    }
  };
  const create = async () => {
    await saveNow();
    const d = newProject(t('New project'));
    useApp.getState().loadProject(d);
    useApp.setState({ dirty: true });
    await saveNow();
    await refresh();
    useApp.getState().setTab('circuit');
  };
  const duplicate = async (id: string) => {
    const d = await loadProject(id);
    if (!d) return;
    const c = { ...structuredClone(d), id: uid('p'), name: `${d.name} (copy)`, createdAt: Date.now() };
    await saveProject(c);
    await refresh();
  };
  const saveAs = async () => {
    const n = prompt(t('Save a copy as'), `${doc.name} (copy)`);
    if (!n) return;
    await saveNow();
    const c = { ...structuredClone(useApp.getState().doc), id: uid('p'), name: n, createdAt: Date.now() };
    useApp.getState().loadProject(c);
    useApp.setState({ dirty: true });
    await saveNow();
    await refresh();
    useApp.getState().showToast(t('Saved as "{n}" — you are now editing the copy.', { n }));
  };
  const fromTemplate = async () => {
    const ex = EXAMPLES.find((e) => e.id === tpl);
    if (ex) await openExample(ex);
    else await create();
  };
  const rename = async (m: ProjectMeta) => {
    const n = prompt(t('New name'), m.name);
    if (!n) return;
    if (m.id === doc.id) {
      useApp.getState().rename(n);
      await saveNow();
    } else {
      const d = await loadProject(m.id);
      if (d) await saveProject({ ...d, name: n });
    }
    await refresh();
  };
  const remove = async (m: ProjectMeta) => {
    if (!confirm(t('Delete "{n}" permanently?', { n: m.name }))) return;
    await deleteProject(m.id);
    if (m.id === doc.id) useApp.getState().loadProject(newProject());
    await refresh();
  };

  return (
    <div className="page" data-testid="projects-tab">
      <h1>💾 {t('Saved projects')}</h1>
      <p className="muted">{t('Projects are stored in this browser (IndexedDB) and survive reloads and restarts unless you clear site data. Export them to keep a copy or move them to another computer.')}</p>
      <div className="row">
        <button className="primary" onClick={() => void create()} data-testid="new-project">
          ＋ {t('New project')}
        </button>
        <button onClick={() => void saveNow().then(refresh)} data-testid="save-project">
          💾 {t('Save current')}
        </button>
        <button onClick={() => void saveAs()} data-testid="save-as">
          {t('Save as…')}
        </button>
        <button className="primary" onClick={() => useApp.getState().setExportOpen(true)} data-testid="export-open">
          ⬇ {t('Export project…')}
        </button>
        <button onClick={() => download(exportJson(doc), `${doc.name.replace(/[^\w-]+/g, '_')}.json`)} data-testid="export-json">
          ⬇ {t('Export JSON')}
        </button>
        <button onClick={() => download(exportZip(doc), `${doc.name.replace(/[^\w-]+/g, '_')}.zip`)} data-testid="export-zip">
          ⬇ {t('Export ZIP (code + wiring)')}
        </button>
        <button onClick={() => download(new Blob([wiringTable(doc)], { type: 'text/markdown' }), 'wiring.md')}>⬇ {t('Wiring table (.md)')}</button>
        <button onClick={() => fileRef.current?.click()} data-testid="import">
          ⬆ {t('Import JSON/ZIP')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.zip"
          hidden
          data-testid="import-input"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              await saveNow();
              const d = await importFile(f);
              useApp.getState().loadProject(d);
              useApp.setState({ dirty: true });
              await saveNow();
              await refresh();
              useApp.getState().showToast(t('Imported "{n}"', { n: d.name }));
            } catch (err: any) {
              alert(`${t('Import failed')}: ${err?.message ?? err}`);
            }
          }}
        />
      </div>
      <div className="row wrap">
        <label>
          {t('Start from a template')}{' '}
          <select value={tpl} onChange={(e) => setTpl(e.target.value)} data-testid="template-select">
            <option value="">{t('Blank project')}</option>
            {EXAMPLES.map((e) => (
              <option key={e.id} value={e.id}>
                {lang === 'ar' ? e.title.ar : e.title.en}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => void fromTemplate()} data-testid="new-from-template">
          ＋ {t('Create')}
        </button>
      </div>
      {list.length > 1 && (
        <div className="row wrap recent" data-testid="recent-projects">
          <span className="muted small">{t('Recent')}:</span>
          {list
            .filter((m) => m.id !== doc.id)
            .slice(0, 5)
            .map((m) => (
              <button key={m.id} className="chip" onClick={() => void open(m.id)}>
                {m.name}
              </button>
            ))}
        </div>
      )}
      <input className="search" placeholder={t('Search projects…')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Search projects')} data-testid="project-search" />
      <table className="data-table" data-testid="project-list">
        <thead>
          <tr>
            <th>{t('Name')}</th>
            <th>{t('Parts')}</th>
            <th>{t('Last saved')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase())).map((m) => (
            <tr key={m.id} className={m.id === doc.id ? 'used' : ''}>
              <td>
                {m.name} {m.id === doc.id && <span className="badge">{t('open')}</span>}
              </td>
              <td>{m.parts}</td>
              <td>{new Date(m.updatedAt).toLocaleString()}</td>
              <td className="row" style={{ margin: 0 }}>
                <button onClick={() => void open(m.id)}>{t('Open')}</button>
                <button onClick={() => void rename(m)}>{t('Rename')}</button>
                <button onClick={() => void duplicate(m.id)}>{t('Duplicate')}</button>
                <button className="danger" onClick={() => void remove(m)}>
                  {t('Delete')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
