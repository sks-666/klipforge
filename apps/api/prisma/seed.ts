import { PrismaClient, AiModelKind } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  return crypto.scryptSync(password, 'klipforge_salt', 64).toString('hex');
}

async function main() {
  console.log('🌱 Seeding KlipForge database...');

  // 1. Seed Plans (Config-driven per Section 4.13)
  const freePlan = await prisma.plan.upsert({
    where: { key: 'free' },
    update: {},
    create: {
      key: 'free',
      name: 'Free',
      price_monthly: 0,
      price_yearly: 0,
      credits: 47,
      seat_price: 0,
      social_limit: 1,
      retention_days: 3,
      max_res: '720p',
      features_json: {
        watermark: true,
        maxRes: '720p',
        schedulePosts: false,
        storageGb: 5,
        brandKit: false,
        shareProject: false,
        apiAccess: false,
        inviteTeam: false,
      },
    },
  });

  await prisma.plan.upsert({
    where: { key: 'creator' },
    update: {},
    create: {
      key: 'creator',
      name: 'Creator',
      price_monthly: 29,
      price_yearly: 174, // $14.5/mo billed yearly (50% OFF)
      credits: 7200,
      seat_price: 0,
      social_limit: 6,
      retention_days: 0, // unlimited
      max_res: '4k',
      features_json: {
        watermark: false,
        maxRes: '4k',
        schedulePosts: true,
        storageGb: 100,
        brandKit: false,
        shareProject: true,
        apiAccess: true,
        inviteTeam: false,
      },
    },
  });

  await prisma.plan.upsert({
    where: { key: 'business' },
    update: {},
    create: {
      key: 'business',
      name: 'Business',
      price_monthly: 39,
      price_yearly: 234, // $19.5/mo billed yearly (50% OFF)
      credits: 14400,
      seat_price: 5,
      social_limit: 20,
      retention_days: 0, // unlimited
      max_res: '4k',
      features_json: {
        watermark: false,
        maxRes: '4k',
        schedulePosts: true,
        storageGb: 99999,
        brandKit: true,
        shareProject: true,
        apiAccess: true,
        inviteTeam: true,
      },
    },
  });

  // 2. Seed AI Models Catalog (Data-driven per Section 4.10)
  const models = [
    { kind: AiModelKind.video, provider: 'google', name: 'Gemini Omni Flash', badge: 'New', description: 'Fast multimodal video generation', base_credits: 24 },
    { kind: AiModelKind.video, provider: 'google', name: 'Veo 3', badge: 'Audio', description: 'Cinematic 1080p video with native audio', base_credits: 80 },
    { kind: AiModelKind.video, provider: 'google', name: 'Veo 2', badge: null, description: 'High-fidelity physics & motion', base_credits: 200 },
    { kind: AiModelKind.video, provider: 'seedance', name: 'Seedance 2.5', badge: 'New', description: 'Long-form + synced audio generation', base_credits: 32 },
    { kind: AiModelKind.video, provider: 'seedance', name: 'Seedance 1.0 Pro', badge: null, description: 'Budget rapid motion', base_credits: 6 },
    { kind: AiModelKind.video, provider: 'kling', name: 'Kling 3.0', badge: 'Hot', description: 'Photorealistic character consistency', base_credits: 45 },
    { kind: AiModelKind.image, provider: 'nanobanana', name: 'Nano Banana', badge: null, description: 'Fast concept generation', base_credits: 3 },
    { kind: AiModelKind.image, provider: 'nanobanana', name: 'Nano Banana Pro', badge: 'New', description: 'Studio quality typography & lighting', base_credits: 10 },
    { kind: AiModelKind.image, provider: 'flux', name: 'FLUX.1 Pro', badge: null, description: 'High-detail image synthesis', base_credits: 6 },
    { kind: AiModelKind.motion, provider: 'remotion', name: 'KlipForge Motion Engine v1', badge: 'New', description: 'Programmatic motion graphics (Social, Map, Chat, Infographics)', base_credits: 20 },
  ];

  for (const m of models) {
    await prisma.aiModel.create({
      data: {
        ...m,
        params_schema_json: { ratios: ['16:9', '9:16', '1:1'], durations: [5, 10] },
      },
    });
  }

  // 3. Seed Demo User & Free Workspace with 47 starter credits
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@klipforge.ai' },
    update: {},
    create: {
      email: 'demo@klipforge.ai',
      name: 'Alex Rivera',
      password_hash: hashPassword('password123'),
    },
  });

  const existingWs = await prisma.workspace.findFirst({
    where: { memberships: { some: { user_id: demoUser.id } } },
  });

  if (!existingWs) {
    const ws = await prisma.workspace.create({
      data: {
        name: "Alex's Workspace",
        plan_id: freePlan.id,
        credits_balance: 47,
        memberships: {
          create: {
            user_id: demoUser.id,
            role: 'owner',
            seat_active: true,
          },
        },
        credit_ledger: {
          create: {
            delta: 47,
            balance_after: 47,
            reason: 'Starter Free Plan Allocation',
            ref_type: 'subscription',
            ref_id: 'starter_grant',
          },
        },
      },
    });
    console.log(`✅ Created Demo Workspace: ${ws.name} (${ws.credits_balance} credits)`);
  }

  console.log('✅ Seeding complete. Login: demo@klipforge.ai / password123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
