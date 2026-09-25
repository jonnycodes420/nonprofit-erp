import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api";
import { T, fmtFull, EmptyState, interactive, Modal, Spin } from "./shared";
import { errorMessage } from "../lib/domainError";

// ── Major gifts (BUILD-99) ──────────────────────────────────────────────────
// Moves management on top of the stages Steward already has, for the
// organisation with a development officer and a portfolio.
//
// EVERY NUMBER ON THIS SCREEN CARRIES ITS SENTENCE, and the sentence comes from
// the SERVER (shared/proposalShape.js writes it) rather than being composed
// again here — a figure and its definition drifting apart is how a board report
// goes wrong. The weighted total is the one that matters: it counts only the
// probabilities she set by hand, and says how many it left out.
//
// NOTHING HERE DECIDES A DONOR'S CAPACITY. There is no scoring, no inferred
// ask amount, no suggested probability.

const STAGE_TINT = {
  identified:  { bg: T.bg2, fg: T.ink2 },
  cultivating: { bg: T.gold100, fg: T.gold700 },
  asked:       { bg: T.gold100, fg: T.gold700 },
  committed:   { bg: T.green100, fg: T.greenDk },
  declined:    { bg: T.terra100, fg: T.terra700 },
  stewarding:  { bg: T.green100, fg: T.greenDk },
};

