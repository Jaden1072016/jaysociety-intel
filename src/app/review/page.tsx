import { requireAuth } from "@/lib/auth";
import { desc, eq, and, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import { experimentResults, ideaFormatReview, ownFormatReview, postingStrategy } from "@/engine/review";
import { createExperiment, endExperiment } from "../actions";
import { Empty, Flash, Header, RefreshButton } from "@/components/ui";
import { Submit } from "@/components/Submit";
import { relTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const fmt = (n: number | null | undefined, digits = 0) => (n == null ? "unavailable" : n.toLocaleString(undefined, { maximumFractionDigits: digits }));

export default async function Review({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  await requireAuth();
  const { msg } = await searchParams;
  const [own, ideaFormats, exps, posting, conns, ytDays, twDays] = await Promise.all([
    ownFormatReview(), ideaFormatReview(), experimentResults(), postingStrategy(),
    db.select().from(schema.oauthConnections),
    db.select().from(schema.channelDaily).where(and(eq(schema.channelDaily.platform, "youtube"), gte(schema.channelDaily.date, new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)))).orderBy(desc(schema.channelDaily.date)),
    db.select().from(schema.channelDaily).where(eq(schema.channelDaily.platform, "twitch")).orderBy(desc(schema.channelDaily.date)).limit(30),
  ]);
  const sum = (k: string) => ytDays.length ? ytDays.reduce((a, d) => a + (Number(d.metrics[k]) || 0), 0) : null;
  const google = conns.find((c) => c.provider === "google"), twitch = conns.find((c) => c.provider === "twitch");
  const followersNow = twDays[0]?.metrics.followers ?? null, followersThen = twDays.at(-1)?.metrics.followers ?? null;

  return (
    <main className="wrap">
      <Header title="Weekly review"><RefreshButton job="own" label="Sync my stats" returnTo="/review" /></Header>
      <Flash msg={msg} />

      <section className="section">
        <h2>Your channels</h2>
        <div className="grid2">
          <div className="card">
            <h3>YouTube {google ? <span className="badge good">{google.accountName ?? "connected"}</span> : <span className="badge warn">not connected</span>}</h3>
            {google ? (
              <ul className="clean">
                <li>Views, last 30 days: {fmt(sum("views"))}</li>
                <li>Watch time: {sum("estimatedMinutesWatched") != null ? `${fmt(sum("estimatedMinutesWatched")! / 60)} hours` : "unavailable"}</li>
                <li>Net subscribers: {sum("subscribersGained") != null ? fmt(sum("subscribersGained")! - (sum("subscribersLost") ?? 0)) : "unavailable"}</li>
                <li className="faint">Returning viewers: unavailable through the API</li>
              </ul>
            ) : <p className="muted">Connect in <a href="/settings#connections">Settings</a> to use your real results.</p>}
          </div>
          <div className="card">
            <h3>Twitch {twitch ? <span className="badge good">{twitch.accountName ?? "connected"}</span> : <span className="badge warn">not connected</span>}</h3>
            {twitch ? (
              <ul className="clean">
                <li>Followers: {fmt(followersNow as number | null)}</li>
                <li>Change since {twDays.at(-1)?.date ?? "first sync"}: {followersNow != null && followersThen != null ? fmt((followersNow as number) - (followersThen as number)) : "unavailable"}</li>
                <li className="faint">Average viewers, chatters, retention: not in the Twitch API. Check your Twitch dashboard.</li>
              </ul>
            ) : <p className="muted">Connect in <a href="/settings#connections">Settings</a>.</p>}
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Which formats deserve more of your time</h2>
        {own.rows.length ? (
          <div className="scroll-x"><table>
            <thead><tr><th>Format</th><th>Posts</th><th>vs your usual</th><th>Subs / 1k views</th><th>Avg % watched</th><th>Verdict</th></tr></thead>
            <tbody>{own.rows.map((r) => (
              <tr key={r.format}><td>{r.label}</td><td>{r.posts}</td><td>{r.medianRatio != null ? `${r.medianRatio}x` : "n/a"}</td><td>{fmt(r.subsPer1kViews, 2)}</td><td>{r.avgViewPct != null ? `${r.avgViewPct}%` : "unavailable"}</td>
                <td><span className={`badge ${r.verdict === "Keep investing" ? "good" : r.verdict === "Deprioritize" ? "bad" : "warn"}`}>{r.verdict}</span></td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{own.note}</Empty>}
        {own.rows.length > 0 && <p className="notice">{own.note} "Subs per 1k views" is the closest available signal for turning casual viewers into community members.</p>}
        {ideaFormats.length > 0 && (
          <div className="card">
            <h3>From results you logged on published ideas</h3>
            <ul className="clean">{ideaFormats.map((f) => <li key={f.format}>{f.format}: {f.posts} posts · median views {fmt(f.medianViews)} · median new follows {fmt(f.medianFollows)}</li>)}</ul>
          </div>
        )}
      </section>

      <section className="section">
        <h2>Posting windows</h2>
        <div className="card">
          <div className="row between"><h3>{posting.headline}</h3><span className="badge navy">{posting.basis === "own" ? "Your data" : posting.basis === "benchmark" ? "Creator benchmark" : "Not enough data"}</span></div>
          <ul className="clean">{posting.detail.map((d) => <li key={d}>{d}</li>)}</ul>
          <p className="notice">{posting.caveat} All times Eastern.</p>
        </div>
      </section>

      <section className="section">
        <h2>Experiments</h2>
        {exps.length ? exps.map((e) => (
          <div key={e.id} className="card">
            <div className="row between"><h3>{e.name}</h3><span className="badge">{e.status}</span></div>
            <ul className="clean">
              <li>A: {e.armA}: {e.A.posts} posts, {e.A.withResults} with results, median views {fmt(e.A.medianViews)}</li>
              <li>B: {e.armB}: {e.B.posts} posts, {e.B.withResults} with results, median views {fmt(e.B.medianViews)}</li>
            </ul>
            <p className="muted" style={{ fontSize: "0.85rem" }}>{e.readout}</p>
            {e.status === "running" && <form action={endExperiment}><input type="hidden" name="id" value={e.id} /><Submit className="ghost">End experiment</Submit></form>}
            <span className="faint" style={{ fontSize: "0.75rem" }}>started {relTime(e.createdAt)}</span>
          </div>
        )) : <Empty>No experiments yet.</Empty>}
        <form action={createExperiment} className="card">
          <h3>Start an experiment</h3>
          <label>What are you testing?<select name="variable"><option value="posting_window">Posting window</option><option value="format">Content format</option></select></label>
          <div className="grid2">
            <label>Option A<input name="armA" placeholder="e.g. 6–9 PM ET" required /></label>
            <label>Option B<input name="armB" placeholder="e.g. 11 AM–3 PM ET" required /></label>
          </div>
          <label>Name (optional)<input name="name" /></label>
          <label>What you expect (optional)<input name="hypothesis" /></label>
          <Submit className="primary">Start</Submit>
        </form>
      </section>
    </main>
  );
}
