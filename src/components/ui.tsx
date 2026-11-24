import { SCORE_DISCLAIMER, SCORE_LABELS } from "@/engine/scoring";
import type { Evidence, Scores } from "@/db/schema";
import { relTime } from "@/lib/time";
import { dismissOpportunity, saveOpportunity, refreshJob } from "@/app/actions";
import { Submit } from "./Submit";

export function Flash({ msg }: { msg?: string }) {
  return msg ? <div className="flash" role="status">{msg}</div> : null;
}

export function Header({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <header className="head">
      <div className="brand">
        <img src="/icons/icon-192.png" alt="" />
        <div><h1>{title}</h1>{sub && <span>{sub}</span>}</div>
      </div>
      <div className="row">{children}</div>
    </header>
  );
}

export function RefreshButton({ job, label, returnTo }: { job: string; label: string; returnTo: string }) {
  return (
    <form action={refreshJob}>
      <input type="hidden" name="job" value={job} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Submit className="ghost" pendingText="Refreshing…">{label}</Submit>
    </form>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ScoreBars({ scores }: { scores: Scores }) {
  return (
    <div className="bars">
      {(Object.keys(SCORE_LABELS) as (keyof Scores)[]).map((k) => (
        <Row key={k} label={SCORE_LABELS[k]} v={scores[k]} />
      ))}
    </div>
  );
}
function Row({ label, v }: { label: string; v: number }) {
  return (<><span>{label}</span><span className="bar"><i style={{ width: `${v * 10}%` }} /></span><span>{v}</span></>);
}

export function EvidenceList({ items }: { items: Evidence[] }) {
  return (
    <ul className="clean evidence">
      {items.map((e, i) => (
        <li key={i}>{e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer">{e.label}</a> : e.label}{e.observedAt && <span className="faint"> · {relTime(e.observedAt)}</span>}</li>
      ))}
    </ul>
  );
}

type Opp = {
  id: string; title: string; hook: string; concept: string; livestream: string | null; clips: string[]; platforms: string[];
  production: string | null; whyFits: string; evidence: Evidence[]; aiNotes: string | null; generator: string; scores: Scores;
  totalScore: number; status: string; createdAt: Date; ideaId: string | null; topic: string;
};

export function OpportunityCard({ o, feature }: { o: Opp; feature?: boolean }) {
  return (
    <article className={`card${feature ? " feature" : ""}`} id={`opp-${o.id}`}>
      <div className="row between">
        <div className="stack" style={{ flex: 1, minWidth: 200 }}>
          <span className="faint" style={{ fontSize: "0.75rem" }}>{o.topic}</span>
          <h2>{o.title}</h2>
        </div>
        <div className="stack" style={{ justifyItems: "end" }}>
          <span className="score" title={SCORE_DISCLAIMER}>{Math.round(o.totalScore)}</span>
          <span className="faint" style={{ fontSize: "0.68rem" }}>priority est.</span>
        </div>
      </div>
      <p>“{o.hook}”</p>
      <p className="muted" style={{ fontSize: "0.88rem" }}><strong style={{ color: "var(--text)" }}>Why it fits: </strong>{o.whyFits}</p>
      <div className="row">
        {o.platforms.map((p) => <span key={p} className="badge navy">{p}</span>)}
        <span className={`badge ${o.generator === "claude" ? "" : "warn"}`}>{o.generator === "claude" ? "Written by Claude" : "Template (no AI)"}</span>
      </div>
      <details>
        <summary>Evidence ({o.evidence.length})</summary>
        <div style={{ marginTop: 8 }}><EvidenceList items={o.evidence} /></div>
      </details>
      <details>
        <summary>Plan: concept, stream, clips</summary>
        <div className="stack" style={{ marginTop: 8, fontSize: "0.88rem" }}>
          <p><strong>Concept.</strong> {o.concept}</p>
          {o.livestream && <p><strong>Stream.</strong> {o.livestream}</p>}
          {o.clips.length > 0 && <p><strong>Clips.</strong> {o.clips.join(" · ")}</p>}
          {o.production && <p><strong>Production.</strong> {o.production}</p>}
          {o.aiNotes && <ul className="clean ai"><li className="muted">Suggestion notes (not evidence): {o.aiNotes}</li></ul>}
        </div>
      </details>
      <details>
        <summary>Score breakdown</summary>
        <div style={{ marginTop: 8 }} className="stack"><ScoreBars scores={o.scores} /><p className="notice">{SCORE_DISCLAIMER}</p></div>
      </details>
      <div className="row">
        {o.ideaId ? <a className="btn" href={`/ideas/${o.ideaId}`}>Open in library</a> : (
          <form action={saveOpportunity}><input type="hidden" name="id" value={o.id} /><Submit className="primary">Save to ideas</Submit></form>
        )}
        <form action={dismissOpportunity}><input type="hidden" name="id" value={o.id} /><Submit className="ghost">Not for me</Submit></form>
      </div>
    </article>
  );
}

type Status = { provider: string; label: string; configured: boolean; lastSuccessAt: Date | null; consecutiveFailures: number; lastError: string | null };

export function StatusStrip({ items }: { items: Status[] }) {
  return (
    <div className="strip" aria-label="Data freshness">
      {items.map((s) => {
        const cls = !s.configured ? "" : s.consecutiveFailures > 0 ? "bad" : s.lastSuccessAt ? "good" : "warn";
        const text = !s.configured ? "not set up" : s.consecutiveFailures > 0 ? s.lastSuccessAt ? `failing, last ok ${relTime(s.lastSuccessAt)}` : "failing" : s.lastSuccessAt ? relTime(s.lastSuccessAt) : "waiting";
        return <span key={s.provider} className={`badge ${cls}`} title={s.lastError ?? ""}>{s.label}: {text}</span>;
      })}
    </div>
  );
}
