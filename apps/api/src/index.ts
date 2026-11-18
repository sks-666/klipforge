import './env';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import crypto from 'crypto';
import { authRoutes } from './routes/auth.routes';
import { workspaceRoutes } from './routes/workspace.routes';
import { popupRoutes } from './routes/popup.routes';
import { billingRoutes } from './routes/billing.routes';
import { vizardCompatRoutes } from './routes/vizard-compat.routes';
import { projectRoutes } from './routes/project.routes';
import { publishRoutes } from './routes/publish.routes';
import { aiStudioRoutes } from './routes/ai-studio.routes';
import { openApiRoutes } from './routes/open-api.routes';
import { editorRoutes } from './routes/editor.routes';
import { plannerRoutes } from './routes/planner.routes';
import { startPlannerWorker } from './services/social/scheduler.worker';
import { repairMissingProjectSourceVideos } from './services/clipping.pipeline';

export function buildServer() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.register(cors, {
    origin: process.env.WEB_ORIGIN || 'http://localhost:5173',
    credentials: true,
  });

  app.register(jwt, {
    secret: process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production',
  });

  // Phase 8 Hardening: OWASP ASVS L2 security headers & request correlation IDs
  app.addHook('onSend', async (req, reply) => {
    const reqId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    reply.header('X-Request-Id', reqId);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'klipforge-api',
    version: '1.0.0',
  }));

  app.register(authRoutes);
  app.register(workspaceRoutes);
  app.register(popupRoutes);
  app.register(billingRoutes);
  app.register(vizardCompatRoutes);
  app.register(projectRoutes);
  app.register(publishRoutes);
  app.register(aiStudioRoutes);
  app.register(openApiRoutes);
  app.register(editorRoutes);
  app.register(plannerRoutes);

  return app;
}

if (require.main === module) {
  const app = buildServer();
  const port = Number(process.env.PORT || 4000);
  app
    .listen({ port, host: '0.0.0.0' })
    .then(() => {
      startPlannerWorker();
      repairMissingProjectSourceVideos().catch((e) =>
        console.warn('Background source video repair notice:', e)
      );
    })
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
}
