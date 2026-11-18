import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { Role } from '@prisma/client';
import { hasMinimumRole } from '../lib/permissions';

export interface AuthContext {
  userId: string;
  email: string;
  workspaceId: string;
  role: Role;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: AuthContext;
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    // Enforce header override if user switches workspace in UI
    const headerWsId = req.headers['x-workspace-id'] as string | undefined;
    if (headerWsId && headerWsId !== req.user.workspaceId) {
      const membership = await prisma.membership.findUnique({
        where: {
          workspace_id_user_id: {
            workspace_id: headerWsId,
            user_id: req.user.userId,
          },
        },
      });
      if (!membership || !membership.seat_active) {
        return reply.status(403).send({ code: 4001, errMsg: 'Forbidden workspace access' });
      }
      req.user.workspaceId = headerWsId;
      req.user.role = membership.role;
    }
  } catch {
    return reply.status(401).send({ code: 4001, errMsg: 'Unauthorized' });
  }
}

export function requireRole(minRole: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    if (!hasMinimumRole(req.user.role, minRole)) {
      return reply.status(403).send({
        code: 4001,
        errMsg: `Requires at least ${minRole} role in this workspace`,
      });
    }
  };
}
