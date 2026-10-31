// client/src/components/Auctions.jsx · PARITY-2 Part 4. AUCTIONS, FIRST VERSION.
//
// Fundraising → Campaigns & pages → Auctions. An auction (per event or on its
// own), its items, who is winning, who won and whether they have paid, the
// people registered to bid, and the two prepared notes a person sends: "bidding
// closes soon" and the winners' pay links. Nothing here sends by itself and
// nothing here moves money: a winner pays on the org's own Stripe, and the
// webhook writes the gift and the receipt.
//
// Every number is a <Figure> with a source (figureSources.js auction-*), so each
// opens the rows that make it.
import { useState, useEffect } from "react";
import { MailTypeSwitches } from "./MailTypes";   // SEND-GATE-2: the same switch as Settings
import { personNamed } from "../lib/people";
import { PeopleDatalist } from "./PeopleDatalist";
import { apiFetch } from "../api";
import { T, Card, Phone } from "./shared";
import { Figure, FigureContext } from "./Figure";
import { PhotoList } from "./PhotoField";
import Picture from "./Picture";
import { errorMessage } from "../lib/domainError";
import { DonorLink } from "./RecordLink";
import RemoveMenu, { removeOne, removeMany } from "./RemoveMenu";
import { UNDONE } from "../lib/recentUndo";
import { countLabel } from "../../../shared/countWords.js";

const h = { fontSize: 11, fontWeight: 800, color: T.ink3, marginBottom: 8 };
const btn = primary => ({ background: primary ? T.greenDk : T.white, border: primary ? "none" : "1px solid " + T.bg3,
  borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, color: primary ? T.white : T.ink,
  cursor: "pointer", fontFamily: "inherit" });
const inp = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 9px", fontSize: 13, color: T.ink, fontFamily: "inherit", minWidth: 0 };
const lab = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: T.ink3, fontWeight: 600 };
const money = n => n == null ? "" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const EMPTY_ITEM = { title: "", category: "", description: "", donorName: "", fmv: "", startingBid: "", bidIncrement: "", buyNow: "", photos: [] };
const FIGURE_KEYS = [
  ["auction-raised", "money"], ["auction-committed", "money"], ["auction-sold", "count"],
  ["auction-unsold", "count"], ["auction-bidders", "count"],
];

// FIX-41: what the winner's note will look like, with the item's main photo.
function WinnerPreview({ itemId }) {
  const [p, setP] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || p) return;
    apiFetch(`/auction-items/${itemId}/winner-preview`).then(setP).catch(() => setP({ error: true }));
  }, [open, itemId, p]);
  return (
    <div data-testid="auction-winner-preview">
      <button type="button" style={btn(false)} onClick={() => setOpen(o => !o)}>{open ? "Hide the winner email" : "Preview the winner email"}</button>
      {open && p && !p.error && (
        <div style={{ marginTop: 8, border: "1px solid " + T.bg3, borderRadius: 10, padding: 14, background: T.white, maxWidth: 520 }}>
          <div style={{ fontSize: 12, color: T.ink3, marginBottom: 6 }}>{p.sentence}</div>
          {p.photo
            ? <div style={{ marginBottom: 10 }}><Picture value={p.photo} ratio="4 / 3" radius={10} width={640} testid="winner-preview-photo" /></div>
            : <div style={{ fontSize: 12, color: T.ink3, marginBottom: 10 }}>No photo yet. Add one above and the winner sees it here.</div>}
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 6 }}>{p.subject}</div>
          <div style={{ fontSize: 12.5, color: T.ink, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{p.body}</div>
        </div>
      )}
    </div>
  );
}

