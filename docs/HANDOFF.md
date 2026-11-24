# Handoff notes (for the next session)

## Status, 2026-11-23

Built and passing: stages 1–7 from FEASIBILITY.md. 52 tests (unit + Postgres integration) cover ingestion, normalization, scoring, auth, scheduled jobs and failure handling. Production build passes. Not yet deployed.

Verified locally: health check, login redirect, migrations + seed, job runs, UI on a 390px viewport. Google Trends could not be fetched from the build sandbox (network allowlist), so live ingestion is only proven by tests with a recorded feed shape; check Settings > Integrations after the first Railway deploy.

## Decisions

- Drizzle instead of Prisma: no engine binaries to download, simpler Railway builds.
- Own scheduler (`src/jobs/scheduler.ts`) instead of node-cron: ET/DST-aware, restart-safe via unique `(job, slot)` in `job_runs`, catch-up windows for missed runs.
- Creator accounts must be confirmed by the owner before tracking (name collisions).
- Performance ratio: same creator, same video type, similar age (0.5x–2x). Falls back to a log-age estimate with "low confidence."
- Claude never gets to set evidence-derived scores (relevance, freshness, evidence). It only judges feasibility/originality/collab, and originality is capped when a topic is crowded.
- Seeded handles are guesses and start unconfirmed. Raud has no handles seeded on purpose.

## Next up

1. Deploy to Railway (web + worker), set variables, confirm creator accounts.
2. TikTok Display API (own videos) after a TikTok dev app passes review. Add provider + OAuth like `src/providers/oauth.ts`.
3. Instagram API with Instagram Login (own insights). Business Discovery for other creators needs the Facebook Login variant.
4. Tune `DEFAULT_PROFILE` keywords from real dismiss/save behavior.

## Gotchas

- YouTube quota resets at midnight Pacific; budgets use `ptDate()`.
- Shorts are detected by duration (<= 3 min). The Data API has no Shorts flag.
- YouTube Analytics lags ~2 days; the sync window ends 2 days ago.
- iOS push only works from the installed Home Screen app.
