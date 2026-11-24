import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { topOpportunities } from "@/engine/generate";
import { getBriefing } from "@/engine/briefing";
import { newUploads, recentOutliers } from "@/ingest/creators";
import { perfLabel } from "@/analysis/performance";
import { etDate, formatEt, relTime } from "@/lib/time";
import { providerStatuses } from "@/lib/status";
import { Empty, Flash, Header, OpportunityCard, RefreshButton, StatusStrip } from "@/components/ui";
import { SCORE_DISCLAIMER } from "@/engine/scoring";

export const dynamic = "force-dynamic";

export default async function Today({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const now = new Date();
  const [opps, briefing, uploads, outliers, statuses, readyCount, creatorCount] = await Promise.all([
    topOpportunities(6, 36, now),
    getBriefing(etDate(now)),
    newUploads(36, now),
    recentOutliers(7, 1.5, now),
    providerStatuses(["google_trends_rss", "youtube_data", "twitch_helix", "youtube_analytics", "claude", "web_push"]),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.ideas).where(eq(schema.ideas.status, "Ready to Film")),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.creatorAccounts).where(eq(schema.creatorAccounts.verified, true)),
  ]);
  const lastJobs = await db.select().from(schema.jobRuns).orderBy(desc(schema.jobRuns.startedAt)).limit(1);
  const [lead, ...rest] = opps;
  const hasDemoGap = creatorCount[0].n === 0;

  return (
    <main className="wrap">
      <Header title="Today" sub={new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric" }).format(now)}>
        <RefreshButton job="briefing" label="Refresh" returnTo="/" />
      </Header>
      <Flash msg={msg} />
      <StatusStrip items={statuses} />

      {briefing && (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Morning briefing {formatEt(briefing.createdAt, { month: undefined, day: undefined })}: {briefing.content.headline}
          {readyCount[0].n > 0 && <> · <a href="/ideas?status=Ready%20to%20Film">{readyCount[0].n} ready to film</a></>}
        </p>
      )}

      <section className="section">
        <div className="section-head"><h2>Best opportunities right now</h2><span className="notice" title={SCORE_DISCLAIMER}>scores are priority estimates</span></div>
        {lead ? (
          <>
            <OpportunityCard o={lead} feature />
            {rest.map((o) => <OpportunityCard key={o.id} o={o} />)}
          </>
        ) : (
          <Empty>
            <p>No opportunities in the last 36 hours yet.</p>
            <p className="faint">They're built from Google Trends plus your watched creators. {hasDemoGap ? "Confirm some creator accounts on the Creators tab to add creator evidence." : ""} Tap Refresh to run research now.</p>
          </Empty>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2>Outperforming for creators you watch</h2><a href="/creators" className="notice">all creators</a></div>
        {outliers.length ? (
          <ul className="clean">
            {outliers.slice(0, 6).map((v) => (
              <li key={v.id} className="card" style={{ padding: 10 }}>
                <div className="row between">
                  <a href={v.url} target="_blank" rel="noopener noreferrer">{v.title}</a>
                  <span className={`badge ${v.perfConfidence === "low" ? "warn" : "good"}`}>{perfLabel(v.perfRatio, v.perfConfidence ?? "none")}</span>
                </div>
                <span className="faint" style={{ fontSize: "0.78rem" }}>{v.creator} · {v.platform} · {v.format} · {relTime(v.publishedAt)} · {v.perfBasis}</span>
              </li>
            ))}
          </ul>
        ) : <Empty>No clear outperformers yet. Baselines need a few refreshes of history per creator.</Empty>}
      </section>

      <section className="section">
        <div className="section-head"><h2>New from watched creators</h2><span className="notice">last 36h</span></div>
        {uploads.length ? (
          <ul className="clean">
            {uploads.slice(0, 8).map((v) => (
              <li key={v.id}>
                <a href={v.url} target="_blank" rel="noopener noreferrer">{v.title}</a>
                <span className="faint"> · {v.creator} · {v.platform} · {relTime(v.publishedAt)}{v.views != null ? ` · ${v.views.toLocaleString()} views` : ""}</span>
              </li>
            ))}
          </ul>
        ) : <Empty>Nothing new yet from confirmed creator accounts.</Empty>}
      </section>

      <p className="notice">
        Last background run: {lastJobs[0] ? `${lastJobs[0].job} ${relTime(lastJobs[0].startedAt)} (${lastJobs[0].status})` : "none yet"}. All numbers come from the linked sources; nothing here is sample data.
      </p>
    </main>
  );
}