function StageChip({ stage, label }) {
  const t = STAGE_TINT[stage] || STAGE_TINT.identified;
  return (
    <span style={{ background: t.bg, color: t.fg, borderRadius: 99, padding: "3px 10px", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>{label}</span>
  );
}

// A tile is a figure and a sentence. The sentence is on hover AND readable by a
// screen reader (title + aria-label), the BUILD-86 C.3 rule.
function Tile({ label, value, sentence, onClick, active, testid }) {
  return (
    <div data-testid={testid} {...interactive(onClick, { label: `${label}: ${value}. ${sentence}` })} title={sentence}
      style={{ background: active ? T.gold100 : T.white, border: "1px solid " + (active ? T.gold500 : T.bg3),
               borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3 }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif", lineHeight: 1.05 }}>{value}</span>
      <span style={{ fontSize: 11, color: T.ink3, lineHeight: 1.4 }}>{sentence}</span>
    </div>
  );
}

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;
function niceDate(s) {
  if (!CIVIL.test(String(s || ""))) return "no date";
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// ── THE FORM ────────────────────────────────────────────────────────────────
// Purpose, ask amount, expected close, stage, probability from the fixed list,
// fund, officer, notes. The probability select's blank option is a real answer
// ("not set yet"), which is why the weighted total has to say how many are
// missing rather than guessing at them.
function ProposalForm({ open, onClose, onSaved, meta, donorId, existing, donorName }) {
  const [f, setF] = useState(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErr("");
    setF(existing ? {
      purpose: existing.purpose || "", askAmount: String(existing.askAmount ?? ""),
      expectedClose: existing.expectedClose || "", stage: existing.stage,
      probability: existing.probability == null ? "" : String(existing.probability),
      fundId: existing.fundId || "", officerId: existing.officerId || "", notes: existing.notes || "",
    } : {
      purpose: "", askAmount: "", expectedClose: "", stage: "identified",
      probability: "", fundId: "", officerId: "", notes: "",
    });
  }, [open, existing]);
  if (!open || !f) return null;
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const body = {
        purpose: f.purpose, askAmount: f.askAmount, expectedClose: f.expectedClose,
        stage: f.stage, probability: f.probability === "" ? null : Number(f.probability),
        fundId: f.fundId || null, notes: f.notes,
      };
      if (f.officerId) body.officerId = f.officerId;
      if (existing) await apiFetch(`/proposals/${existing.id}`, { method: "PUT", body: JSON.stringify(body) });
      else await apiFetch(`/donors/${donorId}/proposals`, { method: "POST", body: JSON.stringify(body) });
      onSaved();
      onClose();
    } catch (e) { setErr(errorMessage(e, "That proposal could not be saved.")); }
    setSaving(false);
  };

  const lbl = { fontSize: 11, fontWeight: 700, color: T.ink2, display: "block", marginBottom: 4 };
  const inp = { width: "100%", padding: "9px 11px", border: "1px solid " + T.bg3, borderRadius: 9, fontSize: 13, background: T.white, color: T.ink };

  return (
    <Modal onClose={onClose} title={existing ? "Edit this proposal" : `New proposal${donorName ? " — " + donorName : ""}`} width={560}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11, color: T.terra700 }}>{err}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 9, padding: "9px 16px", fontSize: 13, color: T.ink2, cursor: "pointer" }}>Cancel</button>
            <button onClick={save} disabled={saving}
              style={{ background: T.gold, border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: saving ? "wait" : "pointer" }}>
              {saving ? "Saving…" : existing ? "Save" : "Create proposal"}
            </button>
          </div>
        </div>
      }>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div><label style={lbl}>What is the ask for?</label>
          <input style={inp} value={f.purpose} onChange={e => set("purpose", e.target.value)} placeholder="Lead gift for the new barn" /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><label style={lbl}>Ask amount</label>
            <input style={inp} value={f.askAmount} onChange={e => set("askAmount", e.target.value)} placeholder="25,000" /></div>
          <div><label style={lbl}>Expected close</label>
            <input type="date" style={inp} value={f.expectedClose} onChange={e => set("expectedClose", e.target.value)} /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><label style={lbl}>Stage</label>
            <select style={inp} value={f.stage} onChange={e => set("stage", e.target.value)}>
              {(meta.stages || []).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select></div>
          <div><label style={lbl}>Probability you'd put on it</label>
            <select style={inp} value={f.probability} onChange={e => set("probability", e.target.value)}>
              <option value="">Not set yet</option>
              {(meta.probabilities || []).map(p => <option key={p} value={p}>{p}%</option>)}
            </select>
            <div style={{ fontSize: 10, color: T.ink3, marginTop: 3 }}>Yours, by hand. Left blank, it stays out of the weighted total.</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><label style={lbl}>Fund it lands in</label>
            <select style={inp} value={f.fundId} onChange={e => set("fundId", e.target.value)}>
              <option value="">No particular fund</option>
              {(meta.funds || []).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select></div>
          <div><label style={lbl}>Officer who owns it</label>
            <select style={inp} value={f.officerId} onChange={e => set("officerId", e.target.value)}>
              <option value="">The relationship owner</option>
              {(meta.officers || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
        </div>
        <div><label style={lbl}>Notes</label>
          <textarea style={{ ...inp, minHeight: 74, resize: "vertical" }} value={f.notes} onChange={e => set("notes", e.target.value)} /></div>
      </div>
    </Modal>
  );
}

// ── MOVING A PROPOSAL ───────────────────────────────────────────────────────
// Committed asks which door the money came through and writes exactly one of
// the two. Declined asks for a reason from the list. Reopening a decline asks
// out loud, because the server refuses a silent one.
function MoveModal({ open, onClose, onSaved, meta, proposal }) {
  const [stage, setStage] = useState("");
  const [kind, setKind] = useState("pledge");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open && proposal) { setStage(proposal.stage); setKind("pledge"); setReason(""); setErr(""); } }, [open, proposal]);
  if (!open || !proposal) return null;

  const committing = (stage === "committed" || stage === "stewarding") && !proposal.pledgeId && !proposal.giftId;
  const declining = stage === "declined";
  const reopening = proposal.stage === "declined" && ["identified", "cultivating", "asked"].includes(stage);

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const body = { stage };
      if (committing) body.commitKind = kind;
      if (declining) body.declineReason = reason;
      if (reopening) body.acknowledgeReopen = true;
      await apiFetch(`/proposals/${proposal.id}`, { method: "PUT", body: JSON.stringify(body) });
      onSaved(); onClose();
    } catch (e) { setErr(errorMessage(e, "That move could not be saved.")); }
    setSaving(false);
  };

  const lbl = { fontSize: 11, fontWeight: 700, color: T.ink2, display: "block", marginBottom: 4 };
  const inp = { width: "100%", padding: "9px 11px", border: "1px solid " + T.bg3, borderRadius: 9, fontSize: 13, background: T.white, color: T.ink };

  return (
    <Modal onClose={onClose} title={`Move — ${proposal.purpose || "proposal"}`} width={500}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11, color: T.terra700 }}>{err}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 9, padding: "9px 16px", fontSize: 13, color: T.ink2, cursor: "pointer" }}>Cancel</button>
            <button onClick={save} disabled={saving || (declining && !reason)}
              style={{ background: T.gold, border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 700, color: T.ink,
                       cursor: (saving || (declining && !reason)) ? "not-allowed" : "pointer", opacity: (declining && !reason) ? 0.5 : 1 }}>
              {saving ? "Saving…" : "Save the move"}
            </button>
          </div>
        </div>
      }>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div><label style={lbl}>Stage</label>
          <select style={inp} value={stage} onChange={e => setStage(e.target.value)}>
            {(meta.stages || []).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <div style={{ fontSize: 11, color: T.ink3, marginTop: 4 }}>{(meta.stages || []).find(s => s.key === stage)?.blurb}</div>
        </div>
        {committing && (
          <div><label style={lbl}>How did it come in?</label>
            <select style={inp} value={kind} onChange={e => setKind(e.target.value)}>
              <option value="pledge">As a pledge — they promised it</option>
              <option value="gift">As a gift already on file</option>
            </select>
            <div style={{ fontSize: 11, color: T.ink3, marginTop: 4 }}>
              {kind === "pledge"
                ? "Steward writes one pledge for the ask amount. It closes itself when the money arrives."
                : "Record the gift on their record first, then link it here."}
            </div>
          </div>
        )}
        {declining && (
          <div><label style={lbl}>Why?</label>
            <select style={inp} value={reason} onChange={e => setReason(e.target.value)}>
              <option value="">Choose a reason</option>
              {(meta.declineReasons || []).map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            <div style={{ fontSize: 11, color: T.ink3, marginTop: 4 }}>The reason and today's date stay on the record, even if you reopen it later.</div>
          </div>
        )}
        {reopening && (
          <div style={{ background: T.gold100, border: "1px solid " + T.gold300, borderRadius: 10, padding: "10px 12px", fontSize: 12, color: T.ink2 }}>
            This proposal was declined. Reopening it keeps the decline on the record.
          </div>
        )}
      </div>
    </Modal>
  );
}

