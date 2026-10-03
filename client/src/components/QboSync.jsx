// client/src/components/QboSync.jsx, PARITY-2 Part 5. QUICKBOOKS ONLINE SYNC.
//
// Opens from the QuickBooks card on Connections. Three things, in the order a
// bookkeeper needs them:
//
//   1. WHERE EACH GIFT LANDS. Every fund, campaign and appeal mapped to an
//      income account and an optional class, chosen from the company's own
//      chart of accounts (asked of QuickBooks, never typed from memory unless
//      QuickBooks cannot be asked), plus the deposit account and the fees
//      account.
//   2. PENDING. Every gift waiting, with the donor, the amount, the date and
//      where it will land, and Sync, Sync all and Skip. Nothing goes until a
//      person presses one, unless the admin turned auto-sync on.
//   3. SENT. The last gifts that went, each with a link to the entry in
//      QuickBooks itself.
//
// A problem is a sentence with a Retry beside it, never a code.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, Card } from "./shared";
import { Figure } from "./Figure";
import { errorMessage } from "../lib/domainError";

const h = { fontSize: 11, fontWeight: 800, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em" };
const btn = primary => ({ background: primary ? T.greenDk : T.white, border: primary ? "none" : "1px solid " + T.bg3,
  borderRadius: 9, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, color: primary ? T.white : T.ink,
  cursor: "pointer", fontFamily: "inherit" });
const field = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "5px 8px",
  fontSize: 12.5, minWidth: 0, maxWidth: "100%", fontFamily: "inherit", color: T.ink };
const row = { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "7px 0",
  borderTop: "1px solid " + T.bg2, fontSize: 13 };
const said = e => e?.body?.sentence || e?.sentence || errorMessage(e, "That did not work.");

