// client/src/components/QboRead.jsx, QBO-IN. GIFTS ENTERED IN QUICKBOOKS.
//
// Inside the QuickBooks card, under "Where each gift lands". Three steps, in
// the order a director needs them:
//
//   1. WHICH QUICKBOOKS INCOME ACCOUNTS ARE DONATIONS? Ticked from the
//      company's own income accounts, each landing on a Steward fund. Nothing
//      ticked, nothing read.
//   2. READ, THEN REVIEW. The first read always stops here: what would become
//      a gift, who needs a pick, who is new, what was skipped and why, and
//      what was left out. Every number opens its lines.
//   3. SAVE, AND UNDO. Save records the gifts; Undo takes the whole read back.
//
// Steward only reads QuickBooks. The demonstration file shows a labelled
// example and asks QuickBooks nothing.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { Figure } from "./Figure";
import { errorMessage } from "../lib/domainError";
import { askConfirm } from "./ConfirmDialog";

const h = { fontSize: 11, fontWeight: 800, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em" };
const sub = { fontSize: 12.5, color: T.ink3, lineHeight: 1.5, marginTop: 4 };
const btn = primary => ({ background: primary ? T.greenDk : T.white, border: primary ? "none" : "1px solid " + T.bg3,
  borderRadius: 9, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, color: primary ? T.white : T.ink,
  cursor: "pointer", fontFamily: "inherit" });
const field = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "5px 8px",
  fontSize: 12.5, minWidth: 0, maxWidth: "100%", fontFamily: "inherit", color: T.ink };
const row = { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "7px 0",
  borderTop: "1px solid " + T.bg2, fontSize: 13 };