function ProposalRow({ p, onMove, onEdit, isReadOnly, showDonor }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: showDonor ? "1.4fr 1.6fr 110px 96px 110px 120px" : "1.8fr 110px 96px 110px 120px",
                  gap: 12, alignItems: "center", padding: "12px 14px", borderTop: "1px solid " + T.bg3, minHeight: 56 }}>
      {showDonor && <div style={{ fontSize: 14, fontWeight: 600, color: T.ink, overflowWrap: "anywhere" }}>{p.donorName}</div>}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: T.ink, overflowWrap: "anywhere" }}>{p.purpose}</div>
        <div style={{ fontSize: 11, color: T.ink3 }}>{p.fundName || "No particular fund"}{p.officerName ? " · " + p.officerName : ""}</div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, fontFamily: "'DM Serif Display',serif" }}>{fmtFull(p.askAmount)}</div>
      <div style={{ fontSize: 12, color: p.probability == null ? T.ink3 : T.ink2 }}>{p.probability == null ? "not set" : p.probability + "%"}</div>
      <div style={{ fontSize: 12, color: T.ink2 }}>{niceDate(p.expectedClose)}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
        <StageChip stage={p.stage} label={(p.stage || "").charAt(0).toUpperCase() + (p.stage || "").slice(1)} />
        {!isReadOnly && (
          <>
            <button onClick={() => onMove(p)} title="Move this proposal"
              style={{ background: T.gold, border: "none", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 700, color: T.ink, cursor: "pointer" }}>Move</button>
            <button onClick={() => onEdit(p)} title="Edit this proposal"
              style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 8, padding: "5px 8px", fontSize: 11, color: T.ink2, cursor: "pointer" }}>Edit</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── THE PROPOSALS SCREEN (Fundraising → Proposals) ─────────────────────────
