import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { isUnlimitedCreditsWorkspace } from '../lib/credits';
import { requireAuth } from '../middleware/auth';

// ---------------------------------------------------------------------------
// Password hashing
// New hashes: `scrypt$<salt hex>$<hash hex>` with a random per-user salt.
// Legacy hashes (static salt, bare hex) still verify and are upgraded on login.
// ---------------------------------------------------------------------------
const LEGACY_SALT = 'klipforge_salt';
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && ab.length > 0 && crypto.timingSafeEqual(ab, bb);
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  if (stored.startsWith('scrypt$')) {
    const [, salt, hash] = stored.split('$');
    if (!salt || !hash) return false;
    return safeEqualHex(crypto.scryptSync(password, salt, KEY_LEN).toString('hex'), hash);
  }
  return safeEqualHex(crypto.scryptSync(password, LEGACY_SALT, KEY_LEN).toString('hex'), stored);
}

const isLegacyHash = (stored: string) => !stored.startsWith('scrypt$');

// ---------------------------------------------------------------------------
// Rate limiting for credential endpoints (in-memory, per IP + email)
// ---------------------------------------------------------------------------
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function tooManyAttempts(key: string): number | null {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) return null;
  return entry.count >= MAX_ATTEMPTS ? Math.ceil((entry.resetAt - now) / 1000) : null;
}

function recordFailure(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function resetAuthRateLimits() {
  attempts.clear();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const emailSchema = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

const newPasswordSchema = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain a letter and a number');

const nameSchema = z
  .string({ required_error: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .max(80, 'Name must be at most 80 characters');

function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  req: FastifyRequest,
  reply: FastifyReply
): z.infer<T> | null {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    reply.status(400).send({
      code: 4002,
      errMsg: issue?.message || 'Invalid request',
      field: issue?.path?.[0],
    });
    return null;
  }
  return result.data;
}

const TOKEN_TTL = process.env.JWT_EXPIRES_IN || '7d';

const publicUser = (u: any) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  avatar_url: u.avatar_url ?? null,
});

