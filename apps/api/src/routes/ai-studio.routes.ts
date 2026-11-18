import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { submitAiGenerationJob } from '../services/ai-studio.service';

export async function aiStudioRoutes(app: FastifyInstance) {
  // Submit AI Generation Job (Video, Image, Motion Graphics)
  app.post('/api/v1/ai-studio/generate', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const schema = z.object({
      kind: z.enum(['video', 'image', 'motion']),
      modelId: z.string(),
      prompt: z.string().min(1),
      params: z.record(z.any()).default({}),
      refs: z.record(z.any()).optional(),
    });
    const body = schema.parse(req.body);

    try {
      const gen = await submitAiGenerationJob({
        workspaceId: req.user.workspaceId,
        userId: req.user.userId,
        ...body,
      });
      return { code: 2000, generation: gen };
    } catch (e: any) {
      return reply.status(400).send({ code: 4007, errMsg: e.message });
    }
  });

  // List User Generations (Assets Tab)
  app.get('/api/v1/ai-studio/generations', { preHandler: [requireAuth] }, async (req) => {
    const generations = await prisma.generation.findMany({
      where: { workspace_id: req.user.workspaceId },
      include: { model: true },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    return { code: 2000, generations };
  });

  // Idea-to-Video Creator (Section 4.11)
  app.post('/api/v1/idea-to-video/create', { preHandler: [requireRole('editor')] }, async (req) => {
    const body = z
      .object({
        ideaPrompt: z.string().min(1),
        mode: z.enum(['prompt', 'script']).default('prompt'),
      })
      .parse(req.body);

    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: req.user.workspaceId },
    });

    const project = await prisma.project.create({
      data: {
        workspace_id: ws.id,
        name: `AI Idea: ${body.ideaPrompt.slice(0, 32)}...`,
        source_type: 1,
        source_url: 'https://storage.klipforge.ai/idea-to-video/generated-scene.mp4',
        status: 'done',
        created_by: req.user.userId,
      },
    });

    return { code: 2000, projectId: project.id };
  });
}
