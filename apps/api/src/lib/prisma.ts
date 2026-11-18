import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DB_FILE_PATH = path.resolve(__dirname, '../../prisma/local-db.json');

function cuid(prefix = 'c'): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function hashPassword(password: string): string {
  return crypto.scryptSync(password, 'klipforge_salt', 64).toString('hex');
}

interface Store {
  users: any[];
  plans: any[];
  workspaces: any[];
  memberships: any[];
  invitations: any[];
  folders: any[];
  projects: any[];
  assets: any[];
  transcripts: any[];
  clips: any[];
  finalVideos: any[];
  templates: any[];
  brandAssets: any[];
  socialAccounts: any[];
  publishJobs: any[];
  postMetrics: any[];
  shareLinks: any[];
  shares: any[];
  aiModels: any[];
  generations: any[];
  creditLedger: any[];
  apiKeys: any[];
  webhooks: any[];
  popupsSeen: any[];
}

function createSeededStore(): Store {
  const now = new Date();
  const threeDaysLater = new Date(Date.now() + 3 * 86400 * 1000);

  const freePlan = {
    id: 'plan_free',
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
  };

  const creatorPlan = {
    id: 'plan_creator',
    key: 'creator',
    name: 'Creator',
    price_monthly: 29,
    price_yearly: 174,
    credits: 7200,
    seat_price: 0,
    social_limit: 6,
    retention_days: 0,
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
  };

  const businessPlan = {
    id: 'plan_business',
    key: 'business',
    name: 'Business',
    price_monthly: 39,
    price_yearly: 234,
    credits: 14400,
    seat_price: 5,
    social_limit: 20,
    retention_days: 0,
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
  };

  const demoUser = {
    id: 'usr_demo',
    email: 'demo@klipforge.ai',
    password_hash: hashPassword('password123'),
    name: 'Alex Rivera',
    avatar_url: null,
    locale: 'en',
    tz: 'UTC',
    created_at: now,
  };

  const demoWorkspace = {
    id: 'ws_demo',
    name: "Alex's Workspace",
    logo_url: null,
    plan_id: freePlan.id,
    stripe_customer_id: null,
    credits_balance: 999999999,
    storage_bytes: BigInt(142 * 1024 * 1024),
    created_at: now,
  };

  const demoMembership = {
    workspace_id: demoWorkspace.id,
    user_id: demoUser.id,
    role: 'owner',
    seat_active: true,
  };

  const demoProject = {
    id: 'proj_demo_1',
    workspace_id: demoWorkspace.id,
    folder_id: null,
    name: 'Founder Podcast Ep. 14 — Scaling AI Video Workflows',
    source_type: 2,
    source_url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    source_asset_id: 'asset_src_1',
    lang: 'en',
    status: 'done',
    error_code: null,
    options_json: { ratioOfClip: 1, maxClipNumber: 8, clipModel: 'clip_v1' },
    expires_at: threeDaysLater,
    deleted_at: null,
    created_by: demoUser.id,
    created_at: now,
    updated_at: now,
  };

  const userActiveProject = {
    id: 'proj_22d0b5752f181b65',
    workspace_id: demoWorkspace.id,
    folder_id: null,
    name: 'YouTube Video Clipping Project',
    source_type: 2,
    source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    source_asset_id: 'asset_src_2',
    lang: 'en',
    status: 'done',
    error_code: null,
    options_json: { ratioOfClip: 1, maxClipNumber: 8, clipModel: 'clip_v1' },
    expires_at: threeDaysLater,
    deleted_at: null,
    created_by: demoUser.id,
    created_at: now,
    updated_at: now,
  };

  const sampleClips = [
    {
      id: 'clip_demo_1',
      project_id: demoProject.id,
      version: 1,
      kind: 'ai',
      title: 'Why 90% of Creators Quit Right Before the Algorithm Clicks',
      start_ms: 0,
      end_ms: 8000,
      viral_score: 9.6,
      viral_reason: 'Strong contrarian opening hook within first 2.5s + high emotional cadence and complete standalone takeaway.',
      topics_json: ['growth', 'algorithm', 'retention'],
      transcript_text: 'Ninety percent of creators quit right before the algorithm figures out their audience. When you repurpose one long podcast into ten high-retention vertical clips, your surface area for discovery compounds every single week.',
      ratio: '9:16',
      template_id: null,
      edit_doc_json: {},
      stale: false,
      starred: true,
      disliked: false,
      label_ready: true,
      created_at: now,
    },
    {
      id: 'clip_demo_2',
      project_id: demoProject.id,
      version: 1,
      kind: 'ai',
      title: 'The 3-Second Hook Formula Used by Top 1% Channels',
      start_ms: 8000,
      end_ms: 16000,
      viral_score: 9.2,
      viral_reason: 'Specific numbered framework in opening sentence with zero filler words and clear payoff.',
      topics_json: ['hooks', 'storytelling', 'shorts'],
      transcript_text: 'Never start a short clip with introductions or weather talk. Start in the middle of the tension: state the counter-intuitive result first, show visual proof in frame two, and compress the explanation into thirty seconds.',
      ratio: '9:16',
      template_id: null,
      edit_doc_json: {},
      stale: false,
      starred: false,
      disliked: false,
      label_ready: true,
      created_at: now,
    },
    {
      id: 'clip_demo_3',
      project_id: demoProject.id,
      version: 1,
      kind: 'ai',
      title: 'How Automated Speaker Reframing Saves 6 Hours Per Episode',
      start_ms: 16000,
      end_ms: 24000,
      viral_score: 8.7,
      viral_reason: 'Quantified productivity gain with relatable pain point for video editors and agencies.',
      topics_json: ['automation', 'editing', 'workflow'],
      transcript_text: 'Keyframing a two-person interview from 16:9 into 9:16 used to take an editor six hours. With face-tracking speaker focus and dynamic word-level captions, the entire batch finishes while you grab coffee.',
      ratio: '9:16',
      template_id: null,
      edit_doc_json: {},
      stale: false,
      starred: false,
      disliked: false,
      label_ready: false,
      created_at: now,
    },
    {
      id: 'clip_u1',
      project_id: userActiveProject.id,
      version: 1,
      kind: 'ai',
      title: 'Opening Hook — High Retention Segment #1',
      start_ms: 0,
      end_ms: 8000,
      viral_score: 9.5,
      viral_reason: 'Extracted at 0s–8s (8s) with FFmpeg H.264/AAC vertical reframing.',
      topics_json: ['hook', 'highlight', 'shorts'],
      transcript_text: 'Segment 1 extracted from 0s to 8s: high-impact opening hook reframed to 9:16 vertical format.',
      ratio: '9:16',
      template_id: null,
      edit_doc_json: {},
      stale: false,
      starred: true,
      disliked: false,
      label_ready: true,
      created_at: now,
    },
    {
      id: 'clip_u2',
      project_id: userActiveProject.id,
      version: 1,
      kind: 'ai',
      title: 'Core Takeaway — Viral Breakdown #2',
      start_ms: 8000,
      end_ms: 16000,
      viral_score: 9.1,
      viral_reason: 'Extracted at 8s–16s (8s) with FFmpeg H.264/AAC vertical reframing.',
      topics_json: ['takeaway', 'breakdown', 'reels'],
      transcript_text: 'Segment 2 extracted from 8s to 16s: standalone takeaway clip with clean audio transitions.',
      ratio: '9:16',
      template_id: null,
      edit_doc_json: {},
      stale: false,
      starred: false,
      disliked: false,
      label_ready: true,
      created_at: now,
    },
    {
      id: 'clip_u3',
      project_id: userActiveProject.id,
      version: 1,
      kind: 'ai',
      title: 'Actionable Framework — Closing Insight #3',
      start_ms: 16000,
      end_ms: 24000,
      viral_score: 8.8,
      viral_reason: 'Extracted at 16s–24s (8s) with FFmpeg H.264/AAC vertical reframing.',
      topics_json: ['framework', 'closing', 'tiktok'],
      transcript_text: 'Segment 3 extracted from 16s to 24s: closing summary segment ready for social publishing.',
      ratio: '9:16',
      template_id: null,
      edit_doc_json: {},
      stale: false,
      starred: false,
      disliked: false,
      label_ready: false,
      created_at: now,
    },
  ];

  const assets = sampleClips.map((c) => ({
    id: `asset_${c.id}`,
    workspace_id: demoWorkspace.id,
    kind: 'final',
    storage_key: `/media/clips/${c.id}.mp4`,
    mime: 'video/mp4',
    bytes: BigInt(512 * 1024),
    duration_ms: c.end_ms - c.start_ms,
    width: 720,
    height: 1280,
    sha256: null,
    created_at: now,
  }));

  const finalVideos = sampleClips.map((c) => ({
    id: `fv_${c.id}`,
    clip_id: c.id,
    asset_id: `asset_${c.id}`,
    res: '720p',
    status: 'done',
    render_job_id: null,
    expires_at: threeDaysLater,
    watermark: true,
    created_at: now,
  }));

  const aiModels = [
    { id: 'mdl_omni', kind: 'video', provider: 'google', name: 'Gemini Omni Flash', badge: 'New', description: 'Fast multimodal video generation', base_credits: 24, enabled: true, params_schema_json: { ratios: ['16:9', '9:16', '1:1'], durations: [5, 10] } },
    { id: 'mdl_veo3', kind: 'video', provider: 'google', name: 'Veo 3', badge: 'Audio', description: 'Cinematic 1080p video with native audio', base_credits: 80, enabled: true, params_schema_json: { ratios: ['16:9', '9:16'], durations: [5, 8] } },
    { id: 'mdl_veo2', kind: 'video', provider: 'google', name: 'Veo 2', badge: null, description: 'High-fidelity physics & motion', base_credits: 200, enabled: true, params_schema_json: { ratios: ['16:9', '9:16'], durations: [5, 10] } },
    { id: 'mdl_seed25', kind: 'video', provider: 'seedance', name: 'Seedance 2.5', badge: 'New', description: 'Long-form + synced audio generation', base_credits: 32, enabled: true, params_schema_json: { ratios: ['16:9', '9:16'], durations: [5, 10] } },
    { id: 'mdl_seed10', kind: 'video', provider: 'seedance', name: 'Seedance 1.0 Pro', badge: null, description: 'Budget rapid motion', base_credits: 6, enabled: true, params_schema_json: { ratios: ['16:9', '9:16'], durations: [5] } },
    { id: 'mdl_kling3', kind: 'video', provider: 'kling', name: 'Kling 3.0', badge: 'Hot', description: 'Photorealistic character consistency', base_credits: 45, enabled: true, params_schema_json: { ratios: ['16:9', '9:16'], durations: [5, 10] } },
    { id: 'mdl_nb1', kind: 'image', provider: 'nanobanana', name: 'Nano Banana', badge: null, description: 'Fast concept generation', base_credits: 3, enabled: true, params_schema_json: { ratios: ['1:1', '16:9', '9:16'] } },
    { id: 'mdl_nbpro', kind: 'image', provider: 'nanobanana', name: 'Nano Banana Pro', badge: 'New', description: 'Studio quality typography & lighting', base_credits: 10, enabled: true, params_schema_json: { ratios: ['1:1', '16:9', '9:16'] } },
    { id: 'mdl_flux1', kind: 'image', provider: 'flux', name: 'FLUX.1 Pro', badge: null, description: 'High-detail image synthesis', base_credits: 6, enabled: true, params_schema_json: { ratios: ['1:1', '16:9', '9:16'] } },
    { id: 'mdl_motion1', kind: 'motion', provider: 'remotion', name: 'KlipForge Motion Engine v1', badge: 'New', description: 'Programmatic motion graphics (Social, Map, Chat, Infographics)', base_credits: 20, enabled: true, params_schema_json: { ratios: ['16:9', '9:16', '1:1'] } },
  ];

  return {
    users: [demoUser],
    plans: [freePlan, creatorPlan, businessPlan],
    workspaces: [demoWorkspace],
    memberships: [demoMembership],
    invitations: [],
    folders: [{ id: 'fld_1', workspace_id: demoWorkspace.id, parent_id: null, name: 'Podcast Episodes', created_at: now }],
    projects: [demoProject, userActiveProject],
    assets,
    transcripts: [],
    clips: sampleClips,
    finalVideos,
    templates: [],
    brandAssets: [],
    socialAccounts: [],
    publishJobs: [],
    postMetrics: [],
    shareLinks: [{ id: 'sl_1', project_id: demoProject.id, access: 'anyone_view', token: 'demo_share_token_1' }],
    shares: [],
    aiModels,
    generations: [],
    creditLedger: [
      {
        id: 'led_1',
        workspace_id: demoWorkspace.id,
        delta: 47,
        balance_after: 47,
        reason: 'Starter Free Plan Allocation',
        ref_type: 'subscription',
        ref_id: 'starter_grant',
        created_at: now,
      },
    ],
    apiKeys: [],
    webhooks: [],
    popupsSeen: [],
  };
}

