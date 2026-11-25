// ONBOARD-5 · Invite your team, and You're set: who to call this week.
// Invitations go out only when she presses Send invites (each through
// /auth/invite, the one door that sends one). Owners are set in the same press.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { C, Card, Choices, Message, side, input, why, btn, link, count } from "./ui";
import { Figure } from "../../components/Figure";

const errText = (e, fallback) => (e && e.body && (e.body.message || e.body.error)) || (e && e.message) || fallback;
const ROLE_WORDS = { admin: "Admin · can connect apps", staff: "Staff", viewer: "Reports only", volunteer_coordinator: "Volunteers only" };
const ROLES = [{ key: "admin", label: "Admin, can connect apps" }, { key: "staff", label: "Staff" }, { key: "viewer", label: "Reports only" }];
const OWNS = [{ key: "", label: "No donors yet" }, { key: "major", label: "The major donors" }, { key: "unowned", label: "Everyone without an owner" }];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const blank = () => ({ email: "", role: { key: "staff" }, sees: "everyone", canExport: false, owns: "" });

export function InviteTeam({ reload }) {
  const [d, setD] = useState(null);
  const [rows, setRows] = useState([blank()]);
  const [restToMe, setRestToMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const load = () => apiFetch("/onboarding/setup/team").then(setD).catch(() => setD({ people: [], invites: [], unowned: 0 }));
  useEffect(() => { load(); }, []);
  if (!d) return <Card><p style={side}>Reading your team…</p></Card>;
  const set = (i, patch) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const ready = rows.filter(r => r.email.trim());
  const bad = ready.find(r => !EMAIL.test(r.email.trim()));
  const send = async () => {
    setBusy(true); setMsg(null);
    const done = [], failed = [];
    for (const r of ready) {
      const custom = r.role.custom;
      try {
        const inv = await apiFetch("/auth/invite", { method: "POST", body: JSON.stringify({ email: r.email.trim(), role: custom ? "staff" : r.role.key,
          ...(custom ? { sees: r.sees, canExport: r.canExport } : {}) }) });
        done.push(r.email.trim());
        if (r.owns && inv.id) await apiFetch("/onboarding/setup/owners", { method: "POST", body: JSON.stringify({ to: `invite:${inv.id}`, which: r.owns }) }).catch(() => null);
      } catch (e) { failed.push(`${r.email.trim()}: ${errText(e, "not sent")}`); }
    }
    let mineN = 0;
    if (restToMe && d.me) {
      const o = await apiFetch("/onboarding/setup/owners", { method: "POST", body: JSON.stringify({ to: d.me, which: "unowned" }) }).catch(() => null);
      mineN = o ? o.updated : 0;
    }
    setRows(failed.length ? ready.filter(r => failed.some(f => f.startsWith(r.email.trim()))) : [blank()]);
    setMsg({ text: [done.length ? `Sent ${count(done.length, "invitation")}.` : "", mineN ? `${count(mineN, "donor")} without an owner are yours now.` : "", failed.length ? `Not sent: ${failed.join("; ")}.` : ""].filter(Boolean).join(" "),
      tone: failed.length ? "bad" : undefined });
    setBusy(false); await load(); reload();
  };
  const row = { display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 0", borderTop: `1px solid ${C.line}`, fontSize: 14.5, flexWrap: "wrap" };
  return <Card testid="setup-team">
    <div>{d.people.map(p => <div key={p.id} style={row}><span>{p.name || p.email}{p.id === d.me ? " (you)" : ""}</span>
      <span style={{ color: C.dim, fontSize: 13.5 }}>{ROLE_WORDS[p.role] || p.role}{p.owns ? ` · owns ${count(p.owns, "donor")}` : ""}</span></div>)}
      {d.invites.map(i => <div key={i.id} style={row}><span>{i.email}</span><span style={{ color: C.dim, fontSize: 13.5 }}>{ROLE_WORDS[i.role] || i.role} · invited</span></div>)}</div>
    {rows.map((r, i) => <div key={i} data-testid="setup-invite-row" style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14, marginTop: 4 }}>
      <input aria-label="Their email address" type="email" placeholder="Add an email address" value={r.email} onChange={e => set(i, { email: e.target.value })} style={input} />
      {r.email.trim() && <>
        <Choices name="Their role" value={r.role} options={ROLES} onPick={v => set(i, { role: v })} />
        {r.role.custom && <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, fontSize: 14 }}>
          <label><input type="radio" checked={r.sees === "everyone"} onChange={() => set(i, { sees: "everyone" })} /> Sees every donor</label>
          <label><input type="radio" checked={r.sees === "assigned"} onChange={() => set(i, { sees: "assigned" })} /> Sees only the donors they own</label>
          <label><input type="checkbox" checked={r.canExport} onChange={e => set(i, { canExport: e.target.checked })} /> Can export</label>
        </div>}
        {r.role.custom && <p style={{ ...side, marginTop: 6 }}>{r.email.trim()} will be Staff, seeing {r.sees === "assigned" ? "only the donors they own" : "every donor"}{r.canExport ? ", and can export" : ", without export"}.</p>}
        <label style={{ ...side, fontWeight: 600, display: "block", marginTop: 10 }}>They own
          <select value={r.owns} onChange={e => set(i, { owns: e.target.value })} style={{ ...input, maxWidth: 320 }}>{OWNS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
      </>}
    </div>)}
    <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
      <button type="button" style={link} onClick={() => setRows(rs => [...rs, blank()])}>+ Add another person</button>
    </div>
    {d.unowned > 0 && <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 14, fontSize: 14 }}>
      <input type="checkbox" checked={restToMe} onChange={e => setRestToMe(e.target.checked)} style={{ marginTop: 3 }} />
      <span>Everyone left without an owner ({count(d.unowned, "donor")}) is yours, so Home and the Thread show each person their own people.</span></label>}
    <div style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" data-testid="setup-send-invites" style={btn("primary")} disabled={busy || !!bad || (!ready.length && !(restToMe && d.unowned > 0))} onClick={send}>
        {busy ? "Saving…" : ready.length > 1 ? `Send ${ready.length} invites` : ready.length ? "Send invites" : "Make them mine"}</button>
      <span style={side}>{bad ? `${bad.email.trim()} isn't an email address yet.` : ready.length ? "Nothing is sent until you press this." : "No one is invited until you add an address and press Send invites."}</span>
    </div>
    <div style={why}>There's no extra charge per person. Your admin can do the QuickBooks and Stripe steps from their own login, so you don't need their passwords.</div>
    <Message {...(msg || {})} />
  </Card>;
}

