// PARITY-4 Part 2 · GIFTS STARTED BUT NOT FINISHED.
//
// Somebody chose an amount on one of the org's own giving forms, gave an
// email, and did not pay. Each row is one of those; the month's total opens
// the same rows (figureSources gifts-not-finished). A row offers a short note
// in the org's voice that a person reads, edits and sends: never sent by
// Steward, one per person per form, and none to someone who has given since.
// A row closes by itself when a gift from that email lands, and links to it.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { T, Modal } from "./shared";
import { Figure, FigureContext } from "./Figure";
import { errorMessage } from "../lib/domainError";
import { displayDate } from "../../../shared/displayDate";

const money = n => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const btn = (primary, disabled) => ({
  background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: "1px solid " + (primary ? T.greenDk : T.bg3),
  borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "inherit",
});
const fieldStyle = { width: "100%", boxSizing: "border-box", border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 14, fontFamily: "inherit", color: T.ink, background: T.white };

function NoteModal({ row, onClose, onSent, isAdmin, isReadOnly }) {
  const [draft, setDraft] = useState(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    apiFetch(`/gift-starts/${row.id}/draft`).then(d => { setDraft(d); setSubject(d.subject); setBody(d.body); }).catch(e => setErr(errorMessage(e, "The draft could not be made.")));
  }, [row.id]);
  const send = async () => {
    setBusy(true); setErr("");
    try { await apiFetch(`/gift-starts/${row.id}/send`, { method: "POST", body: JSON.stringify({ subject, body }) }); onSent(`Sent to ${row.email}.`); }
    catch (e) { setErr(e.sentence || errorMessage(e, "It could not be sent.")); }
    finally { setBusy(false); }
  };
  const blocked = !!(draft && draft.refused);
  return (
    <Modal onClose={onClose} width={560} title={`A note to ${row.name || row.email}`}>
      {!draft && !err && <div style={{ fontSize: 13, color: T.ink3 }}>Drafting…</div>}
      {draft && <div data-testid="unfinished-draft" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 13, color: T.ink3 }}>To {draft.to}. Steward drafted it; nothing goes until you press Send. Change any word.</div>
        <label style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>Subject
          <input value={subject} onChange={e => setSubject(e.target.value)} style={{ ...fieldStyle, marginTop: 4 }} /></label>
        <label style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>Message
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={10} style={{ ...fieldStyle, marginTop: 4, lineHeight: 1.5 }} /></label>
        {blocked && <div role="status" style={{ fontSize: 13, color: T.ink }}>{draft.refused}</div>}
        {!isAdmin && !blocked && <div style={{ fontSize: 13, color: T.ink3 }}>An admin sends notes to donors. Copy it, or ask an admin to send it.</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" style={btn(false)} onClick={() => { try { navigator.clipboard.writeText(`${subject}\n\n${body}`); } catch { /* the words are on screen */ } }}>Copy</button>
          <button type="button" data-testid="unfinished-send" style={btn(true, busy || blocked || !isAdmin || isReadOnly)} disabled={busy || blocked || !isAdmin || isReadOnly} onClick={send}>{busy ? "Sending…" : "Send"}</button>
        </div>
      </div>}
      {err && <div role="status" style={{ fontSize: 13, color: T.ink, marginTop: 8 }}>{err}</div>}
    </Modal>
  );
}

