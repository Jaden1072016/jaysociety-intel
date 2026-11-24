import { requireAuth } from "@/lib/auth";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { addCreator } from "../actions";
import { Flash, Header, RefreshButton } from "@/components/ui";
import { Submit } from "@/components/Submit";
import { relTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function Creators({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  await requireAuth();
  const { msg } = await searchParams;
  const creators = await db.select().from(schema.creators).where(eq(schema.creators.isSelf, false)).orderBy(asc(schema.creators.priority), asc(schema.creators.name));
  const accounts = await db.select().from(schema.creatorAccounts);

  return (
    <main className="wrap">
      <Header title="Creators" sub="Watchlist"><RefreshButton job="creators" label="Refresh all" returnTo="/creators" /></Header>
      <Flash msg={msg} />
      <p className="muted" style={{ fontSize: "0.88rem" }}>
        Only accounts you confirm are tracked. Names collide (there's more than one "Raud" and "Max" online), so each lookup shows the platform's name and follower count before you confirm.
      </p>
      <div className="stack" style={{ gap: 10 }}>
        {creators.map((c) => {
          const accs = accounts.filter((a) => a.creatorId === c.id);
          const confirmed = accs.filter((a) => a.verified).length;
          const needs = accs.filter((a) => !a.verified && (a.platform === "youtube" || a.platform === "twitch")).length;
          const last = accs.map((a) => a.lastFetchedAt).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0];
          return (
            <a key={c.id} href={`/creators/${c.id}`} className="card" style={{ color: "inherit" }}>
              <div className="row between">
                <h3>{c.name}{!c.active && <span className="faint"> (paused)</span>}</h3>
                <div className="row">
                  {c.tags.map((t) => <span key={t} className="badge navy">{t}</span>)}
                  {confirmed === 0 && accs.length > 0 && <span className="badge">candidate</span>}
                  {confirmed > 0 && <span className="badge good">{confirmed} confirmed</span>}
                  {needs > 0 && <span className="badge warn">{needs} to confirm</span>}
                  {accs.length === 0 && <span className="badge warn">no accounts</span>}
                </div>
              </div>
              <span className="faint" style={{ fontSize: "0.78rem" }}>
                {accs.map((a) => `${a.platform}: ${a.handle}`).join(" · ") || "Add accounts"}{last ? ` · refreshed ${relTime(last)}` : ""}
              </span>
            </a>
          );
        })}
      </div>
      <form action={addCreator} className="card">
        <h2>Add a creator</h2>
        <div className="grid2">
          <label>Name<input name="name" required /></label>
          <label>Priority<select name="priority" defaultValue="2"><option value="1">1 (highest)</option><option value="2">2</option><option value="3">3</option></select></label>
        </div>
        <label>How to tell them apart<input name="disambiguation" placeholder="e.g. Philly streamer, real name..., not the musician" /></label>
        <label>Notes<input name="notes" /></label>
        <Submit className="primary">Add</Submit>
      </form>
    </main>
  );
}
