import { useState } from 'react';
import { useApp } from '../state/store';
import { runProgram, saveNow } from '../state/engine';
import { useT } from '../i18n';
import { CodeEditor } from './Editor';

/** Folder markers persist empty folders through project saves and ZIP exports. */
const KEEP_FILE = '.gitkeep';
const isFolderMarker = (name: string) => name.endsWith('/' + KEEP_FILE);
const parentPath = (name: string) => name.split('/').slice(0, -1).join('/');

function validPath(input: string): string | null {
  const path = input.trim().replace(/\\/g, '/');
  const segments = path.split('/');
  if (!path || segments.some((s) => !s.trim() || s === '.' || s === '..') || path.includes(':')) return null;
  return path;
}

type ExplorerRow = { kind: 'folder' | 'file'; path: string; label: string; depth: number };

/** Build folder rows from file paths, including empty folders that have a .gitkeep. */
function folderTree(files: { name: string }[]): ExplorerRow[] {
  const directories = new Set<string>();
  for (const file of files) {
    const parts = file.name.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  const rows: ExplorerRow[] = [];
  const walk = (parent: string, depth: number) => {
    const dirs = [...directories].filter((p) => parentPath(p) === parent).sort((a, b) => a.localeCompare(b));
    for (const dir of dirs) {
      rows.push({ kind: 'folder', path: dir, label: dir.split('/').at(-1)!, depth });
      walk(dir, depth + 1);
    }
    const children = files.filter((f) => !isFolderMarker(f.name) && parentPath(f.name) === parent)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const file of children) rows.push({ kind: 'file', path: file.name, label: file.name.split('/').at(-1)!, depth });
  };
  walk('', 0);
  return rows;
}

function isVisible(path: string, closed: string[]): boolean {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    if (closed.includes(parts.slice(0, i).join('/'))) return false;
  }
  return true;
}

