import { useEffect, useRef, useState } from 'react';
import { newProject, uid } from '../engine/project';
import { useApp } from '../state/store';
import { saveNow } from '../state/engine';
import { deleteProject, download, exportJson, exportZip, importFile, listProjects, loadProject, saveProject, type ProjectMeta } from '../state/persist';
import { wiringTable } from '../state/wiring';
import { useT } from '../i18n';

export default function ProjectsTab() {
  const t = useT();
  const doc = useApp((s) => s.doc);
  const [list, setList] = useState<ProjectMeta[]>([]);
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
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('Name')}</th>
            <th>{t('Parts')}</th>
            <th>{t('Last saved')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((m) => (
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
