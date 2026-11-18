import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { can } from '../lib/permissions';

export async function workspaceRoutes(app: FastifyInstance) {
  // Update workspace settings (name, logo)
  app.patch('/api/v1/workspace', { preHandler: [requireRole('admin')] }, async (req) => {
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        logo_url: z.string().url().nullable().optional(),
      })
      .parse(req.body);

    const updated = await prisma.workspace.update({
      where: { id: req.user.workspaceId },
      data: body,
    });
    return { ...updated, storage_bytes: Number(updated.storage_bytes) };
  });

  // List members + pending invitations
  app.get('/api/v1/workspace/members', { preHandler: [requireAuth] }, async (req) => {
    const members = await prisma.membership.findMany({
      where: { workspace_id: req.user.workspaceId },
      include: {
        user: { select: { id: true, name: true, email: true, avatar_url: true } },
      },
    });
    const invitations = await prisma.invitation.findMany({
      where: { workspace_id: req.user.workspaceId, accepted_at: null },
    });
    return { members, invitations };
  });

  // Invite member (enforces Business plan inviteTeam feature or owner override)
  app.post('/api/v1/workspace/invite', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        role: z.enum(['admin', 'editor', 'viewer']),
      })
      .parse(req.body);

    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: req.user.workspaceId },
      include: { plan: true },
    });

    if (!can(ws.plan.features_json, 'inviteTeam')) {
      return reply.status(403).send({
        code: 4004,
        errMsg: 'Upgrade to Business plan to invite team members (+$5/mo/seat).',
      });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const invite = await prisma.invitation.create({
      data: {
        workspace_id: ws.id,
        email: body.email,
        role: body.role,
        token,
        expires_at: new Date(Date.now() + 7 * 86400 * 1000),
      },
    });

    return { invite, inviteUrl: `${process.env.WEB_ORIGIN}/accept-invite?token=${token}` };
  });

  // Credit history ledger + CSV export support
  app.get('/api/v1/workspace/credit-history', { preHandler: [requireAuth] }, async (req) => {
    const ledger = await prisma.creditLedger.findMany({
      where: { workspace_id: req.user.workspaceId },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    return { items: ledger };
  });

  // Generate API key (gated behind paid plans with apiAccess)
  app.get('/api/v1/workspace/api-keys', { preHandler: [requireAuth] }, async (req) => {
    const keys = await prisma.apiKey.findMany({
      where: { workspace_id: req.user.workspaceId, revoked_at: null },
      select: { id: true, prefix: true, last_used_at: true, created_at: true },
    });
    return { keys };
  });

  app.post('/api/v1/workspace/api-keys', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: req.user.workspaceId },
      include: { plan: true },
    });

    if (!can(ws.plan.features_json, 'apiAccess')) {
      return reply.status(403).send({
        code: 4004,
        errMsg: 'Public API access requires Creator or Business plan.',
      });
    }

    const rawKey = `kf_live_${crypto.randomBytes(24).toString('hex')}`;
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const prefix = rawKey.slice(0, 14) + '...';

    const record = await prisma.apiKey.create({
      data: {
        workspace_id: ws.id,
        hash,
        prefix,
        created_by: req.user.userId,
      },
    });

    // Show full key ONLY once
    return { id: record.id, apiKey: rawKey, prefix: record.prefix, created_at: record.created_at };
  });

  app.delete('/api/v1/workspace/api-keys/:id', { preHandler: [requireRole('admin')] }, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.apiKey.updateMany({
      where: { id, workspace_id: req.user.workspaceId },
      data: { revoked_at: new Date() },
    });
    return { ok: true };
  });
}
