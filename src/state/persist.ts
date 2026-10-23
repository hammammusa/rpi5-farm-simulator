// Project storage in IndexedDB (idb-keyval) + JSON/ZIP import/export.
import { createStore, del, get, set } from 'idb-keyval';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { ProjectDoc } from '../engine/types';
import { defaultFarmConfig } from '../engine/farm';
import { emptyNextionProject } from '../engine/devices/nextion';
import { uid } from '../engine/project';
import { wiringTable } from './wiring';

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  parts: number;
  exampleId?: string;
}

let store: ReturnType<typeof createStore> | null = null;
function db() {
  if (!store) store = createStore('rpi5-farm-simulator', 'projects');
  return store;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  try {
    const idx = (await get<ProjectMeta[]>('index', db())) ?? [];
    return idx.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveProject(doc: ProjectDoc): Promise<void> {
  const d = { ...doc, updatedAt: Date.now() };
  await set(`project:${d.id}`, d, db());
  const idx = ((await get<ProjectMeta[]>('index', db())) ?? []).filter((m) => m.id !== d.id);
  idx.push({ id: d.id, name: d.name, updatedAt: d.updatedAt, createdAt: d.createdAt, parts: d.components.length, exampleId: d.exampleId });
  await set('index', idx, db());
  await set('last', d.id, db());
}

export async function loadProject(id: string): Promise<ProjectDoc | null> {
  const d = await get<ProjectDoc>(`project:${id}`, db());
  return d ? migrate(d) : null;
}

export async function deleteProject(id: string) {
  await del(`project:${id}`, db());
  const idx = ((await get<ProjectMeta[]>('index', db())) ?? []).filter((m) => m.id !== id);
  await set('index', idx, db());
}

export async function lastProjectId(): Promise<string | null> {
  try {
    return (await get<string>('last', db())) ?? null;
  } catch {
    return null;
  }
}

/** Fill fields added in later versions so old saved projects keep opening. */
export function migrate(d: any): ProjectDoc {
  return {
    schema: 1,
    id: d.id ?? uid('p'),
    name: d.name ?? 'Imported project',
    createdAt: d.createdAt ?? Date.now(),
    updatedAt: d.updatedAt ?? Date.now(),
    components: d.components ?? [],
    wires: d.wires ?? [],
    files: d.files?.length ? d.files : [{ name: 'main.py', content: '' }],
    mainFile: d.mainFile ?? d.files?.[0]?.name ?? 'main.py',
    nextion: d.nextion ?? emptyNextionProject(),
    farm: { ...defaultFarmConfig(), ...(d.farm ?? {}) },
    sim: d.sim ?? { speed: 1 },
    exampleId: d.exampleId,
    notes: d.notes,
  };
}

export function exportJson(doc: ProjectDoc): Blob {
  return new Blob([JSON.stringify({ format: 'rpi5-farm-simulator', version: 1, project: doc }, null, 2)], { type: 'application/json' });
}

export function exportZip(doc: ProjectDoc): Blob {
  const files: Record<string, Uint8Array> = {
    'project.json': strToU8(JSON.stringify({ format: 'rpi5-farm-simulator', version: 1, project: doc }, null, 2)),
    'wiring.md': strToU8(wiringTable(doc)),
    'nextion.json': strToU8(JSON.stringify(doc.nextion, null, 2)),
    'README.md': strToU8(
      `# ${doc.name}\n\nExported from the Raspberry Pi 5 Virtual Electronics & Smart Farming Simulator.\n\n- \`code/\` — your Python files (copy them to the Pi, e.g. /home/pi/project)\n- \`wiring.md\` — every connection by physical pin and BCM number\n- \`nextion.json\` — the Nextion page layout (re-create it in Nextion Editor; .HMI is not generated)\n- \`project.json\` — re-import this file (or the whole ZIP) into the simulator\n\nRun on the Pi with:\n\n    python3 ${doc.mainFile}\n`,
    ),
  };
  for (const f of doc.files) files[`code/${f.name}`] = strToU8(f.content);
  return new Blob([zipSync(files) as BlobPart], { type: 'application/zip' });
}

export async function importFile(file: File): Promise<ProjectDoc> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let json: any;
  if (file.name.toLowerCase().endsWith('.zip') || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    const z = unzipSync(buf);
    if (!z['project.json']) throw new Error('ZIP has no project.json');
    json = JSON.parse(strFromU8(z['project.json']));
    // code files in code/ override the embedded copies (lets users edit them outside)
    const p = json.project ?? json;
    for (const [name, data] of Object.entries(z)) {
      if (!name.startsWith('code/') || name.endsWith('/')) continue;
      const fname = name.slice(5);
      const content = strFromU8(data);
      const existing = p.files?.find((f: any) => f.name === fname);
      if (existing) existing.content = content;
      else (p.files ??= []).push({ name: fname, content });
    }
  } else json = JSON.parse(strFromU8(buf));
  const p = json.project ?? json;
  if (!Array.isArray(p.components)) throw new Error('Not a simulator project file');
  const doc = migrate(p);
  doc.id = uid('p');
  return doc;
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
