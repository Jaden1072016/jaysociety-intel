import { requireAuth } from "@/lib/auth";
import { desc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { addAccount, deleteCreator, removeAccount, resolveAccountAction, setVerified, updateCreator } from "../../actions";
import { Empty, Flash, Header } from "@/components/ui";
import { Submit } from "@/components/Submit";
import { perfLabel } from "@/analysis/performance";
import { formatLabel, formatLift } from "@/analysis/formats";
import { formatEt, relTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function CreatorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  await requireAuth();
  const { id } = await params;
  const { msg } = await searchParams;
  const [c] = await db.select().from(schema.creators).where(eq(schema.creators.id, id));
  if (!c) notFound();
  const accs = await db.select().from(schema.creatorAccounts).where(eq(schema.creatorAccounts.creatorId, id));
  const vids = accs.length ? await db.select().from(schema.videos).where(inArray(schema.videos.accountId, accs.map((a) => a.id))).orderBy(desc(schema.videos.publishedAt)).limit(60) : [];
  const lift = formatLift(vids).filter((l) => !["caps_hook", "question_title"].includes(l.format));

  return (
    <main className="wrap">
      <Header title={c.name} sub={c.isSelf ? "You" : `Priority ${c.priority}`} />
      <Flash msg={msg} />
      {c.disambiguation && <p className="muted">{c.disambiguation}</p>}

      <section className="section">
        <h2>Accounts</h2>
        {accs.map((a) => (
          <div key={a.id} className="card">
            <div className="row between">
              <div className="stack">
                <strong>{a.platform}: {a.handle}</strong>
                {a.displayName ? (
                  <span className="muted" style={{ fontSize: "0.85rem" }}>
                    Platform says: <a href={a.url ?? "#"} target="_blank" rel="noopener noreferrer">{a.displayName}</a>
                    {a.followerCount != null && ` · ${a.followerCount.toLocaleString()} ${a.platform === "youtube" ? "subscribers" : "followers"}`}
                    {a.externalId && <span className="faint"> · id {a.externalId}</span>}
                  </span>
                ) : a.resolveError ? <span style={{ color: "var(--warn)", fontSize: "0.85rem" }}>{a.resolveError}</span> : <span className="faint">Not looked up yet</span>}
              </div>
              {a.verified ? <span className="badge good">Confirmed</span> : <span className="badge warn">Unconfirmed</span>}
            </div>
            <div className="row">
              {(a.platform === "youtube" || a.platform === "twitch") && !a.verified && a.externalId && (
                <form action={setVerified}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="creatorId" value={id} /><input type="hidden" name="verified" value="1" /><Submit className="primary">Yes, this is them</Submit></form>
              )}
              {a.verified && !c.isSelf && (
                <form action={setVerified}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="creatorId" value={id} /><input type="hidden" name="verified" value="0" /><Submit className="ghost">Unconfirm</Submit></form>
              )}
              {(a.platform === "youtube" || a.platform === "twitch") && (
                <form action={resolveAccountAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="creatorId" value={id} /><Submit className="ghost">Look up again</Submit></form>
              )}
              {!c.isSelf && <form action={removeAccount}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="creatorId" value={id} /><Submit className="ghost">Remove</Submit></form>}
            </div>
            {a.lastFetchedAt && <span className="faint" style={{ fontSize: "0.75rem" }}>Last refreshed {relTime(a.lastFetchedAt)}</span>}
            {!["youtube", "twitch"].includes(a.platform) && <span className="notice">No permitted automatic access for {a.platform}. Paste their video links into Import to analyze them.</span>}
          </div>
        ))}
        {!c.isSelf && (
          <form action={addAccount} className="card">
            <input type="hidden" name="creatorId" value={id} />
            <div className="grid2">
              <label>Platform<select name="platform"><option>youtube</option><option>twitch</option><option>tiktok</option><option>instagram</option><option>x</option><option>kick</option></select></label>
              <label>Handle or profile URL<input name="handle" placeholder="@handle or https://..." required /></label>
            </div>
            <Submit>Add and look up</Submit>
          </form>
        )}
      </section>

      {lift.length > 0 && (
        <section className="section">
          <h2>Formats in their outperformers</h2>
          <ul className="clean">{lift.map((l) => <li key={l.format}>{formatLabel(l.format)}: {l.outliers} outperformers, {l.lift}x its usual share <span className="faint">(from titles only)</span></li>)}</ul>
        </section>
      )}

      <section className="section">
        <h2>Recent videos</h2>
        {vids.length ? (
          <div className="scroll-x"><table>
            <thead><tr><th>Video</th><th>Posted (ET)</th><th>Views</th><th>vs their usual</th></tr></thead>
            <tbody>{vids.map((v) => (
              <tr key={v.id}>
                <td><a href={v.url} target="_blank" rel="noopener noreferrer">{v.title}</a><div className="faint">{v.platform} · {v.format}{v.formats.length ? ` · ${v.formats.map(formatLabel).join(", ")}` : ""}</div></td>
                <td>{formatEt(v.publishedAt)}</td>
                <td>{v.latestViews?.toLocaleString() ?? "n/a"}</td>
                <td title={v.perfBasis ?? ""}>{perfLabel(v.perfRatio, v.perfConfidence ?? "none")}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>No videos yet. Confirm an account, then refresh.</Empty>}
        <p className="notice">"vs their usual" compares to this creator's own videos of the same type at a similar age. It shows what's working for them, not why, and posting time alone doesn't explain a hit.</p>
      </section>

      {!c.isSelf && (
        <details className="card">
          <summary>Edit creator</summary>
          <form action={updateCreator} className="stack" style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={id} />
            <label>Name<input name="name" defaultValue={c.name} /></label>
            <label>Priority<select name="priority" defaultValue={String(c.priority)}><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
            <label>How to tell them apart<input name="disambiguation" defaultValue={c.disambiguation ?? ""} /></label>
            <label>Notes<textarea name="notes" defaultValue={c.notes ?? ""} /></label>
            <label className="row"><input type="checkbox" name="active" defaultChecked={c.active} style={{ width: "auto" }} /> Active</label>
            <Submit className="primary">Save</Submit>
          </form>
          <form action={deleteCreator} style={{ marginTop: 10 }}><input type="hidden" name="id" value={id} /><Submit className="ghost">Delete creator</Submit></form>
        </details>
      )}
    </main>
  );
}
