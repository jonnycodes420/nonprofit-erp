// GrantAward.jsx · GRANTS-FIX. THE AWARD STEP AND THE FUNDER PICKER.
//
// Awarded means money is promised, and the promise is a pledge on the funder.
// Every move into Awarded (the board's drag, its stage select, the List view,
// the grant's own page) opens AwardStep: the amount awarded (the ask, to
// start), the payment schedule and the restriction. Confirming calls
// PUT /grants/:id/award, which writes the pledge; Cancel leaves the grant
// where it was. A grant with no funder record asks for the link first, then
// carries on to the award without anyone redoing the move.
//
// FunderPicker searches the org's organizations by name, then EIN, puts the
// exact-name match first, and offers "Add <name> as a new funder". Picking
// one keeps the grant's typed name and never renames the record.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";
import { RESTRICTIONS, statusLabel } from "../../../shared/grantShape";
import PledgeSchedule, { scheduleBody } from "./gifts/PledgeSchedule";   // GIFTS-1: the pledge form's own schedule

const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: T.ink, background: T.white, fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const lbl = { fontSize: 11.5, fontWeight: 700, color: T.ink3, marginBottom: 4, display: "block" };
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// The picker, on its own (the grant page's "Link to funder") or as the first
// step of the award.
export function FunderPicker({ grantId, typedName, onLinked, onClose, embedded = false }) {
  const [q, setQ] = useState(typedName || "");
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      apiFetch(`/grants/${grantId}/funder-search?q=${encodeURIComponent(q)}`).then(setR).catch(e => setMsg(errorMessage(e, "The search did not run.")));
    }, 200);
    return () => clearTimeout(t);
  }, [grantId, q]);
  const link = async body => {
    setBusy(true); setMsg("");
    try { const x = await apiFetch(`/grants/${grantId}/funder-link`, { method: "POST", body: JSON.stringify(body) }); onLinked(x); }
    catch (e) { setMsg((e && e.sentence) || errorMessage(e, "That link did not save.")); }
    setBusy(false);
  };
  const body = (
    <div data-testid="funder-picker" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: T.ink }}>Link to funder</div>
      <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5 }}>
        This grant names {typedName ? <b>{typedName}</b> : "a funder"}. Choose its organization record, so an award's pledge and every gift land on the funder. The grant keeps the name as typed.
      </div>
      <input aria-label="Search organizations" value={q} onChange={e => setQ(e.target.value)} placeholder="Name or EIN" style={inp} autoFocus />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
        {r && r.results.map(o => (
          <button key={o.id} type="button" disabled={busy} data-testid="funder-pick" onClick={() => link({ donorId: o.id })}
            style={{ ...btn(false), textAlign: "left", fontWeight: 600, display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{o.name}{o.city || o.state ? <span style={{ color: T.ink3, fontWeight: 400 }}> · {[o.city, o.state].filter(Boolean).join(", ")}</span> : null}{o.ein ? <span style={{ color: T.ink3, fontWeight: 400 }}> · EIN {o.ein}</span> : null}</span>
            {o.exact && <span style={{ color: T.greenDk, fontSize: 12 }}>Same name</span>}
          </button>))}
        {r && !r.results.length && <div style={{ fontSize: 12.5, color: T.ink3 }}>No organization on file matches “{q}”.</div>}
        {r && r.canCreate && (
          <button type="button" disabled={busy} data-testid="funder-create" onClick={() => link({ createName: r.createName })} style={{ ...btn(false), textAlign: "left", color: T.greenDk }}>
            Add “{r.createName}” as a new funder
          </button>)}
      </div>
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div>}
      {!embedded && <div><button type="button" style={btn(false)} onClick={onClose}>Cancel</button></div>}
    </div>);
  if (embedded) return body;
  return <Modal onClose={onClose} width={480} ariaLabel="Link to funder">{body}</Modal>;
}

