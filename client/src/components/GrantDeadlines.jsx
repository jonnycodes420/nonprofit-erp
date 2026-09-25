// BUILD-100 (grants) Part 7 — DEADLINES, ON SCREEN.
//
// Two surfaces over the ONE read, GET /grants/deadlines:
//   · DeadlinesView is Grants → Deadlines: the line Home also says, twelve
//     months (every month present, so an empty one is visibly empty — the
//     server's calendarFromMilestones), the open deadlines in date order, and
//     the org's own lead times.
//   · GrantDeadlinesPanel sits on a grant: its own deadlines, add one, move
//     one, mark one done.
// Nothing here computes a band, a timing sentence or a window — the server
// sends them from shared/grantMilestones.js, and this only draws them.

import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";
import { deadlinesInWindow, HOME_WINDOW_DAYS } from "../../../shared/grantMilestones";
import { grantDeadlineSentence } from "../../../shared/homeNote";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const civil = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; };
const dayLabel = iso => { const c = civil(iso); return c ? `${c.d} ${MONTHS[c.mo - 1]}` : "—"; };
const monthLabel = ym => { const c = civil(ym + "-01"); return c ? `${MONTHS[c.mo - 1]} ${c.y}` : ym; };
const BAND_COLOR = { overdue: T.gold500, soon: T.greenDk, later: T.bg3 };
const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink, background: T.white, boxSizing: "border-box" };
const quietBtn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", minHeight: 36 };
const primaryBtn = { background: T.greenDk, border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: T.white, cursor: "pointer", minHeight: 36 };

function MilestoneRow({ m, onDone, onOpenGrant, isReadOnly, showGrant = true }) {
  return (
    <div data-testid="deadline-row" style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderTop: "1px solid " + T.bg3, flexWrap: "wrap" }}>
      <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: BAND_COLOR[m.band] || T.bg3 }} />
      <div style={{ minWidth: 64, fontSize: 13, fontWeight: 700, color: T.ink }}>{dayLabel(m.dueDate)}</div>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ fontSize: 14, color: T.ink, fontWeight: 600 }}>
          {m.kindLabel}
          {showGrant && <span style={{ fontWeight: 400, color: T.ink3 }}> · {m.funderName}{m.program ? ` · ${m.program}` : ""}</span>}
        </div>
        <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.5 }}>{m.sentence}</div>
        {m.waitingSentence && <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>{m.waitingSentence}</div>}
        {m.balance && <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>{m.balance.sentence}</div>}
      </div>
      <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
        {showGrant && onOpenGrant && <button style={quietBtn} onClick={() => onOpenGrant(m.grantId)}>Open grant</button>}
        {!isReadOnly && <button style={quietBtn} data-testid="deadline-done" onClick={() => onDone(m)}>Done</button>}
      </div>
    </div>
  );
}

// ── Grants → Deadlines ──────────────────────────────────────────────────────
export function DeadlinesView({ isReadOnly, isAdmin, onOpenGrant }) {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");
  const [lead, setLead] = useState(null);
  const load = () => apiFetch("/grants/deadlines").then(d => { setData(d); setLead(d.leadDays); })
    .catch(e => { setMsg(errorMessage(e, "The deadlines could not be loaded.")); setData({ milestones: [], calendar: [], milestoneTypes: [] }); });
  useEffect(() => { load(); }, []);
  const done = async m => {
    setMsg("");
    try { await apiFetch(`/grants/milestones/${m.id}/done`, { method: "POST", body: "{}" }); load(); }
    catch (e) { setMsg(errorMessage(e, "That deadline could not be marked done.")); }
  };
  const saveLead = async () => {
    setMsg("");
    try { const r = await apiFetch("/org/grant-lead-days", { method: "PUT", body: JSON.stringify({ leadDays: lead }) }); setLead(r.leadDays); setMsg("Lead times saved."); load(); }
    catch (e) { setMsg(errorMessage(e, "The lead times did not save.")); }
  };
  if (!data) return <div style={{ padding: 40, textAlign: "center", color: T.ink3, fontSize: 13 }}>Loading…</div>;
  const types = data.milestoneTypes || [];
  return (
    <div data-testid="deadlines-view" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div data-testid="deadlines-line" style={{ fontSize: 15, color: T.ink, lineHeight: 1.5 }}>
        {/* The SAME sentence Home says, over the same window function. */}
        {grantDeadlineSentence(deadlinesInWindow(data.milestones, data.today).length, HOME_WINDOW_DAYS) || "No grant deadline falls in the next two weeks."}
        {data.overdue > 0 && <span style={{ color: T.ink3 }}> {data.overdue === 1 ? "One is" : data.overdue + " are"} past the date and still open.</span>}
      </div>

      <section>
        <h3 style={{ margin: "0 0 10px", fontSize: 16, color: T.ink }}>The next twelve months</h3>
        <div data-testid="deadlines-calendar" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          {(data.calendar || []).map(mo => (
            <div key={mo.month} data-testid="calendar-month" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px", minHeight: 84 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{monthLabel(mo.month)}</span>
                <span style={{ fontSize: 12, color: T.ink3 }}>{mo.count || ""}</span>
              </div>
              {mo.items.length === 0 && <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>Nothing due</div>}
              {mo.items.slice(0, 4).map(it => (
                <button key={it.id} onClick={() => onOpenGrant && onOpenGrant(it.grantId)}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "3px 0", cursor: onOpenGrant ? "pointer" : "default", fontSize: 12, color: T.ink, lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 700 }}>{civil(it.dueDate)?.d}</span> {it.kindLabel} · <span style={{ color: T.ink3 }}>{it.funderName}</span>
                </button>))}
              {mo.items.length > 4 && <div style={{ fontSize: 12, color: T.ink3 }}>and {mo.items.length - 4} more</div>}
            </div>))}
        </div>
      </section>

      <section>
        <h3 style={{ margin: "0 0 4px", fontSize: 16, color: T.ink }}>Open deadlines</h3>
        {!data.milestones.length && <div style={{ fontSize: 13, color: T.ink3 }}>No open deadlines. Add one from a grant, and Steward opens a follow-up when it comes close.</div>}
        {data.milestones.map(m => <MilestoneRow key={m.id} m={m} onDone={done} onOpenGrant={onOpenGrant} isReadOnly={isReadOnly} />)}
      </section>

      {lead && (
        <section data-testid="lead-days">
          <h3 style={{ margin: "0 0 4px", fontSize: 16, color: T.ink }}>How early Steward reminds you</h3>
          <div style={{ fontSize: 13, color: T.ink3, marginBottom: 10 }}>A follow-up opens this many days before each kind of deadline, owned by the grant's officer.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {types.map(t => (
              <label key={t.key} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: T.ink2 }}>
                {t.label}
                <input type="number" min="0" max="365" value={lead[t.key] ?? ""} disabled={!isAdmin || isReadOnly}
                  onChange={e => setLead({ ...lead, [t.key]: e.target.value === "" ? "" : Number(e.target.value) })} style={{ ...inp, width: 90 }} />
              </label>))}
          </div>
          {isAdmin && !isReadOnly && <button style={{ ...primaryBtn, marginTop: 10 }} onClick={saveLead}>Save lead times</button>}
        </section>)}
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink3 }}>{msg}</div>}
    </div>
  );
}

