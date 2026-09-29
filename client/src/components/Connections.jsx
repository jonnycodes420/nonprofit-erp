// client/src/components/Connections.jsx — INT-1.
//
// ONE SCREEN THAT ANSWERS "IS THE MONEY STILL ARRIVING?"
//
// An organisation takes money through four or five doors at once. Steward
// could already read most of them, and could say nothing at all about whether
// they were still working. What that cost was never an error message: it was a
// PayPal permission that lapsed in March and was noticed in July, with four
// months of gifts that never reached the file.
//
// Each card says the same four things, in the same order, whatever the
// provider: is it healthy, when did it last work, what came through it in
// thirty days, and does the money match. Every number opens.
//
// THE CARDS ARE SORTED BY WHAT IS WRONG. Broken, then quiet, then healthy,
// then the ones that are not connected at all — because the point of the
// screen is the two at the top, and a screen that leads with the healthy ones
// is a screen somebody scrolls past.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, Card } from "./shared";
import { errorMessage } from "../lib/domainError";

const h = { fontSize: 11, fontWeight: 800, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em" };
const btn = primary => ({ background: primary ? T.greenDk : T.white, border: primary ? "none" : "1px solid " + T.bg3,
  borderRadius: 9, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, color: primary ? T.white : T.ink,
  cursor: "pointer", fontFamily: "inherit" });
const money = cents => {
  const n = Math.round(Number(cents) || 0) / 100;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
};
// Brass for what needs a look, ink for what is fine, quiet grey for what is
// not connected. Never red: nothing here is destructive, and red on a screen
// somebody opens every morning stops meaning anything by Thursday.
const DOT = { broken: T.gold700, quiet: T.gold600, healthy: T.greenDk, not_connected: T.ink3 };

const shortDate = v => {
  if (!v) return "never";
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : String(v);
};

// ── INT-POS · THE ITEM MAPPING ─────────────────────────────────────────────
// A register cannot tell a donation from a drink, so the organisation does,
// once. Every item the till has actually sold, with what it is — and a count
// of the ones nobody has said anything about, because "twelve items nobody has
// classified" is the sentence that gets somebody to spend four minutes here
// and an empty list is the sentence that does not.
//
// The default is "everything else", which is the safety property: guessing
// wrong toward revenue costs a click, and guessing wrong toward a gift puts a
// lesson fee on somebody's lifetime giving and can reach a tax receipt.
function ItemMapping({ isReadOnly, isAdmin }) {
  const [d, setD] = useState(null);
  const [draft, setDraft] = useState({});
  const [msg, setMsg] = useState("");
  const load = () => apiFetch("/pos/mapping").then(r => { setD(r); setDraft({}); }).catch(() => setD({ items: [] }));
  useEffect(() => { load(); }, []);
  if (!d) return null;
  if (!(d.items || []).length) return null;
  const set = (key, patch) => setDraft(x => ({ ...x, [key]: { ...(x[key] || {}), ...patch } }));
  const valueOf = it => ({ ...it, ...(draft[it.itemKey] || {}) });
  const save = async () => {
    const items = Object.entries(draft).map(([k, v]) => {
      const it = d.items.find(i => i.itemKey === k) || {};
      return { itemName: it.itemName || k, class: v.class || it.class, eventId: v.eventId ?? it.eventId };
    });
    if (!items.length) return;
    try { const r = await apiFetch("/pos/mapping", { method: "PUT", body: JSON.stringify({ items }) });
      setMsg(r.sentence || "Saved."); load(); }
    catch (e) { setMsg(errorMessage(e, "That did not save.")); }
  };
  return (
    <Card data-testid="pos-mapping" style={{ padding: "14px 16px" }}>
      <div style={h}>What the register sells</div>
      <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, margin: "6px 0 10px" }}>{d.definition}</div>
      {d.unmapped > 0 && (
        <div style={{ fontSize: 13, color: T.ink, marginBottom: 10 }}>
          {d.unmapped} {d.unmapped === 1 ? "item has" : "items have"} not been classified. Until somebody says, they are
          counted as revenue and never as a gift.
        </div>)}
      {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink, marginBottom: 8 }}>{msg}</div>}
      {d.items.map(it => {
        const v = valueOf(it);
        return (
          <div key={it.itemKey} data-testid="pos-item-row" style={{ display: "flex", gap: 10, alignItems: "center",
            flexWrap: "wrap", padding: "7px 0", borderTop: "1px solid " + T.bg3, fontSize: 13 }}>
            <strong style={{ minWidth: 150, color: it.mapped ? T.ink : T.gold700 }}>{it.itemName}</strong>
            <span style={{ color: T.ink3, minWidth: 130 }}>{it.times} {it.times === 1 ? "sale" : "sales"} · {money(it.cents)}</span>
            <select disabled={isReadOnly || !isAdmin} value={v.class}
              onChange={e => set(it.itemKey, { class: e.target.value })}
              style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "5px 8px", fontSize: 12.5 }}>
              {Object.values(d.classes || {}).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            {v.class === "event" && (
              <select disabled={isReadOnly || !isAdmin} value={v.eventId || ""}
                onChange={e => set(it.itemKey, { eventId: e.target.value || null })}
                style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "5px 8px", fontSize: 12.5 }}>
                <option value="">Whichever event was on that day</option>
                {(d.events || []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>)}
          </div>);
      })}
      {!isReadOnly && isAdmin && Object.keys(draft).length > 0 && (
        <button style={{ ...btn(true), marginTop: 10 }} data-testid="pos-mapping-save" onClick={save}>
          Save {Object.keys(draft).length} {Object.keys(draft).length === 1 ? "change" : "changes"}
        </button>)}
      <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginTop: 10 }}>
        {(d.classes || {}).donation?.definition}
      </div>
    </Card>
  );
}

