import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { CLIPS_STORAGE_DIR } from './clipping.pipeline';

/**
 * Makes sure a clip's current MP4 shows up in the Exported tab.
 *
 * Every export of a clip overwrites the same `/media/clips/<clipId>.mp4`, so a clip keeps ONE
 * Exported entry: re-exporting refreshes it (new date / resolution) instead of stacking duplicates.
 */
export async function recordClipExport(params: {
  clipId: string;
  workspaceId: string;
  res: string;
  durationMs: number;
  bytes?: number;
}): Promise<any> {
  const { clipId, workspaceId, res, durationMs } = params;
  const mp4 = path.join(CLIPS_STORAGE_DIR, `${clipId}.mp4`);
  const bytes = params.bytes ?? (fs.existsSync(mp4) ? fs.statSync(mp4).size : 0);

  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, include: { plan: true } });
  const watermark = (ws?.plan?.key || 'free') === 'free';

  const existing = await prisma.finalVideo.findMany({ where: { clip_id: clipId }, orderBy: { created_at: 'desc' } });
  if (existing.length) {
    const [latest, ...older] = existing;
    for (const old of older) await prisma.finalVideo.delete({ where: { id: old.id } });
    await prisma.asset
      .update({
        where: { id: latest.asset_id },
        data: { bytes: BigInt(bytes), duration_ms: durationMs, storage_key: `/media/clips/${clipId}.mp4?t=${Date.now()}` },
      })
      .catch(() => {});
    return prisma.finalVideo.update({
      where: { id: latest.id },
      data: { res, status: 'done', watermark, created_at: new Date() },
    });
  }

  const asset = await prisma.asset.create({
    data: {
      workspace_id: workspaceId,
      kind: 'final',
      storage_key: `/media/clips/${clipId}.mp4?t=${Date.now()}`,
      mime: 'video/mp4',
      bytes: BigInt(bytes),
      duration_ms: durationMs,
    },
  });
  return prisma.finalVideo.create({
    data: { clip_id: clipId, asset_id: asset.id, res, status: 'done', watermark },
  });
}

/**
 * Clips that were exported from the editor before exports were recorded have an MP4 on disk but no
 * Exported entry. Adopt them so the tab really shows every exported video.
 */
export async function backfillEditorExports(workspaceId: string): Promise<void> {
  const clips = await prisma.clip.findMany({
    where: { project: { workspace_id: workspaceId, deleted_at: null } },
  });
  for (const clip of clips) {
    const doc = (clip.edit_doc_json || {}) as any;
    if (typeof doc.timelineDuration !== 'number') continue; // never exported from the editor
    if (!fs.existsSync(path.join(CLIPS_STORAGE_DIR, `${clip.id}.mp4`))) continue;
    const has = await prisma.finalVideo.findFirst({ where: { clip_id: clip.id } });
    if (has) continue;
    await recordClipExport({
      clipId: clip.id,
      workspaceId,
      res: '1080p',
      durationMs: Math.round(doc.timelineDuration * 1000),
    });
  }
}
