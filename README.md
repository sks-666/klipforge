# KlipForge (`klipforge`) — AI Video Repurposing & Generation Platform

Production-grade full-stack monorepo implementing **Phases 1–8** of the AI Video Repurposing Platform:

- **Phase 1 — Foundation**: Monorepo (`apps/api`, `apps/web`), PostgreSQL 21-table Prisma schema, RBAC (`owner`, `admin`, `editor`, `viewer`), config-driven plans (`free`, `creator`, `business`) with `can(feature)` gates, credit ledger (47 starter credits), App Shell (Sidebar, Topbar, `⌘K` Command Palette, Coach Marks, Upgrade Modal), Settings suite, and Stripe billing endpoints.
- **Phase 2 — Ingest & Clipping Engine**: URL/upload ingest supporting `videoType` `1..14`, async state machine (`queued → downloading → transcribing → analyzing → rendering → done`) with SSE live progress events, ranked clips with virality scores (`0.0–10.0`), filter/sort/bulk toolbar, inline transcript editing with stale-render banner & re-render flow, folders, and project sharing.
- **Phase 3 — Media Enrichment Engine**: Animated subtitle presets (`hormozi_pop`, `neon_pulse`, `minimal_clean`), AI hook headline banner, contextual emoji injection, keyword highlighting, filler-word & dead-air (`>600ms`) removal, 9:16 speaker-focused reframing keyframes, auto B-roll placement, and plan-aware FFmpeg filtergraph builder.
- **Phase 4 — Distribution, Calendar & Analytics**: Sandbox social OAuth connections (TikTok, YouTube, Instagram, Facebook, X/Twitter, LinkedIn) with plan-limit locking, post scheduler & calendar drag/reschedule, AI Social Caption Generator (`POST /api/v1/project/ai-social`), and 4-KPI Analytics dashboard.
- **Phase 5 — WebGL Multi-Track Timeline Editor & Brand Kit**: Interactive `/editor` with WebGL capability guard (`WebGLGuardModal`), text-based transcript sentence deletion/restoration, 11-icon tool rail, 5-track timeline (Video, B-Roll, Captions, Headline/Stickers, Audio), debounced autosave, and Brand Kit & Templates.
- **Phase 6 — AI Studio & Idea-to-Video**: Data-driven AI model catalog (Veo 3, Seedance 2.5, Kling 3.0, Nano Banana Pro, FLUX.1 Pro, Remotion Motion Engine), Video/Image/Motion composers with live credit cost pill and automatic credit refund on failure, Assets gallery, and Idea-to-Video pipeline.
- **Phase 7 — Public Open API (`/open-api/v1`) & Integrations**: API-key authenticated endpoints (`YOURAPP_API_KEY`), per-workspace rate limiting (3/min, 20/hour), documented status/error codes (`2000`, `1000`, `4001`–`4011`), OpenAPI 3.1 spec (`/open-api/v1/openapi.json`), n8n workflow JSON, and Agent Skill file.
- **Phase 8 — Security & Hardening**: OWASP ASVS L2 headers, request correlation IDs, workspace tenant isolation, and automated test suites across all phases.

## Quick Start

```bash
# 1. Start PostgreSQL, Redis, and MinIO (optional for unit tests)
docker compose up -d

# 2. Install dependencies
npm install

# 3. Push Prisma schema and seed demo data (if Postgres is running)
npm run db:push
npm run db:seed

# 4. Run automated verification tests
npm test

# 5. Start API (http://localhost:4000) and Web App (http://localhost:5173)
npm run dev:api
npm run dev:web
```

