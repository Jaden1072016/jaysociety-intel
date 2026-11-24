# Integration Feasibility Matrix

Checked against official documentation on 2026-11-23. Re-check anything marked "changes often" before relying on it.

Support levels used in the app:

- **Full**: automatic, official API, free.
- **Partial**: some data automatic, the rest through manual URL/CSV import.
- **Manual**: no permitted automatic access for this use. Import workflow only.
- **Not built**: available, but costs money. Off until you approve the cost.

| Source | Level | How the app uses it | Auth | Cost | Limits and caveats |
|---|---|---|---|---|---|
| Google Trends "Trending now" RSS (`trends.google.com/trending/rss?geo=US`) | Full | Polled every 30 min. Title, approx traffic bucket ("2000+"), pubDate, up to 3 linked news articles | None | Free | Undocumented as an API, but it is a public feed Google links from the Trending Now page. Traffic is a bucket, not a count. Parser fails soft if the format changes |
| Google Trends API (alpha) | Not available | Not used | Application | Unknown | Alpha, small pilot group, does not include Trending Now. Revisit if you get accepted |
| YouTube Data API v3 | Full | Resolve `@handle` to channel (`channels.list forHandle`, 1 unit), uploads playlist (`playlistItems.list`, 1 unit), stats (`videos.list`, 1 unit per 50 videos) | API key | Free | 10,000 units/day default. `search.list` costs 100 units and is never used in scheduled jobs. App budget defaults to 3,000 units/day |
| YouTube Analytics API | Full (your channel only) | Views, avg view duration, avg % viewed, subs gained/lost, likes, shares per video and per day | Google OAuth (`yt-analytics.readonly`, `youtube.readonly`) | Free | Only your own channel. Data lags ~2 days. Returning viewers is not exposed per video through this API, so it shows as unavailable |
| YouTube Studio Trends / Inspiration tab | Manual | Paste topics or URLs into Import | n/a | n/a | No API |
| Twitch Helix | Full | Users, VODs (`Get Videos`: view_count, created_at, duration), live status (`Get Streams`), top categories | App access token (client credentials) | Free | 800 points/min with token. VOD view counts only; no clip-level engagement beyond view_count |
| Twitch (your channel) | Partial | Total followers via `Get Channel Followers` | Twitch user OAuth (`moderator:read:followers`) | Free | Helix has no general channel analytics endpoint. Average viewers, chatters and retention stay in the Twitch dashboard; enter them manually if wanted |
| TikTok Creative Center (trends) | Manual | Paste hashtags/sounds/URLs or CSV | n/a | n/a | No public developer API. Third-party scrapers exist; not used (prohibited scraping) |
| TikTok Creator Search Insights | Manual | Paste search terms | n/a | n/a | In-app tool only. No official API found in TikTok developer docs |
| TikTok Display API (your videos) | Partial, not wired yet | `video.list` returns your public videos with view/like/comment/share counts | TikTok Login Kit OAuth + app review | Free | Requires app review by TikTok. Wiring is stubbed; app shows "needs app review" |
| TikTok Research API | Not available | Not used | Academic/non-profit only | n/a | Creators and commercial users are not eligible |
| Instagram API with Instagram Login (your account) | Partial, not wired yet | Media + insights (views, reach, likes, comments, saves, shares) | Business Login for Instagram, professional account | Free | Requires a Meta app and app review for production. Stubbed with clear status |
| Instagram Business Discovery (other creators) | Partial, not wired yet | Public follower count, media, like/comment/view counts of other professional accounts | Facebook Login for Business + your IG pro account linked to a Facebook Page | Free | Only works for professional accounts, and only via Facebook Login variant |
| X API | Not built | Not used | Pay-per-use | ~$0.005 per post read (pay-per-use since Feb 2026; free tier closed to new projects) | Would cost money. Off until you approve. Manual URL import works for X links |
| Anthropic Claude API | Optional, paid | Turns evidence into Jay Society ideas | API key | Haiku 5.5 (`claude-haiku-5-5`): $0.10/M input, $0.50/M output for prompts under 100K tokens. Typical day ≈ 20k in + 8k out ≈ $0.006, about $0.20/month. Hard monthly cap in Settings (default $2) | If no key or cap reached, a rules-based generator produces ideas from the same evidence, labeled as such |

## What this means for the success criterion

Every morning you get: Google Trends filtered to your audience, new and outperforming uploads from watched creators on YouTube and Twitch, ideas built from that evidence with links, and (once connected) your own YouTube results driving posting-window advice. TikTok, Instagram and X research comes in through the Import screen until their official access is set up or paid for.

## Implementation plan (stages)

1. Foundation: Next.js app, Postgres schema, owner login, PWA shell, provider health + budgets + logs.
2. Google Trends radar: ingest, normalize, dedupe, cluster overlaps, freshness, audience relevance.
3. YouTube + Twitch creator intelligence: verified handle resolution, video ingest, recurring snapshots, age- and format-adjusted baselines, outlier detection, format/hook extraction.
4. Opportunity engine: candidate assembly, six-factor scoring, Claude generation with spend cap, rules fallback, evidence vs AI separation.
5. Briefings + notifications: 8:00 AM ET briefing, background refresh, web push with categories, quiet hours, test button, manual refresh.
6. Idea library + weekly review + experiments.
7. Personal analytics: YouTube OAuth + Analytics, Twitch followers, posting-window recommendations from your data first.
8. Next: TikTok Display API and Instagram once you create the developer apps and pass review.
