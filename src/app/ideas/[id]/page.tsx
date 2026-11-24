import { requireAuth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { IDEA_STATUSES } from "@/db/schema";
import { deleteIdea, saveIdea } from "../../actions";
import { EvidenceList, Flash, Header } from "@/components/ui";
import { Submit } from "@/components/Submit";
import { formatEt } from "@/lib/time";

export const dynamic = "force-dynamic";

const ALL_PLATFORMS = ["TikTok", "YouTube", "YouTube Shorts", "Twitch", "Instagram Reels", "X"];

export default async function IdeaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  await requireAuth();
  const { id } = await params;
  const { msg } = await searchParams;
  const [i] = await db.select().from(schema.ideas).where(eq(schema.ideas.id, id));
  if (!i) notFound();
  const [opp] = i.opportunityId ? await db.select().from(schema.opportunities).where(eq(schema.opportunities.id, i.opportunityId)) : [];
  const exps = await db.select().from(schema.experiments).where(eq(schema.experiments.status, "running"));
  const r = i.results ?? {};

  return (
    <main className="wrap">
      <Header title="Idea" sub={i.status} />
      <Flash msg={msg} />
      <form action={saveIdea} className="stack" style={{ gap: 14 }}>
        <input type="hidden" name="id" value={i.id} />
        <div className="card">
          <label>Title<input name="title" defaultValue={i.title} required /></label>
          <div className="grid2">
            <label>Status<select name="status" defaultValue={i.status}>{IDEA_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>Format (your label, used in weekly review)<input name="format" defaultValue={i.format ?? ""} placeholder="Reaction, Ranking, GTA RP..." /></label>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="row">
            {ALL_PLATFORMS.map((p) => (
              <label key={p} className="row" style={{ fontSize: "0.85rem", color: "var(--text)" }}>
                <input type="checkbox" name="platforms" value={p} defaultChecked={i.platforms.includes(p)} style={{ width: "auto" }} />{p}
              </label>
            ))}
          </fieldset>
          <label>Opening hook<input name="hook" defaultValue={i.hook ?? ""} /></label>
          <label>Notes<textarea name="notes" defaultValue={i.notes ?? ""} rows={6} /></label>
          <label>Script<textarea name="script" defaultValue={i.script ?? ""} rows={8} /></label>
          <label>Source links (one per line)<textarea name="sourceLinks" defaultValue={i.sourceLinks.join("\n")} /></label>
        </div>

        <div className="card">
          <h2>After publishing</h2>
          <label>Published URL<input name="publishedUrl" defaultValue={i.publishedUrl ?? ""} /></label>
          <div className="grid2">
            <label>Views<input name="r_views" inputMode="numeric" defaultValue={r.views ?? ""} /></label>
            <label>New follows/subs<input name="r_follows" inputMode="numeric" defaultValue={r.follows ?? ""} /></label>
            <label>Likes<input name="r_likes" inputMode="numeric" defaultValue={r.likes ?? ""} /></label>
            <label>Comments<input name="r_comments" inputMode="numeric" defaultValue={r.comments ?? ""} /></label>
            <label>Avg watch time (sec)<input name="r_avgWatchSec" inputMode="numeric" defaultValue={r.avgWatchSec ?? ""} /></label>
          </div>
          <label>What you learned<textarea name="r_notes" defaultValue={r.notes ?? ""} /></label>
          <p className="notice">Enter numbers from the platform's own analytics. Leave blank if you don't have them; blanks show as unavailable, never as zero.</p>
          {i.publishedAt && <span className="faint">Published {formatEt(i.publishedAt)}</span>}
        </div>

        <div className="card">
          <h2>Experiment</h2>
          <div className="grid2">
            <label>Experiment<select name="experimentId" defaultValue={i.experimentId ?? ""}><option value="">None</option>{exps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
            <label>Arm<select name="experimentArm" defaultValue={i.experimentArm ?? ""}><option value="">-</option><option value="A">A</option><option value="B">B</option></select></label>
          </div>
        </div>

        <Submit className="primary">Save</Submit>
      </form>

      {opp && (
        <section className="card">
          <h2>Original research</h2>
          <p className="muted" style={{ fontSize: "0.85rem" }}>{opp.whyFits}</p>
          <EvidenceList items={opp.evidence} />
          {opp.aiNotes && <p className="notice">Suggestion notes (not evidence): {opp.aiNotes}</p>}
        </section>
      )}
      <form action={deleteIdea}><input type="hidden" name="id" value={i.id} /><Submit className="ghost">Delete idea</Submit></form>
    </main>
  );
}