const said = e => e?.body?.sentence || e?.sentence || errorMessage(e, "That did not work.");
const money = c => "$" + (Number(c || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// The order the review reads in: what comes in, what needs her, what was skipped.
const SHOWN = ["gift", "ambiguous", "unmatched", "already_in_steward", "steward_sent", "payout", "refund", "removed", "already_read"];
// THE DEMONSTRATION FILE'S EXAMPLE. Static, labelled, and no call to anyone.
const DEMO_READ = {
  gifts: [
    { donor: "Maria Okonkwo", cents: 25000, date: "Sept 28", how: "Check 1041", fund: "General Operating" },
    { donor: "Tom and Linda Reyes", cents: 10000, date: "Sept 30", how: "Check 2210", fund: "Scholarships" },
    { donor: "First Harbor Rotary", cents: 50000, date: "Oct 2", how: "Bank transfer", fund: "General Operating" },
  ],
  skipped: { donor: "Dana Whitfield", cents: 7500, date: "Oct 3", why: "Already in Steward from Stripe on Oct 1, so it was not counted twice." },
  leftOut: "14 transactions on other accounts were left out.",
};
const methodLine = l => [l.method, l.checkNumber ? `no. ${l.checkNumber}` : null].filter(Boolean).join(" ");

export default function QboRead({ can, demo }) {
  const [rd, setRd] = useState(null);
  const [income, setIncome] = useState(null);
  const [draft, setDraft] = useState(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(null);
  const [picks, setPicks] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  const load = () => apiFetch("/qbo/read").then(setRd).catch(() => setRd(null));
  useEffect(() => { load(); }, []);
  if (!rd) return null;

  if (demo || rd.demo) {
    return (
      <div data-testid="qbo-read" style={{ marginTop: 16 }}>
        <div style={h}>Gifts entered in QuickBooks</div>
        <div style={sub}>{rd.demoSentence}</div>
        <div data-testid="qbo-read-example" style={{ marginTop: 8, padding: "10px 12px", background: T.white,
          border: "1px dashed " + T.bg3, borderRadius: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.gold700 }}>Example: what a read from QuickBooks looks like</div>
          {DEMO_READ.gifts.map(g => (
            <div key={g.donor} style={row}>
              <strong style={{ flex: "1 1 160px", minWidth: 0 }}>{g.donor}</strong>
              <span>{money(g.cents)}</span><span style={{ color: T.ink3 }}>{g.date}</span>
              <span style={{ color: T.ink3 }}>{g.how} · {g.fund}</span>
            </div>))}
          <div style={{ ...row, alignItems: "flex-start" }}>
            <span style={{ flex: "1 1 160px", minWidth: 0 }}>{DEMO_READ.skipped.donor} · {money(DEMO_READ.skipped.cents)} · {DEMO_READ.skipped.date}</span>
            <span style={{ fontSize: 12.5, color: T.ink3, flex: "2 1 220px" }}>Skipped. {DEMO_READ.skipped.why}</span>
          </div>
          <div style={sub}>{DEMO_READ.leftOut}</div>
        </div>
      </div>);
  }

  const s = draft || { from: rd.from, accounts: rd.accounts };
  const ticked = Object.keys(s.accounts || {});
  const fundFor = id => (s.accounts[id] && s.accounts[id].fundId) || rd.sendFunds?.[id] || "";
  const toggle = (a, on) => {
    const next = { ...(s.accounts || {}) };
    if (on) next[a.id] = { name: a.name, fundId: rd.sendFunds?.[a.id] || null }; else delete next[a.id];
    setDraft({ ...s, accounts: next });
  };
  const setFund = (id, fundId) => setDraft({ ...s, accounts: { ...s.accounts, [id]: { ...s.accounts[id], fundId: fundId || null } } });

  const openChoose = async () => {
    setOpen(o => !o);
    if (income || !can) return;
    try {
      const r = await apiFetch("/qbo/lists", { method: "POST" });
      setIncome(r.income && r.income.length ? r.income : (r.accounts || []));
    } catch (e) { setIncome([]); setMsg(said(e)); }
  };
  const act = async (key, fn) => { setBusy(key); setMsg(""); try { await fn(); } catch (e) { setMsg(said(e)); } setBusy(""); };
  const saveSettings = () => act("settings", async () => {
    const r = await apiFetch("/qbo/read/settings", { method: "PUT", body: JSON.stringify({ from: s.from, accounts: s.accounts }) });
    setMsg(r.sentence); setDraft(null); load();
  });
  const toggleAuto = () => act("auto", async () => {
    const r = await apiFetch("/qbo/read/settings", { method: "PUT", body: JSON.stringify({ auto: !rd.auto }) });
    setMsg(r.sentence); load();
  });
  const read = () => act("read", async () => {
    const r = await apiFetch("/qbo/read/preview", { method: "POST" });
    setView(r); setPicks({}); load();
  });
  const save = () => act("save", async () => {
    const r = await apiFetch("/qbo/read/save", { method: "POST", body: JSON.stringify({ runId: view.runId, picks }) });
    setMsg(r.sentence); setView(r.view); load();
  });
  const undo = runId => act("undo:" + runId, async () => {
    if (!(await askConfirm({ title: "Undo this read?",
      body: "Every gift this read saved is taken out of Steward, with the people it created who have nothing else. Nothing in QuickBooks changes.",
      yes: "Undo the read" }))) return;
    const r = await apiFetch("/qbo/read/undo", { method: "POST", body: JSON.stringify({ runId }) });
    setMsg(r.sentence); if (view && view.runId === runId) setView(null); load();
  });

  const F = view && view.figures;
  const fig = (b, label) => F && F[b] ? (
    <span style={{ whiteSpace: "nowrap" }}>{F[b].count} · <Figure variant="inline" figureKey={`qbo-read-${b}`} value={F[b].value} kind="money"
      label={label || F[b].label} definition={`${F[b].label}. Every line in this read that landed here, at the amount on the line.`} source={F[b].source} /></span>) : null;
  const reviewing = view && view.status === "review";

  return (
    <div data-testid="qbo-read" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={h}>Gifts entered in QuickBooks</div>
        {can && <button type="button" data-testid="qbo-read-go" disabled={!!busy || !rd.ready || !!draft} onClick={read}
          title={!rd.ready ? "Tick a donation account first" : ""}
          style={{ ...btn(true), marginLeft: "auto", ...(!rd.ready || draft ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}>
          {busy === "read" ? "Reading" : "Read gifts from QuickBooks"}</button>}
      </div>
      <div style={sub}>{rd.definition}</div>

      {/* WHICH ACCOUNTS ARE DONATIONS */}
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginTop: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>Which QuickBooks income accounts are donations?</div>
        <button type="button" data-testid="qbo-read-accounts" style={{ ...btn(false), marginLeft: "auto" }} onClick={openChoose}>
          {open ? "Close" : ticked.length ? "Change" : "Choose"}</button>
      </div>
      {!open && <div style={{ ...sub, color: ticked.length ? T.ink3 : T.gold700 }}>
        {ticked.length ? <>Read from {rd.from}: {ticked.map(id => s.accounts[id].name).join(", ")}. Everything else (program fees, dues, tuition, tickets) is left out.</>
          : "No account is ticked yet, so Steward reads nothing. Tick the accounts where your bookkeeper records donations."}
      </div>}
      {open && <div data-testid="qbo-read-choose" style={{ marginTop: 4 }}>
        {income === null && <div style={sub}>Asking QuickBooks for its income accounts…</div>}
        {income && !income.length && <div style={sub}>QuickBooks returned no income accounts to choose from.</div>}
        {(income || []).map(a => (
          <div key={a.id} data-testid="qbo-read-account" style={row}>
            <label style={{ flex: "1 1 200px", minWidth: 0, display: "flex", gap: 8, alignItems: "center", overflowWrap: "anywhere" }}>
              <input type="checkbox" disabled={!can} checked={!!s.accounts[a.id]} onChange={e => toggle(a, e.target.checked)} />
              {a.name}
            </label>
            {s.accounts[a.id] && <select disabled={!can} value={fundFor(a.id)} onChange={e => setFund(a.id, e.target.value)} style={{ ...field, width: 220 }}>
              <option value="">Unrestricted (General)</option>
              {(rd.funds || []).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>}
          </div>))}
        <div style={row}>
          <span style={{ flex: "1 1 200px" }}>Read gifts from</span>
          <input type="date" disabled={!can} value={s.from || ""} onChange={e => setDraft({ ...s, from: e.target.value })} style={{ ...field, width: 220 }} />
        </div>
        {can && draft && <button type="button" data-testid="qbo-read-save-settings" disabled={busy === "settings"} style={{ ...btn(true), marginTop: 8 }}
          onClick={saveSettings}>{busy === "settings" ? "Saving…" : "Save"}</button>}
      </div>}

      {msg && <div role="status" data-testid="qbo-read-msg" style={{ fontSize: 12.5, color: T.ink, marginTop: 8, lineHeight: 1.5 }}>{msg}</div>}

      {/* THE REVIEW */}
      {view && <div data-testid="qbo-read-review" style={{ marginTop: 12, padding: "10px 12px", border: "1px solid " + T.bg3, borderRadius: 10 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: T.ink }}>
          {reviewing ? "Review before saving" : view.undoneAt ? "This read was undone" : "Saved"} · read from {view.from}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "4px 16px", marginTop: 6 }}>
          {SHOWN.filter(b => F[b] && F[b].count > 0).map(b => (
            <div key={b} data-testid={`qbo-read-count-${b}`} style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.6 }}>
              <div style={{ color: T.ink3 }}>{F[b].label}</div>{fig(b)}</div>))}
        </div>
        <div data-testid="qbo-read-leftout" style={sub}>{view.leftOut} {F.other_account && F.other_account.count > 0 && fig("other_account", "Left out: other accounts")}</div>
        {(view.byAccount || []).length > 0 && <div style={sub}>By account: {view.byAccount.map(a => `${a.name} (${a.count}, ${money(a.cents)})`).join("; ")}.</div>}

        {view.samples.length > 0 && <>
          <div style={{ ...h, marginTop: 10 }}>{reviewing ? "How they will look on profiles" : "Saved gifts"}{view.samples.length >= 10 ? ", the first ten" : ""}</div>
          {view.samples.map(l => (
            <div key={l.id} data-testid="qbo-read-sample" style={row}>
              <strong style={{ flex: "1 1 160px", minWidth: 0, overflowWrap: "anywhere" }}>{l.donorName || l.customer}</strong>
              <span>{money(l.cents)}</span><span style={{ color: T.ink3 }}>{l.date}</span>
              <span style={{ color: T.ink3, overflowWrap: "anywhere" }}>{[methodLine(l), l.fund || "Unrestricted", "QuickBooks"].filter(Boolean).join(" · ")}</span>
            </div>))}
        </>}

        {view.ambiguous.length > 0 && <>
          <div style={{ ...h, marginTop: 10 }}>Who gave? More than one person matches</div>
          {view.ambiguous.map(l => (
            <div key={l.id} data-testid="qbo-read-ambiguous" style={row}>
              <span style={{ flex: "1 1 160px", minWidth: 0 }}><strong>{l.customer}</strong> · {money(l.cents)} · {l.date}</span>
              {reviewing && can ? <select value={picks[l.id] || ""} onChange={e => setPicks({ ...picks, [l.id]: e.target.value })} style={{ ...field, width: 260 }}>
                <option value="">Leave for later</option>
                {(l.candidates || []).map(c => <option key={c.id} value={c.id}>{[c.name, c.email, c.address].filter(Boolean).join(" · ")}</option>)}
              </select> : <span style={{ color: T.ink3, fontSize: 12.5 }}>{l.giftId ? `Saved on ${l.donorName}` : "Waiting for a pick"}</span>}
            </div>))}
        </>}

        {view.unmatched.length > 0 && <>
          <div style={{ ...h, marginTop: 10 }}>Nobody in Steward matches</div>
          {view.unmatched.map(l => (
            <div key={l.id} data-testid="qbo-read-unmatched" style={row}>
              <span style={{ flex: "1 1 160px", minWidth: 0 }}><strong>{l.customer || "No name"}</strong> · {money(l.cents)} · {l.date}</span>
              {reviewing && can ? <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                <input type="checkbox" checked={picks[l.id] === "create"} onChange={e => setPicks({ ...picks, [l.id]: e.target.checked ? "create" : "" })} />
                {l.business ? "Create this organisation" : "Create this person"}</label>
                : <span style={{ color: T.ink3, fontSize: 12.5 }}>{l.giftId ? "Created and saved" : "Waiting"}</span>}
            </div>))}
        </>}

        {[...view.skipped, ...view.refunds].length > 0 && <>
          <div style={{ ...h, marginTop: 10 }}>Skipped, refunded or removed, and why</div>
          {[...view.skipped, ...view.refunds].map(l => (
            <div key={l.id} data-testid="qbo-read-skipped" style={{ ...row, alignItems: "flex-start" }}>
              <span style={{ flex: "1 1 160px", minWidth: 0 }}>{l.customer || l.donorName || "No name"} · {money(l.cents)} · {l.date}</span>
              <span style={{ fontSize: 12.5, color: T.ink3, flex: "2 1 220px", lineHeight: 1.5 }}>{l.reason}
                {l.matched && l.matched.donor ? ` (${l.matched.donor}${l.matched.source ? `, ${l.matched.source}` : ""})` : ""}</span>
            </div>))}
        </>}

        {reviewing && can && <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" data-testid="qbo-read-save" disabled={!!busy} style={btn(true)} onClick={save}>
            {busy === "save" ? "Saving…" : "Save these gifts"}</button>
          <button type="button" disabled={!!busy} style={btn(false)} onClick={() => undo(view.runId)}>Discard this read</button>
        </div>}
        {!reviewing && !view.undoneAt && can && <button type="button" data-testid="qbo-read-undo" disabled={!!busy}
          style={{ ...btn(false), marginTop: 10 }} onClick={() => undo(view.runId)}>{busy === "undo:" + view.runId ? "Undoing…" : "Undo this read"}</button>}
      </div>}

      {/* LATER READS, AND THE SWITCH */}
      <div style={{ ...row, marginTop: 10 }}>
        <span style={{ flex: "1 1 220px", minWidth: 0, fontSize: 12.5, color: T.ink }}>
          {rd.auto ? "New gifts are read automatically once an hour. Anything that needs you waits on that read's review."
            : rd.firstSavedAt ? "Reads run only when somebody presses Read." : "The first read always opens a review. After it is saved, later reads can run on their own."}
        </span>
        {can && <button type="button" data-testid="qbo-read-auto" disabled={!!busy || (!rd.auto && !rd.firstSavedAt)} onClick={toggleAuto}
          style={{ ...btn(false), ...(!rd.auto && !rd.firstSavedAt ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}>
          {rd.auto ? "Stop reading automatically" : "Read new gifts automatically"}</button>}
      </div>
      {(rd.runs || []).filter(r => r.status === "saved" && !(view && view.runId === r.id)).slice(0, 5).map(r => (
        <div key={r.id} data-testid="qbo-read-run" style={row}>
          <span style={{ flex: "1 1 220px", minWidth: 0, fontSize: 12.5 }}>
            {new Date(r.savedAt || r.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {r.automatic ? "read automatically" : `read by ${r.by || "someone"}`}
            {r.summary && r.summary.buckets ? ` · ${r.summary.buckets.gift.count} matched as it stood` : ""}</span>
          <button type="button" style={btn(false)} disabled={!!busy} onClick={() => apiFetch(`/qbo/read/run?id=${encodeURIComponent(r.id)}`).then(setView).catch(e => setMsg(said(e)))}>Open</button>
          {can && <button type="button" style={btn(false)} disabled={!!busy} onClick={() => undo(r.id)}>Undo</button>}
        </div>))}
    </div>);
}
