// BUILD-101 Part 1 — MEMBERSHIPS.
//
// Two surfaces, one set of rows:
//   · MembershipPanel sits on the person's record beside their giving. It
//     shows the membership they hold (or held), and puts them on a level.
//   · MembersView is Fundraising → Members: the levels with their counts, and
//     every membership, sortable by expiry.
//
// A membership payment is a GIFT (the server writes it through recordGift with
// the level's fair-market value), so nothing here totals money of its own.
// Every count carries its sentence on hover, from the server.

import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";

const STATUS_LABEL = { active: "Active", grace: "Grace", lapsed: "Lapsed", cancelled: "Cancelled", renewed: "Renewed" };
const STATUS_COLOR = { active: T.greenDk, grace: T.gold500, lapsed: T.ink3, cancelled: T.ink3, renewed: T.ink3 };
const usd = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 10px", fontSize: 12, color: T.ink, background: T.white };
const quietBtn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer" };
const primaryBtn = { background: T.gold500, border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer" };
const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now()) + Math.random());

function StatusPill({ status }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[status] || T.ink3 }}>{STATUS_LABEL[status] || status}</span>;
}

// ── On the person's record ──────────────────────────────────────────────────
export function MembershipPanel({ donor, isReadOnly, onChanged }) {
  const [data, setData] = useState(null);
  const [levels, setLevels] = useState([]);
  const [form, setForm] = useState(null); // {levelId, paymentMethod, key}
  const [msg, setMsg] = useState("");
  const load = () => {
    apiFetch(`/donors/${donor.id}/memberships`).then(setData).catch(() => setData(null));
    apiFetch("/membership-levels").then(r => setLevels((r.levels || []).filter(l => l.active))).catch(() => setLevels([]));
  };
  useEffect(() => { load(); }, [donor.id]);
  // An org that sells no memberships sees nothing here.
  if (!data || (!data.memberships.length && !levels.length)) return null;
  const cur = data.current;
  // One form, two acts: joining (no current membership) or renewing the one
  // they hold. A renewal's new term starts the day after the old one ends.
  const join = async () => {
    setMsg("");
    try {
      const body = JSON.stringify({ levelId: form.levelId, paymentMethod: form.paymentMethod || null, idempotencyKey: form.key });
      const r = form.renew
        ? await apiFetch(`/memberships/${cur.id}/renew`, { method: "POST", body })
        : await apiFetch(`/donors/${donor.id}/memberships`, { method: "POST", body });
      setForm(null); setMsg(r?.sentence || ""); load(); onChanged && onChanged();
    } catch (e) { setMsg(errorMessage(e, "That membership did not save.")); }
  };
  const chosen = form && levels.find(l => l.id === form.levelId);
  return (
    <div data-testid="membership-panel" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: T.greenDk }}>Membership</span>
      {cur ? (
        <div data-testid="membership-current" title={data.sentence} aria-label={data.sentence} tabIndex={0}>
          <span style={{ fontSize: 16, fontWeight: 800, color: T.ink }}>{cur.level_name}</span>{" "}
          <StatusPill status={cur.status} />
          <div style={{ fontSize: 12, color: T.ink3 }}>
            Member since {cur.joined_on}{cur.expires_on ? ` · through ${cur.expires_on}` : " · lifetime"}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: T.ink3 }}>
          {data.memberships.length ? "Not a current member." : "Not a member yet."}
        </div>
      )}
      {data.memberships.filter(m => !cur || m.id !== cur.id).slice(0, 4).map(m => (
        <div key={m.id} style={{ display: "flex", gap: 8, fontSize: 12, color: T.ink }}>
          <span>{m.level_name}</span><StatusPill status={m.status} />
          <span style={{ color: T.ink3, marginLeft: "auto" }}>{m.starts_on}{m.expires_on ? ` to ${m.expires_on}` : ""}</span>
        </div>))}
      {!isReadOnly && !cur && levels.length > 0 && !form && (
        <button style={{ ...quietBtn, alignSelf: "flex-start" }} data-testid="membership-add"
          onClick={() => setForm({ levelId: levels[0].id, paymentMethod: "", key: newKey() })}>Add a membership</button>)}
      {!isReadOnly && cur && cur.expires_on && levels.length > 0 && !form && (
        <button style={{ ...quietBtn, alignSelf: "flex-start" }} data-testid="membership-renew"
          onClick={() => setForm({ renew: true, levelId: levels.some(l => l.id === cur.level_id) ? cur.level_id : levels[0].id, paymentMethod: "", key: newKey() })}>Renew</button>)}
      {form && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <select value={form.levelId} onChange={e => setForm({ ...form, levelId: e.target.value })} style={inp} data-testid="membership-level">
              {levels.map(l => <option key={l.id} value={l.id}>{l.name} · {usd(l.price)} · {l.termLabel}</option>)}
            </select>
            <select value={form.paymentMethod} onChange={e => setForm({ ...form, paymentMethod: e.target.value })} style={inp}>
              <option value="">How was it paid?</option>
              {["check", "cash", "card", "bank transfer", "other"].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {chosen && <div style={{ fontSize: 12, color: T.ink3 }}>{chosen.fmvSentence} It is recorded as a {usd(chosen.price)} gift.
            {form.renew && cur?.expires_on ? ` The new term starts the day after ${cur.expires_on}.` : ""}</div>}
          <div style={{ display: "flex", gap: 6 }}>
            <button style={primaryBtn} onClick={join} data-testid="membership-save">{form.renew ? "Record renewal" : "Record membership"}</button>
            <button style={quietBtn} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>)}
      {msg && <div role="status" style={{ fontSize: 12, color: T.ink3 }}>{msg}</div>}
    </div>
  );
}

