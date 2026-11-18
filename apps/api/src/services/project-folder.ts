import fs from 'fs';
import path from 'path';
import { CLIPS_STORAGE_DIR, UPLOADS_STORAGE_DIR } from './clipping.pipeline';

/**
 * One folder per project that gathers its downloaded source video(s) and generated
 * short clips in one place. Files stay where the pipeline writes them (storage/uploads,
 * storage/clips); this folder holds symlinks to them, so nothing is duplicated and
 * playback/repair code keeps working with the original paths.
 *
 *   storage/projects/<projectId>/
 *     source.mp4 | source_scan.mkv   -> ../../uploads/<projectId>...
 *     clips/01 - <title>.mp4         -> ../../../clips/<clipId>.mp4
 */
export const PROJECTS_STORAGE_DIR = path.resolve(UPLOADS_STORAGE_DIR, '../projects');

const VIDEO_EXT = /\.(mp4|mkv|webm|mov)$/i;

function safeName(s: string): string {
  return (s || 'clip')
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function relinkDir(dir: string, wanted: Map<string, string>) {
  fs.mkdirSync(dir, { recursive: true });
  // Remove links that are stale (target gone or no longer wanted).
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (!st.isSymbolicLink()) continue;
    const target = wanted.get(name);
    if (!target || fs.readlinkSync(full) !== target) fs.unlinkSync(full);
  }
  for (const [name, target] of wanted) {
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) {
      try {
        fs.symlinkSync(target, full);
      } catch {}
    }
  }
}

/** Create/refresh the project's folder and return its absolute path. */
export function syncProjectFolder(
  projectId: string,
  clips: Array<{ id: string; title?: string | null; viral_score?: number | null }>
): string {
  const dir = path.join(PROJECTS_STORAGE_DIR, projectId);
  try {
    const sources = new Map<string, string>();
    for (const f of fs.readdirSync(UPLOADS_STORAGE_DIR)) {
      if (!f.startsWith(projectId) || !VIDEO_EXT.test(f)) continue;
      const suffix = f.slice(projectId.length); // ".mp4" or "_scan.mkv"
      sources.set(`source${suffix}`, path.relative(dir, path.join(UPLOADS_STORAGE_DIR, f)));
    }
    relinkDir(dir, sources);

    const clipDir = path.join(dir, 'clips');
    const wanted = new Map<string, string>();
    const ordered = [...clips].sort((a, b) => Number(b.viral_score || 0) - Number(a.viral_score || 0));
    ordered.forEach((c, i) => {
      const file = path.join(CLIPS_STORAGE_DIR, `${c.id}.mp4`);
      if (!fs.existsSync(file)) return;
      const name = `${String(i + 1).padStart(2, '0')} - ${safeName(c.title || c.id)}.mp4`;
      wanted.set(name, path.relative(clipDir, file));
    });
    relinkDir(clipDir, wanted);
  } catch (err) {
    console.warn(`Project folder sync notice for ${projectId}:`, (err as Error).message);
  }
  return dir;
}