export function ProposalsView({ isReadOnly, onNavigate }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [officerId, setOfficerId] = useState("");
  const [fundId, setFundId] = useState("");
  const [sort, setSort] = useState("expected");
  const [stageFilter, setStageFilter] = useState("");
  const [moving, setMoving] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (officerId) q.set("officerId", officerId);
    if (fundId) q.set("fundId", fundId);
    if (stageFilter) q.set("stage", stageFilter);
    q.set("sort", sort);
    apiFetch("/proposals?" + q.toString())
      .then(r => { setD(r); setLoading(false); })
      .catch(e => { console.error("[proposals]", e); setLoading(false); });
  }, [officerId, fundId, sort, stageFilter]);
  useEffect(() => { load(); }, [load]);

  if (loading && !d) return <div style={{ padding: 48, textAlign: "center", color: T.ink3, fontSize: 13 }}><Spin /></div>;
  if (!d) return null;

  const meta = { stages: d.stages, probabilities: d.probabilities, declineReasons: d.declineReasons, funds: d.funds, officers: d.officers };
  const sel = { padding: "7px 10px", border: "1px solid " + T.bg3, borderRadius: 9, fontSize: 12, background: T.white, color: T.ink };

  return (
    <div data-testid="proposals-view">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 16 }}>
        <Tile testid="proposals-openask" label="Asked for, still open" value={fmtFull(d.openAsk.amount)} sentence={d.openAsk.sentence} />
        <Tile testid="proposals-weighted" label="Weighted" value={fmtFull(d.weighted.amount)} sentence={d.weighted.sentence} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 16 }}>
        {d.byStage.map(r => (
          <Tile key={r.stage} testid={"proposals-stage-" + r.stage} label={r.label} value={`${fmtFull(r.amount)} · ${r.count}`} sentence={r.sentence}
            active={stageFilter === r.stage} onClick={() => setStageFilter(stageFilter === r.stage ? "" : r.stage)} />
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select style={sel} value={officerId} onChange={e => setOfficerId(e.target.value)}>
          <option value="">Every officer</option>
          {d.officers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select style={sel} value={fundId} onChange={e => setFundId(e.target.value)}>
          <option value="">Every fund</option>
          {d.funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select style={sel} value={sort} onChange={e => setSort(e.target.value)}>
          <option value="expected">Soonest expected close first</option>
          <option value="amount">Largest ask first</option>
          <option value="stage">By stage</option>
        </select>
        {stageFilter && (
          <button onClick={() => setStageFilter("")} style={{ ...sel, cursor: "pointer", fontWeight: 700 }}>
            Showing {d.stages.find(s => s.key === stageFilter)?.label} only — clear ×
          </button>
        )}
      </div>

      {d.proposals.length === 0 ? (
        <EmptyState title="No proposals yet"
          message="A proposal is one ask to one person: what it's for, how much, and when you expect an answer. Open one from a person's record." />
      ) : (
        <div data-testid="proposals-table" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 110px 96px 110px 120px", gap: 12, padding: "10px 14px", background: T.bg2,
                        fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3 }}>
            <div>Person</div><div>What the ask is for</div><div>Ask</div><div>Probability</div><div>Expected</div><div style={{ textAlign: "right" }}>Stage</div>
          </div>
          {d.proposals.map(p => (
            <ProposalRow key={p.id} p={p} showDonor isReadOnly={isReadOnly}
              onMove={setMoving} onEdit={setEditing} />
          ))}
        </div>
      )}

      <MoveModal open={!!moving} onClose={() => setMoving(null)} onSaved={load} meta={meta} proposal={moving} />
      <ProposalForm open={!!editing} onClose={() => setEditing(null)} onSaved={load} meta={meta}
        donorId={editing?.donorId} existing={editing} donorName={editing?.donorName} />
    </div>
  );
}

// ── THE PROFILE PANEL (above giving history) ───────────────────────────────
// The brief puts proposals above giving history because an open ask is what an
// officer is here to look at; the history is the evidence behind it.
export function ProposalsPanel({ donorId, donorName, isReadOnly, canWrite }) {
  const [d, setD] = useState(null);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => {
    apiFetch(`/donors/${donorId}/proposals`).then(setD).catch(e => console.error("[proposals]", e));
  }, [donorId]);
  useEffect(() => { load(); }, [load]);
  if (!d) return null;

  const meta = { stages: d.stages, probabilities: d.probabilities, declineReasons: d.declineReasons, funds: [], officers: [] };
  const openOnes = d.proposals.filter(p => ["identified", "cultivating", "asked"].includes(p.stage));

  return (
    <div data-testid="donor-proposals-panel" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.ink3 }}>Proposals</div>
        {canWrite && !isReadOnly && (
          <button onClick={() => setAdding(true)}
            style={{ background: T.gold, border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer" }}>+ New proposal</button>
        )}
      </div>
      {d.proposals.length === 0 ? (
        <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6 }}>
          No proposal open. A proposal is one ask — what it's for, how much, and when you expect an answer.
        </div>
      ) : (
        <>
          {openOnes.length > 0 && (
            <div style={{ fontSize: 12, color: T.ink2, marginBottom: 8 }}>{d.weighted.sentence}</div>
          )}
          <div style={{ border: "1px solid " + T.bg3, borderRadius: 10, overflow: "hidden" }}>
            {d.proposals.map(p => (
              <ProposalRow key={p.id} p={p} isReadOnly={isReadOnly || !canWrite}
                onMove={setMoving} onEdit={setEditing} />
            ))}
          </div>
        </>
      )}
      <ProposalForm open={adding} onClose={() => setAdding(false)} onSaved={load} meta={meta} donorId={donorId} donorName={donorName} />
      <ProposalForm open={!!editing} onClose={() => setEditing(null)} onSaved={load} meta={meta} donorId={donorId} existing={editing} donorName={donorName} />
      <MoveModal open={!!moving} onClose={() => setMoving(null)} onSaved={load} meta={meta} proposal={moving} />
    </div>
  );
}

