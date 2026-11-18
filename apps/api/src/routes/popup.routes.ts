import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const ALL_COACH_MARKS = [
  {
    key: 'folders_intro',
    title: 'Organize your projects with Folders',
    description: 'Create folders and drag project cards into them to keep client work tidy.',
    route: '/workspace:projects',
  },
  {
    key: 'idea_to_video_start',
    title: 'Choose how to start',
    description: 'Toggle between a short idea prompt or paste your full script to generate a scene-by-scene video.',
    route: '/idea-to-video/create',
  },
];

export async function popupRoutes(app: FastifyInstance) {
  // [OBSERVED endpoint: pop-up/list]
  app.get('/api/v1/pop-up/list', { preHandler: [requireAuth] }, async (req) => {
    const seen = await prisma.popupSeen.findMany({
      where: { user_id: req.user.userId },
    });
    const seenSet = new Set(seen.map((s) => s.popup_key));

    return {
      code: 2000,
      data: ALL_COACH_MARKS.map((cm) => ({
        ...cm,
        seen: seenSet.has(cm.key),
      })),
    };
  });

  // [OBSERVED endpoint: pop-up/record-popup-timing]
  app.post('/api/v1/pop-up/record-popup-timing', { preHandler: [requireAuth] }, async (req) => {
    const body = z.object({ popupKey: z.string() }).parse(req.body);

    await prisma.popupSeen.upsert({
      where: {
        user_id_popup_key: {
          user_id: req.user.userId,
          popup_key: body.popupKey,
        },
      },
      update: { seen_at: new Date() },
      create: {
        user_id: req.user.userId,
        popup_key: body.popupKey,
      },
    });

    return { code: 2000, ok: true };
  });
}
