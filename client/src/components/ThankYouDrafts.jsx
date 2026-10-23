// CHECK-2 · ONE DRAFT, THREE VIEWS. A thank-you drafted from a check (or any
// gift) is one row in thank_you_drafts. Communications (drafts waiting to
// send), the donor profile's Emails tab and Money in, Acknowledgments all
// list it through this component, from the one GET /thank-yous, so Mark sent
// or Skip in any of them takes it out of all three. Nothing here copies a draft.
//
// `highlightId` opens that draft on arrival ("Read and send it" on a
// confirmed check lands here with it open).
import { useEffect, useRef, useState } from "react";
import { T, fmtFull, PersonMark } from "./shared";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";
import { DonorLink, RecordLink } from "./RecordLink";
import { giftHref } from "../lib/appUrls";
import { displayDateShort } from "../../../shared/displayDate";
import { displayName } from "../../../shared/displayName.js";

export const THANK_YOUS_CHANGED = "steward:thank-yous-changed";
const CAPTURE_CHANGED = "steward:capture-changed";
const announce = () => { try { window.dispatchEvent(new Event(THANK_YOUS_CHANGED)); } catch { /* no window */ } };

const btn = { borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

export function ThankYouDrafts({ donorId = null, highlightId = null, title = "Thank-yous waiting to send", intro, onNavigate, hideWhenEmpty = false, testid = "ty-drafts" }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(highlightId || null);
  const [copied, setCopied] = useState(null);
  const [err, setErr] = useState("");
  const refs = useRef({});

  const load = () => apiFetch("/thank-yous")
    .then(r => setRows(((r && r.drafts) || []).filter(d => !donorId || d.donorId === donorId)))
    .catch(() => setRows([]));
  useEffect(() => {
    load();
    const on = () => load();
    window.addEventListener(THANK_YOUS_CHANGED, on);
    window.addEventListener(CAPTURE_CHANGED, on);
    return () => { window.removeEventListener(THANK_YOUS_CHANGED, on); window.removeEventListener(CAPTURE_CHANGED, on); };
  }, [donorId]);   // eslint-disable-line react-hooks/exhaustive-deps

  // The deep link: open it, record that it was read, and bring it into view.
  useEffect(() => {
    if (!highlightId || !rows) return;
    const d = rows.find(x => x.id === highlightId);
    if (!d) return;
    setOpen(d.id);
    if (!d.opened) apiFetch(`/thank-yous/${encodeURIComponent(d.id)}/opened`, { method: "POST" }).catch(() => {});
    const el = refs.current[d.id];
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, rows]);

  const toggle = d => {
    if (open === d.id) { setOpen(null); return; }
    setOpen(d.id); setErr("");
    if (!d.opened) apiFetch(`/thank-yous/${encodeURIComponent(d.id)}/opened`, { method: "POST" }).catch(() => {});
  };
  const copy = async d => {
    try { await navigator.clipboard.writeText(d.body || ""); setCopied(d.id); setTimeout(() => setCopied(null), 2500); }
    catch { setErr("Your browser would not let Steward reach the clipboard. Select the draft and copy it."); }
  };
  const act = async (d, what) => {
    setErr("");
    try { await apiFetch(`/thank-yous/${encodeURIComponent(d.id)}/${what}`, { method: "POST" }); setOpen(null); announce(); await load(); }
    catch (e) { setErr(errorMessage(e, "That could not be saved.")); }
  };

  if (rows == null) return null;
  if (!rows.length && hideWhenEmpty) return null;
  return (
    <section data-testid={testid} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{title}</div>
        <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>
          {intro || "Each thank-you Steward drafted for a gift, not yet sent. It is the same draft wherever you see it. Steward does not send it: you send it from your own mail, then mark it sent."}
        </div>
      </div>
      {!rows.length && <div style={{ fontSize: 13, color: T.ink3 }}>{donorId ? "No thank-you is waiting for this person." : "No thank-you is waiting to be sent."}</div>}
      {rows.length > 0 && (
        <div style={{ background: T.white, border: "1px solid " + T.bg2, borderRadius: 12 }}>
          {rows.map((d, i) => (
            <div key={d.id} ref={el => { refs.current[d.id] = el; }} data-thank-you={d.id} data-testid="ty-draft-row"
              style={{ padding: "12px 14px", borderTop: i ? "1px solid " + T.bg2 : "none", boxShadow: highlightId === d.id ? "inset 3px 0 0 " + T.gold : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                {!donorId && <PersonMark id={d.donorId} name={d.donorName} size={28} />}
                <div style={{ flex: "1 1 180px", minWidth: 0, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  {!donorId && (
                    <DonorLink id={d.donorId} onOpen={onNavigate ? () => onNavigate("donors", { selectDonorId: d.donorId }) : undefined}
                      style={{ background: "none", border: "none", padding: 0, font: "inherit", fontSize: 14, fontWeight: 700, color: T.ink, cursor: "pointer", textAlign: "left" }}>{displayName(d.donorName)}</DonorLink>
                  )}
                  <span style={{ fontSize: 13, color: T.ink2, fontVariantNumeric: "tabular-nums" }}>
                    <RecordLink to={giftHref(d.donorId, d.giftId)} data-record-link="gift" title="Open the gift"
                      onOpen={onNavigate ? () => onNavigate("donors", { selectDonorId: d.donorId, anchor: "gift-" + d.giftId }) : undefined}
                      style={{ color: "inherit" }}>{fmtFull(d.amount)}</RecordLink>{d.fundName ? ` · ${d.fundName}` : ""}
                  </span>
                  {d.giftDate && <span style={{ fontSize: 12.5, color: T.ink3 }}>{displayDateShort(String(d.giftDate).slice(0, 10), new Date())}</span>}
                  {d.opened && <span style={{ fontSize: 11.5, color: T.ink3 }}>opened</span>}
                </div>
                <button type="button" data-testid="ty-draft-open" aria-expanded={open === d.id} onClick={() => toggle(d)}
                  style={{ ...btn, flexShrink: 0, background: T.white, border: "1px solid " + T.ink, color: T.ink, whiteSpace: "nowrap" }}>
                  {open === d.id ? "Close" : "Read the draft"}
                </button>
              </div>
              {open === d.id && (
                <div style={{ marginTop: 10 }}>
                  <textarea readOnly value={d.body || ""} aria-label={`Thank-you for ${d.donorName}`} data-testid="ty-draft-body"
                    style={{ width: "100%", minHeight: 130, background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "10px 12px", color: T.ink, fontSize: 13, lineHeight: 1.55, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button type="button" onClick={() => copy(d)} style={{ ...btn, background: T.green, border: "none", color: T.white }}>{copied === d.id ? "Copied" : "Copy"}</button>
                    <button type="button" onClick={() => act(d, "sent")} data-testid="ty-draft-sent" style={{ ...btn, background: T.white, border: "1px solid " + T.ink, color: T.ink }}>Mark sent</button>
                    <button type="button" onClick={() => act(d, "skip")} style={{ ...btn, background: T.white, border: "1px solid " + T.bg3, color: T.ink3, fontWeight: 600 }}>Skip</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 8 }}>{err}</div>}
    </section>
  );
}
