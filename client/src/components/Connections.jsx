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
import { InboxConnectCard, useMailbox } from "./InboxConnect";
import QboSync from "./QboSync";
import { CreditCard, HandCoins, Smartphone, FileSpreadsheet, Mail, AtSign, Send, BookOpen, FileText, Store,
  KeyRound, Webhook, Zap } from "lucide-react";

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
  const [open, setOpen] = useState(false);
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
  // FIX-9 Part A.1 — folded to one line until somebody opens it. The summary
  // still carries the number that matters, so folding hides no count.
  const mapped = d.items.filter(i => i.mapped).length;
  if (!open) return (
    <Card data-testid="pos-mapping" data-open="false" style={{ padding: "12px 16px" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13.5, color: T.ink }}>What the register sells</strong>
        <span style={{ fontSize: 12.5, color: d.unmapped ? T.gold700 : T.ink3 }}>
          {mapped} {mapped === 1 ? "item" : "items"} mapped
          {d.unmapped ? `, ${d.unmapped} not classified` : ""}.
        </span>
        <button style={{ ...btn(false), marginLeft: "auto" }} data-testid="pos-mapping-open"
          onClick={() => setOpen(true)}>Review</button>
      </div>
    </Card>);
  return (
    <Card data-testid="pos-mapping" data-open="true" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={h}>What the register sells</div>
        <button style={{ ...btn(false), marginLeft: "auto" }} onClick={() => setOpen(false)}>Close</button>
      </div>
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

// ── INT-2 · THE BOOKKEEPER'S END ───────────────────────────────────────────
// The mapping, set once, and the month's agreement beside it. Nothing is sent
// until every fund, the fee and each bank account point somewhere: a fund with
// no account is a MISSING mapping and not a default, because a default here
// silently posts restricted money to the wrong place and nobody notices until
// an auditor does.
function Bookkeeping({ isReadOnly, isAdmin }) {
  const [loaded, setD] = useState(null);
  const [openId, setOpenId] = useState("");
  const [openMap, setOpenMap] = useState("");
  const [agree, setAgree] = useState(null);
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch("/bookkeeping").then(r => { setD(r); setDraft(null); }).catch(() => setD(null));
  useEffect(() => { load(); }, []);
  // PARITY-2 Part 5: where QuickBooks sync is on, QboSync's own panel (chosen
  // from the company's chart of accounts) is QuickBooks' mapping; this one
  // stays for Xero.
  const d = loaded && loaded.qboSyncEnabled
    ? { ...loaded, connections: (loaded.connections || []).filter(c => c.vendor !== "quickbooks") } : loaded;
  if (!d || !(d.connections || []).length) return null;
  // FIX-9 Part A.2 — ONE CARD PER ACCOUNTING CONNECTION. QuickBooks appeared
  // twice on this screen: once as this panel's own heading and again as a
  // connection card further down. The connection is the CARD; this is the
  // mapping that opens from it, so it is folded to a line and named for what
  // it is rather than for the vendor.
  const anyOpen = d.connections.some(c => openMap === c.id);
  if (!anyOpen) return (
    <Card data-testid="bookkeeping-mapping" data-open="false" style={{ padding: "12px 16px" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13.5, color: T.ink }}>Where the money posts</strong>
        {d.connections.map(c => (
          <span key={c.id} style={{ fontSize: 12.5, color: c.ready ? T.ink3 : T.gold700 }}>
            {c.vendorLabel}: {c.sends === false ? "sending is not available yet" : c.ready ? "every fund, the fee and each bank account are mapped" : "not sending yet"}.
          </span>))}
        <button style={{ ...btn(false), marginLeft: "auto" }} data-testid="bookkeeping-open"
          onClick={() => setOpenMap(d.connections[0].id)}>Review</button>
      </div>
    </Card>);
  const save = async c => {
    try {
      const r = await apiFetch(`/bookkeeping/${c.id}/mapping`, { method: "PUT",
        body: JSON.stringify({ mapping: draft?.mapping ?? c.mapping, donorNames: draft?.donorNames ?? c.donorNames }) });
      setMsg(r.sentence || "Saved."); load();
    } catch (e) { setMsg(errorMessage(e, "That did not save.")); }
  };
  const openAgreement = async c => {
    if (openId === c.id) { setOpenId(""); return; }
    setOpenId(c.id); setAgree(null);
    try { setAgree(await apiFetch(`/bookkeeping/${c.id}/agreement`)); }
    catch (e) { setAgree({ sentence: errorMessage(e, "That did not load.") }); }
  };
  return (
    <>
      {d.connections.filter(c => openMap === c.id).map(c => {
        const mapping = draft?.id === c.id ? draft.mapping : c.mapping;
        const donorNames = draft?.id === c.id ? draft.donorNames : c.donorNames;
        const setMap = patch => setDraft({ id: c.id, donorNames,
          mapping: { ...mapping, ...patch } });
        return (
          <Card key={c.id} data-testid="bookkeeping-card" style={{ padding: "14px 16px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 15, color: T.ink }}>{c.vendorLabel}</strong>
              <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
                color: c.ready ? T.greenDk : T.gold700 }}>{c.sends === false ? "Sending not available yet" : c.ready ? "Ready to send" : "Not sending yet"}</span>
              {c.sends !== false && <button style={{ ...btn(false), marginLeft: "auto" }} data-testid="bookkeeping-agreement"
                onClick={() => openAgreement(c)}>Do the two agree?</button>}
              <button style={{ ...btn(false), ...(c.sends === false ? { marginLeft: "auto" } : {}) }} onClick={() => setOpenMap("")}>Close</button>
            </div>
            <div data-testid="bookkeeping-sentence" style={{ fontSize: 13, color: T.ink, lineHeight: 1.55, marginTop: 6 }}>{c.sentence}</div>
            {c.sends !== false && <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, marginTop: 4 }}>{d.definition}</div>}
            {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink, marginTop: 8 }}>{msg}</div>}

            <div style={{ marginTop: 10 }}>
              <div style={h}>Each fund posts to</div>
              {(d.funds || []).map(f => (
                <div key={f.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
                  padding: "6px 0", borderTop: "1px solid " + T.bg3, fontSize: 13 }}>
                  <span style={{ minWidth: 160 }}>{f.name}{f.restricted ? " (restricted)" : ""}</span>
                  <input disabled={isReadOnly || !isAdmin} placeholder="Income account"
                    value={(mapping.funds || {})[f.id] || ""}
                    onChange={e => setMap({ funds: { ...(mapping.funds || {}), [f.id]: e.target.value } })}
                    style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8,
                      padding: "5px 8px", fontSize: 12.5, width: 210 }} />
                  <input disabled={isReadOnly || !isAdmin} placeholder={c.secondAxisLabel || "Class"}
                    value={(mapping.classes || {})[f.id] || ""}
                    onChange={e => setMap({ classes: { ...(mapping.classes || {}), [f.id]: e.target.value } })}
                    style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8,
                      padding: "5px 8px", fontSize: 12.5, width: 160 }} />
                </div>))}
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
                padding: "6px 0", borderTop: "1px solid " + T.bg3, fontSize: 13 }}>
                <span style={{ minWidth: 160 }}>Processing fees</span>
                <input disabled={isReadOnly || !isAdmin} placeholder="Expense account"
                  value={mapping.feeAccountId || ""}
                  onChange={e => setMap({ feeAccountId: e.target.value })}
                  style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8,
                    padding: "5px 8px", fontSize: 12.5, width: 210 }} />
              </div>
              {(d.sources || []).map(src => (
                <div key={src} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
                  padding: "6px 0", borderTop: "1px solid " + T.bg3, fontSize: 13 }}>
                  {/* FIX-9 Part A.6 — the provider's LABEL, never its key. */}
                  <span style={{ minWidth: 160 }}>{(d.sourceLabels || {})[src] || src} settles to</span>
                  <input disabled={isReadOnly || !isAdmin} placeholder="Bank account"
                    value={(mapping.depositAccounts || {})[src] || ""}
                    onChange={e => setMap({ depositAccounts: { ...(mapping.depositAccounts || {}), [src]: e.target.value } })}
                    style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8,
                      padding: "5px 8px", fontSize: 12.5, width: 210 }} />
                </div>))}
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: T.ink,
                marginTop: 10, cursor: "pointer" }}>
                <input type="checkbox" disabled={isReadOnly || !isAdmin} checked={!!donorNames}
                  onChange={e => setDraft({ id: c.id, mapping, donorNames: e.target.checked })} style={{ marginTop: 2 }} />
                <span>
                  <strong>Put donor names on the accounting lines</strong>
                  <span style={{ display: "block", fontSize: 12, color: T.ink3, marginTop: 2 }}>{d.donorNamesDefault}</span>
                </span>
              </label>
              {!c.ready && c.sends !== false && <div style={{ fontSize: 12.5, color: T.gold700, marginTop: 8, lineHeight: 1.5 }}>{c.sentence}</div>}
              {!isReadOnly && isAdmin && draft?.id === c.id && (
                <button style={{ ...btn(true), marginTop: 10 }} data-testid="bookkeeping-save" onClick={() => save(c)}>Save the mapping</button>)}
            </div>

            {openId === c.id && (
              <div data-testid="bookkeeping-agreement-rows" style={{ marginTop: 12, background: T.bg2,
                border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px" }}>
                {!agree ? <div style={{ fontSize: 12.5, color: T.ink3 }}>Loading…</div> : <>
                  <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.55 }}>{agree.sentence}</div>
                  <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginTop: 6 }}>{agree.definition}</div>
                  {(agree.onlyInSteward || []).map(r => (
                    <div key={r.payoutId} style={{ fontSize: 12.5, color: T.gold700, padding: "3px 0" }}>
                      Steward sent {money(r.netCents)} for {r.payoutId} and it is not there.
                    </div>))}
                  {(agree.differing || []).map(r => (
                    <div key={r.payoutId} style={{ fontSize: 12.5, color: T.gold700, padding: "3px 0" }}>
                      {r.payoutId}: Steward {money(r.stewardCents)}, the books {money(r.vendorCents)}.
                    </div>))}
                  {(agree.held || []).map(r => (
                    <div key={r.payoutId} style={{ fontSize: 12.5, color: T.ink3, padding: "3px 0" }}>
                      {r.payoutId} is held ({r.status}) and has not been sent.
                    </div>))}
                </>}
              </div>)}
          </Card>);
      })}
    </>
  );
}

