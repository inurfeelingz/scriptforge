# ScriptForge

AI-powered content studio for solo creators. One app, six modes, Claude as the active intelligence layer throughout.

---

## Stack

| Layer    | Service  | What it does                              |
|----------|----------|-------------------------------------------|
| Frontend | Netlify  | React + Vite, deploys on git push         |
| Backend  | Railway  | Express API, wraps all AI services        |
| Database | Supabase | Postgres + Auth + Storage + RLS           |
| AI       | Claude   | Generation, analysis, chat, insights      |
| Video    | YouTube  | Trending fetch + transcript extraction    |

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/yourname/scriptforge
cd scriptforge
npm install          # installs root + workspaces
```

### 2. Supabase

1. Create a project at supabase.com
2. Open SQL Editor → paste the contents of `supabase/schema.sql` → Run
3. Go to Storage → create buckets: `episode-outputs`, `analytics-uploads`
4. Copy your `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_KEY`

### 3. Environment variables

**Backend** (`backend/.env`):
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=service_role_key
ANTHROPIC_API_KEY=sk-ant-...
YOUTUBE_API_KEY=AIza...
FRONTEND_URL=http://localhost:5173
CLAUDE_MODEL=claude-sonnet-4-20250514
PORT=3001
```

**Frontend** (`frontend/.env`):
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=anon_key
VITE_API_URL=http://localhost:3001/api
```

### 4. Run locally

```bash
npm run dev          # starts both frontend (5173) and backend (3001)
```

---

## Deployment

### Backend → Railway

1. Push to GitHub
2. Create new Railway project → Deploy from GitHub repo
3. Set root directory to `backend`
4. Add all backend env vars in Railway dashboard
5. Railway auto-deploys on every push

### Frontend → Netlify

1. Connect your GitHub repo to Netlify
2. Build settings:
   - Base directory: `frontend`
   - Build command: `npm run build`
   - Publish directory: `dist`
3. Add frontend env vars in Netlify dashboard
4. Update `VITE_API_URL` to your Railway URL
5. Update `FRONTEND_URL` in Railway to your Netlify URL

---

## First use

1. Sign up at your Netlify URL
2. Complete onboarding (name your show + niche)
3. ScriptForge will fetch competitor content and set up your workspace
4. Generate your first episode from the Generate page

---

## Multi-user / Rental

To invite users:

1. Sign in as admin
2. POST `/api/users/invite` with `{ tier, maxUses, expiresInDays }`
3. Share the invite code — users enter it at sign-up for the correct tier

**Tier limits** (configurable in `supabase/schema.sql`):

| Tier   | Episodes/mo | Categories | Features                           |
|--------|-------------|------------|------------------------------------|
| Free   | 8           | 3          | Generate, Vault, Teleprompter      |
| Pro    | 30          | 10         | + EDL, Sound, Series memory, Log   |
| Studio | Unlimited   | Unlimited  | + Collaboration mode               |

---

## Per-episode workflow

```bash
# In the app:
# 1. Select or create a category
# 2. Go to Generate
# 3. Fill in: track name, mood, genre, BPM, voice memo, footage clips
# 4. Watch Claude reason out loud, then stream your VO script
# 5. Download: EDL for DaVinci, VO script, metadata, shorts cut
# 6. Open DaVinci → File → Import Timeline → Import EDL
# 7. Record VO against picture, apply colour grade, export
# 8. Upload analytics CSV after publishing for the feedback loop
```

---

## Smart refresh

Trending data refreshes automatically when:
- You open the app and data is >48 hours old
- You switch to a category with stale data
- You click the refresh button in the sidebar

Generation log analysis runs automatically when 3+ episodes have performance data.

---

## File structure

```
scriptforge/
├── frontend/                    # React + Vite → Netlify
│   ├── src/
│   │   ├── pages/               # Dashboard, Generate, Series, Vault, Analytics, Teleprompter, Sound
│   │   ├── components/
│   │   │   ├── layout/          # AppLayout, Notifications, NewCategoryModal
│   │   │   └── chat/            # ChatPanel (Claude in every mode)
│   │   ├── lib/                 # supabase.js, api.js
│   │   └── store/               # Zustand global state
│   └── netlify.toml
├── backend/                     # Express → Railway
│   ├── src/
│   │   ├── routes/              # episodes, vault, analytics, series, chat, categories, users, refresh, collab
│   │   ├── middleware/          # auth.js, tier.js
│   │   ├── services/            # contextAssembler, smartScheduler, trendingService, logAnalysisService
│   │   └── utils/               # supabase.js, sse.js
│   └── railway.json
└── supabase/
    └── schema.sql               # All tables, RLS, triggers, functions
```