// One account or class chooser: a list when QuickBooks could be asked, typed
// text when it could not.
function Pick({ list, value, name, onChange, placeholder, disabled, testid }) {
  if (list) {
    const known = list.some(x => x.id === value);
    return (
      <select data-testid={testid} disabled={disabled} value={value || ""} style={{ ...field, width: 220 }}
        onChange={e => { const x = list.find(a => a.id === e.target.value); onChange(x ? { id: x.id, name: x.name } : null); }}>
        <option value="">{placeholder}</option>
        {!known && value && <option value={value}>{name || value}</option>}
        {list.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>);
  }
  return (
    <input data-testid={testid} disabled={disabled} placeholder={placeholder} value={name || value || ""}
      style={{ ...field, width: 210 }}
      onChange={e => onChange(e.target.value ? { id: e.target.value, name: e.target.value } : null)} />);
}

export default function QboSync({ connectionId = null, isReadOnly, isAdmin }) {
  const [d, setD] = useState(null);
  const [p, setP] = useState(null);
  const [lists, setLists] = useState(null);
  const [listNote, setListNote] = useState("");
  const [draft, setDraft] = useState(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const can = !isReadOnly && isAdmin;

  const load = () => {
    apiFetch("/qbo").then(r => { setD(r); setDraft(null); }).catch(() => setD({ enabled: false }));
    apiFetch("/qbo/pending").then(setP).catch(() => setP(null));
  };
  useEffect(() => { load(); }, []);

  if (!d || !d.enabled || !d.connection) return null;
  if (connectionId && !String(connectionId).startsWith("unconnected") && d.connection.id !== connectionId) return null;

  const m = draft || d.mapping;
  const setMap = patch => setDraft({ ...m, ...patch });
  const setPart = (part, id, patch) => setMap({ [part]: { ...(m[part] || {}), [id]: { ...((m[part] || {})[id] || {}), ...patch } } });

  const openMapping = async () => {
    setMapOpen(o => !o);
    if (lists || !can) return;
    try {
      const r = await apiFetch("/qbo/lists", { method: "POST" });
      setLists(r); setListNote(r.sentence || "");
    } catch (e) { setLists(null); setListNote(said(e)); }
  };
  const save = async () => {
    setBusy("save"); setMsg("");
    try { const r = await apiFetch("/qbo/mapping", { method: "PUT", body: JSON.stringify(m) }); setMsg(r.sentence); load(); }
    catch (e) { setMsg(said(e)); }
    setBusy("");
  };
  const sync = async body => {
    setBusy(body.all ? "all" : "g:" + body.giftIds[0]); setMsg("");
    try { const r = await apiFetch("/qbo/sync", { method: "POST", body: JSON.stringify(body) }); setMsg(r.sentence); }
    catch (e) { setMsg(said(e)); }
    setBusy(""); load();
  };
  const skip = async (giftId, restore = false) => {
    setBusy("s:" + giftId); setMsg("");
    try { const r = await apiFetch("/qbo/skip", { method: "POST", body: JSON.stringify({ giftIds: [giftId], restore }) }); setMsg(r.sentence); }
    catch (e) { setMsg(said(e)); }
    setBusy(""); load();
  };
  const toggleAuto = async () => {
    setBusy("auto"); setMsg("");
    try { const r = await apiFetch("/qbo/auto-sync", { method: "PUT", body: JSON.stringify({ on: !d.autoSync }) }); setMsg(r.sentence); load(); }
    catch (e) { setMsg(said(e)); }
    setBusy("");
  };

  const income = lists ? (lists.income && lists.income.length ? lists.income : lists.accounts) : null;
  const deposit = lists ? (lists.deposit && lists.deposit.length ? lists.deposit : lists.accounts) : null;
  const expense = lists ? (lists.expense && lists.expense.length ? lists.expense : lists.accounts) : null;
  const classes = lists ? lists.classes || [] : null;
  const mapRow = (part, it) => {
    const v = (m[part] || {})[it.id] || {};
    return (
      <div key={part + it.id} data-testid="qbo-map-row" style={row}>
        <span style={{ flex: "1 1 160px", minWidth: 0, overflowWrap: "anywhere" }}>{it.name}{it.restricted ? " (restricted)" : ""}</span>
        <Pick list={income} value={v.accountId} name={v.accountName} disabled={!can} placeholder="Income account"
          onChange={x => setPart(part, it.id, { accountId: x ? x.id : null, accountName: x ? x.name : null })} />
        <Pick list={classes} value={v.classId} name={v.className} disabled={!can}
          placeholder={classes && !classes.length ? "No classes in this company" : "Class (optional)"}
          onChange={x => setPart(part, it.id, { classId: x ? x.id : null, className: x ? x.name : null })} />
      </div>);
  };

  return (
    <Card data-testid="qbo-sync" style={{ padding: "14px 16px", marginTop: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 15, color: T.ink }}>QuickBooks Online sync</strong>
        {d.environment === "sandbox" && <span data-testid="qbo-sandbox" style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em",
          textTransform: "uppercase", color: T.gold700 }}>Intuit sandbox</span>}
        {can && <button type="button" data-testid="qbo-auto" disabled={busy === "auto" || d.demo} onClick={toggleAuto}
          style={{ ...btn(false), marginLeft: "auto" }}>{d.autoSync ? "Turn auto-sync off" : "Turn auto-sync on"}</button>}
      </div>
      <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, marginTop: 4 }}>{d.definition}</div>
      <div style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.5, marginTop: 4 }}>
        {d.autoSync ? "Auto-sync is on: once an hour Steward sends whatever is waiting." : "Auto-sync is off: nothing goes until somebody presses Sync."}
      </div>
      {d.demoSentence && <div data-testid="qbo-demo" style={{ fontSize: 12.5, color: T.gold700, lineHeight: 1.5, marginTop: 4 }}>{d.demoSentence}</div>}
      {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink, marginTop: 8, lineHeight: 1.5 }}>{msg}</div>}

      {/* 1 · WHERE EACH GIFT LANDS */}
      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <div style={h}>Where each gift lands</div>
          <button type="button" data-testid="qbo-map-open" style={{ ...btn(false), marginLeft: "auto" }} onClick={openMapping}>
            {mapOpen ? "Close" : "Review the mapping"}</button>
        </div>
        {!mapOpen && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 4 }}>
          {Object.values(m.funds || {}).filter(x => x.accountId).length} of {(d.funds || []).length} funds mapped,
          {" "}{Object.values(m.campaigns || {}).filter(x => x.accountId).length} campaigns mapped.
          Deposits go to {m.depositAccount ? m.depositAccount.name || m.depositAccount.id : "an account not chosen yet"}.
        </div>}
        {mapOpen && <div data-testid="qbo-mapping" style={{ marginTop: 6 }}>
          {listNote && <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, marginBottom: 6 }}>{listNote}</div>}
          <div style={row}>
            <span style={{ flex: "1 1 160px" }}>Each gift becomes</span>
            <select disabled={!can} value={m.mode} onChange={e => setMap({ mode: e.target.value })} style={{ ...field, width: 220 }}>
              <option value="salesreceipt">A sales receipt</option>
              <option value="deposit">Part of a deposit, one per payout</option>
            </select>
          </div>
          <div style={row}>
            <span style={{ flex: "1 1 160px" }}>Send gifts dated from</span>
            <input type="date" disabled={!can} value={m.startDate || ""} onChange={e => setMap({ startDate: e.target.value })} style={{ ...field, width: 220 }} />
          </div>
          <div style={row}>
            <span style={{ flex: "1 1 160px" }}>Money lands in</span>
            <Pick testid="qbo-deposit-account" list={deposit} value={m.depositAccount?.id} name={m.depositAccount?.name} disabled={!can}
              placeholder="Deposit account" onChange={x => setMap({ depositAccount: x })} />
          </div>
          <div style={row}>
            <span style={{ flex: "1 1 160px" }}>Stripe fees post to</span>
            <Pick list={expense} value={m.feeAccount?.id} name={m.feeAccount?.name} disabled={!can}
              placeholder="Fees account" onChange={x => setMap({ feeAccount: x })} />
          </div>
          <div style={{ ...h, marginTop: 12 }}>Funds</div>
          {(d.funds || []).map(f => mapRow("funds", f))}
          {(d.campaigns || []).length > 0 && <>
            <div style={{ ...h, marginTop: 12 }}>Campaigns and appeals</div>
            <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, margin: "2px 0 4px" }}>
              A mapped campaign wins over the gift's fund. Leave one blank and its gifts follow their fund.</div>
            {d.campaigns.map(c => mapRow("campaigns", c))}
          </>}
          {can && draft && <button type="button" data-testid="qbo-map-save" disabled={busy === "save"} style={{ ...btn(true), marginTop: 10 }}
            onClick={save}>{busy === "save" ? "Saving…" : "Save the mapping"}</button>}
        </div>}
      </div>

      {/* 2 · PENDING */}
      {p && <div data-testid="qbo-pending" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <div style={h}>Pending</div>
          <span style={{ fontSize: 13.5, color: T.ink }}>
            {p.count} {p.count === 1 ? "gift" : "gifts"},{" "}
            <Figure variant="inline" figureKey="qbo-pending" value={p.total.value} kind="money" label={p.total.label}
              definition={p.total.definition} source={p.total.source} />
          </span>
          {can && p.count > 0 && <button type="button" data-testid="qbo-sync-all" disabled={!!busy || d.demo}
            style={{ ...btn(true), marginLeft: "auto" }} onClick={() => sync({ all: true })}>
            {busy === "all" ? "Sending…" : "Sync all"}</button>}
        </div>
        <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginTop: 2 }}>{p.total.definition}</div>
        {!p.rows.length && <div style={{ fontSize: 13, color: T.ink3, marginTop: 6 }}>Nothing is waiting. Every gift since {p.since} is in QuickBooks or skipped.</div>}
        {p.rows.map(r => (
          <div key={r.giftId} data-testid="qbo-pending-row" style={{ ...row, alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ color: T.ink, overflowWrap: "anywhere" }}>{r.donorName}</strong>
                <Figure variant="cell" figureKey={"qbo-gift-" + r.giftId} value={r.amount} kind="money" label={`${r.donorName} · the gift`}
                  definition="This one gift, at its own amount." source={r.source} />
                <span style={{ color: T.ink3, fontSize: 12 }}>{r.date}</span>
              </div>
              {r.lands && !r.problem && <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>Lands on {r.lands}.</div>}
              {r.problem && <div data-testid="qbo-problem" style={{ fontSize: 12.5, color: T.gold700, lineHeight: 1.5, marginTop: 2 }}>{r.problem}</div>}
            </div>
            {can && <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button type="button" data-testid="qbo-sync-one" disabled={!!busy || d.demo} style={btn(false)}
                onClick={() => sync({ giftIds: [r.giftId] })}>{busy === "g:" + r.giftId ? "Sending…" : r.tried ? "Retry" : "Sync"}</button>
              <button type="button" data-testid="qbo-skip" disabled={!!busy} style={btn(false)} onClick={() => skip(r.giftId)}>Skip</button>
            </div>}
          </div>))}
        {p.count > p.shown && <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>Showing the first {p.shown}. Sync all sends them in order, a hundred at a time.</div>}
      </div>}

      {/* 3 · SENT AND SKIPPED */}
      {p && p.recent.length > 0 && <div data-testid="qbo-recent" style={{ marginTop: 16 }}>
        <div style={h}>Recently sent or skipped</div>
        {p.recent.map(r => (
          <div key={r.giftId} style={row}>
            <span style={{ flex: "1 1 200px", minWidth: 0, overflowWrap: "anywhere" }}>
              {r.donorName} ·{" "}
              <Figure variant="inline" figureKey={"qbo-sent-" + r.giftId} value={r.amount} kind="money" label={`${r.donorName} · the gift`}
                definition="This one gift, at its own amount." source={r.source} /> · {r.date}
            </span>
            {r.status === "synced"
              ? <a href={r.link} target="_blank" rel="noopener noreferrer" style={{ color: T.ink, fontWeight: 700, fontSize: 12.5 }}>Open in QuickBooks</a>
              : <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12.5, color: T.ink3 }}>Skipped</span>
                  {can && <button type="button" style={btn(false)} disabled={!!busy} onClick={() => skip(r.giftId, true)}>Put back</button>}
                </span>}
          </div>))}
      </div>}
      <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginTop: 12 }}>
        Disconnecting stops the sending and keeps this history. The bookkeeper file on this page still works without any of it.
      </div>
    </Card>
  );
}
