# Jay Society Creator Intelligence

Private, mobile-first research app for Jay Society. Every morning at 8:00 AM ET it pulls Google Trends, checks the creators you watch on YouTube and Twitch, finds what's outperforming for them, and turns that evidence into scored, original content ideas for your audience.

- **Evidence vs suggestions are separate.** Every idea card lists its sources with links. AI or template text is labeled.
- **Scores are internal priority estimates**, not view predictions.
- **No fake data.** Unavailable metrics say "unavailable." The app shipped with no sample data.
- **No scraping.** Only official APIs and public feeds. TikTok, Instagram and X research comes in through Import. See `docs/FEASIBILITY.md`.

## Stack

Next.js 15 (App Router, server actions) · PostgreSQL via Drizzle ORM · separate Node worker for schedules · Web Push · optional Claude (Haiku 5.5) with a monthly cap and a rules-based fallback.

## Railway setup (two services, one repo)

1. Create a project with a **Postgres** database.
2. **Web service** from this repo. Uses `railway.json` (build `npm run build`, start `npm start`, which runs migrations then serves). Generate a domain.
3. **Worker service** from the same repo. Settings > Start command: `npm run worker`. Remove the healthcheck for this service (it has no HTTP server).
4. Variables for both services (see `.env.example`). At minimum: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `SESSION_SECRET`, `APP_PASSWORD`, `APP_URL`.
5. Optional, all free: `YOUTUBE_API_KEY`, Twitch client id/secret, Google OAuth client (redirect URI `APP_URL/api/oauth/google/callback`; Twitch: `APP_URL/api/oauth/twitch/callback`), VAPID keys (`npm run vapid`).
6. Open the app, go to Creators, and confirm each account is the right person. Nothing is tracked until you confirm.
7. On iPhone: Share > Add to Home Screen, open it from there, then Settings > Enable push.

## Costs

Railway hosting (billed by Railway). Everything else is free except optional Claude: about $0.006/day on Haiku 5.5, hard-capped (default $2/month). X API is off because it's pay-per-use.

## Develop

```
npm install
cp .env.example .env.local   # fill DATABASE_URL etc.
npm run migrate && npm run dev
npm run worker               # separate terminal
npm test                     # needs a Postgres test DB: TEST_DATABASE_URL
```

## Layout

- `src/providers` official API clients (Google Trends RSS, YouTube Data + Analytics, Twitch, OAuth)
- `src/ingest` writes trends, creator videos, snapshots, your own analytics, manual imports
- `src/analysis` pure functions: normalization, relevance, freshness, baselines, formats, posting windows
- `src/engine` candidates, scoring, Claude + rules generators, briefing, weekly review
- `src/jobs` + `src/worker` ET scheduler; each slot runs once (enforced in Postgres)
- `src/app` pages and server actions (all auth-checked)
- `docs/` feasibility matrix and handoff notes
