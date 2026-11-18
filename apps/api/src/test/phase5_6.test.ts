import { describe, it, expect } from 'vitest';
import { submitAiGenerationJob } from '../services/ai-studio.service';
import { prisma } from '../lib/prisma';

describe('Phase 5 & 6: AI Studio & Multi-Track Timeline Backing', () => {
  it('verifies AI Studio generation workflow and credit debiting', async () => {
    const ws = await prisma.workspace.findFirst();
    const user = await prisma.user.findFirst();
    const model = await prisma.aiModel.findFirst();

    if (!ws || !user || !model) {
      // Skip if seed wasn't run
      return;
    }

    const initialCredits = ws.credits_balance;
    const gen = await submitAiGenerationJob({
      workspaceId: ws.id,
      userId: user.id,
      kind: 'video',
      modelId: model.id,
      prompt: 'Cinematic drone shot of snowy mountains',
      params: { ratio: '16:9' },
    });

    expect(gen.id).toBeDefined();
    expect(gen.status).toBe('processing');

    const updatedWs = await prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    expect(updatedWs.credits_balance).toBe(initialCredits - model.base_credits);
  });
});