// ── INT-3 · SET ONCE ON THE CARD: WHICH LIST, AND WHO GOES TO IT ───────────
//
// NOTHING LEAVES STEWARD UNTIL THIS IS SAVED. The panel shows the preview
// first, and the preview is a count with its reasons, not a promise: "412
// people, 38 new to Mailchimp", and underneath, everybody held back and why.
// An organisation is entitled to know what it is about to put into somebody
// else's system before it happens, and what its bill is about to do.
function EmailToolMapping({ card, onSaved, onError }) {
  const provider = card.provider;
  const [audiences, setAudiences] = useState(null);
  // "Could not ask" and "there are none" are DIFFERENT, and the panel told a
  // customer her Mailchimp account held no audiences when the truth was that
  // Steward never managed to ask. Saying the first as the second sends somebody
  // into another company's settings to fix something that is not broken there.
  const [askFailed, setAskFailed] = useState("");
  const [groups, setGroups] = useState({});          // audienceId -> tag name
  const [audienceId, setAudienceId] = useState("");
  const [meta, setMeta] = useState(null);            // /email-marketing
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");

  useEffect(() => { apiFetch("/email-marketing").then(setMeta).catch(() => {}); }, []);
  useEffect(() => {
    apiFetch(`/email-marketing/${provider}/audiences`)
      .then(r => { setAudiences(r.audiences || []); setAskFailed(""); })
      .catch(e => {
        setAudiences([]);
        setAskFailed(e?.sentence || e?.body?.sentence || errorMessage(e, "Steward could not ask just now."));
      });
  }, [provider]);

  const chosen = Object.entries(groups).filter(([, t]) => String(t || "").trim());
  const runPreview = () => {
    setBusy("preview");
    apiFetch(`/email-marketing/${provider}/preview`, { method: "POST", body: JSON.stringify({ groups }) })
      .then(r => { setPreview(r); setBusy(""); })
      .catch(e => { setBusy(""); onError(e?.sentence || e?.body?.sentence || errorMessage(e, "The preview did not run.")); });
  };
  const save = () => {
    setBusy("save");
    const a = (audiences || []).find(x => x.id === audienceId);
    apiFetch(`/email-marketing/${provider}/mapping`, { method: "POST",
      body: JSON.stringify({ audienceId, audienceName: a ? a.name : null, groups }) })
      .then(r => { setBusy(""); onSaved(r.sentence); })
      .catch(e => { setBusy(""); onError(e?.sentence || e?.body?.sentence || errorMessage(e, "That did not save.")); });
  };

  const noun = card.audienceNoun || "audience";
  return (
    <div data-testid="email-mapping" style={{ marginTop: 12, padding: 14, background: T.bg2,
      border: "1px solid " + T.bg3, borderRadius: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>
        Choose the {noun} to keep in step
      </div>
      {audiences === null ? (
        <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 6 }}>Asking {card.label}…</div>
      ) : askFailed ? (
        <div data-testid="email-ask-failed"
             style={{ fontSize: 12.5, color: T.gold700, marginTop: 6, lineHeight: 1.5 }}>
          {askFailed}
        </div>
      ) : !audiences.length ? (
        <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 6 }}>
          {card.label} reports no {noun}s on this account yet. Make one there and come back.
        </div>
      ) : (
        <select data-testid="email-audience" value={audienceId} onChange={e => setAudienceId(e.target.value)}
          style={{ marginTop: 8, width: "100%", maxWidth: 380, padding: "8px 10px", fontFamily: "inherit",
                   fontSize: 13, border: "1px solid " + T.bg3, borderRadius: 8, background: "#fff", color: T.ink }}>
          <option value="">Choose one</option>
          {audiences.map(a => (
            <option key={a.id} value={a.id}>
              {a.name}{a.members === null || a.members === undefined ? "" : ` (${a.members.toLocaleString()} there now)`}
            </option>
          ))}
        </select>
      )}

      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginTop: 14 }}>
        Which groups go, and the tag each one carries
      </div>
      <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginTop: 4 }}>
        {meta?.fieldsSentence}
      </div>
      <div style={{ marginTop: 8 }}>
        {(meta?.groups || []).map(g => (
          <div key={g.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
                                   padding: "6px 0", borderTop: "1px solid " + T.bg3 }}>
            <label style={{ flex: "1 1 200px", minWidth: 0, fontSize: 12.5, color: T.ink }}>
              <input type="checkbox" data-testid="email-group" data-group={g.id}
                checked={!!groups[g.id]}
                onChange={e => setGroups(prev => {
                  const next = { ...prev };
                  if (e.target.checked) next[g.id] = g.name; else delete next[g.id];
                  return next;
                })}
                style={{ marginRight: 8 }} />
              {g.name}{g.kind === "dynamic" ? <span title="A group by rule: its people are worked out fresh each time" aria-label="Group by rule" style={{ marginLeft: 6, verticalAlign: "-2px" }}><Zap size={13} color={T.gold} aria-hidden="true" /></span> : null}
            </label>
            {!!groups[g.id] && (
              <input data-testid="email-tag" data-group={g.id} value={groups[g.id]}
                onChange={e => setGroups(prev => ({ ...prev, [g.id]: e.target.value }))}
                placeholder="Tag in the email tool"
                style={{ flex: "0 1 200px", padding: "6px 9px", fontFamily: "inherit", fontSize: 12.5,
                         border: "1px solid " + T.bg3, borderRadius: 7, background: "#fff", color: T.ink }} />
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <button data-testid="email-preview" disabled={!chosen.length || busy === "preview"}
          onClick={runPreview}
          style={{ background: "#fff", color: T.ink, border: "1px solid " + T.bg3, borderRadius: 8,
                   padding: "8px 14px", fontWeight: 600, fontSize: 12.5,
                   cursor: chosen.length ? "pointer" : "not-allowed", opacity: chosen.length ? 1 : 0.5 }}>
          {busy === "preview" ? "Counting…" : "Preview"}
        </button>
        <button data-testid="email-save" disabled={!audienceId || !chosen.length || busy === "save"}
          onClick={save}
          style={{ background: T.greenDk, color: "#fff", border: "none", borderRadius: 8,
                   padding: "8px 14px", fontWeight: 700, fontSize: 12.5,
                   cursor: audienceId && chosen.length ? "pointer" : "not-allowed",
                   opacity: audienceId && chosen.length ? 1 : 0.5 }}>
          {busy === "save" ? "Saving…" : "Save and keep in step"}
        </button>
      </div>

      {preview && (
        <div data-testid="email-preview-result" style={{ marginTop: 12, paddingTop: 10,
             borderTop: "1px solid " + T.bg3 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{preview.sentence}</div>
          <div style={{ fontSize: 11.5, color: T.ink3, lineHeight: 1.5, marginTop: 3 }}>{preview.definition}</div>
          {!!(preview.excluded || []).length && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.ink }}>
                Held back: {preview.excludedTotal}
              </div>
              {preview.excluded.map(e => (
                <div key={e.key} style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginTop: 3 }}>
                  <strong style={{ color: T.ink }}>{e.count} {e.label.toLowerCase()}.</strong> {e.sentence}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// FIX-13 Part 5 — ConnectionsView is now the DETAIL behind one card's Manage
// or Fix on the one Connections page (ConnectionsPage below): `onlyIds` picks
// the card, `bare` drops the page header, and `mappings` names which folded
// form ("books" or "pos") belongs under it. With no props it draws what it
// always drew.
export function ConnectionsView({ isReadOnly, isAdmin = true, onNavigate, onlyIds = null, bare = false, mappings = null }) {
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState("");
  const [openId, setOpenId] = useState("");
  const [rows, setRows] = useState(null);
  const [log, setLog] = useState(null);
  const [sales, setSales] = useState(null);
  const [busy, setBusy] = useState("");
  // FIX-10 D — which cards have had their "Why?" opened. The action leads; the
  // reason is one click away and never in front of it.
  const [whyOpen, setWhyOpen] = useState({});
  // INT-3 — which email card has its mapping panel open. Undefined falls back
  // to the card's own `needsMapping`, so a connection that has not chosen a
  // list yet opens showing the one thing it still needs.
  const [mapOpen, setMapOpen] = useState({});

  const load = () => apiFetch("/connections").then(setD)
    .catch(e => { setD({ cards: [] }); setMsg(errorMessage(e, "Connections did not load.")); });
  useEffect(() => { load(); }, []);

  // INT-OAUTH — WHETHER A CONNECT BUTTON CAN ACTUALLY FINISH. The server says
  // which providers have app credentials on this deployment, in booleans and
  // variable NAMES; it never sends a secret or any part of one. A button that
  // cannot complete is disabled and says why, rather than opening a consent
  // screen that ends in the provider's own error page.
  const [oauth, setOauth] = useState(null);
  useEffect(() => { apiFetch("/oauth/status").then(r => setOauth(r.providers)).catch(() => setOauth({})); }, []);
  // null while the answer is still coming: the button stays live rather than
  // flickering disabled, and a click in that window is refused by the server
  // with the same sentence this would have shown.
  const oauthReady = c => (oauth && c.oauthProvider) ? !!oauth[c.oauthProvider]?.ready : null;

  // START. The browser leaves Steward here; it comes back to /oauth/:p/callback.
  const startConnect = async c => {
    setBusy("connect:" + c.id); setMsg("");
    try {
      const r = await apiFetch(`/oauth/${encodeURIComponent(c.oauthProvider)}/start`, { method: "POST" });
      window.location.href = r.url;
    } catch (e) {
      setBusy("");
      setMsg(e?.body?.sentence || errorMessage(e, "That connection could not be started."));
    }
  };

  // INT-3 — one sync, on demand. The same run the daily job does: opt-outs
  // come in first, then the campaigns, then the push.
  const syncEmail = async c => {
    setBusy("sync:" + c.id); setMsg("");
    try {
      const r = await apiFetch(`/email-marketing/${encodeURIComponent(c.provider)}/sync`, { method: "POST" });
      setMsg(r.sentence); load();
    } catch (e) {
      setMsg(e?.sentence || e?.body?.sentence || errorMessage(e, "That check did not finish."));
    } finally { setBusy(""); }
  };

  const openFigure = async c => {
    if (openId === c.id + ":gifts") { setOpenId(""); return; }
    setOpenId(c.id + ":gifts"); setRows(null); setLog(null); setSales(null);
    try { setRows(await apiFetch(`/connections/${encodeURIComponent(c.id)}/gifts`)); }
    catch (e) { setRows({ rows: [], definition: errorMessage(e, "Those rows did not load.") }); }
  };
  // FIX-9 Part A.5 — the sales behind a register's figure.
  const openSales = async c => {
    if (openId === c.id + ":sales") { setOpenId(""); return; }
    setOpenId(c.id + ":sales"); setRows(null); setLog(null); setSales(null);
    try { setSales(await apiFetch(`/connections/${encodeURIComponent(c.id)}/sales`)); }
    catch (e) { setSales({ rows: [], definition: errorMessage(e, "Those rows did not load.") }); }
  };
  const openLog = async c => {
    if (openId === c.id + ":log") { setOpenId(""); return; }
    setOpenId(c.id + ":log"); setRows(null); setLog(null); setSales(null);
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
      {!bare && <div>
        <div style={h}>Connections</div>
        <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.55, marginTop: 6, maxWidth: 720 }}>{d.definition}</div>
      </div>}
      {!bare && d.attentionSentence && (
        <Card data-testid="connections-attention" style={{ padding: "12px 16px", borderLeft: "3px solid " + T.gold600 }}>
          <div style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>{d.attentionSentence}</div>
        </Card>)}
      {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink }}>{msg}</div>}

      {/* FIX-9 Part A.1 — THE CARDS COME FIRST. The screen's job is "is the
          money still arriving", and it led with two long forms: the register's
          item mapping and the whole QuickBooks account mapping, so the first
          card was about sixty per cent down the page. The forms are below now,
          each folded to one line until somebody opens it. */}
      {(d.cards || []).filter(c => !onlyIds || onlyIds.includes(c.id)).map(c => (
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
            {/* FIX-9 Part A.4 — the verb the SERVER says this card can do. A
                file-mode provider has no API to connect to, and its own
                subtitle says so, so it offers "Import a file" and never
                "Connect". No card offers an action it cannot do. */}
            {/* INT-OAUTH — the button that really connects. A card naming an
                OAuth provider starts the handshake here; one that does not
                keeps the settings link it had; one whose provider has no
                credentials on this deployment is disabled and says why
                underneath, because a button that opens a page nobody can
                complete is worse than no button. */}
            {!c.connected && c.action && !(c.parts || []).length && !isReadOnly && isAdmin && (
              c.oauthProvider ? (
                <button style={{ ...btn(oauthReady(c) !== false), marginLeft: "auto",
                                 opacity: oauthReady(c) === false ? 0.5 : 1,
                                 cursor: oauthReady(c) === false ? "not-allowed" : "pointer" }}
                  data-testid="connection-connect" data-action="oauth"
                  data-provider={c.oauthProvider} data-ready={String(oauthReady(c) !== false)}
                  disabled={oauthReady(c) === false || busy === "connect:" + c.id}
                  title={oauthReady(c) === false ? (oauth?.[c.oauthProvider]?.sentence || "") : ""}
                  onClick={() => startConnect(c)}>
                  {busy === "connect:" + c.id ? "Opening…" : c.actionLabel}
                </button>
              ) : (
                <button style={{ ...btn(true), marginLeft: "auto" }} data-testid="connection-connect"
                  data-action={c.action}
                  onClick={() => onNavigate && onNavigate("settings",
                    { section: c.action === "import" ? "imports" : "connections" })}>{c.actionLabel}</button>
              ))}
          </div>
          <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, marginTop: 4 }}>{c.subtitle}</div>
          <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.55, marginTop: 6 }}>{c.sentence}</div>

          {/* FIX-10 D — THE TWO THINGS INSIDE THE STRIPE CARD. Stripe used to
              be two cards, both labelled Stripe, both offering "Connect", and
              nothing on the screen said which one somebody wanted. One card,
              two plain labels, each with its own state and its own button. */}
          {(c.parts || []).length > 1 && (
            <div data-testid="connection-parts" style={{ marginTop: 10 }}>
              {c.parts.map(part => (
                <div key={part.key} data-testid="connection-part" data-part={part.key}
                  style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap",
                    padding: "8px 0", borderTop: "1px solid " + T.bg3 }}>
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 99, marginTop: 5,
                    background: part.connected ? T.greenDk : T.ink3, display: "inline-block", flexShrink: 0 }} />
                  <strong style={{ fontSize: 13, color: T.ink }}>{part.label}</strong>
                  <span style={{ fontSize: 12.5, color: T.ink3, flex: "1 1 220px", minWidth: 0, lineHeight: 1.5 }}>
                    {part.sentence}
                  </span>
                  {!part.connected && part.action && !isReadOnly && isAdmin && (
                    <button style={{ ...btn(false), marginLeft: "auto" }}
                      data-testid="connection-part-connect" data-part-action={part.key}
                      onClick={() => onNavigate && onNavigate("settings", { section: "connections", focus: "stripe" })}>
                      {part.actionLabel || "Connect"}
                    </button>)}
                </div>))}
            </div>)}
          {/* Why a Connect button is greyed out, in the server's own words,
              and what this connection will be allowed to see if it opens. */}
          {!c.connected && c.oauthProvider && oauthReady(c) === false && (
            <div data-testid="connection-not-ready"
                 style={{ fontSize: 12, color: T.gold700, lineHeight: 1.5, marginTop: 6 }}>
              {oauth[c.oauthProvider].sentence}
            </div>)}
          {!c.connected && c.oauthProvider && oauthReady(c) === true && oauth[c.oauthProvider].note && (
            <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginTop: 6 }}>
              {oauth[c.oauthProvider].note}
            </div>)}
          {/* PayPal has no consent screen to open yet, and the card says so
              instead of offering a button that goes nowhere. */}
          {/* FIX-10 D — PAYPAL LEADS WITH THE ACTION. The card used to open with
              somebody else's partner programme and put what she can do today in
              the middle of the same sentence. The partner-programme context is
              behind "Why?", and the deployment's own webhook state is not a
              sentence for a customer at all: it is in the console. */}
          {!c.connected && !c.oauthProvider && c.provider === "paypal" && oauth?.paypal?.sentence && (
            <div data-testid="connection-paypal-waiting"
                 style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.5, marginTop: 6 }}>
              {oauth.paypal.sentence}
              {oauth.paypal.why && <>
                {" "}
                <button data-testid="connection-paypal-why" aria-expanded={!!whyOpen[c.id]}
                  onClick={() => setWhyOpen(w => ({ ...w, [c.id]: !w[c.id] }))}
                  style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700,
                    textDecoration: "underline dotted", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5 }}>
                  Why?
                </button>
                {whyOpen[c.id] && (
                  <div data-testid="connection-paypal-why-body"
                       style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginTop: 5 }}>
                    {oauth.paypal.why}
                  </div>)}
              </>}
            </div>)}
          {/* INT-3 — the one decision an email connection still needs, and the
              check that runs it. Opened by default when nothing is mapped,
              because an unmapped connection is doing nothing and the card
              should not make somebody hunt for the reason. */}
          {c.connected && c.kind === "email_marketing" && !isReadOnly && isAdmin && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button data-testid="email-choose" style={btn(false)}
                  onClick={() => setMapOpen(m => ({ ...m, [c.id]: !(m[c.id] ?? c.needsMapping) }))}>
                  {c.mapped ? "Change what is sent" : `Choose the ${c.audienceNoun || "audience"}`}
                </button>
                {c.mapped && (
                  <button data-testid="email-sync" style={btn(false)} disabled={busy === "sync:" + c.id}
                    onClick={() => syncEmail(c)}>
                    {busy === "sync:" + c.id ? "Checking…" : "Check now"}
                  </button>)}
              </div>
              {(mapOpen[c.id] ?? c.needsMapping) && (
                <EmailToolMapping card={c}
                  onSaved={s => { setMsg(s); setMapOpen(m => ({ ...m, [c.id]: false })); load(); }}
                  onError={setMsg} />)}
            </div>)}
          {c.connected && c.kind === "source" && c.provider !== "stripe" && (
            <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginTop: 4 }}>
              This provider does not publish its payouts to Steward, so the money in the bank cannot be matched to these
              gifts automatically. A statement import does it by hand.
            </div>)}

          {/* FIX-9 Parts A.3 and A.5 — THREE SHAPES, BECAUSE THERE ARE THREE
              KINDS OF CONNECTION. An accounting system has no gifts, and a
              register's money is mostly not gifts; both were drawing the
              money-in card, so QuickBooks read "0 gifts · never last gift"
              and Square read "nothing has come through" over eleven sales. */}
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginTop: 10 }}>
            {c.kind === "bookkeeping" && c.sends === false ? null
              : c.kind === "bookkeeping" ? <>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif" }}>{c.deposits30 ?? 0}</div>
                <div style={{ fontSize: 11.5, color: T.ink3 }}>{(c.deposits30 ?? 0) === 1 ? "deposit sent" : "deposits sent"}</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif" }}>{money(c.deposits30Cents)}</div>
                <div style={{ fontSize: 11.5, color: T.ink3 }}>sent this month</div>
              </div>
              {c.held30 > 0 && <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: T.gold700, fontFamily: "'DM Serif Display',serif" }}>{c.held30}</div>
                <div style={{ fontSize: 11.5, color: T.ink3 }}>held, not sent</div>
              </div>}
              <div>
                <div style={{ fontSize: 13.5, color: T.ink, marginTop: 4 }}>{shortDate(c.lastSentAt)}</div>
                <div style={{ fontSize: 11.5, color: T.ink3 }}>last sent</div>
              </div>
            {/* INT-3 — A FOURTH SHAPE, BECAUSE AN EMAIL TOOL HAS NO MONEY.
                Drawing the money-in figures here would print "$0 · 0 gifts"
                under Mailchimp, which is not a quiet connection, it is a
                category error. What this card counts is people kept in step
                and when it last checked. */}
            </> : c.kind === "email_marketing" ? <>
              <div>
                <div style={{ fontSize: 13.5, color: T.ink, marginTop: 4 }}>
                  {c.audienceName || (c.connected ? "None chosen yet" : "not connected")}
                </div>
                <div style={{ fontSize: 11.5, color: T.ink3 }}>{c.audienceNoun || "audience"} kept in step</div>
              </div>
              <div>
                <div style={{ fontSize: 13.5, color: T.ink, marginTop: 4 }}>{shortDate(c.lastSyncedAt)}</div>
                <div style={{ fontSize: 11.5, color: T.ink3 }}>last checked</div>
              </div>
            </> : c.kind === "pos" ? <>
              <div>
                <button data-testid="connection-sales-figure" onClick={() => openSales(c)}
                  disabled={!c.posFigureSource} title="The sales behind this figure"
                  style={{ background: "none", border: "none", padding: 0, cursor: c.posFigureSource ? "pointer" : "default",
                    fontSize: 18, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif",
                    borderBottom: c.posFigureSource ? "1px dashed " + T.bg3 : "none" }}>
                  {money(c.takings30Cents || 0)}
                </button>
                <div style={{ fontSize: 11.5, color: T.ink3 }}>taken in the last 30 days</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif" }}>{c.sales30 || 0}</div>
                <div style={{ fontSize: 11.5, color: T.ink3 }}>{(c.sales30 || 0) === 1 ? "sale" : "sales"}</div>
              </div>
              <div>
                <button data-testid="connection-gifts-figure" onClick={() => openFigure(c)}
                  disabled={!c.figureSource} title="The gifts behind this figure"
                  style={{ background: "none", border: "none", padding: 0, cursor: c.figureSource ? "pointer" : "default",
                    fontSize: 18, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif",
                    borderBottom: c.figureSource ? "1px dashed " + T.bg3 : "none" }}>
                  {money(c.dollars30Cents)}
                </button>
                <div style={{ fontSize: 11.5, color: T.ink3 }}>of it given</div>
              </div>
            </> : <>
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
            </>}
          </div>
          {c.heldSentence && <div style={{ fontSize: 12.5, color: T.gold700, marginTop: 6 }}>{c.heldSentence}</div>}

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

          {openId === c.id + ":sales" && (
            <div data-testid="connection-sales-rows" style={{ marginTop: 12, background: T.bg2, border: "1px solid " + T.bg3,
              borderRadius: 10, padding: "10px 12px" }}>
              {!sales ? <div style={{ fontSize: 12.5, color: T.ink3 }}>Loading…</div> : <>
                <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginBottom: 8 }}>{sales.definition}</div>
                {(sales.rows || []).slice(0, 40).map(r => (
                  <div key={r.id} style={{ display: "flex", gap: 10, fontSize: 12.5, color: T.ink, padding: "3px 0" }}>
                    <span style={{ color: T.ink3, width: 86 }}>{r.on}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>{r.who || "At the register"}</span>
                    {r.giftCents > 0 && <span style={{ color: T.greenDk, fontWeight: 700 }}>{money(r.giftCents)} given</span>}
                    <span style={{ fontWeight: 700 }}>{money(r.totalCents)}</span>
                  </div>))}
                <div style={{ display: "flex", gap: 10, fontSize: 12.5, borderTop: "1px solid " + T.bg3,
                  marginTop: 6, paddingTop: 6, fontWeight: 800, color: T.ink }}>
                  <span style={{ flex: 1 }}>{sales.count} {sales.count === 1 ? "sale" : "sales"}</span>
                  {sales.giftCents > 0 && <span style={{ color: T.greenDk }}>{money(sales.giftCents)} given</span>}
                  <span>{money(sales.totalCents)}</span>
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

      {/* The two mappings, below the cards, each a line until it is opened. */}
      {(!bare || mappings === "pos") && <ItemMapping isReadOnly={isReadOnly} isAdmin={isAdmin} />}
      {(!bare || mappings === "books") && <Bookkeeping isReadOnly={isReadOnly} isAdmin={isAdmin} />}
      {mappings === "books" && <QboSync connectionId={onlyIds && onlyIds[0]} isReadOnly={isReadOnly} isAdmin={isAdmin} />}
    </div>
  );
}

