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
import { apiFetch } from "../api";
import { T, Card } from "./shared";
import { Figure, FigureContext } from "./Figure";
import Uploader, { IMAGE_ACCEPT, IMAGE_ACCEPT_LABEL, IMAGE_MAX_BYTES } from "./Uploader";
import { resolveAssetUrl } from "../lib/assetUrl";
import { errorMessage } from "../lib/domainError";
import { DonorLink } from "./RecordLink";

const h = { fontSize: 11, fontWeight: 800, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 };
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

function ItemForm({ initial, donors, onSave, onCancel, saving }) {
  const [f, setF] = useState(initial);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = () => {
    const name = f.donorName.trim().toLowerCase();
    const d = name ? donors.find(x => String(x.name || "").toLowerCase() === name) : null;
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
      <datalist id="auction-donors">{donors.slice(0, 2000).map(d => <option key={d.id} value={d.name} />)}</datalist>
      <label style={lab}>Description<textarea style={{ ...inp, minHeight: 70 }} value={f.description} onChange={e => set("description", e.target.value)} /></label>
      <div>
        <div style={{ ...lab, marginBottom: 6 }}>Photos (up to six; the first leads the item)</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          {f.photos.map((p, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img src={p.startsWith("data:") ? p : resolveAssetUrl(p)} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, display: "block" }} />
              <button type="button" aria-label="Remove photo" onClick={() => set("photos", f.photos.filter((_, j) => j !== i))}
                style={{ position: "absolute", top: 2, right: 2, ...btn(false), padding: "0 6px", fontSize: 12 }}>×</button>
            </div>))}
        </div>
        {f.photos.length < 6 && <Uploader accept={IMAGE_ACCEPT} acceptLabel={IMAGE_ACCEPT_LABEL} maxBytes={IMAGE_MAX_BYTES} compact
          label="Drag a photo here, or browse" onFile={({ dataUrl }) => set("photos", [...f.photos, dataUrl])} />}
      </div>
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
  const [saving, setSaving] = useState(false);
  const [times, setTimes] = useState(null);
  const load = () => apiFetch(`/auctions/${id}`).then(r => { setD(r); setTimes({ opensLocal: r.auction.opensLocal, closesLocal: r.auction.closesLocal }); })
    .catch(e => setMsg(errorMessage(e, "Could not load the auction.")));
  useEffect(() => { load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
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
        <p style={{ fontSize: 12, color: T.ink3, margin: "8px 0 0" }}>Times are in your organisation's timezone ({d.timezone}). Bidding stops at the closing time to the second, by the server's clock.</p>
      </Card>

      <Card style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ ...h, marginBottom: 0 }}>Items</div>
          {editing == null && <button style={btn(true)} disabled={isReadOnly} onClick={() => setEditing("new")} data-testid="auction-add-item">Add an item</button>}
        </div>
        {editing === "new" && <ItemForm initial={EMPTY_ITEM} donors={donors} saving={saving} onSave={saveItem} onCancel={() => setEditing(null)} />}
        {d.items.length === 0 && editing !== "new" && <p style={{ fontSize: 13, color: T.ink3 }}>No items yet. Add the first one: a title, a photo, who gave it and what it is worth.</p>}
        {d.items.map(it => editing === it.id
          ? <div key={it.id} style={{ padding: "10px 0", borderBottom: "1px solid " + T.bg3 }}><ItemForm initial={itemInitial(it)} donors={donors} saving={saving} onSave={saveItem} onCancel={() => setEditing(null)} /></div>
          : (
          <div key={it.id} data-auction-item={it.id} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid " + T.bg3, flexWrap: "wrap", alignItems: "flex-start" }}>
            {it.photos[0]
              ? <img src={resolveAssetUrl(it.photos[0])} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, flex: "none" }} />
              : <div style={{ width: 56, height: 56, borderRadius: 8, background: T.bg2, flex: "none" }} />}
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{it.title}{it.category ? <span style={{ fontWeight: 400, color: T.ink3 }}> · {it.category}</span> : null}</div>
              <div style={{ fontSize: 12.5, color: T.ink3 }}>
                {it.donorId ? <>Donated by <DonorLink id={it.donorId} onOpen={() => openPerson(it.donorId)}>{it.donorName}</DonorLink> · </> : "No donor named · "}
                worth {money(it.fmv)} · starts {money(it.startingBid)}, +{money(it.bidIncrement)}{it.buyNow != null ? ` · buy now ${money(it.buyNow)}` : ""}
              </div>
              <div style={{ fontSize: 12.5, color: T.ink, marginTop: 2 }}>
                {it.highBid == null ? (it.closed ? "Closed with no bids." : "No bids yet.")
                  : `${it.closed ? "Won at" : "High bid"} ${money(it.highBid)} by #${it.highBidder.bidderNumber} ${it.highBidder.name} · ${it.bidCount} bid${it.bidCount === 1 ? "" : "s"}${it.boughtNow ? " · bought now" : ""}`}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button style={btn(false)} disabled={isReadOnly} onClick={() => setEditing(it.id)}>Edit</button>
              {it.inKindGiftId
                ? <span style={{ fontSize: 12, color: T.ink3, alignSelf: "center" }}>In-kind gift recorded</span>
                : <button style={btn(false)} disabled={isReadOnly || !it.donorId || !(it.fmv > 0)}
                    title={!it.donorId ? "Say who donated it first." : !(it.fmv > 0) ? "Enter its fair market value first." : "Records the item as an in-kind gift on the donor's record, at its fair market value. Once."}
                    onClick={() => act(() => apiFetch(`/auction-items/${it.id}/in-kind`, { method: "POST" }), `Recorded ${money(it.fmv)} in-kind from ${it.donorName}.`)}>Record as in-kind gift</button>}
              {it.bidCount === 0 && <button style={btn(false)} disabled={isReadOnly} onClick={() => act(() => apiFetch(`/auction-items/${it.id}`, { method: "DELETE" }), "Item removed.")}>Remove</button>}
            </div>
          </div>))}
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
          </div>))}
        {!d.canTakeCards && winners.length > 0 && <p style={{ fontSize: 12, color: T.ink3 }}>Connect Stripe in Settings so winners can pay online. Until then, take their payment as you would any gift.</p>}
      </Card>

      <Card style={{ padding: "16px 18px" }}>
        <div style={h}>Notes to bidders</div>
        <p style={{ fontSize: 12.5, color: T.ink3, margin: "0 0 10px" }}>Steward writes these as drafts. Nothing goes out until you press Send, and each one goes through your usual mail rules.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {!a.closed && <button style={btn(false)} disabled={isReadOnly || d.bidders.length === 0}
            onClick={() => act(() => apiFetch(`/auctions/${id}/closing-note`, { method: "POST" }), r => `${r.made} draft${r.made === 1 ? "" : "s"} written for ${r.bidders} bidder${r.bidders === 1 ? "" : "s"}.`)}>
            Prepare "bidding closes soon"</button>}
          {winners.some(w => !w.paidGiftId) && <button style={btn(false)} disabled={isReadOnly}
            onClick={() => act(() => apiFetch(`/auctions/${id}/winner-emails`, { method: "POST" }), r => `${r.made} draft${r.made === 1 ? "" : "s"} written for ${r.winners} winner${r.winners === 1 ? "" : "s"}.`)}>
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
            <span style={{ color: T.ink3, flex: "1 1 160px", wordBreak: "break-all" }}>{b.email}{b.phone ? ` · ${b.phone}` : ""}</span>
            <span style={{ color: T.ink3 }}>{b.bids} bid{b.bids === 1 ? "" : "s"}</span>
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
        <div style={{ fontSize: 13, color: T.ink3, maxWidth: 560 }}>An online auction with its own page: items people donated, bidding that opens and closes on time, and winners who pay through your own Stripe account.</div>
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
            <span style={{ fontSize: 12.5, color: T.ink3 }}>{a.items} item{a.items === 1 ? "" : "s"} · {a.bids} bid{a.bids === 1 ? "" : "s"}</span>
          </div>
        </Card>))}
    </div>
  );
}

export default AuctionsView;
