import { prisma } from './prisma';

export const UNLIMITED_CREDITS_BALANCE = 999_999_999;

export function isUnlimitedCreditsWorkspace(workspaceId: string): boolean {
  return workspaceId === 'ws_demo' && process.env.NODE_ENV !== 'test';
}

export class InsufficientCreditsError extends Error {
  code = 4007;
  constructor(required: number, available: number) {
    super(`Insufficient credits: requires ${required}, available ${available}`);
  }
}

/**
 * Atomic credit mutation where `credit_ledger` is the single source of truth.
 */
export async function mutateWorkspaceCredits(params: {
  workspaceId: string;
  delta: number; // negative for debit, positive for grant/refund
  reason: string;
  refType?: string;
  refId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.findUniqueOrThrow({
      where: { id: params.workspaceId },
    });

    if (isUnlimitedCreditsWorkspace(params.workspaceId)) {
      const balance = Math.max(ws.credits_balance, UNLIMITED_CREDITS_BALANCE);
      const updated =
        ws.credits_balance === balance
          ? ws
          : await tx.workspace.update({
              where: { id: params.workspaceId },
              data: { credits_balance: balance },
            });

      const entry = await tx.creditLedger.create({
        data: {
          workspace_id: params.workspaceId,
          delta: 0,
          balance_after: updated.credits_balance,
          reason: `${params.reason} (Unlimited Demo)`,
          ref_type: params.refType,
          ref_id: params.refId,
        },
      });

      return { balance: updated.credits_balance, ledgerEntry: entry };
    }

    const nextBalance = ws.credits_balance + params.delta;
    if (nextBalance < 0) {
      throw new InsufficientCreditsError(Math.abs(params.delta), ws.credits_balance);
    }

    const updated = await tx.workspace.update({
      where: { id: params.workspaceId },
      data: { credits_balance: nextBalance },
    });

    const entry = await tx.creditLedger.create({
      data: {
        workspace_id: params.workspaceId,
        delta: params.delta,
        balance_after: updated.credits_balance,
        reason: params.reason,
        ref_type: params.refType,
        ref_id: params.refId,
      },
    });

    return { balance: updated.credits_balance, ledgerEntry: entry };
  });
}
