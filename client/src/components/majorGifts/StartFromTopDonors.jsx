// FLOWS-8 (W-1112-Fundraising-11X) · AN EMPTY TOP 100 SAYS WHY, AND OFFERS A START.
// The Top 100 is her own hand-kept list (TOP100-1), so it starts empty while
// Reports' Top donors already ranks many people. The empty page says that, and
// offers her top donors by lifetime (GET /top100/suggested, the same rule as
// Top donors, Lifetime) to review: every name ticked, untick any, then one
// press adds the rest (POST /top100/members). Nothing is added before that press.
import { useState } from "react";
import { apiFetch } from "../../api";
import { T, fmtFull } from "../shared";
import { errorMessage } from "../../lib/domainError";

const btn = { background: T.green, border: "none", borderRadius: 9, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, color: T.white, cursor: "pointer" };
const quiet = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, padding: "7px 12px", fontSize: 12, color: T.ink2, cursor: "pointer" };

export function StartFromTopDonors({ listName, isReadOnly, onAdded }) {
  const [offer, setOffer] = useState(null);   // { people, sentence }
  const [ticked, setTicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const open = async () => {
    setBusy(true); setErr("");
    try {
      const r = await apiFetch("/top100/suggested?limit=25");
      setOffer(r); setTicked(new Set((r.people || []).map(p => p.id)));
    } catch (e) { setErr(errorMessage(e, "Your top donors did not load.")); }
    setBusy(false);
  };
  const add = async () => {
    const ids = (offer.people || []).filter(p => ticked.has(p.id)).map(p => p.id);
    if (!ids.length) { setErr("Tick at least one person to add."); return; }
    setBusy(true); setErr("");
    try {
      const r = await apiFetch("/top100/members", { method: "POST", body: JSON.stringify({ donorIds: ids }) });
      setOffer(null); onAdded && onAdded(r.sentence);
    } catch (e) { setErr((e && e.sentence) || errorMessage(e, "Nobody was added.")); }
    setBusy(false);
  };
  const flip = id => setTicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div data-testid="top100-empty" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "18px 20px" }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: T.ink, marginBottom: 6 }}>Nobody on your {listName} yet</div>
      <div data-testid="top100-empty-why" style={{ fontSize: 13, color: T.ink2, lineHeight: 1.6, maxWidth: 640, marginBottom: 12 }}>
        Your {listName} is the list you keep by hand, in your own order, so it starts empty. Reports' Top donors ranks
        everyone by what they have given; nobody is on this list until you add them. Add people by name above, from a
        person's profile (Plan of care, then Add), or start from your top donors.
      </div>
      {!isReadOnly && !offer && <button type="button" data-testid="top100-start" onClick={open} disabled={busy} style={btn}>{busy ? "Reading…" : "Start from your top donors"}</button>}
      {offer && (
        <div data-testid="top100-offer">
          {(offer.people || []).length === 0
            ? <div style={{ fontSize: 13, color: T.ink2 }}>Nobody has given yet, so there are no top donors to start from. Add people by name above.</div>
            : <>
              <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 8 }}>{offer.sentence}</div>
              <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid " + T.bg2, borderRadius: 10 }}>
                {offer.people.map(p => (
                  <label key={p.id} data-testid="top100-offer-row" style={{ display: "grid", gridTemplateColumns: "24px 28px minmax(0,1fr) auto", gap: 8, alignItems: "center", padding: "7px 10px", borderBottom: "1px solid " + T.bg2, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={ticked.has(p.id)} onChange={() => flip(p.id)} aria-label={`Add ${p.name}`} />
                    <span style={{ color: T.ink3 }}>{p.rank}</span>
                    <span style={{ color: T.ink, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    <span style={{ color: T.ink2 }}>{fmtFull(p.lifetimeCents / 100)} lifetime</span>
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button type="button" data-testid="top100-offer-add" onClick={add} disabled={busy} style={btn}>{busy ? "Adding…" : `Add these ${ticked.size} to your ${listName}`}</button>
                <button type="button" onClick={() => setOffer(null)} style={quiet}>Not now</button>
              </div>
            </>}
        </div>
      )}
      {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink, marginTop: 8 }}>{err}</div>}
    </div>
  );
}