// ── THE PORTFOLIO SCREEN (Fundraising → Portfolios) ────────────────────────
// Her people in the order the server ranked them — the ORDER is the product, so
// the screen never re-sorts (a second sort here would be a second truth about
// which relationship is going quiet). The target and the cap are the two numbers
// she typed; when she has not typed one, the tile says so rather than showing a
// percentage of nothing.
// The signed-in user comes from the ONE place the app already keeps it
// (`npe_user` in localStorage, written by the login path) rather than from a
// prop, because `data` on this tab is the shared donor/org payload and does not
// carry the caller. A read that throws here must not take the screen with it.
function signedInUser() {
  try { return JSON.parse(localStorage.getItem("npe_user") || "{}") || {}; } catch { return {}; }
}

export function PortfolioView({ isReadOnly, onNavigate }) {
  const me = signedInUser();
  const isAdmin = String(me.role || "") === "admin";
  const [officers, setOfficers] = useState([]);
  const [who, setWho] = useState(me.id || "me");
  const [d, setD] = useState(null);
  const [un, setUn] = useState(null);
  const [editing, setEditing] = useState(false);
  const [tVal, setTVal] = useState(""); const [cVal, setCVal] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => { apiFetch("/portfolio/officers").then(r => setOfficers(r.officers || [])).catch(() => {}); }, []);
  const load = useCallback(() => {
    apiFetch(`/portfolio/${encodeURIComponent(who || "me")}`).then(r => {
      setD(r);
      setTVal(r.target.amount == null ? "" : String(r.target.amount));
      setCVal(r.cap.cap == null ? "" : String(r.cap.cap));
    }).catch(e => console.error("[portfolio]", e));
    apiFetch("/portfolio/unassigned-prospects").then(setUn).catch(() => {});
  }, [who]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div style={{ padding: 48, textAlign: "center", color: T.ink3, fontSize: 13 }}><Spin /></div>;

  const saveTarget = async () => {
    setErr("");
    try {
      await apiFetch(`/portfolio/${encodeURIComponent(d.officer.id)}/target`,
        { method: "PUT", body: JSON.stringify({ target: tVal, countCap: cVal }) });
      setEditing(false); load();
    } catch (e) { setErr(errorMessage(e, "That could not be saved.")); }
  };
  const assignTo = async (donorId) => {
    setErr("");
    try {
      await apiFetch(`/donors/${donorId}/assign`, { method: "PATCH", body: JSON.stringify({ assignedTo: d.officer.id }) });
      load();
    } catch (e) { setErr(errorMessage(e, "That person could not be assigned.")); }
  };

  const sel = { padding: "7px 10px", border: "1px solid " + T.bg3, borderRadius: 9, fontSize: 12, background: T.white, color: T.ink };
  const inp = { padding: "7px 10px", border: "1px solid " + T.bg3, borderRadius: 9, fontSize: 13, background: T.white, color: T.ink, width: 130 };

  return (
    <div data-testid="portfolio-view">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        {isAdmin && officers.length > 1 && (
          <select style={sel} value={who} onChange={e => setWho(e.target.value)}>
            {officers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        <span style={{ fontSize: 13, color: T.ink2 }}>{d.officer.name} · {d.fiscalLabel}</span>
        {d.downgraded && <span style={{ fontSize: 11, color: T.ink3 }}>Showing your own portfolio.</span>}
        {err && <span style={{ fontSize: 11, color: T.terra700 }}>{err}</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 18 }}>
        <Tile testid="portfolio-count" label="People assigned" value={String(d.count.value)} sentence={d.count.sentence} />
        <Tile testid="portfolio-target" label={`Committed · ${d.fiscalLabel}`}
          value={d.target.set ? `${fmtFull(d.target.committedAmount)} of ${fmtFull(d.target.amount)}` : fmtFull(d.target.committedAmount)}
          sentence={d.target.sentence} />
        <Tile testid="portfolio-cap" label="Against your cap"
          value={d.cap.set ? `${d.cap.count} / ${d.cap.cap}` : String(d.cap.count)} sentence={d.cap.sentence} />
      </div>

      {!isReadOnly && (
        <div style={{ marginBottom: 18 }}>
          {editing ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, color: T.ink2 }}>Target for {d.fiscalLabel}
                <input style={{ ...inp, marginLeft: 8 }} value={tVal} onChange={e => setTVal(e.target.value)} placeholder="150,000" /></label>
              <label style={{ fontSize: 12, color: T.ink2 }}>Count cap
                <input style={{ ...inp, marginLeft: 8, width: 90 }} value={cVal} onChange={e => setCVal(e.target.value)} placeholder="120" /></label>
              <button onClick={saveTarget} style={{ background: T.gold, border: "none", borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer" }}>Save</button>
              <button onClick={() => setEditing(false)} style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 9, padding: "8px 14px", fontSize: 13, color: T.ink2, cursor: "pointer" }}>Cancel</button>
              <span style={{ fontSize: 11, color: T.ink3 }}>Leave either blank to say you have not decided.</span>
            </div>
          ) : (
            <button onClick={() => setEditing(true)}
              style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 9, padding: "7px 14px", fontSize: 12, color: T.ink2, cursor: "pointer" }}>
              {d.target.set || d.cap.set ? "Change your target or cap" : "Set your target for the year"}
            </button>
          )}
        </div>
      )}

      {d.people.length === 0 ? (
        <EmptyState title="Nobody assigned yet"
          message="Assigning somebody to an officer is what puts them in that officer's portfolio and on their board — one act, not two." />
      ) : (
        <div data-testid="portfolio-table" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 110px 1.6fr 1.4fr", gap: 12, padding: "10px 14px", background: T.bg2,
                        fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3 }}>
            <div>Person</div><div>Open ask</div><div>Last conversation</div><div>Next step</div>
          </div>
          {d.people.map(p => (
            <div key={p.donorId} style={{ display: "grid", gridTemplateColumns: "1.5fr 110px 1.6fr 1.4fr", gap: 12, alignItems: "center",
                                          padding: "12px 14px", borderTop: "1px solid " + T.bg3, minHeight: 60,
                                          borderLeft: "3px solid " + (p.quiet ? T.gold500 : "transparent") }}>
              <div style={{ minWidth: 0 }}>
                <a href={`/donors/${p.donorId}`} onClick={e => { if (onNavigate) { e.preventDefault(); onNavigate("donors", { selectDonorId: p.donorId }); } }}
                  style={{ fontSize: 14, fontWeight: 600, color: T.ink, textDecoration: "none", overflowWrap: "anywhere" }}>{p.name}</a>
                <div style={{ fontSize: 11, color: T.ink3 }}>{fmtFull(p.lifetime)} lifetime{p.stage ? " · " + p.stage : ""}</div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: p.openAskCents ? T.ink : T.ink3, fontFamily: "'DM Serif Display',serif" }}>
                {p.openAskCents ? fmtFull(p.openAskAmount) : "—"}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: p.quiet ? T.gold700 : T.ink2, fontWeight: p.quiet ? 700 : 400 }}>{p.contactPhrase}</div>
                {p.lastConversation && <div style={{ fontSize: 11, color: T.ink3, overflowWrap: "anywhere" }}>{p.lastConversation.note}</div>}
              </div>
              <div style={{ fontSize: 12, color: T.ink2, minWidth: 0, overflowWrap: "anywhere" }}>
                {p.nextStep ? `${p.nextStep.label} · due ${niceDate(p.nextStep.due)}` : <span style={{ color: T.ink3 }}>No open step</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {un && (
        <div data-testid="portfolio-unassigned" style={{ marginTop: 22 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Nobody owns these relationships</div>
          <div style={{ fontSize: 12, color: T.ink3, marginBottom: 10 }}>{un.sentence}</div>
          {un.prospects.length > 0 && (
            <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, overflow: "hidden" }}>
              {un.prospects.map(p => (
                <div key={p.donorId} style={{ display: "grid", gridTemplateColumns: "1.6fr 120px 120px 140px", gap: 12, alignItems: "center",
                                              padding: "11px 14px", borderTop: "1px solid " + T.bg3 }}>
                  <div style={{ fontSize: 14, color: T.ink, overflowWrap: "anywhere" }}>{p.name}</div>
                  <div style={{ fontSize: 13, color: T.ink2 }}>{fmtFull(p.lifetime)}</div>
                  <div style={{ fontSize: 12, color: T.ink3 }}>{p.giftCount} {p.giftCount === 1 ? "gift" : "gifts"}</div>
                  <div style={{ textAlign: "right" }}>
                    {!isReadOnly && isAdmin && (
                      <button onClick={() => assignTo(p.donorId)}
                        style={{ background: T.gold, border: "none", borderRadius: 8, padding: "5px 12px", fontSize: 11, fontWeight: 700, color: T.ink, cursor: "pointer" }}>
                        Assign to {d.officer.name.split(" ")[0]}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
