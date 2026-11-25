import { requireAuth } from "@/lib/auth";
import { timingReport } from "@/engine/timing";
import { KIND_LABEL } from "@/analysis/timing";
import { Header } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Timing() {
  await requireAuth();
  const { creators, own } = await timingReport();
  return (
    <main className="wrap">
      <Header title="When to post" sub="Eastern time" />
      <section className="card feature">
        <div className="row between"><h2>Your own results</h2><span className="badge navy">{own.basis === "own" ? "Your data" : "Not enough of your data yet"}</span></div>
        <p>{own.basis === "own" ? own.headline : "Once about 12 of your posts have results, your own best window shows here and takes priority over creator patterns."}</p>
      </section>
      {creators.map((r) => (
        <section key={r.kind} className="card">
          <div className="row between">
            <h2>{KIND_LABEL[r.kind]}</h2>
            {r.pick && <span className={`badge ${r.pick.confidence === "usable" ? "good" : "warn"}`}>{r.pick.confidence}</span>}
          </div>
          {r.pick ? (
            <>
              <p style={{ fontSize: "1.15rem" }}><strong>Start with {r.pick.block}{r.pick.tiedWith.length ? ` (or ${r.pick.tiedWith.join(", ")})` : ""}</strong>{r.topDays.length ? ` · busiest days ${r.topDays.map((d) => d.day).join(", ")}` : ""}</p>
              <p className="muted" style={{ fontSize: "0.88rem" }}>{r.pick.reason}</p>
              {r.avoid.length > 0 && <p style={{ fontSize: "0.88rem" }}><strong>Avoid:</strong> {r.avoid.join(", ")} (clearly below creators' usual)</p>}
            </>
          ) : <p className="muted">{r.note}</p>}
          <div className="scroll-x"><table>
            <thead><tr><th>Window (ET)</th><th>Creator activity</th><th>Creators</th><th>vs their usual</th></tr></thead>
            <tbody>{r.blocks.map((b) => (
              <tr key={b.block}>
                <td>{b.block}</td>
                <td><span className="bar" style={{ display: "inline-block", width: 80, verticalAlign: "middle" }}><i style={{ width: `${Math.min(100, b.creatorShare * 2)}%` }} /></span> {b.creatorShare}%</td>
                <td>{b.creators}</td>
                <td>{b.medianRatio != null ? `${b.medianRatio}x (${b.ratedPosts} posts)` : <span className="faint">need more data ({b.ratedPosts})</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="notice">{r.posts} posts from {r.creators} creators, last 60 days. {r.note}</p>
        </section>
      ))}
      <p className="notice">Timing shows association only. Topic, title and thumbnail matter more than the clock. Test a window for 2–3 weeks against another before locking it in.</p>
    </main>
  );
}