async function findUserByEmail(email: string, include?: any) {
  const direct = await prisma.user.findUnique({ where: { email }, include });
  if (direct) return direct;
  // Accounts created before emails were normalised may contain capitals.
  const all = await prisma.user.findMany({});
  const match = all.find((u: any) => String(u.email).toLowerCase() === email);
  return match ? prisma.user.findUnique({ where: { id: match.id }, include }) : null;
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/v1/auth/register', async (req, reply) => {
    const body = parseBody(
      z.object({ name: nameSchema, email: emailSchema, password: newPasswordSchema }),
      req,
      reply
    );
    if (!body) return;

    const limitKey = `register:${req.ip}`;
    const retryAfter = tooManyAttempts(limitKey);
    if (retryAfter) {
      reply.header('Retry-After', String(retryAfter));
      return reply.status(429).send({ code: 4029, errMsg: 'Too many attempts. Try again later.' });
    }

    if (await findUserByEmail(body.email)) {
      recordFailure(limitKey);
      return reply
        .status(409)
        .send({ code: 4009, errMsg: 'An account with this email already exists', field: 'email' });
    }

    const freePlan = await prisma.plan.findUniqueOrThrow({ where: { key: 'free' } });

    const result = await prisma.$transaction(async (tx: any) => {
      const user = await tx.user.create({
        data: {
          email: body.email,
          name: body.name,
          password_hash: hashPassword(body.password),
          avatar_url: null,
          locale: 'en',
          tz: 'UTC',
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: `${body.name}'s Workspace`,
          plan_id: freePlan.id,
          credits_balance: freePlan.credits,
          storage_bytes: BigInt(0),
          logo_url: null,
          memberships: {
            create: {
              user_id: user.id,
              role: 'owner',
              seat_active: true,
            },
          },
          credit_ledger: {
            create: {
              delta: freePlan.credits,
              balance_after: freePlan.credits,
              reason: 'Starter Free Plan Allocation',
              ref_type: 'subscription',
              ref_id: 'starter_grant',
            },
          },
        },
      });

      return { user, workspace };
    });

    const token = app.jwt.sign(
      {
        userId: result.user.id,
        email: result.user.email,
        workspaceId: result.workspace.id,
        role: 'owner',
      },
      { expiresIn: TOKEN_TTL }
    );

    return reply
      .status(201)
      .send({ token, user: publicUser(result.user), workspaceId: result.workspace.id });
  });

  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = parseBody(
      z.object({
        email: emailSchema,
        password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
      }),
      req,
      reply
    );
    if (!body) return;

    const limitKey = `login:${req.ip}:${body.email}`;
    const retryAfter = tooManyAttempts(limitKey);
    if (retryAfter) {
      reply.header('Retry-After', String(retryAfter));
      return reply.status(429).send({
        code: 4029,
        errMsg: `Too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} min.`,
      });
    }

    const user = await findUserByEmail(body.email, {
      memberships: {
        where: { seat_active: true },
        include: { workspace: { include: { plan: true } } },
      },
    });

    if (!user || !verifyPassword(body.password, user.password_hash)) {
      recordFailure(limitKey);
      return reply.status(401).send({ code: 4001, errMsg: 'Invalid email or password' });
    }
    attempts.delete(limitKey);

    if (isLegacyHash(user.password_hash)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { password_hash: hashPassword(body.password) },
      });
    }

    const primaryMembership = user.memberships?.[0];
    if (!primaryMembership) {
      return reply.status(403).send({
        code: 4003,
        errMsg: 'This account has no active workspace. Ask an owner to re-invite you.',
      });
    }

    const token = app.jwt.sign(
      {
        userId: user.id,
        email: user.email,
        workspaceId: primaryMembership.workspace_id,
        role: primaryMembership.role,
      },
      { expiresIn: TOKEN_TTL }
    );

    return { token, user: publicUser(user), workspaceId: primaryMembership.workspace_id };
  });

  // JWTs are stateless; the client discards its token. Kept for API symmetry.
  app.post('/api/v1/auth/logout', async () => ({ ok: true }));

  app.get('/api/v1/auth/me', { preHandler: [requireAuth] }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) {
      return reply.status(401).send({ code: 4001, errMsg: 'Account no longer exists' });
    }

    const memberships = await prisma.membership.findMany({
      where: { user_id: req.user.userId, seat_active: true },
      include: {
        workspace: {
          include: {
            plan: true,
            _count: { select: { memberships: true } },
          },
        },
      },
    });

    if (memberships.length === 0) {
      return reply.status(403).send({ code: 4003, errMsg: 'No active workspace for this account' });
    }

    const activeMembership =
      memberships.find((m: any) => m.workspace_id === req.user.workspaceId) || memberships[0];
    const activeWorkspace = activeMembership.workspace;

    return {
      user: {
        ...publicUser(user),
        locale: user.locale ?? 'en',
        tz: user.tz ?? 'UTC',
      },
      activeWorkspace: {
        ...activeWorkspace,
        unlimited_credits: isUnlimitedCreditsWorkspace(activeWorkspace.id),
        storage_bytes: Number(activeWorkspace.storage_bytes ?? 0),
        memberCount: activeWorkspace._count.memberships,
        role: activeMembership.role,
      },
      workspaces: memberships.map((m: any) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        logo_url: m.workspace.logo_url,
        role: m.role,
        planName: m.workspace.plan.name,
        planKey: m.workspace.plan.key,
        credits_balance: m.workspace.credits_balance,
        unlimited_credits: isUnlimitedCreditsWorkspace(m.workspace.id),
        memberCount: m.workspace._count.memberships,
      })),
    };
  });

  app.patch('/api/v1/auth/profile', { preHandler: [requireAuth] }, async (req, reply) => {
    const body = parseBody(z.object({ name: nameSchema }), req, reply);
    if (!body) return;
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: { name: body.name },
    });
    return { user: publicUser(user) };
  });

  app.post('/api/v1/auth/change-password', { preHandler: [requireAuth] }, async (req, reply) => {
    const body = parseBody(
      z.object({
        currentPassword: z
          .string({ required_error: 'Current password is required' })
          .min(1, 'Current password is required'),
        newPassword: newPasswordSchema,
      }),
      req,
      reply
    );
    if (!body) return;

    const limitKey = `change-password:${req.user.userId}`;
    if (tooManyAttempts(limitKey)) {
      return reply.status(429).send({ code: 4029, errMsg: 'Too many attempts. Try again later.' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user || !verifyPassword(body.currentPassword, user.password_hash)) {
      recordFailure(limitKey);
      return reply
        .status(400)
        .send({ code: 4002, errMsg: 'Current password is incorrect', field: 'currentPassword' });
    }
    if (body.currentPassword === body.newPassword) {
      return reply
        .status(400)
        .send({ code: 4002, errMsg: 'New password must be different', field: 'newPassword' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { password_hash: hashPassword(body.newPassword) },
    });
    attempts.delete(limitKey);
    return { ok: true };
  });
}