export function ConnectionsView({ isReadOnly, isAdmin = true, onNavigate }) {
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState("");
  const [openId, setOpenId] = useState("");
  const [rows, setRows] = useState(null);
  const [log, setLog] = useState(null);
  const [busy, setBusy] = useState("");

  const load = () => apiFetch("/connections").then(setD)
    .catch(e => { setD({ cards: [] }); setMsg(errorMessage(e, "Connections did not load.")); });
  useEffect(() => { load(); }, []);

  const openFigure = async c => {
    if (openId === c.id + ":gifts") { setOpenId(""); return; }
    setOpenId(c.id + ":gifts"); setRows(null); setLog(null);
    try { setRows(await apiFetch(`/connections/${encodeURIComponent(c.id)}/gifts`)); }
    catch (e) { setRows({ rows: [], definition: errorMessage(e, "Those rows did not load.") }); }
  };
  const openLog = async c => {
    if (openId === c.id + ":log") { setOpenId(""); return; }
    setOpenId(c.id + ":log"); setRows(null); setLog(null);
    try { setLog(await apiFetch(`/connections/${encodeURIComponent(c.id)}/log`)); }
    catch (e) { setLog({ lines: [], definition: errorMessage(e, "The log did not load.") }); }
  };
  const check = async c => {
    setBusy(c.id); setMsg("");
    try {
      const r = await apiFetch(`/giving-sources/${encodeURIComponent(c.id)}/sync`, { method: "POST", body: "{}" });
      setMsg(r?.giftsCreated != null
        ? `Checked. ${r.giftsCreated} new ${r.giftsCreated === 1 ? "gift" : "gifts"}.`
        : "Checked.");
      await load();
    } catch (e) { setMsg(errorMessage(e, "That check did not go through.")); }
    setBusy("");
  };

  if (!d) return <div style={{ padding: 40, textAlign: "center", color: T.ink3, fontSize: 13 }}>Loading…</div>;

  return (
    <div data-testid="connections-view" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={h}>Connections</div>
        <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.55, marginTop: 6, maxWidth: 720 }}>{d.definition}</div>
      </div>
      {d.attentionSentence && (
        <Card data-testid="connections-attention" style={{ padding: "12px 16px", borderLeft: "3px solid " + T.gold600 }}>
          <div style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>{d.attentionSentence}</div>
        </Card>)}
      {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink }}>{msg}</div>}

      <ItemMapping isReadOnly={isReadOnly} isAdmin={isAdmin} />

      {(d.cards || []).map(c => (
        <Card key={c.id} data-testid="connection-card" data-status={c.status} style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 99, background: DOT[c.status] || T.ink3, display: "inline-block" }} />
            <strong style={{ fontSize: 15, color: T.ink }}>{c.label}</strong>
            <span data-testid="connection-status" style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".06em",
              textTransform: "uppercase", color: DOT[c.status] || T.ink3 }}>{(d.statuses?.[c.status]?.label) || c.status}</span>
            {!isReadOnly && isAdmin && c.connected && c.kind === "source" && (
              <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button style={btn(false)} data-testid="connection-log" onClick={() => openLog(c)}>Sync log</button>
                <button style={btn(false)} disabled={busy === c.id} data-testid="connection-check"
                  onClick={() => check(c)}>{busy === c.id ? "Checking…" : "Check now"}</button>
              </span>)}
            {/* INT-1 — DOES THE MONEY MATCH. Stripe's payouts are already
                reconciled to the cent on Finance's Deposits and payouts
                (FIX-1 E); the card links there rather than drawing a second
                view of one computation. The other providers do not publish
                payout data Steward can read yet, and the card says so rather
                than showing an empty panel that implies it should. */}
            {c.connected && (c.kind === "own_stripe" || c.provider === "stripe") && (
              <button style={{ ...btn(false), marginLeft: "auto" }} data-testid="connection-reconcile"
                onClick={() => onNavigate && onNavigate("finance", "deposits")}>Does it match?</button>)}
            {!c.connected && c.kind === "source" && !isReadOnly && isAdmin && (
              <button style={{ ...btn(true), marginLeft: "auto" }} data-testid="connection-connect"
                onClick={() => onNavigate && onNavigate("settings", "integrations")}>Connect</button>)}
          </div>
          <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, marginTop: 4 }}>{c.subtitle}</div>
          <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.55, marginTop: 6 }}>{c.sentence}</div>
          {c.connected && c.kind === "source" && c.provider !== "stripe" && (
            <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginTop: 4 }}>
              This provider does not publish its payouts to Steward, so the money in the bank cannot be matched to these
              gifts automatically. A statement import does it by hand.
            </div>)}

          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginTop: 10 }}>
            <div>
              <button data-testid="connection-gifts-figure" onClick={() => openFigure(c)}
                disabled={!c.figureSource}
                title="The gifts behind this figure"
                style={{ background: "none", border: "none", padding: 0, cursor: c.figureSource ? "pointer" : "default",
                  fontSize: 18, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif",
                  borderBottom: c.figureSource ? "1px dashed " + T.bg3 : "none" }}>
                {money(c.dollars30Cents)}
              </button>
              <div style={{ fontSize: 11.5, color: T.ink3 }}>in the last 30 days</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif" }}>{c.gifts30}</div>
              <div style={{ fontSize: 11.5, color: T.ink3 }}>{c.gifts30 === 1 ? "gift" : "gifts"}</div>
            </div>
            <div>
              <div style={{ fontSize: 13.5, color: T.ink, marginTop: 4 }}>{shortDate(c.lastSyncedAt || c.lastGiftDate)}</div>
              <div style={{ fontSize: 11.5, color: T.ink3 }}>{c.lastSyncedAt ? "last successful check" : "last gift"}</div>
            </div>
          </div>

          {openId === c.id + ":gifts" && (
            <div data-testid="connection-rows" style={{ marginTop: 12, background: T.bg2, border: "1px solid " + T.bg3,
              borderRadius: 10, padding: "10px 12px" }}>
              {!rows ? <div style={{ fontSize: 12.5, color: T.ink3 }}>Loading…</div> : <>
                <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginBottom: 8 }}>{rows.definition}</div>
                {(rows.rows || []).slice(0, 40).map(r => (
                  <div key={r.id} style={{ display: "flex", gap: 10, fontSize: 12.5, color: T.ink, padding: "3px 0" }}>
                    <span style={{ color: T.ink3, width: 86 }}>{r.date}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>{r.donorName}</span>
                    <span style={{ fontWeight: 700 }}>{money(r.amountCents)}</span>
                  </div>))}
                <div style={{ display: "flex", gap: 10, fontSize: 12.5, borderTop: "1px solid " + T.bg3,
                  marginTop: 6, paddingTop: 6, fontWeight: 800, color: T.ink }}>
                  <span style={{ flex: 1 }}>{rows.count} {rows.count === 1 ? "gift" : "gifts"}</span>
                  <span>{money(rows.totalCents)}</span>
                </div>
              </>}
            </div>)}

          {openId === c.id + ":log" && (
            <div data-testid="connection-log-rows" style={{ marginTop: 12, background: T.bg2, border: "1px solid " + T.bg3,
              borderRadius: 10, padding: "10px 12px" }}>
              {!log ? <div style={{ fontSize: 12.5, color: T.ink3 }}>Loading…</div> : <>
                <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginBottom: 8 }}>{log.definition}</div>
                {!(log.lines || []).length && <div style={{ fontSize: 12.5, color: T.ink3 }}>Steward has not checked this one yet.</div>}
                {(log.lines || []).map(l => (
                  <div key={l.id} style={{ fontSize: 12.5, color: l.ok ? T.ink : T.gold700, padding: "4px 0", lineHeight: 1.5 }}>
                    <span style={{ color: T.ink3, marginRight: 8 }}>{shortDate(l.at)}</span>{l.sentence}
                    {!!(l.skipped || []).length && (
                      <span style={{ color: T.ink3 }}> Skipped: {l.skipped.join(", ")}.</span>)}
                  </div>))}
              </>}
            </div>)}
        </Card>))}
    </div>
  );
}

export default ConnectionsView;