// ═══ FIX-13 Part 5 — ONE CONNECTIONS PAGE ═══════════════════════════════════
//
// Settings had an Integrations tab ("set this up") and a Connections tab ("is
// it still working") covering the same ground, and things were scattered
// between them: INT-BUILD-1 found the inbox card halfway down Integrations,
// below Payments, the QR code and the embed form. This is the one page now.
//
// One summary line, then six sections in a fixed order, and every connection
// is the SAME card: icon, name, one line on what it does, a status, and one
// button. The status is one of three: Connected (with when it last synced),
// Not connected, or Needs attention in brass with the reason. The button is
// Connect, Manage or Fix, and only Connect on a card that is not connected is
// emerald. Manage and Fix open the card's detail in place, which is the
// INT-1 card it always was (figures, the sync log, Check now, the mappings).
//
// This changes the SCREEN only. Every button calls the handshake, route or
// panel it called before; nothing here connects anything a new way.
const SECTIONS = [
  { id: "giving", title: "Giving", line: "Where gifts come in." },
  { id: "inbox", title: "Email and calendar", line: "Conversations and meetings with people on file, logged for you." },
  { id: "marketing", title: "Email marketing", line: "Your newsletter list, kept in step with Steward." },
  { id: "books", title: "Books", line: "What your bookkeeper and accounting system receive." },
  { id: "pos", title: "Point of sale", line: "Registers at the shop, the café or the event." },
  { id: "api", title: "Build your own", line: "Keys, webhooks and Zapier, for tools Steward does not connect to itself." },
];
// The order inside Giving: the processors people know, then the files.
const GIVING_ORDER = ["stripe", "paypal", "givebutter", "donorbox", "zeffy", "cashapp", "venmo", "statements"];
const CONN_ICON = {
  stripe: CreditCard, paypal: HandCoins, givebutter: HandCoins, donorbox: HandCoins, zeffy: HandCoins,
  cashapp: Smartphone, venmo: Smartphone, statements: FileSpreadsheet, inbox: Mail, bcc: AtSign,
  email_marketing: Send, bookkeeping: BookOpen, bookkeeperFile: FileText, pos: Store,
  apiKeys: KeyRound, webhooks: Webhook, zapier: Zap,
};
const STATUS_WORD = { connected: "Connected", not_connected: "Not connected", attention: "Needs attention", ready: "Ready" };
const sinceWord = ts => {
  if (!ts) return "";
  const t = new Date(ts);
  if (isNaN(t)) return "";
  const days = Math.floor((Date.now() - t) / 864e5);
  if (days < 1) return "synced today";
  if (days === 1) return "synced yesterday";
  if (days < 30) return `synced ${days} days ago`;
  return "synced " + t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const statusOf = c => c.status === "broken" || c.status === "quiet" ? "attention"
  : c.connected ? "connected" : "not_connected";
const sectionOf = c => c.kind === "email_marketing" ? "marketing" : c.kind === "bookkeeping" ? "books"
  : c.kind === "pos" ? "pos" : "giving";

const PAGE_CSS = `.conn-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.conn-grid > .conn-detail{grid-column:1 / -1}
@media (max-width:760px){.conn-grid{grid-template-columns:minmax(0,1fr)}}`;

function ConnCard({ card, open, onButton, isAdmin, isReadOnly }) {
  const Icon = CONN_ICON[card.icon] || FileText;
  const att = card.status === "attention";
  const isConnect = card.button && card.button.kind === "connect" && card.status === "not_connected";
  const canPress = card.button && !(card.button.adminOnly && !isAdmin) && !(card.button.writes && isReadOnly);
  return (
    <div id={"conn-" + card.key} data-testid="conn-card" data-key={card.key} data-status={card.status}
      style={{ background: T.white, border: "1px solid " + (open ? T.ink3 : T.bg2), borderRadius: 12,
        padding: "16px 18px", display: "flex", gap: 14, alignItems: "flex-start", minWidth: 0, scrollMarginTop: 80 }}>
      <span aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 10, background: T.bg, color: T.ink,
        display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={19} strokeWidth={1.75} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: "1 1 160px" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, overflowWrap: "anywhere" }}>{card.name}</div>
            <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, marginTop: 2 }}>{card.line}</div>
          </div>
          {card.button && canPress && (
            <button type="button" data-testid="conn-button" data-kind={card.button.kind}
              aria-expanded={card.button.opens ? !!open : undefined}
              disabled={!!card.button.disabled} title={card.button.title || undefined}
              onClick={onButton}
              style={{ background: isConnect ? T.greenDk : T.white, color: isConnect ? T.white : T.ink,
                border: "1px solid " + (isConnect ? T.greenDk : T.ink), borderRadius: 9, padding: "8px 15px",
                minHeight: 36, fontSize: 13, fontWeight: 700, cursor: card.button.disabled ? "not-allowed" : "pointer",
                opacity: card.button.disabled ? 0.5 : 1, fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}>
              {card.button.label}
            </button>)}
        </div>
        <div data-testid="conn-status" style={{ display: "flex", gap: 7, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 99, flexShrink: 0, boxSizing: "border-box",
            background: att ? T.gold600 : card.status === "connected" || card.status === "ready" ? T.ink : "transparent",
            border: card.status === "not_connected" ? "1.5px solid " + T.ink3 : "none" }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: att ? T.gold700 : card.status === "not_connected" ? T.ink3 : T.ink }}>
            {STATUS_WORD[card.status]}</span>
          {card.status === "connected" && card.synced && <span style={{ fontSize: 12, color: T.ink3 }}>· {card.synced}</span>}
        </div>
        {card.reason && <div data-testid="conn-reason" style={{ fontSize: 12.5, color: att ? T.gold700 : T.ink3, lineHeight: 1.5, marginTop: 4 }}>{card.reason}</div>}
      </div>
    </div>
  );
}

