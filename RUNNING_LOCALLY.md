# How to Run KlipForge Locally

KlipForge runs locally out of the box **without requiring Docker, PostgreSQL, Redis, or MinIO**. In local development, the API automatically persists data to `apps/api/prisma/local-db.json` and stores media files in `apps/api/storage/`.

---

## 1. Prerequisites

- **Node.js** `>= 18` (Node 20+ recommended) and **npm**
- **FFmpeg & FFprobe** (`ffmpeg`, `ffprobe` on `PATH` or `/usr/local/bin/`) — used for rendering 720p/1080p video clips and thumbnails
- **Python 3** (`python3`) — used by the bundled `apps/api/bin/yt-dlp` downloader and highlight detector

---

## 2. Install Dependencies

Open a terminal in the project root and install workspace packages (only needed once):

```bash
cd /Users/ssomai/.gemini/antigravity/scratch/klipforge
npm install
```

*(Optional)* Copy `.env.example` if you want to customize ports or secrets — default values are already built into `apps/api/src/config.ts`:

```bash
cp .env.example .env
```

---

## 3. Start the Project (2 Terminals)

### Terminal 1 — Start the Backend API (`http://localhost:4000`)

```bash
cd /Users/ssomai/.gemini/antigravity/scratch/klipforge
npm run dev:api
```

- Runs `tsx watch src/index.ts` inside `apps/api` with automatic hot-reload.
- Verify health check: http://localhost:4000/health
- OpenAPI 3.1 spec: http://localhost:4000/open-api/v1/openapi.json

### Terminal 2 — Start the Frontend Web App (`http://localhost:5173`)

```bash
cd /Users/ssomai/.gemini/antigravity/scratch/klipforge
npm run dev:web
```

- Runs Vite on port `5173` and proxies `/api`, `/open-api` and `/media` requests to `http://localhost:4000` (same-origin, so it also works from your LAN IP without CORS setup).

---

## 4. Access the App & Demo Account

Open **http://localhost:5173** in your browser.

In local dev, the app automatically logs in with the seeded demo account:

- **Email**: `demo@klipforge.ai`
- **Password**: `password123`
- **Workspace**: `Alex's Workspace` (`ws_demo`) — configured with **∞ Unlimited credits**

### Unlimited access (on by default)

A fresh install from the GitHub repo has **unlimited access out of the box**, so you don't need to configure anything:

- Every workspace (the demo one and every account you register) is put on the **Business** plan with **∞ credits**: no watermark, 4K export, and every feature unlocked (scheduling, brand kit, sharing, API access, team invites).
- This is applied when the API starts, so existing local databases are upgraded too.
- To bring back normal plans and credits (for example on a public, paid server), start the API with `UNLIMITED_ACCESS=false`.

### Accounts: register, log in, log out

| Page | What it does |
| :--- | :--- |
| `/register` | Create an account (name, email, password ≥ 8 chars with a letter and a number). You get your own workspace with unlimited access (Business plan, ∞ credits). With `UNLIMITED_ACCESS=false` it starts on the **Free** plan with 47 credits instead. |
| `/login` | Log in with email + password, or click **Continue with demo account**. |
| Avatar menu → **Log out** | Signs out and returns to `/login`. Demo auto-login stays off until you log in again. |
| `/settings/profile` | Change your name and password. |

- Every app page requires a session; signed-out visitors are sent to `/login` and returned to the page they wanted after logging in.
- Sessions are JWTs valid for 7 days (`JWT_EXPIRES_IN` on the API). An expired session redirects to `/login`.
- Passwords are stored as salted scrypt hashes. Login, registration and password changes are rate-limited (10 failed attempts per 15 minutes).
- To turn off demo auto-login entirely (e.g. on a shared server), build the web app with `VITE_DEMO_AUTOLOGIN=false`.

### Social planner (Calendar tab)

**Workspace → Calendar** is a post scheduler modelled on Metricool's Planner, with five tabs: **Calendar, List, Posts library, Autolists and Deleted posts**.

- **Accounts:** link TikTok, YouTube Shorts, Instagram Reels, LinkedIn, X or Facebook as **sandbox** accounts. These schedule, publish and fail exactly like real accounts, without posting anywhere. Manage them under the accounts button (top right of the planner). OAuth tokens are encrypted at rest (AES-256-GCM with `ENCRYPTION_KEY`) and never sent to the browser.
- **Scheduling:** press **Schedule** on any finished clip in a project, or **+ Create post** / click an empty calendar slot. Every platform gets its own tab for caption, title and first comment, with live limits and validation, plus a phone preview and an **AI caption** button. Drag a card to reschedule it.
- **Times:** stored in UTC and shown in your browser's timezone (change it under ⋮ → Change timezone).
- **Publishing worker:** runs inside the API and checks every minute (`PLANNER_TICK_MS`). It publishes due posts, retries failures 3 times (after 1, 5 and 15 minutes), can't post the same target twice, fills autolist slots, and permanently removes posts deleted more than 30 days ago. Put `#fail` in a sandbox caption to test failures and Retry.
- **Monthly post limit:** 20 posts per user (`POST_QUOTA_MONTHLY`), enforced by the API. In unlimited access mode there is no limit.
- **Real platforms:** live publishing is stubbed until you set the platform keys on the API: `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`, `YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET`, `META_APP_ID`/`META_APP_SECRET`, `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET`, `X_CLIENT_ID`/`X_CLIENT_SECRET`. Each stub in `apps/api/src/services/social/providers/live.ts` names the API it needs to call.
- **Best-time heatmap:** uses mock engagement data from `getBestTimes()` in `apps/api/src/services/social/planner.service.ts`, ready to be replaced with real analytics.

---

## 5. Useful Commands

| Task | Command |
| :--- | :--- |
| Start API server (port `4000`) | `npm run dev:api` |
| Start Web app (port `5173`) | `npm run dev:web` |
| Run automated API test suite | `npm test` |
| Build Web app & sync compiled JS | `npm --workspace=apps/web run build` |
| Start optional Docker services (Postgres/Redis/MinIO) | `docker compose up -d` |

---

## 6. Local Storage & Troubleshooting

- **Database file**: `apps/api/prisma/local-db.json`
  - To reset all local data back to clean defaults, stop the API server, delete `apps/api/prisma/local-db.json`, and run `npm run dev:api` again.
- **Media files**:
  - Source downloads & captions: `apps/api/storage/uploads/`
  - Rendered MP4 clips & JPG posters: `apps/api/storage/clips/`
- **Port already in use (`EADDRINUSE`)**:
  ```bash
  # Free port 4000 (API) or 5173 (Web)
  lsof -ti :4000 | xargs kill -9
  lsof -ti :5173 | xargs kill -9
  ```
- **Frontend UI changes not reflecting**:
  - `apps/web/src` contains `.js` outputs alongside `.tsx` sources; run `npm --workspace=apps/web run build` after editing `.tsx` files so Vite picks up the updated modules.