const DATE_FIELDS = new Set([
  'created_at',
  'updated_at',
  'expires_at',
  'deleted_at',
  'accepted_at',
  'fetched_at',
  'viewed_at',
  'seen_at',
  'scheduled_at',
  'last_used_at',
  'revoked_at',
]);

const BIGINT_FIELDS = new Set(['storage_bytes', 'bytes']);

function loadStoreFromDisk(): Store {
  try {
    if (fs.existsSync(DB_FILE_PATH)) {
      const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw, (key, value) => {
        if (value === null) return null;
        if (DATE_FIELDS.has(key) && typeof value === 'string') {
          return new Date(value);
        }
        if (BIGINT_FIELDS.has(key) && (typeof value === 'string' || typeof value === 'number')) {
          return BigInt(value);
        }
        return value;
      });
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.plans)) {
        const demoWs = Array.isArray(parsed.workspaces)
          ? parsed.workspaces.find((w: any) => w.id === 'ws_demo')
          : null;
        if (demoWs && Number(demoWs.credits_balance || 0) < 999999999) {
          demoWs.credits_balance = 999999999;
          saveStoreToDisk(parsed as Store);
        }
        return parsed as Store;
      }
    }
  } catch (err) {
    console.warn('Could not load local-db.json, initializing fresh store:', err);
  }
  const initial = createSeededStore();
  saveStoreToDisk(initial);
  return initial;
}

