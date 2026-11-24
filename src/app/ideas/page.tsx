import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { IDEA_STATUSES } from "@/db/schema";
import { saveIdea, setIdeaStatus } from "../actions";
import { Empty, Flash, Header } from "@/components/ui";
import { Submit } from "@/components/Submit";
import { relTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function Ideas({ searchParams }: { searchParams: Promise<{ msg?: string; q?: string; status?: string }> }) {
  const { msg, q, status } = await searchParams;
  const conds: SQL[] = [];
  if (status && (IDEA_STATUSES as readonly string[]).includes(status)) conds.push(eq(schema.ideas.status, status));
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(schema.ideas.title, like), ilike(schema.ideas.notes, like), ilike(schema.ideas.script, like), ilike(schema.ideas.format, like))!);
  }
  const ideas = await db.select().from(schema.ideas).where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.ideas.updatedAt)).limit(200);
  const counts = await db.select({ status: schema.ideas.status, n: sql<number>`count(*)::int` }).from(schema.ideas).groupBy(schema.ideas.status);
  const count = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;

  return (
    <main className="wrap">
      <Header title="Idea library" sub={`${counts.reduce((a, c) => a + c.n, 0)} ideas`} />
      <Flash msg={msg} />
      <form className="inline" action="/ideas">
        <input name="q" placeholder="Search titles, notes, scripts" defaultValue={q ?? ""} />
        {status && <input type="hidden" name="status" value={status} />}
        <button>Search</button>
      </form>
      <div className="strip">
        <a className={`badge ${!status ? "navy" : ""}`} href={q ? `/ideas?q=${encodeURIComponent(q)}` : "/ideas"}>All</a>
        {IDEA_STATUSES.map((s) => (
          <a key={s} className={`badge ${status === s ? "navy" : ""}`} href={`/ideas?status=${encodeURIComponent(s)}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>{s} {count(s)}</a>
        ))}
      </div>

      {ideas.length ? (
        <div className="stack" style={{ gap: 8 }}>
          {ideas.map((i) => {
            const next = IDEA_STATUSES[IDEA_STATUSES.indexOf(i.status as (typeof IDEA_STATUSES)[number]) + 1];
            return (
              <div key={i.id} className="card" style={{ padding: 12 }}>
                <div className="row between">
                  <a href={`/ideas/${i.id}`}><h3>{i.title}</h3></a>
                  <span className="badge navy">{i.status}</span>
                </div>
                <div className="row">
                  {i.format && <span className="badge">{i.format}</span>}
                  {i.platforms.map((p) => <span key={p} className="badge">{p}</span>)}
                  <span className="faint" style={{ fontSize: "0.75rem" }}>updated {relTime(i.updatedAt)}</span>
                </div>
                {next && (
                  <form action={setIdeaStatus}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="status" value={next} /><Submit className="ghost">Move to {next}</Submit></form>
                )}
              </div>
            );
          })}
        </div>
      ) : <Empty>No ideas match. Save one from Today, or add your own below.</Empty>}

      <form action={saveIdea} className="card">
        <h2>Add your own idea</h2>
        <label>Title<input name="title" required /></label>
        <label>Format<input name="format" placeholder="e.g. Reaction, Ranking, GTA RP, IRL" /></label>
        <label>Notes<textarea name="notes" /></label>
        <input type="hidden" name="status" value="Researching" />
        <Submit className="primary">Add idea</Submit>
      </form>
    </main>
  );
}