function ItemForm({ initial, donors, onSave, onCancel, saving, itemId = null }) {
  const [f, setF] = useState(initial);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = async () => {
    const name = f.donorName.trim().toLowerCase();
    // SCALE-2: the person with exactly this name, highest giving first, from the server.
    const d = name ? await personNamed(name).catch(() => null) : null;
    onSave({ title: f.title, category: f.category, description: f.description, donorId: d ? d.id : null,
             fmv: f.fmv || "0", startingBid: f.startingBid, bidIncrement: f.bidIncrement, buyNow: f.buyNow || null,
             photos: f.photos }, name && !d);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="auction-item-form">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <label style={lab}>Title<input style={inp} value={f.title} onChange={e => set("title", e.target.value)} /></label>
        <label style={lab}>Category<input style={inp} value={f.category} onChange={e => set("category", e.target.value)} placeholder="Getaways, Dining, Art" /></label>
        <label style={lab}>Donated by<input style={inp} list="auction-donors" value={f.donorName} onChange={e => set("donorName", e.target.value)} placeholder="Type a name on file" /></label>
        <label style={lab}>Fair market value<input style={inp} inputMode="decimal" value={f.fmv} onChange={e => set("fmv", e.target.value)} placeholder="0.00" /></label>
        <label style={lab}>Starting bid<input style={inp} inputMode="decimal" value={f.startingBid} onChange={e => set("startingBid", e.target.value)} /></label>
        <label style={lab}>Bid increment<input style={inp} inputMode="decimal" value={f.bidIncrement} onChange={e => set("bidIncrement", e.target.value)} /></label>
        <label style={lab}>Buy now (optional)<input style={inp} inputMode="decimal" value={f.buyNow} onChange={e => set("buyNow", e.target.value)} /></label>
      </div>
      <PeopleDatalist id="auction-donors" text={f.donorName} />
      <label style={lab}>Description<textarea style={{ ...inp, minHeight: 70 }} value={f.description} onChange={e => set("description", e.target.value)} /></label>
      <div style={{ maxWidth: 420 }}>
        <div style={{ ...lab, marginBottom: 6 }}>Photos (up to five; the first is the main one)</div>
        <PhotoList value={f.photos} onChange={v => set("photos", v)} name={f.title} max={5} testid="auction-item-photos" />
      </div>
      {itemId && <WinnerPreview itemId={itemId} />}
      <p style={{ fontSize: 12, color: T.ink3, margin: 0 }}>
        The fair market value is your number: what the winner receives. Only what they pay over it is deductible, and their receipt says so.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={btn(true)} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save item"}</button>
        <button style={btn(false)} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function AuctionDetail({ id, donors, isReadOnly, onBack, onNavigate }) {
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(null);   // null | "new" | item id
  const [picked, setPicked] = useState(() => new Set());   // FIX-41: items ticked for Remove selected
  const [winnerFor, setWinnerFor] = useState(null);   // JOURNEYS-4: the item whose winner is being recorded
  const [wf, setWf] = useState({ name: "", amount: "" });
  const [saving, setSaving] = useState(false);
  const [times, setTimes] = useState(null);
  const load = () => apiFetch(`/auctions/${id}`).then(r => { setD(r); setTimes({ opensLocal: r.auction.opensLocal, closesLocal: r.auction.closesLocal }); })
    .catch(e => setMsg(errorMessage(e, "Could not load the auction.")));
  useEffect(() => { load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  // FIX-45: an Undo from Recent changes reloads the items from the server.
  useEffect(() => { const f = () => load(); window.addEventListener(UNDONE, f); return () => window.removeEventListener(UNDONE, f); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn, okMsg) => {
    setMsg("");
    try { const r = await fn(); setMsg(typeof okMsg === "function" ? okMsg(r) : okMsg || ""); await load(); }
    catch (e) { setMsg(errorMessage(e, "That did not save.")); }
  };
  if (!d) return <div style={{ padding: 24, color: T.ink3, fontSize: 13 }}>{msg || "Loading…"}</div>;
  const a = d.auction;
  const openPerson = pid => { if (pid && onNavigate) onNavigate("donors", { selectDonorId: pid }); };
  const saveItem = async (body, unknownDonor) => {
    if (unknownDonor) { setMsg("That donor name is not on file. Pick a name from the list, or add the person first."); return; }
    setSaving(true);
    await act(() => editing === "new"
      ? apiFetch(`/auctions/${id}/items`, { method: "POST", body: JSON.stringify(body) })
      : apiFetch(`/auction-items/${editing}`, { method: "PUT", body: JSON.stringify(body) }), "Saved.");
    setSaving(false); setEditing(null);
  };
  const itemInitial = it => it ? {
    title: it.title, category: it.category || "", description: it.description || "", donorName: it.donorName || "",
    fmv: String(it.fmv || ""), startingBid: String(it.startingBid), bidIncrement: String(it.bidIncrement),
    buyNow: it.buyNow == null ? "" : String(it.buyNow), photos: it.photos || [],
  } : EMPTY_ITEM;
  const winners = d.items.filter(i => i.winner);
  const pendingDrafts = d.drafts.filter(x => x.status === "pending_review");
  const sendDraft = x => apiFetch(`/milestone-drafts/${x.id}/send`, { method: "POST" });
  const sendAll = async () => {
    setMsg("");
    let sent = 0; const failed = [];
    for (const x of pendingDrafts) {
      try { await sendDraft(x); sent++; } catch (e) { failed.push(`${x.donor_name}: ${errorMessage(e, "not sent")}`); }
    }
    setMsg(`Sent ${sent}.${failed.length ? ` Not sent: ${failed.join("; ")}` : ""}`);
    load();
  };
  const copy = t => navigator.clipboard && navigator.clipboard.writeText(t).then(() => setMsg("Copied."));
  // JOURNEYS-4 · a live auction or a paper bid sheet: the name and the number.
  const saveWinner = async it => {
    const name = wf.name.trim().toLowerCase();
    const p = name ? await personNamed(name).catch(() => null) : null;   // SCALE-2
    if (!p) { setMsg("Pick the winner's name from the list, or add the person first."); return; }
    await act(() => apiFetch(`/auction-items/${it.id}/winner`, { method: "POST", body: JSON.stringify({ donorId: p.id, amount: wf.amount }) }), r => r.sentence);
    setWinnerFor(null); setWf({ name: "", amount: "" });
  };

  return (
    <FigureContext.Provider value={{ openPerson }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} data-testid="auction-detail">
      <div>
        <button onClick={onBack} style={{ ...btn(false), padding: "4px 10px", marginBottom: 8 }}>← All auctions</button>
        <div style={{ fontSize: 20, fontWeight: 800, color: T.ink }}>{a.title}</div>
        <div style={{ fontSize: 13, color: T.ink3 }}>
          {a.event_name ? `${a.event_name} · ` : ""}{a.notOpen ? `Opens ${a.opensWords}` : a.closed ? `Closed ${a.closesWords}` : `Open now, closes ${a.closesWords}`}
          {a.status === "archived" ? " · archived" : ""}
        </div>
        <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          The public page: <a href={a.publicUrl} target="_blank" rel="noopener noreferrer" style={{ color: T.ink, wordBreak: "break-all" }} data-testid="auction-public-url">{a.publicUrl}</a>
          <button style={{ ...btn(false), padding: "3px 10px", fontSize: 12 }} onClick={() => copy(a.publicUrl)}>Copy</button>
        </div>
      </div>
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {FIGURE_KEYS.map(([k, kind]) => {
          const f = d.figures[k];
          return <Figure key={k} figureKey={k} value={f.value} kind={kind} label={f.label} definition={f.sentence} source={f.source} />;
        })}
      </div>

      <Card style={{ padding: "16px 18px" }}>
        <div style={h}>When bidding happens</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={lab}>Opens<input type="datetime-local" style={inp} value={times.opensLocal} onChange={e => setTimes(t => ({ ...t, opensLocal: e.target.value }))} /></label>
          <label style={lab}>Closes<input type="datetime-local" style={inp} value={times.closesLocal} onChange={e => setTimes(t => ({ ...t, closesLocal: e.target.value }))} /></label>
          <button style={btn(false)} disabled={isReadOnly} onClick={() => act(() => apiFetch(`/auctions/${id}`, { method: "PUT", body: JSON.stringify(times) }), "Times saved.")}>Save times</button>
          <button style={btn(false)} disabled={isReadOnly} onClick={() => act(() => apiFetch(`/auctions/${id}`, { method: "PUT", body: JSON.stringify({ status: a.status === "archived" ? "active" : "archived" }) }),
            a.status === "archived" ? "The page is live again." : "Archived: the public page is down. Bids and winners are kept.")}>
            {a.status === "archived" ? "Restore" : "Archive"}</button>
        </div>
        <p style={{ fontSize: 12, color: T.ink3, margin: "8px 0 0" }}>Times are in your organization's timezone ({d.timezone}). Bidding stops at the closing time to the second, by the server's clock.</p>
      </Card>

      <Card style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ ...h, marginBottom: 0 }}>Items</div>
          <span style={{ display: "flex", gap: 6 }}>
            {!isReadOnly && picked.size > 0 && <button style={btn(false)} data-testid="auction-remove-selected"
              onClick={() => removeMany({ kind: "auction_item", ids: [...picked], onDone: () => { setPicked(new Set()); load(); } })}>Remove selected ({picked.size})</button>}
            {editing == null && <button style={btn(true)} disabled={isReadOnly} onClick={() => setEditing("new")} data-testid="auction-add-item">Add an item</button>}
          </span>
        </div>
        {editing === "new" && <ItemForm initial={EMPTY_ITEM} donors={donors} saving={saving} onSave={saveItem} onCancel={() => setEditing(null)} />}
        {d.items.length === 0 && editing !== "new" && <p style={{ fontSize: 13, color: T.ink3 }}>No items yet. Add the first one: a title, a photo, who gave it and what it is worth.</p>}
        {d.items.map(it => editing === it.id
          ? <div key={it.id} style={{ padding: "10px 0", borderBottom: "1px solid " + T.bg3 }}><ItemForm initial={itemInitial(it)} itemId={it.id} donors={donors} saving={saving} onSave={saveItem} onCancel={() => setEditing(null)} /></div>
          : (
          <div key={it.id} data-auction-item={it.id} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid " + T.bg3, flexWrap: "wrap", alignItems: "flex-start", opacity: it.retired ? 0.6 : 1 }}>
            {!isReadOnly && !it.retired && <input type="checkbox" aria-label={`Select ${it.title}`} data-testid="auction-item-pick" checked={picked.has(it.id)} style={{ accentColor: T.greenDk, marginTop: 4 }}
              onChange={e => setPicked(x => { const n = new Set(x); if (e.target.checked) n.add(it.id); else n.delete(it.id); return n; })} />}
            {it.photos[0]
              ? <div style={{ width: 56, flex: "none" }}><Picture value={it.photos[0]} alt={it.title} ratio="1 / 1" radius={8} width={160} testid="auction-item-thumb" /></div>
              : <button type="button" disabled={isReadOnly} onClick={() => setEditing(it.id)} data-testid="auction-item-add-photo"
                  style={{ width: 56, height: 56, borderRadius: 8, background: T.bg, border: "1px dashed " + T.bg3, flex: "none", fontSize: 10.5, fontWeight: 700, color: T.ink3, cursor: "pointer", fontFamily: "inherit", padding: 2 }}>Add a photo</button>}
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{it.title}{it.category ? <span style={{ fontWeight: 400, color: T.ink3 }}> · {it.category}</span> : null}{it.retired ? <span data-testid="auction-item-retired" style={{ fontWeight: 400, color: T.ink3 }}> · Retired, off the public page</span> : null}</div>
              <div style={{ fontSize: 12.5, color: T.ink3 }}>
                {it.donorId ? <>Donated by <DonorLink id={it.donorId} onOpen={() => openPerson(it.donorId)}>{it.donorName}</DonorLink> · </> : "No donor named · "}
                worth {money(it.fmv)} · starts {money(it.startingBid)}, +{money(it.bidIncrement)}{it.buyNow != null ? ` · buy now ${money(it.buyNow)}` : ""}
              </div>
              <div style={{ fontSize: 12.5, color: T.ink, marginTop: 2 }}>
                {it.highBid == null ? (it.closed ? "Closed with no bids." : "No bids yet.")
                  : `${it.closed ? "Won at" : "High bid"} ${money(it.highBid)} by #${it.highBidder.bidderNumber} ${it.highBidder.name} · ${countLabel(it.bidCount, "bid")}${it.boughtNow ? " · bought now" : ""}`}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button style={btn(false)} disabled={isReadOnly} onClick={() => setEditing(it.id)}>Edit</button>
              {it.inKindGiftId
                ? <span style={{ fontSize: 12, color: T.ink3, alignSelf: "center" }}>In-kind gift recorded</span>
                : <button style={btn(false)} disabled={isReadOnly || !it.donorId || !(it.fmv > 0)}
                    title={!it.donorId ? "Say who donated it first." : !(it.fmv > 0) ? "Enter its fair market value first." : "Records the item as an in-kind gift on the donor's record, at its fair market value. Once."}
                    onClick={() => act(() => apiFetch(`/auction-items/${it.id}/in-kind`, { method: "POST" }), `Recorded ${money(it.fmv)} in-kind from ${it.donorName}.`)}>Record as in-kind gift</button>}
              {/* FIX-41: one More menu. Remove retires an item with bids
                  (off the public page, bids kept) and deletes one without;
                  Remove winner returns it to unassigned, never touching a payment. */}
              <RemoveMenu kind="auction_item" id={it.id} disabled={isReadOnly || it.retired} onDone={load}
                items={[it.winner && !it.paidGiftId && { label: "Remove winner", onClick: () => removeOne({ kind: "auction_winner", id: it.id, onDone: load }) }]} />
              {!it.paidGiftId && winnerFor !== it.id && <button style={btn(false)} disabled={isReadOnly} data-testid={"auction-record-winner-" + it.id}
                title="For a live auction or a paper bid sheet: who won it, and for how much. It closes the item."
                onClick={() => { setWinnerFor(it.id); setWf({ name: "", amount: "" }); }}>Record the winner</button>}
            </div>
            {winnerFor === it.id && (
              <div data-testid="auction-winner-form" style={{ flex: "1 1 100%", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <label style={{ ...lab, flex: "2 1 200px" }}>Who won it<input style={inp} list="auction-winner-donors" value={wf.name} autoFocus
                  onChange={e => setWf(x => ({ ...x, name: e.target.value }))} placeholder="Type a name on file" data-testid="auction-winner-name" /></label>
                <label style={{ ...lab, flex: "1 1 120px" }}>Winning bid<input style={inp} inputMode="decimal" value={wf.amount}
                  onChange={e => setWf(x => ({ ...x, amount: e.target.value }))} placeholder="450" data-testid="auction-winner-amount" /></label>
                <button style={btn(true)} disabled={isReadOnly || !wf.name.trim() || !wf.amount.trim()} onClick={() => saveWinner(it)} data-testid="auction-winner-save">Save the winner</button>
                <button style={btn(false)} onClick={() => setWinnerFor(null)}>Cancel</button>
              </div>
            )}
          </div>))}
        {winnerFor && <PeopleDatalist id="auction-winner-donors" text={wf.name} />}
      </Card>

      <Card style={{ padding: "16px 18px" }}>
        <div style={h}>Winners</div>
        {winners.length === 0 && <p style={{ fontSize: 13, color: T.ink3, margin: 0 }}>{a.closed ? "No item had a bid." : "Winners appear here as each item closes: the highest bid, and between equal bids the earliest."}</p>}
        {winners.map(it => (
          <div key={it.id} data-auction-winner={it.id} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid " + T.bg3, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
            <strong style={{ flex: "1 1 180px", color: T.ink }}>{it.title}</strong>
            <span style={{ flex: "1 1 160px" }}><DonorLink id={it.winner.donorId} onOpen={() => openPerson(it.winner.donorId)}>#{it.winner.bidderNumber} {it.winner.name}</DonorLink></span>
            <span>{money(it.winner.amount)}</span>
            <span style={{ color: T.ink3 }}>{money(it.deductibleOfWin)} deductible</span>
            <span style={{ fontWeight: 700, color: it.paidGiftId ? T.greenDk : T.gold700 }}>{it.paidGiftId ? "Paid" : "Not paid yet"}</span>
            {!it.paidGiftId && <button style={{ ...btn(false), padding: "4px 10px", fontSize: 12 }} onClick={() => copy(it.winner.payUrl)}>Copy pay link</button>}
            {!it.paidGiftId && it.winner.mailBlocked && <span data-winner-unreachable style={{ flex: "1 1 100%", fontSize: 12, color: T.ink2 }}>{it.winner.mailBlocked.sentence}</span>}
          </div>))}
        {!d.canTakeCards && winners.length > 0 && <p style={{ fontSize: 12, color: T.ink3 }}>Connect Stripe in Settings so winners can pay online. Until then, take their payment as you would any gift.</p>}
      </Card>

      {(d.refundFlags || []).length > 0 && <Card style={{ padding: "16px 18px", borderLeft: "4px solid " + T.gold700 }}>
        <div style={h} data-testid="auction-refund-flags">Payments to refund</div>
        <p style={{ fontSize: 12.5, color: T.ink2, margin: "0 0 10px" }}>{d.refundSentence}</p>
        {d.refundFlags.map(f => (
          <div key={f.id} data-refund-flag={f.id} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid " + T.bg3, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
            <strong style={{ flex: "1 1 180px", color: T.ink }}>{f.item_title}</strong>
            <span style={{ flex: "1 1 160px" }}>{f.donor_id ? <DonorLink id={f.donor_id} onOpen={() => openPerson(f.donor_id)}>{f.payer_name || f.payer_email}</DonorLink> : (f.payer_name || f.payer_email)}</span>
            <span>{money(f.amount)}</span>
            <code style={{ fontSize: 12, color: T.ink2, wordBreak: "break-all" }}>{f.stripe_payment_id}</code>
            <button style={{ ...btn(false), padding: "4px 10px", fontSize: 12 }} onClick={() => copy(f.stripe_payment_id)}>Copy payment id</button>
            {f.resolved_at
              ? <span style={{ color: T.ink3 }}>Marked refunded{f.resolved_by_name ? ` by ${f.resolved_by_name}` : ""}</span>
              : <button style={{ ...btn(false), padding: "4px 10px", fontSize: 12 }} disabled={isReadOnly}
                  onClick={() => act(() => apiFetch(`/auction-refund-flags/${f.id}/resolve`, { method: "POST" }), "Marked as refunded in Stripe.")}>I refunded this in Stripe</button>}
          </div>))}
      </Card>}

      <Card style={{ padding: "16px 18px" }}>
        <div style={h}>Notes to bidders</div>
        <p style={{ fontSize: 12.5, color: T.ink3, margin: "0 0 10px" }}>Steward writes these as drafts. Nothing goes out until you press Send, and each one goes through your usual mail rules.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {!a.closed && <button style={btn(false)} disabled={isReadOnly || d.bidders.length === 0}
            onClick={() => act(() => apiFetch(`/auctions/${id}/closing-note`, { method: "POST" }), r => `${countLabel(r.made, "draft")} written for ${countLabel(r.bidders, "bidder")}.`)}>
            Prepare "bidding closes soon"</button>}
          {winners.some(w => !w.paidGiftId) && <button style={btn(false)} disabled={isReadOnly}
            onClick={() => act(() => apiFetch(`/auctions/${id}/winner-emails`, { method: "POST" }), r => `${countLabel(r.made, "draft")} written for ${countLabel(r.winners, "winner")}.${r.unreachable ? ` ${countLabel(r.unreachable, "winner")} cannot be emailed: copy their pay link from Winners.` : ""}`)}>
            Prepare the winners' emails</button>}
          {pendingDrafts.length > 1 && <button style={btn(true)} disabled={isReadOnly} onClick={sendAll}>Send all {pendingDrafts.length}</button>}
        </div>
        {d.drafts.map(x => (
          <details key={x.id} style={{ borderBottom: "1px solid " + T.bg3, padding: "6px 0" }}>
            <summary style={{ fontSize: 13, color: T.ink, cursor: "pointer", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 200px" }}>{x.donor_name}: {x.subject}</span>
              {x.status === "sent" ? <span style={{ color: T.ink3, fontSize: 12 }}>Sent</span>
                : <button style={{ ...btn(true), padding: "4px 12px", fontSize: 12 }} disabled={isReadOnly}
                    onClick={e => { e.preventDefault(); act(() => sendDraft(x), `Sent to ${x.donor_name}.`); }}>Send</button>}
            </summary>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12.5, color: T.ink2, margin: "8px 0 0" }}>{x.body}</pre>
          </details>))}
      </Card>

      <Card style={{ padding: "16px 18px" }}>
        <div style={h}>Registered bidders</div>
        {d.bidders.length === 0 && <p style={{ fontSize: 13, color: T.ink3, margin: 0 }}>Nobody yet. People register on the public page with their name, email and phone.</p>}
        {d.bidders.map(b => (
          <div key={b.id} style={{ display: "flex", gap: 10, fontSize: 13, padding: "6px 0", borderBottom: "1px solid " + T.bg3, flexWrap: "wrap" }}>
            <strong style={{ minWidth: 48 }}>#{b.bidder_number}</strong>
            <span style={{ flex: "1 1 160px" }}><DonorLink id={b.donor_id} onOpen={() => openPerson(b.donor_id)}>{b.name}</DonorLink></span>
            <span style={{ color: T.ink3, flex: "1 1 160px", wordBreak: "break-all" }}>{b.email}{b.phone ? <> · <Phone value={b.phone} /></> : ""}</span>
            <span style={{ color: T.ink3 }}>{countLabel(b.bids, "bid")}</span>
          </div>))}
      </Card>
    </div>
    </FigureContext.Provider>
  );
}

export function AuctionsView({ donors = [], isReadOnly, onNavigate }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState("");
  const [nf, setNf] = useState(null);
  const load = () => apiFetch("/auctions").then(setList).catch(e => setMsg(errorMessage(e, "Could not load auctions.")));
  useEffect(() => { load(); }, []);
  if (open) return <AuctionDetail id={open} donors={donors} isReadOnly={isReadOnly} onNavigate={onNavigate} onBack={() => { setOpen(null); load(); }} />;
  const create = async () => {
    setMsg("");
    try {
      const r = await apiFetch("/auctions", { method: "POST", body: JSON.stringify(nf) });
      setNf(null); setOpen(r.id);
    } catch (e) { setMsg(errorMessage(e, "That did not save.")); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="auctions-view">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: T.ink3, maxWidth: 560 }}>An online auction with its own page: items people donated, bidding that opens and closes on time, and winners who pay through your own Stripe account.
          <MailTypeSwitches keys={["auction_signin"]} from="auctions" /></div>
        {!nf && <button style={btn(true)} disabled={isReadOnly} onClick={() => setNf({ title: "", eventId: "", opensLocal: "", closesLocal: "", description: "" })} data-testid="auction-new">New auction</button>}
      </div>
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div>}
      {nf && (
        <Card style={{ padding: "16px 18px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            <label style={lab}>Title<input style={inp} value={nf.title} onChange={e => setNf(x => ({ ...x, title: e.target.value }))} placeholder="Spring silent auction" /></label>
            <label style={lab}>Part of an event (optional)
              <select style={inp} value={nf.eventId} onChange={e => setNf(x => ({ ...x, eventId: e.target.value }))}>
                <option value="">On its own</option>
                {(list?.events || []).map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select></label>
            <label style={lab}>Bidding opens<input type="datetime-local" style={inp} value={nf.opensLocal} onChange={e => setNf(x => ({ ...x, opensLocal: e.target.value }))} /></label>
            <label style={lab}>Bidding closes<input type="datetime-local" style={inp} value={nf.closesLocal} onChange={e => setNf(x => ({ ...x, closesLocal: e.target.value }))} /></label>
          </div>
          <label style={{ ...lab, marginTop: 10 }}>What it is for<textarea style={{ ...inp, minHeight: 60 }} value={nf.description} onChange={e => setNf(x => ({ ...x, description: e.target.value }))} /></label>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button style={btn(true)} onClick={create}>Create auction</button>
            <button style={btn(false)} onClick={() => setNf(null)}>Cancel</button>
          </div>
        </Card>)}
      {list && list.auctions.length === 0 && !nf && (
        <Card style={{ padding: "18px 18px" }}><p style={{ fontSize: 13, color: T.ink3, margin: 0 }}>No auctions yet. Start one for your next event, or on its own.</p></Card>)}
      {list && list.auctions.map(a => (
        <Card key={a.id} style={{ padding: "14px 18px", cursor: "pointer" }} onClick={() => setOpen(a.id)} data-auction-row={a.id}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
            <strong style={{ fontSize: 14, color: T.ink, flex: "1 1 200px" }}>{a.title}</strong>
            <span style={{ fontSize: 12.5, color: T.ink3 }}>{a.event_name ? `${a.event_name} · ` : ""}{a.status === "archived" ? "Archived" : a.not_open ? "Not open yet" : a.closed ? "Closed" : "Open now"}</span>
            <span style={{ fontSize: 12.5, color: T.ink3 }}>{countLabel(a.items, "item")} · {countLabel(a.bids, "bid")}</span>
          </div>
        </Card>))}
    </div>
  );
}

export default AuctionsView;