/** File explorer + editor. `compact` is the version shown in the circuit dock. */
export function CodePane({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const files = useApp((s) => s.doc.files);
  const lang = useApp((s) => s.lang);
  const main = useApp((s) => s.doc.mainFile);
  const active = useApp((s) => s.activeFile);
  const theme = useApp((s) => s.theme);
  const pyError = useApp((s) => s.pyError);
  const st = useApp.getState();
  const file = files.find((f) => f.name === active && !isFolderMarker(f.name))
    ?? files.find((f) => f.name === main)
    ?? files.find((f) => !isFolderMarker(f.name))!;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [closed, setClosed] = useState<string[]>([]);
  const rows = folderTree(files);

  const createFile = (directory = '') => {
    const name = prompt(lang === 'ar' ? 'اسم الملف الجديد:' : 'New file name:', directory ? 'index.html' : 'module.py');
    if (!name) return;
    const path = validPath(directory ? directory + '/' + name : name);
    if (!path || path.endsWith('/' + KEEP_FILE)) {
      alert(lang === 'ar' ? 'اسم الملف غير صالح' : 'Invalid file name');
      return;
    }
    if (files.some((f) => f.name === path) || rows.some((r) => r.kind === 'folder' && r.path === path)) {
      alert(lang === 'ar' ? 'هذا الاسم موجود مسبقًا' : 'That name already exists');
      return;
    }
    st.addFile(path, path.endsWith('.py') ? '# new module\n' : '');
    setClosed((old) => old.filter((f) => f !== directory));
  };

  const createFolder = () => {
    const name = prompt(lang === 'ar' ? 'اسم المجلد الجديد (مثل templates):' : 'New folder name (e.g. templates):', 'templates');
    if (!name) return;
    const path = validPath(name);
    if (!path || path.endsWith('/' + KEEP_FILE)) {
      alert(lang === 'ar' ? 'اسم المجلد غير صالح' : 'Invalid folder name');
      return;
    }
    if (rows.some((r) => r.path === path) || files.some((f) => f.name === path)) {
      alert(lang === 'ar' ? 'المجلد أو الملف موجود مسبقًا' : 'Folder or file already exists');
      return;
    }
    st.addFile(path + '/' + KEEP_FILE, '');
    st.setActiveFile(file.name);
    setClosed((old) => old.filter((f) => f !== path));
  };

  const deleteEmptyFolder = (path: string) => {
    const keep = path + '/' + KEEP_FILE;
    if (!files.some((f) => f.name === keep)) return;
    if (files.some((f) => f.name.startsWith(path + '/') && f.name !== keep)) {
      alert(lang === 'ar' ? 'احذف الملفات داخل المجلد أولًا' : 'Delete files inside the folder first');
      return;
    }
    if (confirm(lang === 'ar' ? 'حذف المجلد الفارغ؟' : 'Delete empty folder?')) st.deleteFile(keep);
  };

  const errLine = pyError && pyError.file === file.name ? pyError.line : null;
  return (
    <div className={'code-pane ' + (compact ? 'compact' : '')}>
      <div className="file-explorer" aria-label={t('Files')}>
        <div className="panel-title">
          {t('Files')}
          <button className="icon" title={lang === 'ar' ? 'إنشاء مجلد' : 'New folder'} aria-label={lang === 'ar' ? 'إنشاء مجلد' : 'New folder'} onClick={createFolder}>
            📁＋
          </button>
          <button className="icon" title={t('New file')} aria-label={t('New file')} onClick={() => createFile()}>
            ＋
          </button>
        </div>
        {rows.filter((row) => isVisible(row.path, closed)).map((row) => (
          row.kind === 'folder' ? (
            <div key={'dir:' + row.path} className="file">
              <button
                className="file-name"
                title={row.path}
                style={{ paddingInlineStart: 6 + row.depth * 12 }}
                onClick={() => setClosed((old) => old.includes(row.path) ? old.filter((p) => p !== row.path) : [...old, row.path])}
              >
                {closed.includes(row.path) ? '▸' : '▾'} 📁 {row.label}
              </button>
              <button className="icon" title={lang === 'ar' ? 'ملف جديد داخل المجلد' : 'New file in folder'} onClick={() => createFile(row.path)}>＋</button>
              {files.some((f) => f.name === row.path + '/' + KEEP_FILE) && (
                <button className="icon" title={lang === 'ar' ? 'حذف المجلد الفارغ' : 'Delete empty folder'} onClick={() => deleteEmptyFolder(row.path)}>×</button>
              )}
            </div>
          ) : (
            <div key={row.path} className={'file ' + (row.path === file.name ? 'on' : '')}>
              {renaming === row.path ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const path = validPath(newName);
                    if (path && !files.some((f) => f.name === path && f.name !== row.path)) st.renameFile(row.path, path);
                    setRenaming(null);
                  }}
                >
                  <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onBlur={() => setRenaming(null)} dir="ltr" />
                </form>
              ) : (
                <button
                  className="file-name"
                  style={{ paddingInlineStart: 6 + row.depth * 12 }}
                  onClick={() => st.setActiveFile(row.path)}
                  onDoubleClick={() => (setRenaming(row.path), setNewName(row.path))}
                  dir="ltr"
                  title={row.path}
                >
                  {row.path.endsWith('.py') ? '🐍' : '📄'} {row.label}
                  {row.path === main && <span className="badge">main</span>}
                </button>
              )}
              {row.path === file.name && !compact && (
                <span className="file-actions">
                  {row.path !== main && row.path.endsWith('.py') && (
                    <button className="icon" title={t('Set as main file')} onClick={() => st.setMainFile(row.path)}>▶</button>
                  )}
                  {files.length > 1 && (
                    <button className="icon" title={t('Delete file')} onClick={() => confirm(t('Delete {f}?', { f: row.path })) && st.deleteFile(row.path)}>✕</button>
                  )}
                </span>
              )}
            </div>
          )
        ))}
      </div>
      <CodeEditor
        value={file.content}
        filename={file.name}
        dark={theme === 'dark'}
        errorLine={errLine}
        onChange={(v) => st.setFile(file.name, v)}
        onRun={() => void runProgram()}
        onSave={() => void saveNow()}
      />
    </div>
  );
}
