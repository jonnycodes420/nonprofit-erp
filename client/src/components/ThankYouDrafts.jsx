// CHECK-2 · ONE DRAFT, THREE VIEWS. A thank-you drafted from a check (or any
// gift) is one row in thank_you_drafts. Communications (drafts waiting to
// send), the donor profile's Emails tab and Money in, Acknowledgments all
// list it through this component, from the one GET /thank-yous, so I sent it
// or Not sending this in any of them takes it out of all three. Nothing here copies a draft.
//
// `highlightId` opens that draft on arrival ("Read and send it" on a
// confirmed check lands here with it open).
//
// COMMS-3 item 1 · READ THE DRAFT OPENS, EVERY TIME, AND STAYS OPEN. Jonathan on prod
// (25 Nov): "half the time I hit read it and it glitches". Reproduced on staging: the first
// open of a draft POSTed /opened, which announced the "draft" topic; the page re-read with a
// spinner, the list went to 0 rows twice and came back with nothing open. Now /opened is a
// seen-only note (api.js SEEN_ONLY, the server answers "none"), the list is read through
// useLiveRead (only the newest read's answer is kept), the open row is kept by id through any
// re-read, and a row she took away (I sent it, Not sending this) stays away until Undo, even
// when a read that left before her press lands after it.
//
// COMMS-3 item 2 · ONE OBVIOUS NEXT STEP. Each row shows the draft's first line under the name.
// Opened: Open in my email (her own mail app, addressed, with the words), Copy, then I sent it.
// Not sending this is the one way to set one aside, with Undo. Steward sends nothing.
import { useEffect, useRef, useState } from "react";
import { T, PersonMark } from "./shared";
import { apiFetch } from "../api";
import { track } from "../lib/analyticsDoor";   // ANALYTICS-1
import { errorMessage } from "../lib/domainError";
import { DonorLink, RecordLink } from "./RecordLink";
import { giftHref } from "../lib/appUrls";
import { displayName } from "../../../shared/displayName.js";
import { giftOnDate } from "../../../shared/draftNote";
import { dismissDrafts, SelectBox } from "./DraftDismiss";   // COMMS-1 item 4
import { offerUndo } from "./EditHistory";
import { useLiveRead } from "../lib/liveRead";

export const THANK_YOUS_CHANGED = "steward:thank-yous-changed";
const CAPTURE_CHANGED = "steward:capture-changed";
const announce = () => { try { window.dispatchEvent(new Event(THANK_YOUS_CHANGED)); } catch { /* no window */ } };