// grant: { id, funderName, funderLinked, askCents }. target: the stage the
// person asked for (awarded, reporting or closed). onDone(result) after the
// award is written and, for a later stage, the grant is moved there.
export function AwardStep({ grant, target = "awarded", onDone, onClose }) {
  const [linked, setLinked] = useState(!!grant.funderLinked);
  const [funderName, setFunderName] = useState(grant.funderName || "");
  const [a, setA] = useState({ amount: grant.askCents ? (grant.askCents / 100).toFixed(2) : "", plan: "one", count: 2, frequency: "semiannual",
    firstDue: todayIso(), restriction: grant.restriction || "", restrictedUntil: grant.restrictedUntil || "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (k, v) => setA(p => ({ ...p, [k]: v }));
  const confirm = async () => {
    setBusy(true); setMsg("");
    try {
      const body = { amountAwarded: a.amount, firstDue: a.firstDue, restriction: a.restriction || undefined,
        restrictedUntil: a.restriction === "time_restricted" ? a.restrictedUntil : undefined };
      if (a.plan === "many") { const sb = scheduleBody(a); body.installmentCount = sb.installmentCount; body.frequency = sb.frequency; }
      const award = await apiFetch(`/grants/${grant.id}/award`, { method: "PUT", body: JSON.stringify(body) });
      let moved = null;
      if (target !== "awarded") moved = await apiFetch(`/grants/${grant.id}/stage`, { method: "PATCH", body: JSON.stringify({ status: target }) });
      onDone({ award, moved });
    } catch (e) {
      if (e && e.code === "funder_not_linked") { setLinked(false); setBusy(false); return; }
      setMsg((e && e.sentence) || errorMessage(e, "The award did not save."));
    }
    setBusy(false);
  };
  return (
    <Modal onClose={onClose} width={480} ariaLabel="Record the award">
      {!linked ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13, color: T.ink2 }}>Step 1 of 2. The award's pledge belongs to the funder, so link the grant first.</div>
          <FunderPicker embedded grantId={grant.id} typedName={grant.funderName} onClose={onClose}
            onLinked={x => { setFunderName(x.funderName); setLinked(true); }} />
          <div><button type="button" style={btn(false)} onClick={onClose}>Cancel</button></div>
        </div>
      ) : (
        <div data-testid="award-step" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: T.ink }}>Record the award from {funderName}</div>
          <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5 }}>
            This writes the promise as a pledge on {funderName}, paid as you set out below; each payment links itself when it arrives.
            {target !== "awarded" ? ` Then the grant moves to ${statusLabel(target)}.` : ""}
          </div>
          <label><span style={lbl}>Amount awarded ($)</span>
            <input aria-label="Amount awarded" inputMode="decimal" value={a.amount} onChange={e => set("amount", e.target.value)} style={inp} /></label>
          <div>
            <span style={lbl}>Payment schedule</span>
            <PledgeSchedule testid="award-schedule" amount={a.amount} firstLabel={a.plan === "many" ? "First payment" : "Payment due"}
              value={{ plan: a.plan, count: a.count, frequency: a.frequency, firstDue: a.firstDue }}
              onChange={sc => setA(p => ({ ...p, plan: sc.plan, count: sc.count, frequency: sc.frequency, firstDue: sc.firstDue }))} />
          </div>
          <label><span style={lbl}>Restriction</span>
            <select aria-label="Restriction" value={a.restriction} onChange={e => set("restriction", e.target.value)} style={inp}>
              <option value="">Not said</option>
              {RESTRICTIONS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
          {a.restriction === "time_restricted" && <label><span style={lbl}>Released on</span>
            <input aria-label="Released on" type="date" value={a.restrictedUntil} onChange={e => set("restrictedUntil", e.target.value)} style={inp} /></label>}
          {msg && <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={btn(true)} disabled={busy} onClick={confirm} data-testid="award-confirm">{busy ? "Saving…" : "Record the award"}</button>
            <button type="button" style={btn(false)} onClick={onClose}>Cancel</button>
          </div>
        </div>)}
    </Modal>);
}