function saveStoreToDisk(currentStore: Store) {
  if (process.env.NODE_ENV === 'test') return;
  try {
    fs.mkdirSync(path.dirname(DB_FILE_PATH), { recursive: true });
    const serialized = JSON.stringify(
      currentStore,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2
    );
    fs.writeFileSync(DB_FILE_PATH, serialized, 'utf-8');
  } catch (err) {
    console.warn('Failed to persist local-db.json:', err);
  }
}

const store: Store = loadStoreFromDisk();

function matchesWhere(item: any, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (v === null) {
      if (item[k] !== null && item[k] !== undefined) return false;
      continue;
    }
    if (k === 'project' && typeof v === 'object' && v !== null) {
      const proj = store.projects.find((p) => p.id === item.project_id);
      if (!proj || !matchesWhere(proj, v)) return false;
      continue;
    }
    if (k === 'clip' && typeof v === 'object' && v !== null) {
      const clip = store.clips.find((c) => c.id === item.clip_id);
      if (!clip || !matchesWhere(clip, v)) return false;
      continue;
    }
    if (k === 'social_account' && typeof v === 'object' && v !== null) {
      const acc = store.socialAccounts.find((a) => a.id === item.social_account_id);
      if (!acc || !matchesWhere(acc, v)) return false;
      continue;
    }
    if (k === 'workspace_id_user_id' && typeof v === 'object' && v !== null) {
      // Prisma compound unique key on Membership (@@id([workspace_id, user_id]))
      if (!matchesWhere(item, v)) return false;
      continue;
    }
    if (k === 'memberships' && typeof v === 'object' && v !== null && 'some' in v) {
      const someCond = (v as any).some;
      const hasMatch = store.memberships.some(
        (m) => m.workspace_id === item.id && matchesWhere(m, someCond)
      );
      if (!hasMatch) return false;
      continue;
    }
    if (typeof v === 'object' && v !== null && !(v instanceof Date)) {
      if ('contains' in v) {
        const hay = String(item[k] || '').toLowerCase();
        const needle = String((v as any).contains || '').toLowerCase();
        if (!hay.includes(needle)) return false;
        continue;
      }
    }
    if (item[k] !== v) return false;
  }
  return true;
}