const btn = { borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const primary = { ...btn, background: T.green, border: "1px solid " + T.green, color: T.white, textDecoration: "none", display: "inline-flex", alignItems: "center" };
const plain = { ...btn, background: T.white, border: "1px solid " + T.ink, color: T.ink };
const quiet = { ...btn, background: "none", border: "none", color: T.ink3, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 2, padding: "7px 4px" };

// The line that tells two drafts apart: the first line after the greeting.
export function firstLine(body) {
  const lines = String(body || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
  const greet = /^(dear|hi|hello|good (morning|afternoon|evening))\b.*[,!:]?$/i;
  const line = lines.find(l => !(greet.test(l) && l.length < 60)) || lines[0] || "";
  return line.length > 140 ? line.slice(0, 137).replace(/\s+\S*$/, "") + "…" : line;
}
export function mailtoFor(d) {
  if (!d.donorEmail) return null;
  // The address keeps its @ (some mail apps do not decode %40); the rest is encoded.
  return `mailto:${encodeURIComponent(d.donorEmail).replace(/%40/g, "@")}?subject=${encodeURIComponent(d.subject || "Thank you for your gift")}&body=${encodeURIComponent(d.body || "")}`;
}

export function ThankYouDrafts({ donorId = null, highlightId = null, title = "Thank-yous waiting to send", intro, onNavigate, hideWhenEmpty = false, testid = "ty-drafts", selection = null, onCount = null }) {
  const [open, setOpen] = useState(highlightId || null);
  const [copied, setCopied] = useState(null);
  const [err, setErr] = useState("");
  const [gone, setGone] = useState(() => new Set());   // taken away here; kept away until Undo
  const refs = useRef({});
  // NUMBERS-9 item 6: the gifts waiting to be thanked behind these drafts (shared/numbers/thankBacklog.js),
  // said only org-wide and only when the two counts differ.
  const [backlogLine, setBacklogLine] = useState(null);

  const read = useLiveRead("comms.thank-yous", ["draft"],
    () => apiFetch("/thank-yous").then(r => { if (!donorId) setBacklogLine((r && r.backlog && r.backlog.sentence) || null); return ((r && r.drafts) || []).filter(d => !donorId || d.donorId === donorId); }).catch(() => []),
    [donorId]);
  const { reload } = read;
  useEffect(() => {
    const on = () => reload();
    window.addEventListener(THANK_YOUS_CHANGED, on);
    window.addEventListener(CAPTURE_CHANGED, on);
    return () => { window.removeEventListener(THANK_YOUS_CHANGED, on); window.removeEventListener(CAPTURE_CHANGED, on); };
  }, [reload]);
  const rows = read.data === undefined ? null : read.data.filter(d => !gone.has(d.id));
  useEffect(() => { if (onCount && rows) onCount(rows.length); }, [rows && rows.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  const markOpened = d => { if (!d.opened) apiFetch(`/thank-yous/${encodeURIComponent(d.id)}/opened`, { method: "POST" }).catch(() => {}); };
  // The deep link: open it, record that it was read, and bring it into view. Once.
  const landed = useRef(false);
  useEffect(() => {
    if (!highlightId || !rows || landed.current) return;
    const d = rows.find(x => x.id === highlightId);
    if (!d) return;
    landed.current = true;
    setOpen(d.id); markOpened(d);
    const el = refs.current[d.id];
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, rows]);   // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = d => {
    if (open === d.id) { setOpen(null); return; }
    setOpen(d.id); setErr(""); markOpened(d);
  };
  const copy = async d => {
    try { await navigator.clipboard.writeText(d.body || ""); setCopied(d.id); setTimeout(() => setCopied(c => (c === d.id ? null : c)), 2500); }
    catch { setErr("Your browser would not let Steward reach the clipboard. Select the draft and copy it."); }
  };
  const hide = id => setGone(s => new Set(s).add(id));
  const unhide = id => setGone(s => { const n = new Set(s); n.delete(id); return n; });
  const sent = async d => {
    setErr(""); hide(d.id); if (open === d.id) setOpen(null);
    try {
      await apiFetch(`/thank-yous/${encodeURIComponent(d.id)}/sent`, { method: "POST" });
      track("thank_you_marked_sent", { on_profile: !!donorId });
      announce();
      offerUndo({ message: `Marked sent: the thank-you to ${displayName(d.donorName)}. Steward sent nothing.`, undoAction: async () => {
        const y = await apiFetch(`/thank-yous/${encodeURIComponent(d.id)}/unsent`, { method: "POST" });
        unhide(d.id); announce();
        return y;
      } }, "thank-you");
    } catch (e) { unhide(d.id); setErr(errorMessage(e, "That could not be saved.")); }
  };
  const notSending = d => {
    setErr("");
    dismissDrafts([{ kind: "thank_you", id: d.id }], { confirm: false, onGone: () => { hide(d.id); if (open === d.id) setOpen(null); },
      onRestored: () => { unhide(d.id); reload(); } })
      .catch(e => { unhide(d.id); setErr(errorMessage(e, "That draft was not set aside.")); });
  };

  if (rows == null) return null;
  if (!rows.length && hideWhenEmpty) return null;
  return (
    <section data-testid={testid} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{title}{rows.length ? ` (${rows.length})` : ""}</div>
        <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>
          {intro || "Steward wrote these for you. Read one, send it from your own email, then mark it sent."}
        </div>
        {backlogLine && <div data-testid="ty-backlog-line" style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>{backlogLine}</div>}
      </div>
      {!rows.length && <div style={{ fontSize: 13, color: T.ink3 }}>{donorId ? "No thank-you is waiting for this person." : "No thank-you is waiting to be sent."}</div>}
      {rows.length > 0 && (
        <div style={{ background: T.white, border: "1px solid " + T.bg2, borderRadius: 12 }}>
          {rows.map((d, i) => {
            const isOpen = open === d.id, mail = mailtoFor(d), who = displayName(d.donorName);
            return (
              <div key={d.id} ref={el => { refs.current[d.id] = el; }} data-thank-you={d.id} data-testid="ty-draft-row" data-open={isOpen ? "1" : undefined}
                style={{ padding: "12px 14px", borderTop: i ? "1px solid " + T.bg2 : "none", boxShadow: highlightId === d.id ? "inset 3px 0 0 " + T.gold : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  {selection && selection.selecting && <SelectBox checked={selection.has("thank_you", d.id)} onChange={on => selection.toggle("thank_you", d.id, on)} label={`Select the thank-you to ${who}`} />}
                  {!donorId && <PersonMark id={d.donorId} name={d.donorName} size={28} />}
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                      {!donorId && (
                        <DonorLink id={d.donorId} onOpen={onNavigate ? () => onNavigate("donors", { selectDonorId: d.donorId }) : undefined}
                          style={{ background: "none", border: "none", padding: 0, font: "inherit", fontSize: 14, fontWeight: 700, color: T.ink, cursor: "pointer", textAlign: "left" }}>{who}</DonorLink>
                      )}
                      <span style={{ fontSize: 13, color: T.ink2, fontVariantNumeric: "tabular-nums" }}>
                        <RecordLink to={giftHref(d.donorId, d.giftId)} data-record-link="gift" title="Open the gift"
                          onOpen={onNavigate ? () => onNavigate("donors", { selectDonorId: d.donorId, anchor: "gift-" + d.giftId }) : undefined}
                          style={{ color: "inherit" }}>{giftOnDate(Math.round(Number(d.amount) * 100), d.giftDate)}</RecordLink>{d.fundName ? ` · ${d.fundName}` : ""}
                      </span>
                    </div>
                    {!isOpen && <div data-testid="ty-draft-preview" style={{ fontSize: 12.5, color: T.ink3, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{firstLine(d.body)}</div>}
                  </div>
                  <button type="button" data-testid="ty-draft-open" aria-expanded={isOpen} onClick={() => toggle(d)} style={{ ...plain, flexShrink: 0 }}>
                    {isOpen ? "Close" : "Read the draft"}
                  </button>
                </div>
                {isOpen && (
                  <div style={{ marginTop: 10 }}>
                    <textarea readOnly value={d.body || ""} aria-label={`Thank-you for ${who}`} data-testid="ty-draft-body"
                      style={{ width: "100%", minHeight: 150, background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "10px 12px", color: T.ink, fontSize: 13, lineHeight: 1.55, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
                    {!mail && <div data-testid="ty-draft-no-email" style={{ fontSize: 12.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 8, marginTop: 6 }}>
                      There is no email address on file for {who}. Copy the words and send them however you reach {who}.</div>}
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {mail && <a href={mail} data-testid="ty-draft-mailto" onClick={() => track("draft_opened_in_email", { draft: "thank_you", on_profile: !!donorId })} style={primary}>Open in my email</a>}
                      <button type="button" data-testid="ty-draft-copy" onClick={() => copy(d)} style={mail ? plain : { ...primary, border: "none" }}>{copied === d.id ? "Copied" : "Copy"}</button>
                      <button type="button" data-testid="ty-draft-sent" onClick={() => sent(d)} style={plain}>I sent it</button>
                      <button type="button" data-testid="ty-draft-not-sending" onClick={() => notSending(d)} style={{ ...quiet, marginLeft: "auto" }}>Not sending this</button>
                    </div>
                    <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 6 }}>Steward does not send it. It goes from your own email, then you mark it sent.</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 8 }}>{err}</div>}
    </section>
  );
}