export function StartedNotFinished({ isReadOnly = false, isAdmin = false, onNavigate }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState(null);
  const [flash, setFlash] = useState("");
  const load = () => apiFetch("/gift-starts").then(setData).catch(e => setErr(errorMessage(e, "This list could not load.")));
  useEffect(() => { load(); apiFetch("/gift-starts/notice/seen", { method: "POST", body: "{}" }).catch(() => {}); }, []);
  const openPerson = id => onNavigate && onNavigate("donors", { selectDonorId: id });
  const setAside = async r => { try { await apiFetch(`/gift-starts/${r.id}/dismiss`, { method: "POST", body: "{}" }); load(); } catch (e) { setErr(errorMessage(e, "It could not be set aside.")); } };
  if (err) return <div style={{ fontSize: 14, color: T.ink }}>{err}</div>;
  if (!data) return <div style={{ fontSize: 13, color: T.ink3 }}>Loading…</div>;
  const open = data.rows.filter(r => r.status === "open");
  const done = data.rows.filter(r => r.status === "finished");
  const m = data.month;
  return (
    <FigureContext.Provider value={{ openPerson }}>
      <div data-testid="started-not-finished" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "16px 18px" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: T.ink }}>Started but didn't finish</div>
          <div style={{ fontSize: 15, color: T.ink, marginTop: 8, lineHeight: 1.6 }} data-testid="unfinished-total">
            <Figure variant="inline" kind="money" value={m.total} label="Started and not finished this month"
              definition="Gifts started this month on your own giving forms, with an email given, and not finished. At the amount each person chose."
              source={{ key: "gifts-not-finished", params: { from: m.from, to: m.to } }} />
            {" "}started this month and not finished, across{" "}
            <Figure variant="inline" kind="count" value={m.count} label="Gifts started and not finished this month"
              definition="Gifts started this month on your own giving forms, with an email given, and not finished."
              source={{ key: "gifts-not-finished", params: { from: m.from, to: m.to, measure: "count" } }} />
            {" "}{m.count === 1 ? "gift" : "gifts"}.
          </div>
          <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 6, lineHeight: 1.5 }}>
            A gift counts here once an hour has passed or the payment page closed, and leaves the moment a gift from that email comes in. {data.connectedNote}
          </div>
        </div>
        {flash && <div role="status" style={{ fontSize: 13, color: T.ink, background: T.green100, border: "1px solid " + T.green200, borderRadius: 8, padding: "8px 12px" }}>{flash}</div>}
        <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "6px 18px" }}>
          {open.length === 0 && <div style={{ fontSize: 13, color: T.ink3, padding: "12px 0" }}>Nobody is waiting. Every gift started in the last 60 days either came in or was set aside.</div>}
          {open.map(r => (
            <div key={r.id} data-testid="unfinished-row" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 0", borderTop: "1px solid " + T.bg2 }}>
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>
                  {r.donorId ? <button type="button" onClick={() => openPerson(r.donorId)} style={{ background: "none", border: "none", padding: 0, font: "inherit", color: T.ink, textDecoration: "underline", cursor: "pointer" }}>{r.name || r.email}</button> : (r.name || r.email)}
                  {r.amount ? <span style={{ fontWeight: 400, color: T.ink3 }}> · {money(r.amount)}{r.frequency === "monthly" ? " a month" : ""}</span> : null}
                </div>
                <div style={{ fontSize: 12.5, color: T.ink3, overflowWrap: "anywhere" }}>{r.form} · {r.email} · started {displayDate(String(r.startedAt).slice(0, 10))}{r.expired ? " · payment page closed" : ""}</div>
                {r.noted && <div style={{ fontSize: 12.5, color: T.ink }}>Note sent{r.noteSentBy ? ` by ${r.noteSentBy.split(" ")[0]}` : ""}. Steward sends one at most.</div>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {!r.noted && <button type="button" data-testid="unfinished-draft-open" style={btn(true, isReadOnly)} disabled={isReadOnly} onClick={() => setNote(r)}>Draft a note</button>}
                <button type="button" style={btn(false, isReadOnly)} disabled={isReadOnly} onClick={() => setAside(r)}>Set aside</button>
              </div>
            </div>
          ))}
        </div>
        {done.length > 0 && <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 18px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.ink }}>Finished later</div>
          {done.map(r => (
            <div key={r.id} style={{ fontSize: 13, color: T.ink3, padding: "6px 0", borderTop: "1px solid " + T.bg2 }}>
              {r.donorId ? <button type="button" onClick={() => openPerson(r.donorId)} style={{ background: "none", border: "none", padding: 0, font: "inherit", color: T.ink, fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}>{r.name || r.email}</button> : <b style={{ color: T.ink }}>{r.name || r.email}</b>}
              {" "}started on {r.form} and gave{r.giftId && r.donorId ? <> (<a href={`/donors/${r.donorId}#gift-${r.giftId}`} onClick={e => { e.preventDefault(); onNavigate && onNavigate("donors", { selectDonorId: r.donorId }); }} style={{ color: T.greenDk }}>the gift</a>)</> : null}.
            </div>
          ))}
        </div>}
        {note && <NoteModal row={note} isAdmin={isAdmin} isReadOnly={isReadOnly} onClose={() => setNote(null)} onSent={msg => { setNote(null); setFlash(msg); load(); }} />}
      </div>
    </FigureContext.Provider>
  );
}
