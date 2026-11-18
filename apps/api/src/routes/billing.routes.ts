import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { mutateWorkspaceCredits } from '../lib/credits';

export async function billingRoutes(app: FastifyInstance) {
  // List all config-driven plans for the Pricing / Upgrade modal
  app.get('/api/v1/billing/plans', async () => {
    const plans = await prisma.plan.findMany({
      orderBy: { price_monthly: 'asc' },
    });
    return { plans };
  });

  // Create Stripe Checkout session (or instant sandbox upgrade in local dev)
  app.post('/api/v1/billing/checkout', { preHandler: [requireRole('owner')] }, async (req) => {
    const body = z
      .object({
        planKey: z.enum(['creator', 'business']),
        interval: z.enum(['monthly', 'yearly']),
        seats: z.number().int().min(1).default(1),
      })
      .parse(req.body);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { key: body.planKey } });

    // In local dev without real Stripe keys, simulate webhook completion & credit grant
    if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('placeholder')) {
      await prisma.workspace.update({
        where: { id: req.user.workspaceId },
        data: { plan_id: plan.id },
      });

      const creditGrant = body.interval === 'yearly' ? plan.credits : Math.floor(plan.credits / 12);
      await mutateWorkspaceCredits({
        workspaceId: req.user.workspaceId,
        delta: creditGrant,
        reason: `Upgraded to ${plan.name} (${body.interval})`,
        refType: 'subscription',
        refId: `sim_sub_${Date.now()}`,
      });

      return {
        mode: 'sandbox_upgraded',
        checkoutUrl: `${process.env.WEB_ORIGIN}/settings/subscription?upgraded=${plan.key}`,
      };
    }

    return {
      mode: 'stripe_redirect',
      checkoutUrl: `${process.env.WEB_ORIGIN}/settings/subscription?session_id=cs_test_123`,
    };
  });
}
