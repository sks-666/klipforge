import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { execFile } from 'child_process';
import { syncProjectFolder } from '../services/project-folder';

/**
 * Mirrors observed internal web-app endpoints from Section 6.8
 * and global search for ⌘K Command Palette.
 */
export async function vizardCompatRoutes(app: FastifyInstance) {
  app.post('/api/v1/vizard-video/list', { preHandler: [requireAuth] }, async (req) => {
    const projects = await prisma.project.findMany({
      where: { workspace_id: req.user.workspaceId, deleted_at: null },
      orderBy: { updated_at: 'desc' },
      take: 30,
    });
    // Each project gets a folder gathering its downloaded video + generated clips.
    const list = await Promise.all(
      projects.map(async (p: any) => {
        const clips = await prisma.clip.findMany({ where: { project_id: p.id } });
        return { ...p, folder_path: syncProjectFolder(p.id, clips) };
      })
    );
    return { code: 2000, data: { list, total: list.length } };
  });

  // Open the project's folder in Finder. The API runs on the same Mac as the files,
  // so this only does anything for local use; it never accepts a path from the client.
  app.post('/api/v1/projects/:id/open-folder', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await prisma.project.findFirst({
      where: { id, workspace_id: req.user.workspaceId, deleted_at: null },
    });
    if (!project) return reply.status(404).send({ code: 4002, errMsg: 'Project not found' });
    const clips = await prisma.clip.findMany({ where: { project_id: id } });
    const dir = syncProjectFolder(id, clips);
    if (process.platform !== 'darwin') {
      return reply.status(501).send({ code: 5010, errMsg: 'Open folder is only supported on macOS', path: dir });
    }
    execFile('open', [dir], () => {});
    return { code: 2000, path: dir };
  });

  app.get('/api/v1/vizard-video/storage/out-count', { preHandler: [requireAuth] }, async (req) => {
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: req.user.workspaceId },
      include: { plan: true },
    });
    return {
      code: 2000,
      data: {
        usedBytes: Number(ws.storage_bytes),
        retentionDays: ws.plan.retention_days,
      },
    };
  });

  app.get('/api/v1/folder/get-folder-tree', { preHandler: [requireAuth] }, async (req) => {
    const folders = await prisma.folder.findMany({
      where: { workspace_id: req.user.workspaceId },
      orderBy: { name: 'asc' },
    });
    return { code: 2000, data: folders };
  });

  app.get('/api/v1/ai-studio/models', { preHandler: [requireAuth] }, async () => {
    const models = await prisma.aiModel.findMany({
      where: { enabled: true },
      orderBy: { base_credits: 'asc' },
    });
    return { code: 2000, data: models };
  });

  // Global ⌘K search across projects, clips, folders
  app.get('/api/v1/search', { preHandler: [requireAuth] }, async (req) => {
    const q = ((req.query as { q?: string }).q || '').trim();
    if (!q) return { projects: [], folders: [], clips: [] };

    const [projects, folders, clips] = await Promise.all([
      prisma.project.findMany({
        where: {
          workspace_id: req.user.workspaceId,
          deleted_at: null,
          name: { contains: q, mode: 'insensitive' },
        },
        take: 5,
      }),
      prisma.folder.findMany({
        where: {
          workspace_id: req.user.workspaceId,
          name: { contains: q, mode: 'insensitive' },
        },
        take: 5,
      }),
      prisma.clip.findMany({
        where: {
          project: { workspace_id: req.user.workspaceId, deleted_at: null },
          title: { contains: q, mode: 'insensitive' },
        },
        take: 5,
      }),
    ]);

    return { projects, folders, clips };
  });
}