export function ConnectionsPage({ isReadOnly, isAdmin = true, onNavigate, focus = null,
  stripe = null, stripeLoading = false, onConnectStripe, paymentsPanel = null,
  renderGivingSources, bccPanel = null, apiKeysPanel = null }) {
  const [d, setD] = useState(null);
  const [mail] = useMailbox();
  const [inbound, setInbound] = useState(null);
  const [keys, setKeys] = useState(null);
  const [hooks, setHooks] = useState(null);
  const [oauth, setOauth] = useState(null);
  const [open, setOpen] = useState(focus === "inbox" ? "inbox" : "");
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [nonce, setNonce] = useState(0);

  const loadHooks = () => apiFetch("/webhooks").then(setHooks).catch(() => setHooks(null));
  useEffect(() => {
    apiFetch("/connections").then(setD).catch(e => { setD({ cards: [] }); setMsg(errorMessage(e, "Connections did not load.")); });
    apiFetch("/settings/inbound-email").then(setInbound).catch(() => setInbound({ enabled: false }));
    apiFetch("/oauth/status").then(r => setOauth(r.providers || {})).catch(() => setOauth({}));
    if (isAdmin) {
      apiFetch("/api-keys").then(r => setKeys(r.keys || [])).catch(() => setKeys(null));
      loadHooks();
    }
  }, [isAdmin]); // eslint-disable-line

  // A deep link's anchor (#api, #inbox, #stripe, a provider key, a section)
  // lands on its card or section once the cards are drawn.
  useEffect(() => {
    if (!focus || !d) return;
    const el = document.getElementById("conn-" + focus) || document.getElementById("connections-" + focus);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus, !!d]); // eslint-disable-line

  const startOauth = async (c) => {
    setBusy("connect:" + c.id); setMsg("");
    try {
      const r = await apiFetch(`/oauth/${encodeURIComponent(c.oauthProvider)}/start`, { method: "POST" });
      window.location.href = r.url;
    } catch (e) { setBusy(""); setMsg(e?.body?.sentence || errorMessage(e, "That connection could not be started.")); }
  };
  const toggle = (key, auto = null) => {
    setNonce(n => n + 1);
    setOpen(o => (o === key && !auto ? "" : key));
  };
  const resume = async id => {
    setBusy("hook:" + id); setMsg("");
    try { const r = await apiFetch(`/webhooks/${encodeURIComponent(id)}/resume`, { method: "POST" }); setMsg(r.sentence || "Back on."); loadHooks(); }
    catch (e) { setMsg(errorMessage(e, "That did not change.")); }
    setBusy("");
  };

  if (!d) return <div style={{ padding: 40, textAlign: "center", color: T.ink3, fontSize: 13 }}>Loading…</div>;

  // ── The cards, one model for every kind ────────────────────────────────
  const cards = [];
  const oauthNotReady = c => c.oauthProvider && oauth && oauth[c.oauthProvider] && oauth[c.oauthProvider].ready === false;
  const giving = (k) => renderGivingSources ? renderGivingSources(k, nonce) : null;
  for (const c of d.cards || []) {
    let status = statusOf(c);
    let reason = status === "attention" ? c.sentence : "";
    const key = c.kind === "own_stripe" ? "stripe" : c.kind === "statements" ? "statements" : c.provider;
    const isFile = c.action === "import";
    const isSource = c.kind === "source" || c.kind === "statements";
    // Stripe set up but not finished is a thing to fix, in Settings' own words.
    if (c.kind === "own_stripe" && stripe && stripe.onboardingStarted && !stripe.connected && status !== "connected") {
      status = "attention";
      reason = stripe.checked ? "Stripe setup isn't finished. Stripe cannot take gifts on it until it is." : "Steward could not check with Stripe just now.";
    }
    let button;
    const detail = () => <>
      {c.kind === "own_stripe" && paymentsPanel}
      <ConnectionsView key={nonce} isReadOnly={isReadOnly} isAdmin={isAdmin} onNavigate={onNavigate} onlyIds={[c.id]} bare
        mappings={c.kind === "bookkeeping" ? "books" : c.kind === "pos" ? "pos" : null} />
      {c.kind === "source" && giving(null)}
    </>;
    if (status === "not_connected") {
      if (c.kind === "own_stripe") button = { kind: "connect", label: stripeLoading ? "Opening…" : "Connect", adminOnly: true, writes: true, onClick: () => onConnectStripe && onConnectStripe() };
      else if (c.oauthProvider) button = { kind: "connect", label: busy === "connect:" + c.id ? "Opening…" : "Connect", adminOnly: true, writes: true,
        disabled: oauthNotReady(c), title: oauthNotReady(c) ? oauth[c.oauthProvider].sentence : "", onClick: () => startOauth(c) };
      else if (isFile || c.kind === "statements") button = { kind: "import", label: "Import a file", opens: true, adminOnly: true, onClick: () => toggle(key), detail: () => giving(null) };
      else if (isSource) button = { kind: "connect", label: "Connect", opens: true, adminOnly: true, writes: true, onClick: () => toggle(key, c.provider), detail: () => giving(c.provider) };
    } else {
      button = { kind: status === "attention" ? "fix" : "manage", label: status === "attention" ? "Fix" : "Manage", opens: true,
        onClick: () => (status === "attention" && c.kind === "own_stripe" && stripe && stripe.checked && onConnectStripe) ? onConnectStripe() : toggle(key),
        detail: c.kind === "statements" ? () => giving(null) : detail };
    }
    if (status === "not_connected" && oauthNotReady(c)) reason = oauth[c.oauthProvider].sentence;
    // Square is listed only where it is live: an unconnected Square card on a
    // deployment with no Square app is a button that cannot finish.
    if (c.provider === "square" && status === "not_connected" && oauthNotReady(c)) continue;
    cards.push({ key, section: sectionOf(c), icon: c.kind === "own_stripe" ? "stripe" : c.kind === "source" || c.kind === "statements" ? key : c.kind,
      name: c.label, line: c.subtitle, status, reason,
      synced: sinceWord(c.lastSyncedAt || c.lastSentAt || c.lastGiftDate), button });
  }
  // DONORBOX HAS NO ADAPTER (LANDING-3). It is listed because people ask for
  // it, and it says what is true: its export comes in as a statement.
  if (!cards.some(c => c.key === "donorbox")) cards.push({ key: "donorbox", section: "giving", icon: "donorbox", name: "Donorbox",
    line: "Steward has no direct Donorbox connection yet. Its gift export comes in as a statement file.",
    status: "not_connected", button: { kind: "import", label: "Import a file", opens: true, adminOnly: true, onClick: () => toggle("donorbox"), detail: () => giving(null) } });

  // Email and calendar: the one inbox card, and the BCC address.
  if (mail) {
    const ps = (mail.providers || []);
    const broken = ps.find(p => p.connected && p.lastError);
    const conn = ps.filter(p => p.connected);
    const last = conn.map(p => p.lastSyncedAt).filter(Boolean).sort().pop();
    const st = broken ? "attention" : mail.connected ? "connected" : "not_connected";
    cards.push({ key: "inbox", section: "inbox", icon: "inbox", name: "Gmail and Outlook",
      line: "Emails and meetings with people on file land on their timeline. Each person connects their own.",
      status: st, reason: broken ? broken.lastError : st === "connected" ? `Connected as ${conn.map(p => p.address).filter(Boolean).join(", ")}.` : "",
      synced: sinceWord(last),
      button: { kind: st === "attention" ? "fix" : st === "connected" ? "manage" : "connect", label: st === "attention" ? "Fix" : st === "connected" ? "Manage" : "Connect",
        opens: true, onClick: () => toggle("inbox"),
        detail: () => <InboxConnectCard isReadOnly={isReadOnly} onNavigate={onNavigate} /> } });
  }
  if (inbound) {
    const on = !!(inbound.enabled && inbound.address);
    cards.push({ key: "bcc", section: "inbox", icon: "bcc", name: "BCC address",
      line: on ? `BCC ${inbound.address} on an email and it is logged to the person it names.` : "One address for the organisation: BCC it on an email and it is logged to the person it names.",
      status: on ? "connected" : "not_connected",
      button: { kind: on ? "manage" : "connect", label: on ? "Manage" : "Connect", opens: true, onClick: () => toggle("bcc"), detail: () => bccPanel } });
  }
  // Books: the bookkeeper file needs nothing connected; it is always ready.
  cards.push({ key: "bookkeeper-file", section: "books", icon: "bookkeeperFile", name: "Bookkeeper file",
    line: "A monthly file of every gift, by fund and payout, that foots to the cent. Nothing to connect.",
    status: "ready", button: { kind: "manage", label: "Manage", onClick: () => onNavigate && onNavigate("finance", "close") } });
  // Build your own.
  if (isAdmin) {
    const live = (keys || []).filter(k => !k.revokedAt);
    const used = live.map(k => k.lastUsedAt).filter(Boolean).sort().pop();
    cards.push({ key: "api", section: "api", icon: "apiKeys", name: "API keys",
      line: "For Zapier or your own tools. A key reads your people and gifts and is shown once.",
      status: live.length ? "connected" : "not_connected",
      reason: live.length ? `${live.length} ${live.length === 1 ? "key" : "keys"} in use.` : "",
      synced: used ? sinceWord(used).replace(/^synced/, "last used") : "",
      button: { kind: live.length ? "manage" : "connect", label: live.length ? "Manage" : "Connect", opens: true, onClick: () => toggle("api"), detail: () => apiKeysPanel } });
    const eps = (hooks && hooks.endpoints) || [];
    const paused = eps.find(e => e.paused);
    const lastHook = eps.map(e => e.lastDeliveredAt).filter(Boolean).sort().pop();
    const hookDetail = () => (
      <div data-testid="webhooks-detail" style={{ background: T.white, border: "1px solid " + T.bg2, borderRadius: 12, padding: "16px 18px" }}>
        <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.55, marginBottom: 10 }}>{hooks?.definition}</div>
        {!eps.length && <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.55 }}>Nothing is set up yet. An endpoint is added through the Steward API with an API key, or by Zapier when a Zap starts. <a href="/connections#api" style={{ color: T.ink, fontWeight: 700 }}>How the API works</a></div>}
        {eps.map(e => (
          <div key={e.id} data-testid="webhook-row" style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid " + T.bg2 }}>
            <code style={{ fontSize: 12.5, color: T.ink, overflowWrap: "anywhere", flex: "1 1 240px", minWidth: 0 }}>{e.url}</code>
            <span style={{ fontSize: 12.5, color: e.paused ? T.gold700 : T.ink3, flex: "1 1 200px", minWidth: 0 }}>{e.sentence}</span>
            {e.paused && !isReadOnly && <button type="button" onClick={() => resume(e.id)} disabled={busy === "hook:" + e.id}
              style={{ background: T.white, color: T.ink, border: "1px solid " + T.ink, borderRadius: 9, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              {busy === "hook:" + e.id ? "Turning on…" : "Turn back on"}</button>}
          </div>))}
      </div>);
    const hst = paused ? "attention" : eps.length ? "connected" : "not_connected";
    cards.push({ key: "webhooks", section: "api", icon: "webhooks", name: "Webhooks",
      line: "Steward posts to an address you choose when something happens here, signed and retried for a day.",
      status: hst, reason: paused ? paused.sentence : "", synced: lastHook ? sinceWord(lastHook).replace(/^synced/, "last delivered") : "",
      button: { kind: hst === "attention" ? "fix" : hst === "connected" ? "manage" : "connect", label: hst === "attention" ? "Fix" : hst === "connected" ? "Manage" : "Connect",
        opens: true, onClick: () => toggle("webhooks"), detail: hookDetail } });
    const zap = eps.filter(e => /zapier\.com/i.test(e.url || ""));
    cards.push({ key: "zapier", section: "api", icon: "zapier", name: "Zapier",
      line: "Start a Zap when a gift comes in, or record one from somewhere else, with an API key.",
      status: zap.length ? "connected" : "not_connected",
      reason: zap.length ? `${zap.length} ${zap.length === 1 ? "Zap is" : "Zaps are"} listening.` : "",
      button: { kind: zap.length ? "manage" : "connect", label: zap.length ? "Manage" : "Connect", opens: true, onClick: () => toggle("zapier"),
        detail: () => (
          <div data-testid="zapier-detail" style={{ background: T.white, border: "1px solid " + T.bg2, borderRadius: 12, padding: "16px 18px", fontSize: 13, color: T.ink, lineHeight: 1.6 }}>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              <li>Make an API key on the API keys card, named for the Zap.</li>
              <li>In Zapier, choose Steward as the app and paste the key when it asks.</li>
              <li>Each Zap that listens for a gift shows up here and under Webhooks.</li>
            </ol>
            <div style={{ marginTop: 8 }}><a href="/connections#api" style={{ color: T.ink, fontWeight: 700 }}>About the Steward API</a></div>
          </div>) } });
  }

  // ── The summary line ───────────────────────────────────────────────────
  const nConn = cards.filter(c => c.status === "connected").length;
  const nAtt = cards.filter(c => c.status === "attention").length;
  const shown = filter ? cards.filter(c => c.status === filter) : cards;
  const order = c => { const i = GIVING_ORDER.indexOf(c.key); return i < 0 ? 99 : i; };
  const sumBtn = (on) => ({ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, cursor: "pointer",
    textDecoration: "underline", textUnderlineOffset: 3, color: on ? T.gold700 : T.ink });

  return (
    <div data-testid="connections-page" style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      <style>{PAGE_CSS}</style>
      <div data-testid="connections-summary" style={{ fontSize: 15, color: T.ink, lineHeight: 1.6 }}>
        <button type="button" data-testid="summary-connected" aria-pressed={filter === "connected"} style={sumBtn(false)}
          onClick={() => setFilter(f => f === "connected" ? "" : "connected")}>{nConn} connected</button>
        {", "}
        <button type="button" data-testid="summary-attention" aria-pressed={filter === "attention"} style={sumBtn(nAtt > 0)}
          onClick={() => setFilter(f => f === "attention" ? "" : "attention")}>{nAtt} {nAtt === 1 ? "needs" : "need"} attention</button>
        .
        {filter && <button type="button" onClick={() => setFilter("")} style={{ ...sumBtn(false), fontWeight: 600, color: T.ink3, marginLeft: 12 }}>Show every connection</button>}
      </div>
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div>}

      {SECTIONS.map(sec => {
        const list = shown.filter(c => c.section === sec.id).sort((a, b) => sec.id === "giving" ? order(a) - order(b) : 0);
        if (!list.length) return null;
        return (
          <section key={sec.id} id={"connections-" + sec.id} data-testid="connections-section" data-section={sec.id} style={{ scrollMarginTop: 80 }}>
            <h3 style={{ margin: "0 0 2px", fontSize: 17, fontWeight: 700, color: T.ink }}>{sec.title}</h3>
            <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 12 }}>{sec.line}</div>
            <div className="conn-grid">
              {list.flatMap(c => {
                const isOpen = open === c.key && c.button && c.button.detail;
                const out = [<ConnCard key={c.key} card={c} open={isOpen} isAdmin={isAdmin} isReadOnly={isReadOnly}
                  onButton={c.button ? c.button.onClick : undefined} />];
                if (isOpen) out.push(<div key={c.key + ":detail"} className="conn-detail" data-testid="conn-detail" data-key={c.key}
                  style={{ minWidth: 0 }}>{c.button.detail()}</div>);
                return out;
              })}
            </div>
          </section>);
      })}

      {/* Other: what is not a connection. The donation form embed and the QR
          code moved to Fundraising; this pointer stays for one release. */}
      {!filter && (
        <section id="connections-other" data-testid="connections-section" data-section="other">
          <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, color: T.ink }}>Other</h3>
          <div data-testid="connections-moved-pointer" style={{ fontSize: 13, color: T.ink3, lineHeight: 1.55 }}>
            Your donation form embed code and QR code have moved to{" "}
            <button type="button" onClick={() => onNavigate && onNavigate("fundraising", { frSection: "pages" })}
              style={{ background: "none", border: "none", padding: 0, font: "inherit", color: T.ink, fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}>
              Fundraising, Giving pages and forms</button>.
          </div>
        </section>)}
    </div>
  );
}

export default ConnectionsView;
