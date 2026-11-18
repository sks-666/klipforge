import { prisma } from '../lib/prisma';
import { mutateWorkspaceCredits } from '../lib/credits';

export interface SubmitGenerationInput {
  workspaceId: string;
  userId: string;
  kind: 'video' | 'image' | 'motion';
  modelId: string;
  prompt: string;
  params: Record<string, any>;
  refs?: Record<string, any>;
}

export async function submitAiGenerationJob(input: SubmitGenerationInput) {
  const model = await prisma.aiModel.findUniqueOrThrow({
    where: { id: input.modelId },
  });

  const creditCost = model.base_credits;

  // 1. Hold / Debit credits upfront
  await mutateWorkspaceCredits({
    workspaceId: input.workspaceId,
    delta: -creditCost,
    reason: `AI Studio generation (${model.name})`,
    refType: 'generation',
    refId: input.modelId,
  });

  const generation = await prisma.generation.create({
    data: {
      workspace_id: input.workspaceId,
      user_id: input.userId,
      kind: input.kind,
      model_id: model.id,
      prompt: input.prompt,
      params_json: input.params,
      refs_json: input.refs || {},
      status: 'processing',
      progress: 40,
      credits_cost: creditCost,
    },
  });

  // Simulate async generation worker completion
  setTimeout(async () => {
    try {
      const resultAsset = await prisma.asset.create({
        data: {
          workspace_id: input.workspaceId,
          kind: input.kind === 'image' ? 'image' : 'final',
          storage_key: `workspaces/${input.workspaceId}/ai-studio/${generation.id}.${
            input.kind === 'image' ? 'png' : 'mp4'
          }`,
          mime: input.kind === 'image' ? 'image/png' : 'video/mp4',
          bytes: BigInt(3 * 1024 * 1024),
          duration_ms: input.kind === 'video' ? 10000 : null,
          width: 1080,
          height: 1920,
        },
      });

      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          status: 'completed',
          progress: 100,
          result_asset_id: resultAsset.id,
        },
      });
    } catch {
      // Auto-refund credits if generation fails
      await mutateWorkspaceCredits({
        workspaceId: input.workspaceId,
        delta: creditCost,
        reason: `Refund: failed AI generation ${generation.id}`,
        refType: 'generation',
        refId: generation.id,
      }).catch(() => {});

      await prisma.generation.update({
        where: { id: generation.id },
        data: { status: 'failed', error: 'Provider generation timeout' },
      });
    }
  }, 1200);

  return generation;
}