// ── You're set ────────────────────────────────────────────────────────────
export function YoureSet() {
  const [d, setD] = useState(null);
  useEffect(() => { apiFetch("/onboarding/setup/call").then(setD).catch(() => setD(false)); }, []);
  if (d === null) return <Card><p style={side}>Reading your history…</p></Card>;
  if (d === false) return <Card><p style={side}>Your totals could not be read just now. Home has them.</p></Card>;
  const t = d.totals;
  // Every number opens its rows (a <Figure> with its source) and carries its sentence.
  const tile = (value, kind, words, sentence, source, testid) => <div data-testid={testid} style={{ background: C.cream, borderRadius: 10, padding: 14, fontSize: 13 }}>
    <b style={{ display: "block", fontSize: 22, fontFamily: "'Fraunces',Georgia,serif" }}>{source && value != null
      ? <Figure variant="inline" kind={kind} value={value} label={words} definition={sentence} source={source} why={false} whole /> : value == null ? "–" : String(value)}</b>{words}
    <div style={{ fontSize: 11.5, color: C.dim, marginTop: 4, lineHeight: 1.4 }}>{sentence}</div></div>;
  return <Card testid="setup-call">
    <div className="setup-overview" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
      {tile(t.people, "count", "people in", d.sentences.people, d.sources && d.sources.people, "setup-total-people")}
      {tile(t.lifetimeCents / 100, "money", "lifetime giving", d.sentences.lifetime, d.sources && d.sources.lifetime, "setup-total-lifetime")}
      {tile(t.lapsed, "count", "lapsed 12+ months", d.sentences.lapsed, d.sources && d.sources.lapsed, "setup-total-lapsed")}
      {tile(t.apps, "count", t.apps === 1 ? "app connected" : "apps connected", d.sentences.apps, null, "setup-total-apps")}
    </div>
    <div style={{ marginTop: 16 }}>
      {d.people.length ? d.people.map(p => <a key={p.id} data-testid="setup-call-person" href={`/donors/${encodeURIComponent(p.id)}`}
        style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "12px 0", borderTop: `1px solid ${C.line}`, fontSize: 14.5, color: C.ink, textDecoration: "none", flexWrap: "wrap" }}>
        <span style={{ flex: "1 1 320px", minWidth: 0 }}><b>{p.name}</b>{p.what ? <span style={{ display: "block", fontSize: 13.5 }}>{p.what}</span> : null}
          {p.why ? <span style={{ display: "block", color: C.dim, fontSize: 13.5 }}>{p.why}</span> : null}</span>
        <span style={{ color: C.emerald, fontWeight: 700, fontSize: 13.5, alignSelf: "center" }}>Open {p.name.split(" ")[0]} →</span></a>)
        : <p style={side}>{d.preparing ? "Steward is still reading your history. Home lists the people worth a call as soon as it's done." : "Once your donors are in, Steward lists the first people worth a call here, each with the reason."}</p>}
    </div>
  </Card>;
}
