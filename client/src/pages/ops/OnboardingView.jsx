// ONBOARD-2 · /ops, the Onboarding tab. Draws GET /ops/onboarding: the line at
// the top (billing, onboarding, stuck, and MRR now and at the first charge
// dates), then one row per customer org with its stage as five dots, days in
// it, the next action, the first charge date and MRR. A deal past its window
// is marked in brass (overdue is brass in Steward; red is only a destructive
// confirm). Clicking a row opens its checklist: every gate and its evidence,
// and the two facts Jonathan types (the verbal-yes date and "Waiting on").
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { countLabel } from "../../../../shared/countWords.js";
import DateInput from "../../components/inputs/LazyDateInput";   // POLISH-6: the one date box

const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6", EMERALD = "#0D5C3A", BRASS = "#C9A84C";
const FIVE = ["paper", "data", "connections", "kickoff", "first_month"];
const card = { background: WHITE, borderRadius: 12, padding: "18px 20px", marginBottom: 16, border: `1px solid ${INK}14` };
const says = { fontSize: 13, opacity: 0.72, margin: "0 0 10px" };
const cell = { padding: "10px 12px 10px 0", fontSize: 13.5, verticalAlign: "top", borderTop: `1px solid ${CREAM}` };
const usd = c => `$${(Number(c || 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : "–"; };

function Dots({ row }) {
  return <span aria-label={`Stage: ${row.title}`} data-onb-dots={row.stage} style={{ display: "inline-flex", gap: 5 }}>
    {FIVE.map((s, i) => {
      const done = row.gates[s].met, cur = row.stage === s;
      return <span key={s} title={s} style={{ width: 11, height: 11, borderRadius: "50%", boxSizing: "border-box",
        background: done ? EMERALD : cur && row.red ? `${BRASS}88` : "transparent",
        border: `1.5px ${cur && !done ? (row.red ? "solid" : "dashed") : "solid"} ${cur && row.red ? BRASS : cur ? INK : EMERALD}` }} data-i={i} />;
    })}
  </span>;
}

function Gate({ id, title, g }) {
  const parts = g.parts || [];
  return <div style={{ padding: "10px 0", borderTop: `1px solid ${CREAM}` }} data-onb-gate={id}>
    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      <span style={{ fontWeight: 700, fontSize: 14 }}>{title}</span>
      <span style={{ fontSize: 12, fontWeight: 600, padding: "1px 8px", borderRadius: 10, background: g.met ? EMERALD : WHITE, color: g.met ? WHITE : INK, border: g.met ? 0 : `1px solid ${INK}33` }}>{g.met ? `met ${dayWords(g.day || g.at)}` : "not yet"}</span>
    </div>
    {g.evidence ? <div style={{ fontSize: 13, marginTop: 4 }}>{g.evidence}</div> : null}
    {g.card ? <div style={{ fontSize: 13, marginTop: 2 }}>{g.card}</div> : null}
    {parts.map(p => <div key={p.key} style={{ fontSize: 13, marginTop: 4, display: "flex", gap: 6 }}>
      <span aria-hidden style={{ color: p.ok ? EMERALD : BRASS, fontWeight: 700 }}>{p.ok ? "✓" : "•"}</span>
      <span><b>{p.label}:</b> {p.says}</span></div>)}
  </div>;
}

function Detail({ orgId, onSaved }) {
  const [row, setRow] = useState(null);
  const [err, setErr] = useState(null);
  const [waiting, setWaiting] = useState("");
  const [yes, setYes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    apiFetch(`/ops/onboarding/${encodeURIComponent(orgId)}`).then(d => { setRow(d.row); setWaiting(d.row.waitingOn || ""); setYes(d.row.verbalYesOn || ""); })
      .catch(() => setErr("This org's checklist could not be read."));
  }, [orgId]);
  if (err) return <p style={says}>{err}</p>;
  if (!row) return <p style={says}>Reading the checklist…</p>;
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const d = await apiFetch(`/ops/onboarding/${encodeURIComponent(orgId)}`, { method: "POST", body: JSON.stringify({ waitingOn: waiting, verbalYesOn: yes || null }) });
      setRow(d.row); setMsg("Saved. The stage still moves on signals alone."); onSaved && onSaved();
    } catch (e) { setMsg((e && e.message) || "That did not save."); }
    setBusy(false);
  };
  const box = { fontSize: 13, padding: "6px 8px", border: `1px solid ${INK}33`, borderRadius: 6, fontFamily: "inherit", background: WHITE, color: INK };
  return <div data-onb-detail={orgId} style={{ background: CREAM, borderRadius: 10, padding: "12px 16px", margin: "4px 0 10px" }}>
    {row.redWhy ? <p style={{ ...says, opacity: 1 }}><b style={{ color: INK, background: `${BRASS}55`, padding: "1px 6px", borderRadius: 6 }}>Past its window</b> {row.redWhy}</p> : null}
    <Gate id="paper" title="1 · Paper" g={row.gates.paper} />
    <Gate id="data" title="2 · Data in" g={row.gates.data} />
    <Gate id="connections" title="3 · Connections" g={row.gates.connections} />
    <Gate id="kickoff" title="4 · Kickoff" g={row.gates.kickoff} />
    <Gate id="first_month" title="5 · First month" g={row.gates.first_month} />
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", paddingTop: 12, borderTop: `1px solid ${INK}1a` }}>
      <label style={{ fontSize: 12, fontWeight: 600, display: "flex", flexDirection: "column", gap: 4 }}>Verbal yes on
        <DateInput value={yes} onChange={e => setYes(e.target.value)} style={box} data-onb-yes="1" aria-label="Verbal yes on" /></label>
      <label style={{ fontSize: 12, fontWeight: 600, display: "flex", flexDirection: "column", gap: 4, flex: "1 1 260px" }}>Waiting on
        <input value={waiting} onChange={e => setWaiting(e.target.value)} maxLength={200} placeholder="e.g. their email tool and grant system" style={box} data-onb-waiting="1" /></label>
      <button type="button" onClick={save} disabled={busy} data-onb-save="1"
        style={{ fontSize: 13, fontWeight: 700, padding: "7px 14px", borderRadius: 8, border: 0, background: EMERALD, color: WHITE, cursor: "pointer", fontFamily: "inherit", minHeight: 34 }}>{busy ? "Saving…" : "Save"}</button>
    </div>
    <p style={{ ...says, margin: "8px 0 0" }}>{msg || "These two are typed by hand. Every stage is read from what happened: a signature and a card, an accepted import, live connections, a logged call, a first gift and a paid invoice."}</p>
  </div>;
}

export default function OnboardingView({ data, error, onReload }) {
  const [open, setOpen] = useState(null);
  if (error) return <section style={card}><p style={says}>{error}</p></section>;
  if (!data) return <section style={card}><p style={says}>Loading…</p></section>;
  if (!data.ok) return <section style={card}><p style={says}>{data.error}</p></section>;
  const s = data.summary;
  return <div data-testid="ops-onboarding">
    <section style={{ ...card, background: INK, color: WHITE }}>
      <div data-onb-summary="1" style={{ fontSize: 20, fontWeight: 700 }}>Billing: {s.billing} · Onboarding: {s.onboarding} · Stuck: {s.stuck}</div>
      <p style={{ fontSize: 13, opacity: 0.85, margin: "6px 0 0" }}>
        MRR billing now <b data-onb-mrr-now="1">{usd(s.mrrNowCents)}</b> · at the first charge dates <b data-onb-mrr-at="1">{usd(s.mrrAtFirstChargeCents)}</b>.
        {" "}{s.sentences.mrrNow} {s.sentences.mrrAt}</p>
      <p style={{ fontSize: 12.5, opacity: 0.7, margin: "6px 0 0" }}>Stuck: {s.sentences.stuck}</p>
    </section>
    <section style={card}>
      <p style={says}>One row per customer org. The stage is the first gate not met, read from signals; nobody sets it. Days count on the stage's own clock: paper from the verbal yes, data from paper, kickoff and the first month from data in. Click a row for its checklist.</p>
      {data.rows.length === 0 ? <p style={says}>No customer org yet.</p> :
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>{["Org", "Stage", "Days", "Next action", "First charge", "MRR"].map(h => <th key={h} style={{ textAlign: "left", fontSize: 12, fontWeight: 600, opacity: 0.65, padding: "0 12px 8px 0" }}>{h}</th>)}</tr></thead>
          <tbody>
            {data.rows.flatMap(r => [
              <tr key={r.orgId} data-onb-row={r.orgId} data-stage={r.stage} data-red={r.red ? "1" : "0"} onClick={() => setOpen(o => (o === r.orgId ? null : r.orgId))}
                style={{ cursor: "pointer", background: r.red ? `${BRASS}22` : "transparent" }} aria-expanded={open === r.orgId}>
                <td style={{ ...cell, fontWeight: 700 }}>{r.name}{r.waitingOn ? <div style={{ fontWeight: 400, fontSize: 12.5, opacity: 0.75 }}>Waiting on: {r.waitingOn}</div> : null}</td>
                <td style={cell}><Dots row={r} /><div style={{ fontSize: 12, marginTop: 3 }}>{r.title}</div></td>
                <td style={cell} data-onb-days="1">{r.stage === "billing" ? "–" : r.daysInStage == null ? "–" : countLabel(r.daysInStage, "day")}</td>
                <td style={cell} data-onb-next="1">{r.red ? <span style={{ background: `${BRASS}55`, padding: "1px 6px", borderRadius: 6, fontWeight: 700, marginRight: 6 }}>late</span> : null}{r.next}</td>
                <td style={cell}>{r.firstChargeOn ? dayWords(r.firstChargeOn) : "–"}</td>
                <td style={cell}>{r.stage === "billing" ? usd(r.mrrNowCents) : r.mrrAgreedCents ? `${usd(r.mrrAgreedCents)} agreed` : "–"}</td>
              </tr>,
              open === r.orgId ? <tr key={r.orgId + ":d"}><td colSpan={6} style={{ padding: 0 }}><Detail orgId={r.orgId} onSaved={onReload} /></td></tr> : null,
            ])}
          </tbody>
        </table>}
    </section>
  </div>;
}
