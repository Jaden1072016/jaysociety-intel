import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { freshness, freshnessLabel } from "@/analysis/freshness";
import { relTime } from "@/lib/time";
import { dismissTrend } from "../actions";
import { Empty, Flash, Header, RefreshButton } from "@/components/ui";
import { Submit } from "@/components/Submit";

export const dynamic = "force-dynamic";

const SRC: Record<string, string> = {
  google_trends_rss: "Google Trends", twitch_top: "Twitch top", manual_tiktok_cc: "TikTok CC (import)",
  manual_tiktok_search: "TikTok Search (import)", manual_yt_trends: "YT Studio (import)", manual_instagram: "Instagram (import)",
  manual_x: "X (import)", manual_other: "Import",
};

export default async function Trends({ searchParams }: { searchParams: Promise<{ msg?: string; all?: string }> }) {
  const { msg, all } = await searchParams;
  const now = new Date();
  const since = new Date(now.getTime() - 72 * 3_600_000);
  const minRel = all ? 0 : 0.2;
  const rows = await db.select().from(schema.trends)
    .where(and(gte(schema.trends.lastSeenAt, since), gte(schema.trends.relevance, minRel), eq(schema.trends.dismissed, false)))
    .orderBy(sql`${schema.trends.relevance} desc`, desc(schema.trends.lastSeenAt)).limit(150);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.trends).where(gte(schema.trends.lastSeenAt, since));

  // Group overlapping topics so one story shows once.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.clusterKey ?? r.key;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  return (
    <main className="wrap">
      <Header title="Trend radar" sub={`${groups.size} topics · ${total} raw in 72h`}>
        <RefreshButton job="trends" label="Refresh" returnTo="/trends" />
      </Header>
      <Flash msg={msg} />
      <div className="row">
        <a className="btn" href={all ? "/trends" : "/trends?all=1"}>{all ? "Show audience matches only" : "Show everything"}</a>
        <a className="btn" href="/settings#import">Import TikTok / YouTube Studio / X research</a>
      </div>
      {groups.size === 0 ? (
        <Empty>No audience-relevant trends in the last 72 hours. Refresh, adjust your audience keywords in Settings, or import research.</Empty>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {[...groups.values()].map((g) => {
            const lead = g[0];
            const f = freshness(new Date(Math.min(...g.map((x) => x.firstSeenAt.getTime()))), new Date(Math.max(...g.map((x) => x.lastSeenAt.getTime()))), now);
            const sources = [...new Set(g.map((x) => SRC[x.source] ?? x.source))];
            return (
              <article key={lead.id} className="card">
                <div className="row between">
                  <h3>{lead.url ? <a href={lead.url} target="_blank" rel="noopener noreferrer">{lead.title}</a> : lead.title}</h3>
                  <div className="row">
                    <span className={`badge ${f >= 0.45 ? "good" : f >= 0.2 ? "warn" : ""}`}>{freshnessLabel(f)}</span>
                    <span className="badge navy">fit {Math.round(Math.max(...g.map((x) => x.relevance)) * 100)}</span>
                  </div>
                </div>
                <div className="row">
                  {sources.map((s) => <span key={s} className={`badge ${s.includes("import") ? "warn" : ""}`}>{s}</span>)}
                  {lead.approxTraffic && <span className="badge">{lead.approxTraffic}{lead.source === "google_trends_rss" ? " searches" : ""}</span>}
                  <span className="faint" style={{ fontSize: "0.75rem" }}>first seen {relTime(lead.firstSeenAt)}{lead.seenCount > 1 ? ` · seen ${lead.seenCount}x` : ""}</span>
                </div>
                {g.length > 1 && <p className="faint" style={{ fontSize: "0.8rem" }}>Also: {g.slice(1).map((x) => x.title).join(" · ")}</p>}
                {lead.matchedTopics.length > 0 && <p className="faint" style={{ fontSize: "0.78rem" }}>Matched: {lead.matchedTopics.join(", ")}</p>}
                {(lead.news ?? []).length > 0 && (
                  <ul className="clean evidence">
                    {(lead.news ?? []).slice(0, 3).map((n) => <li key={n.url}><a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a>{n.source && <span className="faint"> · {n.source}</span>}</li>)}
                  </ul>
                )}
                <form action={dismissTrend}><input type="hidden" name="id" value={lead.id} /><Submit className="ghost">Hide</Submit></form>
              </article>
            );
          })}
        </div>
      )}
      <p className="notice">Google Trends traffic is a bucket (e.g. "200K+"), not an exact count. Imported items show numbers exactly as you entered them.</p>
    </main>
  );
}
