import { desc, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSetting } from "@/lib/settings";
import { providerStatuses } from "@/lib/status";
import { recentLogs, monthCost } from "@/lib/ops";
import { SETUP_HINT, isConfigured } from "@/lib/config";
import { etDate, formatEt, ptDate, relTime } from "@/lib/time";
import { MANUAL_SOURCES } from "@/ingest/manual";
import { disconnectOAuth, importAction, logout, saveAi, saveBudgets, saveNotifications, saveProfile, testPush } from "../actions";
import { Flash, Header, RefreshButton } from "@/components/ui";
import { Submit } from "@/components/Submit";
import { PushControls } from "@/components/PushControls";

export const dynamic = "force-dynamic";

const LEVEL: Record<string, [string, string]> = {
  full: ["Automatic", "good"], partial: ["Partial", "warn"], manual: ["Manual import", "warn"], optional: ["Optional", ""], not_built: ["Off (paid)", "bad"],
};

export default async function Settings({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const [statuses, profile, notif, ai, budgets, logs, usage, conns, jobs, subs] = await Promise.all([
    providerStatuses(), getSetting("audience_profile"), getSetting("notifications"), getSetting("ai"), getSetting("budgets"),
    recentLogs(40),
    db.select().from(schema.apiUsage).orderBy(desc(schema.apiUsage.day)).limit(30),
    db.select().from(schema.oauthConnections),
    db.select().from(schema.jobRuns).orderBy(desc(schema.jobRuns.startedAt)).limit(15),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.pushSubscriptions),
  ]);
  const aiMonth = await monthCost("claude", etDate().slice(0, 7));
  const ytToday = usage.find((u) => u.provider === "youtube_data" && u.day === ptDate());
  const twToday = usage.find((u) => u.provider === "twitch_helix" && u.day === etDate());

  return (
    <main className="wrap">
      <Header title="Settings"><form action={logout}><button className="ghost">Sign out</button></form></Header>
      <Flash msg={msg} />

      <section className="section" id="integrations">
        <div className="section-head"><h2>Integrations</h2><RefreshButton job="trends" label="Refresh trends" returnTo="/settings" /></div>
        <div className="scroll-x"><table>
          <thead><tr><th>Source</th><th>Access</th><th>Status</th><th>Last success</th></tr></thead>
          <tbody>{statuses.map((s) => {
            const [lvl, cls] = LEVEL[s.supportLevel] ?? [s.supportLevel, ""];
            const state = !s.configured && ["full", "optional"].includes(s.supportLevel) ? <span className="badge warn">Needs setup</span>
              : s.consecutiveFailures ? <span className="badge bad" title={s.lastError ?? ""}>Failing x{s.consecutiveFailures}</span>
              : s.lastSuccessAt ? <span className="badge good">OK</span> : s.configured ? <span className="badge">Waiting</span> : <span className="badge">-</span>;
            return (
              <tr key={s.provider}>
                <td>{s.fullLabel}<div className="faint">{s.consecutiveFailures ? s.lastError : (!s.configured || s.supportLevel !== "full") ? SETUP_HINT[s.provider] ?? "" : s.note ?? ""}</div></td>
                <td><span className={`badge ${cls}`}>{lvl}</span></td>
                <td>{state}</td>
                <td>{s.lastSuccessAt ? formatEt(s.lastSuccessAt) : "never"}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </section>

      <section className="section" id="connections">
        <h2>Your accounts</h2>
        <div className="grid2">
          {(["google", "twitch"] as const).map((p) => {
            const c = conns.find((x) => x.provider === p);
            const label = p === "google" ? "YouTube (Google)" : "Twitch";
            const ready = isConfigured(p === "google" ? "youtube_analytics" : "twitch_user");
            return (
              <div key={p} className="card">
                <h3>{label}</h3>
                {c ? (
                  <>
                    <p className="muted">Connected{c.accountName ? ` as ${c.accountName}` : ""} · {relTime(c.connectedAt)}</p>
                    {c.lastError && <p style={{ color: "var(--warn)", fontSize: "0.82rem" }}>{c.lastError}</p>}
                    <form action={disconnectOAuth}><input type="hidden" name="provider" value={p} /><Submit className="ghost">Disconnect</Submit></form>
                  </>
                ) : ready ? <a className="btn primary" href={`/api/oauth/${p}/start`}>Connect {label}</a> : <p className="faint">{SETUP_HINT[p === "google" ? "youtube_analytics" : "twitch_user"]}</p>}
              </div>
            );
          })}
        </div>
        <p className="notice">Read-only access. Tokens are encrypted in the database and never sent to the browser. TikTok and Instagram connections need developer apps with app review first (see docs/FEASIBILITY.md).</p>
      </section>

      <section className="section" id="import">
        <h2>Import research</h2>
        <form action={importAction} className="card">
          <label>Source<select name="source">{Object.entries(MANUAL_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>One per line<textarea name="text" rows={6} placeholder={"gta 6 leaks\nfanum tax, 12000\nhttps://www.tiktok.com/@user/video/123 | 45k | caption or title\nhttps://www.youtube.com/watch?v=..."} /></label>
          <p className="notice">YouTube links are looked up through the official API. Everything else is saved as you typed it and labeled "import". Numbers you add are shown as yours, not verified.</p>
          <Submit className="primary">Import</Submit>
        </form>
      </section>

      <section className="section" id="notifications">
        <h2>Notifications</h2>
        <div className="card">
          <PushControls publicKey={process.env.VAPID_PUBLIC_KEY ?? ""} devices={subs[0].n} />
          <form action={testPush}><Submit>Send test notification</Submit></form>
        </div>
        <form action={saveNotifications} className="card">
          <div className="row">
            {(["opportunity", "briefing", "system"] as const).map((k) => (
              <label key={k} className="row" style={{ color: "var(--text)" }}><input type="checkbox" name={`cat_${k}`} defaultChecked={notif.categories[k]} style={{ width: "auto" }} />{k === "opportunity" ? "High-fit opportunities" : k === "briefing" ? "Briefings" : "System alerts"}</label>
            ))}
          </div>
          <div className="grid2">
            <label>Quiet from (ET)<input name="quietStart" defaultValue={notif.quietStart} /></label>
            <label>Quiet until (ET)<input name="quietEnd" defaultValue={notif.quietEnd} /></label>
            <label>Only push ideas scoring at least<input name="threshold" inputMode="numeric" defaultValue={notif.opportunityThreshold} /></label>
            <label>Max opportunity pushes per day<input name="maxPushes" inputMode="numeric" defaultValue={notif.maxOpportunityPushesPerDay} /></label>
          </div>
          <p className="notice">Morning briefing: 8:00 AM ET. Trend refresh: every {budgets.trendsRefreshMinutes} min. Creator refresh: every {budgets.creatorRefreshHours}h.</p>
          <Submit className="primary">Save</Submit>
        </form>
      </section>

      <section className="section" id="audience">
        <h2>Ideal Viewer Profile</h2>
        <form action={saveProfile} className="card">
          <label>Who you're making content for<textarea name="summary" defaultValue={profile.summary} /></label>
          <label>Topics (one per line, "topic: keyword, keyword")<textarea name="topics" rows={7} defaultValue={Object.entries(profile.topics).map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n")} /></label>
          <label>Music artists<textarea name="musicArtists" defaultValue={profile.musicArtists.join(", ")} /></label>
          <label>Skip topics containing<input name="exclude" defaultValue={profile.exclude.join(", ")} /></label>
          <Submit className="primary">Save profile</Submit>
        </form>
      </section>

      <section className="section" id="costs">
        <h2>Costs and budgets</h2>
        <div className="card">
          <ul className="clean">
            <li>Claude this month: ${aiMonth.toFixed(4)} of ${ai.monthlyCapUsd.toFixed(2)} cap {isConfigured("claude") ? "" : <span className="faint">(no key set, rules generator in use, $0)</span>}</li>
            <li>YouTube quota today: {ytToday?.units ?? 0} of {budgets.youtubeDailyUnits} units (Google's free limit is 10,000; resets midnight Pacific)</li>
            <li>Twitch requests today: {twToday?.requests ?? 0} of {budgets.twitchDailyRequests}</li>
            <li className="faint">Everything else is free. Railway hosting is billed by Railway separately.</li>
          </ul>
        </div>
        <form action={saveAi} className="card">
          <h3>AI idea writing</h3>
          <label className="row" style={{ color: "var(--text)" }}><input type="checkbox" name="enabled" defaultChecked={ai.enabled} style={{ width: "auto" }} />Use Claude when a key is set</label>
          <div className="grid2">
            <label>Model<input name="model" defaultValue={ai.model} /></label>
            <label>Monthly cap (USD)<input name="cap" inputMode="decimal" defaultValue={ai.monthlyCapUsd} /></label>
            <label>Ideas per run<input name="maxIdeas" inputMode="numeric" defaultValue={ai.maxIdeasPerRun} /></label>
          </div>
          <Submit>Save</Submit>
        </form>
        <form action={saveBudgets} className="card">
          <h3>API budgets</h3>
          <div className="grid2">
            <label>YouTube units/day<input name="yt" inputMode="numeric" defaultValue={budgets.youtubeDailyUnits} /></label>
            <label>Twitch requests/day<input name="tw" inputMode="numeric" defaultValue={budgets.twitchDailyRequests} /></label>
            <label>Trend refresh (minutes)<input name="trendsMin" inputMode="numeric" defaultValue={budgets.trendsRefreshMinutes} /></label>
            <label>Creator refresh (hours)<input name="creatorHours" inputMode="numeric" defaultValue={budgets.creatorRefreshHours} /></label>
          </div>
          <Submit>Save</Submit>
        </form>
      </section>

      <section className="section" id="logs">
        <h2>Background jobs</h2>
        <div className="scroll-x"><table>
          <thead><tr><th>Job</th><th>When</th><th>Result</th></tr></thead>
          <tbody>{jobs.map((j) => <tr key={j.id}><td>{j.job}</td><td>{formatEt(j.startedAt)}</td><td><span className={`badge ${j.status === "ok" ? "good" : j.status === "error" ? "bad" : ""}`}>{j.status}</span> <span className="faint">{j.message}</span></td></tr>)}</tbody>
        </table></div>
        <h2>Error log</h2>
        {logs.length ? (
          <ul className="clean">{logs.map((l) => <li key={l.id} style={{ fontSize: "0.8rem" }}><span className={`badge ${l.level === "error" ? "bad" : l.level === "warn" ? "warn" : ""}`}>{l.provider}</span> <span className="faint">{formatEt(l.createdAt)}</span> {l.message}</li>)}</ul>
        ) : <p className="faint">No errors logged.</p>}
      </section>
    </main>
  );
}