// ── On a grant ──────────────────────────────────────────────────────────────
export function GrantDeadlinesPanel({ grantId, isReadOnly }) {
  const [all, setAll] = useState(null);
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch("/grants/deadlines").then(d => { setAll((d.milestones || []).filter(m => m.grantId === grantId)); setTypes(d.milestoneTypes || []); })
    .catch(e => { setAll([]); setMsg(errorMessage(e, "The deadlines could not be loaded.")); });
  useEffect(() => { load(); }, [grantId]);
  const add = async () => {
    setMsg("");
    try { await apiFetch(`/grants/${grantId}/milestones`, { method: "POST", body: JSON.stringify(form) }); setForm(null); load(); }
    catch (e) { setMsg(errorMessage(e, "That deadline did not save.")); }
  };
  const move = async (m, dueDate) => {
    setMsg("");
    try { await apiFetch(`/grants/milestones/${m.id}`, { method: "PUT", body: JSON.stringify({ dueDate }) }); load(); }
    catch (e) { setMsg(errorMessage(e, "The date did not move.")); }
  };
  const done = async m => {
    setMsg("");
    try { await apiFetch(`/grants/milestones/${m.id}/done`, { method: "POST", body: "{}" }); load(); }
    catch (e) { setMsg(errorMessage(e, "That deadline could not be marked done.")); }
  };
  if (!all) return null;
  return (
    <div data-testid="grant-deadlines" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.ink3 }}>Deadlines Steward watches</div>
        {!isReadOnly && !form && <button style={{ ...quietBtn, marginLeft: "auto" }} data-testid="deadline-add"
          onClick={() => setForm({ kind: types[0]?.key || "", dueDate: "", notes: "" })}>Add a deadline</button>}
      </div>
      {!all.length && !form && <div style={{ fontSize: 13, color: T.ink3 }}>None yet. Add the LOI, proposal, decision or report date and a follow-up opens when it comes close.</div>}
      {all.map(m => (
        <div key={m.id}>
          <MilestoneRow m={m} onDone={done} isReadOnly={isReadOnly} showGrant={false} />
          {!isReadOnly && <label style={{ fontSize: 12, color: T.ink3, display: "flex", gap: 6, alignItems: "center", paddingLeft: 16 }}>Move to
            <input type="date" defaultValue={m.dueDate} onBlur={e => e.target.value && e.target.value !== m.dueDate && move(m, e.target.value)} style={inp} /></label>}
        </div>))}
      {form && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
          <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} style={inp} data-testid="deadline-kind">
            {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} style={inp} data-testid="deadline-date" />
          <input placeholder="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={{ ...inp, flex: "1 1 160px" }} />
          <button style={primaryBtn} onClick={add} disabled={!form.dueDate} data-testid="deadline-save">Add</button>
          <button style={quietBtn} onClick={() => setForm(null)}>Cancel</button>
        </div>)}
      {msg && <div role="status" style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>{msg}</div>}
    </div>
  );
}