function hydrateItem(table: keyof Store, item: any, include?: any): any {
  if (!item) return null;
  const copy = { ...item };

  if (table === 'workspaces' && include) {
    if (include.plan) {
      copy.plan = store.plans.find((p) => p.id === copy.plan_id) || null;
    }
    if (include._count?.select) {
      copy._count = {
        memberships: store.memberships.filter((m) => m.workspace_id === copy.id).length,
        social_accounts: store.socialAccounts.filter((a) => a.workspace_id === copy.id).length,
      };
    }
  }

  if (table === 'users' && include?.memberships) {
    const mList = store.memberships
      .filter((m) => m.user_id === copy.id && matchesWhere(m, include.memberships.where))
      .map((m) => hydrateItem('memberships', m, include.memberships.include));
    copy.memberships = mList;
  }

  if (table === 'memberships' && include) {
    if (include.workspace) {
      copy.workspace = hydrateItem(
        'workspaces',
        store.workspaces.find((w) => w.id === copy.workspace_id),
        include.workspace.include
      );
    }
    if (include.user) {
      copy.user = store.users.find((u) => u.id === copy.user_id) || null;
    }
  }

  if (table === 'projects' && include) {
    if (include.share_links) {
      copy.share_links = store.shareLinks.filter((s) => s.project_id === copy.id);
    }
    if (include.shares) {
      copy.shares = store.shares.filter((s) => s.project_id === copy.id);
    }
    if (include.clips) {
      let clips = store.clips.filter((c) => c.project_id === copy.id);
      if (include.clips.include?.final_videos) {
        clips = clips.map((c) => ({
          ...c,
          final_videos: store.finalVideos
            .filter((fv) => fv.clip_id === c.id)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
        }));
      }
      copy.clips = clips;
    }
  }

  if (table === 'clips' && include) {
    if (include.project) {
      copy.project = store.projects.find((p) => p.id === copy.project_id) || null;
    }
    if (include.final_videos) {
      copy.final_videos = store.finalVideos
        .filter((fv) => fv.clip_id === copy.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
  }

  if (table === 'finalVideos' && include) {
    if (include.clip) {
      copy.clip = store.clips.find((c) => c.id === copy.clip_id) || null;
    }
    if (include.asset) {
      copy.asset = store.assets.find((a) => a.id === copy.asset_id) || null;
    }
  }

  if (table === 'publishJobs' && include) {
    if (include.social_account) {
      copy.social_account = store.socialAccounts.find((a) => a.id === copy.social_account_id) || null;
    }
    if (include.final_video) {
      copy.final_video = hydrateItem(
        'finalVideos',
        store.finalVideos.find((fv) => fv.id === copy.final_video_id),
        include.final_video.include
      );
    }
    if (include.post_metrics) {
      copy.post_metrics = store.postMetrics
        .filter((m) => m.publish_job_id === copy.id)
        .sort((a, b) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime());
    }
  }

  if (table === 'generations' && include?.model) {
    copy.model = store.aiModels.find((m) => m.id === copy.model_id) || null;
  }

  if (table === 'apiKeys' && include?.workspace) {
    copy.workspace = hydrateItem(
      'workspaces',
      store.workspaces.find((w) => w.id === copy.workspace_id),
      include.workspace.include
    );
  }

  if (table === 'shares' && include?.project) {
    copy.project = store.projects.find((p) => p.id === copy.project_id) || null;
  }

  return copy;
}

function makeModelDelegate(table: keyof Store, idPrefix: string) {
  return {
    async findUnique(args?: any) {
      const found = store[table].find((item) => matchesWhere(item, args?.where));
      return hydrateItem(table, found || null, args?.include);
    },
    async findUniqueOrThrow(args?: any) {
      const res = await this.findUnique(args);
      if (!res) throw new Error(`Record not found in ${String(table)}`);
      return res;
    },
    async findFirst(args?: any) {
      const found = store[table].find((item) => matchesWhere(item, args?.where));
      return hydrateItem(table, found || null, args?.include);
    },
    async findMany(args?: any) {
      let list = store[table].filter((item) => matchesWhere(item, args?.where));
      if (args?.orderBy) {
        const [field, dir] = Object.entries(args.orderBy)[0] as [string, 'asc' | 'desc'];
        list = [...list].sort((a, b) => {
          const av = a[field] instanceof Date ? a[field].getTime() : a[field];
          const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
          if (av < bv) return dir === 'asc' ? -1 : 1;
          if (av > bv) return dir === 'asc' ? 1 : -1;
          return 0;
        });
      }
      if (args?.take) {
        list = list.slice(0, args.take);
      }
      return list.map((item) => hydrateItem(table, item, args?.include));
    },
    async create(args: any) {
      const now = new Date();
      const rawData = { ...args.data };
      const nestedMemberships = rawData.memberships?.create;
      const nestedLedger = rawData.credit_ledger?.create;
      delete rawData.memberships;
      delete rawData.credit_ledger;

      const record: any = {
        id: rawData.id || cuid(idPrefix),
        deleted_at: null,
        revoked_at: null,
        accepted_at: null,
        stale: false,
        starred: false,
        disliked: false,
        label_ready: false,
        created_at: now,
        updated_at: now,
        fetched_at: now,
        viewed_at: now,
        seen_at: now,
        ...rawData,
      };
      store[table].push(record);

      if (table === 'workspaces') {
        if (nestedMemberships) {
          store.memberships.push({
            workspace_id: record.id,
            ...nestedMemberships,
          });
        }
        if (nestedLedger) {
          store.creditLedger.push({
            id: cuid('led'),
            workspace_id: record.id,
            created_at: now,
            ...nestedLedger,
          });
        }
      }

      saveStoreToDisk(store);
      return hydrateItem(table, record, args?.include);
    },
    async update(args: any) {
      const idx = store[table].findIndex((item) => matchesWhere(item, args.where));
      if (idx === -1) throw new Error(`Record to update not found in ${String(table)}`);
      const current = store[table][idx];
      const next = { ...current, updated_at: new Date() };
      for (const [k, v] of Object.entries(args.data || {})) {
        if (v === undefined) continue;
        if (typeof v === 'object' && v !== null && 'increment' in v) {
          next[k] = (next[k] || 0) + (v as any).increment;
        } else {
          next[k] = v;
        }
      }
      store[table][idx] = next;
      saveStoreToDisk(store);
      return hydrateItem(table, next, args?.include);
    },
    async updateMany(args: any) {
      let count = 0;
      store[table] = store[table].map((item) => {
        if (matchesWhere(item, args?.where)) {
          count++;
          const next = { ...item, updated_at: new Date() };
          for (const [k, v] of Object.entries(args.data || {})) {
            if (v !== undefined) next[k] = v;
          }
          return next;
        }
        return item;
      });
      saveStoreToDisk(store);
      return { count };
    },
    async deleteMany(args?: any) {
      const before = store[table].length;
      store[table] = store[table].filter((item) => !matchesWhere(item, args?.where));
      saveStoreToDisk(store);
      return { count: before - store[table].length };
    },
    async upsert(args: any) {
      const existing = await this.findFirst({ where: args.where });
      if (existing) {
        return this.update({ where: args.where, data: args.update, include: args.include });
      }
      return this.create({ data: args.create, include: args.include });
    },
  };
}

export const prisma: any = {
  user: makeModelDelegate('users', 'usr'),
  plan: makeModelDelegate('plans', 'plan'),
  workspace: makeModelDelegate('workspaces', 'ws'),
  membership: makeModelDelegate('memberships', 'mem'),
  invitation: makeModelDelegate('invitations', 'inv'),
  folder: makeModelDelegate('folders', 'fld'),
  project: makeModelDelegate('projects', 'proj'),
  asset: makeModelDelegate('assets', 'ast'),
  transcript: makeModelDelegate('transcripts', 'tr'),
  clip: makeModelDelegate('clips', 'clip'),
  finalVideo: makeModelDelegate('finalVideos', 'fv'),
  template: makeModelDelegate('templates', 'tpl'),
  brandAsset: makeModelDelegate('brandAssets', 'ba'),
  socialAccount: makeModelDelegate('socialAccounts', 'soc'),
  publishJob: makeModelDelegate('publishJobs', 'pub'),
  postMetric: makeModelDelegate('postMetrics', 'pm'),
  shareLink: makeModelDelegate('shareLinks', 'sl'),
  share: makeModelDelegate('shares', 'sh'),
  aiModel: makeModelDelegate('aiModels', 'mdl'),
  generation: makeModelDelegate('generations', 'gen'),
  creditLedger: makeModelDelegate('creditLedger', 'led'),
  apiKey: makeModelDelegate('apiKeys', 'key'),
  webhook: makeModelDelegate('webhooks', 'wh'),
  popupSeen: makeModelDelegate('popupsSeen', 'pop'),
  async $transaction(fn: (tx: any) => Promise<any>) {
    return fn(prisma);
  },
  async $disconnect() {},
};
