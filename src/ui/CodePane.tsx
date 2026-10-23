import { useState } from 'react';
import { useApp } from '../state/store';
import { runProgram, saveNow } from '../state/engine';
import { useT } from '../i18n';
import { CodeEditor } from './Editor';

/** File explorer + editor. `compact` is the version shown in the circuit dock. */
export function CodePane({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const files = useApp((s) => s.doc.files);
  const main = useApp((s) => s.doc.mainFile);
  const active = useApp((s) => s.activeFile);
  const theme = useApp((s) => s.theme);
  const pyError = useApp((s) => s.pyError);
  const st = useApp.getState();
  const file = files.find((f) => f.name === active) ?? files.find((f) => f.name === main) ?? files[0];
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const errLine = pyError && pyError.file === file.name ? pyError.line : null;
  return (
    <div className={`code-pane ${compact ? 'compact' : ''}`}>
      <div className="file-explorer" aria-label={t('Files')}>
        <div className="panel-title">
          {t('Files')}
          <button
            className="icon"
            title={t('New file')}
            aria-label={t('New file')}
            onClick={() => {
              const n = prompt(t('File name (e.g. sensors.py or templates/index.html)'), 'module.py');
              if (n) st.addFile(n.trim(), n.endsWith('.py') ? '# new module\n' : '');
            }}
          >
            ＋
          </button>
        </div>
        {files.map((f) => (
          <div key={f.name} className={`file ${f.name === file.name ? 'on' : ''}`}>
            {renaming === f.name ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  st.renameFile(f.name, newName.trim());
                  setRenaming(null);
                }}
              >
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onBlur={() => setRenaming(null)} dir="ltr" />
              </form>
            ) : (
              <button className="file-name" onClick={() => st.setActiveFile(f.name)} onDoubleClick={() => (setRenaming(f.name), setNewName(f.name))} dir="ltr" title={t('Double-click to rename')}>
                {f.name.endsWith('.py') ? '🐍' : '📄'} {f.name}
                {f.name === main && <span className="badge">main</span>}
              </button>
            )}
            {f.name === file.name && !compact && (
              <span className="file-actions">
                {f.name !== main && f.name.endsWith('.py') && (
                  <button className="icon" title={t('Set as main file')} onClick={() => st.setMainFile(f.name)}>
                    ▶
                  </button>
                )}
                {files.length > 1 && (
                  <button className="icon" title={t('Delete file')} onClick={() => confirm(t('Delete {f}?', { f: f.name })) && st.deleteFile(f.name)}>
                    ✕
                  </button>
                )}
              </span>
            )}
          </div>
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
