# Pre-deployment audit (2026-11-23)

## Fixed in this pass

| Area | Problem found | Fix |
|---|---|---|
| Login | Lockout keyed on the first `X-Forwarded-For` value, which the client controls. Rotating that header bypassed the 5-try limit. | Use the rightmost entry (added by Railway's edge). Added a global cap: 30 failures in 15 min across all addresses locks login. |
| Auth | Pages relied on middleware alone. | Every page and server action now calls `requireAuth()` itself. |
| Migrations | Web and worker both migrate on boot and could race on the first deploy. | Postgres advisory lock around migrations. |
| Railway config | `railway.json` applies to every service, so the worker would have started the web server. | `npm start` branches on `APP_ROLE=worker`; the worker serves its own `/api/health` that fails if the loop stalls for 5 min. |
| Claude cap | Cap was checked against an estimate; two simultaneous runs, or a low estimate, could overshoot slightly. | Each call reserves its worst-case cost (prompt chars + max output tokens) under a DB lock before calling, then settles down to the real cost. Failed calls release the reservation. The cap is now a hard ceiling (tested with concurrent reservations). |
| Creator comparisons | Low-confidence estimates could appear in "Outperforming" and feed ideas. Very new videos could be judged. | Low-confidence results show only on the creator page with a label. Videos under 6 hours are "too new to compare." |
| Ideas | Twitch top categories (Fortnite, GTA) were always present and would resurface as ideas every 3 days. | They only become a standalone idea in their first 24 hours on the list; otherwise they're supporting evidence. |
| Twitch | A revoked cached app token would keep failing until expiry. | On 401, drop the cached token and retry once. |
| Push | VAPID subject defaulted to an example email (Apple can reject bad subjects). | Defaults to `APP_URL`. Set `VAPID_SUBJECT=mailto:you@...` to be safe. |

## Verified

- DST: tests cover both sides of Nov 1 2026, Mar 14 2027 and Nov 7 2027, plus the repeated 1 AM hour on fall-back day (runs once).
- 61 automated tests pass against real Postgres.

## Known limits (not bugs)

- Google OAuth app left in "Testing" mode expires refresh tokens after 7 days. Publish the OAuth consent screen to "In production" (unverified is fine for one user; you'll click through a warning once).
- YouTube Shorts are inferred from duration (3 min or less). The API has no Shorts flag.
- Returning viewers per video are not available from the YouTube Analytics API used here.
- Twitch has no API for your average viewers, chatters or retention.
- TikTok, Instagram and X: no automatic access (see FEASIBILITY.md).
- iPhone push requires the app installed to the Home Screen; can only be verified on your device.