// ── Fundraising → Members ───────────────────────────────────────────────────
export function MembersView({ isReadOnly, isAdmin = true, onNavigate }) {
  const [levels, setLevels] = useState(null);
  const [list, setList] = useState(null);
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("expiry_asc");
  const [draft, setDraft] = useState(null); // new level form
  const [msg, setMsg] = useState("");
  const [settings, setSettings] = useState(null);
  const loadLevels = () => apiFetch("/membership-levels").then(r => setLevels(r.levels || [])).catch(() => setLevels([]));
  const loadList = () => {
    const qs = new URLSearchParams(); if (status) qs.set("status", status); if (sort === "expiry_desc") qs.set("sort", "expiry_desc");
    apiFetch("/memberships?" + qs.toString()).then(setList).catch(() => setList({ members: [], byStatus: {}, sentence: "" }));
  };
  useEffect(() => { loadLevels(); apiFetch("/org/membership-settings").then(setSettings).catch(() => setSettings(null)); }, []);
  const saveSettings = async patch => {
    setMsg("");
    try { await apiFetch("/org/membership-settings", { method: "PUT", body: JSON.stringify(patch) }); setSettings(await apiFetch("/org/membership-settings")); }
    catch (e) { setMsg(errorMessage(e, "That setting did not save.")); }
  };
  useEffect(() => { loadList(); }, [status, sort]);
  const saveLevel = async () => {
    setMsg("");
    try {
      const r = await apiFetch("/membership-levels", { method: "POST", body: JSON.stringify({ ...draft, benefits: String(draft.benefits || "").split("\n") }) });
      setDraft(null); setMsg(r.sentence || ""); loadLevels();
    } catch (e) { setMsg(errorMessage(e, "That level did not save.")); }
  };
  if (!levels || !list) return <div style={{ padding: 48, textAlign: "center", color: T.ink3, fontSize: 13 }}>Loading…</div>;
  const by = list.byStatus || {};
  return (
    <div data-testid="members-view" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }} title={list.sentence} aria-label={list.sentence} tabIndex={0} data-testid="members-counts">
        {["active", "grace", "lapsed", "cancelled"].map(s => (
          <button key={s} onClick={() => setStatus(status === s ? "" : s)} aria-pressed={status === s}
            style={{ background: "transparent", border: "none", padding: 0, textAlign: "left", cursor: "pointer", borderBottom: status === s ? "2px solid " + T.gold500 : "2px solid transparent" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: T.ink }}>{by[s] || 0}</div>
            <div style={{ fontSize: 12, color: T.ink3 }}>{STATUS_LABEL[s]}</div>
          </button>))}
      </div>

      {settings && (
        <div data-testid="membership-settings" style={{ fontSize: 13, color: T.ink2, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>A renewal thread opens</span>
          <input type="number" min="0" max="365" defaultValue={settings.renewalDays} disabled={!isAdmin || isReadOnly} aria-label="Renewal window in days"
            onBlur={e => Number(e.target.value) !== settings.renewalDays && saveSettings({ renewalDays: e.target.value })} style={{ ...inp, width: 64 }} />
          <span>days before a membership expires; an expired one stays in grace for</span>
          <input type="number" min="0" max="365" defaultValue={settings.graceDays} disabled={!isAdmin || isReadOnly} aria-label="Grace period in days"
            onBlur={e => Number(e.target.value) !== settings.graceDays && saveSettings({ graceDays: e.target.value })} style={{ ...inp, width: 64 }} />
          <span>days, then lapses. Steward drafts the renewal note; nothing is sent.</span>
        </div>)}

      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: T.ink }}>Levels</h3>
          {isAdmin && !isReadOnly && !draft && (
            <button style={quietBtn} data-testid="level-add" onClick={() => setDraft({ name: "", price: "", fmv: "", term: "12_months", scope: "individual", benefits: "" })}>Add a level</button>)}
        </div>
        {!levels.length && !draft && (
          <div style={{ fontSize: 13, color: T.ink3 }}>No levels yet. Add one with its price, its term and the value of what members receive, and receipts will state the deductible part.</div>)}
        {levels.map(l => {
          const c = l.counts || {};
          return (
            <div key={l.id} data-testid="level-row" style={{ display: "flex", gap: 14, alignItems: "baseline", padding: "8px 0", borderBottom: "1px solid " + T.bg3, opacity: l.active ? 1 : 0.6 }}>
              <span style={{ fontWeight: 700, color: T.ink, minWidth: 140 }}>{l.name}{!l.active ? " (retired)" : ""}</span>
              <span style={{ fontSize: 13, color: T.ink }} title={l.fmvSentence} aria-label={l.fmvSentence} tabIndex={0}>{usd(l.price)} · {l.termLabel}</span>
              <span style={{ fontSize: 12, color: T.ink3 }}>{l.scope === "household" ? "Household" : "Individual"}</span>
              <span style={{ fontSize: 12, color: T.ink3, marginLeft: "auto" }}
                title="People holding this level now, and people whose membership at this level has lapsed.">
                {c.active + c.grace} current · {c.lapsed} lapsed
              </span>
            </div>);
        })}
        {draft && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10, maxWidth: 560 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input placeholder="Level name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} style={{ ...inp, width: 160 }} />
              <input placeholder="Price" inputMode="decimal" value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })} style={{ ...inp, width: 90 }} />
              <input placeholder="Value of benefits" inputMode="decimal" value={draft.fmv} onChange={e => setDraft({ ...draft, fmv: e.target.value })} style={{ ...inp, width: 130 }} />
              <select value={draft.term} onChange={e => setDraft({ ...draft, term: e.target.value })} style={inp}>
                <option value="12_months">12 months</option><option value="calendar_year">Calendar year</option><option value="lifetime">Lifetime</option>
              </select>
              <select value={draft.scope} onChange={e => setDraft({ ...draft, scope: e.target.value })} style={inp}>
                <option value="individual">Individual</option><option value="household">Household</option>
              </select>
            </div>
            <textarea placeholder="Benefits, one per line" rows={3} value={draft.benefits} onChange={e => setDraft({ ...draft, benefits: e.target.value })} style={inp} />
            <div style={{ fontSize: 12, color: T.ink3 }}>The value of benefits is your number. Steward never estimates it; at $0 receipts call the whole payment deductible.</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={primaryBtn} onClick={saveLevel} data-testid="level-save">Save level</button>
              <button style={quietBtn} onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </div>)}
        {msg && <div role="status" style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>{msg}</div>}
      </section>

      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: T.ink }}>Members{status ? ` · ${STATUS_LABEL[status]}` : ""}</h3>
          <select value={sort} onChange={e => setSort(e.target.value)} style={{ ...inp, marginLeft: "auto" }} aria-label="Sort by expiry">
            <option value="expiry_asc">Expiring soonest</option><option value="expiry_desc">Expiring latest</option>
          </select>
        </div>
        {!list.members.length && <div style={{ fontSize: 13, color: T.ink3 }}>No members{status ? ` who are ${STATUS_LABEL[status].toLowerCase()}` : " yet"}. Add a membership from a person's record.</div>}
        <div style={{ overflowX: "auto" }}>
          {list.members.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ textAlign: "left", color: T.ink3, fontSize: 11 }}>
                <th style={{ padding: "6px 8px" }}>Member</th><th style={{ padding: "6px 8px" }}>Level</th>
                <th style={{ padding: "6px 8px" }}>Status</th><th style={{ padding: "6px 8px" }}>Joined</th><th style={{ padding: "6px 8px" }}>Expires</th>
              </tr></thead>
              <tbody>{list.members.map(m => (
                <tr key={m.id} data-testid="member-row" style={{ borderTop: "1px solid " + T.bg3 }}>
                  <td style={{ padding: "8px" }}>
                    <a href={`/donors/${m.donor_id}`} onClick={e => { if (onNavigate && !e.metaKey && !e.ctrlKey) { e.preventDefault(); onNavigate("donors", { selectDonorId: m.donor_id }); } }}
                      style={{ color: T.ink, fontWeight: 600, textDecoration: "none" }}>{m.donor_name}</a>
                  </td>
                  <td style={{ padding: "8px", color: T.ink }}>{m.level_name}</td>
                  <td style={{ padding: "8px" }}><StatusPill status={m.status} /></td>
                  <td style={{ padding: "8px", color: T.ink3 }}>{m.joined_on}</td>
                  <td style={{ padding: "8px", color: T.ink3 }}>{m.expires_on || "Lifetime"}</td>
                </tr>))}</tbody>
            </table>)}
        </div>
      </section>
    </div>
  );
}
