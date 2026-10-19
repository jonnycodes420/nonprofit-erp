// CAPTURE-1 · TO CONFIRM. One place for every gift that arrived as paper or
// as a document: a photographed check, a scanned batch, a pledge form or a
// fund's grant letter from email, anything forwarded to the capture address.
// Money waits here as a card until a person confirms it. Low-stakes changes
// (an address, an email, a document for a profile) are done right away and
// listed under "Done for you", each with Undo for 30 days.
import { useEffect, useState } from "react";
import { T } from "./shared";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";
import Uploader from "./Uploader";
import { SnapChecks, prepareCaptureFile, uploadCaptureFiles, CAPTURE_MAX_BYTES, CAPTURE_MAX_LABEL } from "./SnapChecks";
import { CaptureCard } from "./CaptureCard";

const DROP_ACCEPT = ["image/*", "application/pdf", ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];

// The card is two columns on a laptop and one on a phone, where the image
// sits on top at no more than 40% of the screen so the form stays in reach.
const CAPTURE_CSS = `
.capture-card-grid { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: 18px; align-items: start; }
.capture-doc-img { max-height: 460px; }
.capture-doc-frame { height: 460px; }
.capture-drop-wide { display: block; }
@media (max-width: 720px) {
  .capture-card-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .capture-doc-img { max-height: 40vh; }
  .capture-doc-frame { height: 40vh; }
  .capture-drop-wide { display: none; }
}
`;

export const CAPTURE_CHANGED = "steward:capture-changed";
const announce = () => { try { window.dispatchEvent(new Event(CAPTURE_CHANGED)); } catch { /* no window */ } };

const when = s => {
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

function DoneForYou({ items, isReadOnly, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState("");
  if (!items.length) return null;
  const undo = async it => {
    setBusy(it.id); setMsg("");
    try {
      await apiFetch(`/capture/${encodeURIComponent(it.id)}/undo`, { method: "POST" });
      setMsg("Put back the way it was.");
      onChanged();
    } catch (e) { setMsg(errorMessage(e, "It could not be undone.")); }
    setBusy(null);
  };
  const now = Date.now();
  return (
    <section data-testid="capture-done-for-you" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>Done for you</div>
      <div style={{ fontSize: 12.5, color: T.ink3 }}>Small changes Steward made right away. Each can be undone for 30 days.</div>
      <div style={{ background: T.white, border: "1px solid " + T.bg2, borderRadius: 12 }}>
        {items.map((it, i) => {
          const open = it.status === "applied" && it.undoUntil && new Date(it.undoUntil).getTime() > now;
          return (
            <div key={it.id} data-card-id={it.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 14px", borderTop: i ? "1px solid " + T.bg2 : "none" }}>
              <span style={{ flex: "1 1 220px", fontSize: 13.5, color: T.ink, lineHeight: 1.45 }}>
                {it.appliedSummary || it.headline}
                {it.status === "undone" && <span style={{ color: T.ink3 }}> · undone</span>}
              </span>
              <span style={{ fontSize: 12, color: T.ink3 }}>{when(it.decidedAt)}</span>
              {open && (
                <button type="button" data-testid="capture-undo" disabled={isReadOnly || busy === it.id} onClick={() => undo(it)}
                  style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, color: T.ink, cursor: "pointer", fontFamily: "inherit" }}>
                  Undo
                </button>
              )}
            </div>
          );
        })}
      </div>
      {msg && <div style={{ fontSize: 12.5, color: T.ink }}>{msg}</div>}
    </section>
  );
}

export function CaptureInbox({ isReadOnly, onOpenThanks }) {
  const [data, setData] = useState(null);
  const [funds, setFunds] = useState([]);
  const [err, setErr] = useState("");
  const [batch, setBatch] = useState(null);
  const [refused, setRefused] = useState([]);
  const [dropped, setDropped] = useState([]);
  const [dropErr, setDropErr] = useState("");
  const [sending, setSending] = useState(false);
  const [pinned, setPinned] = useState({});   // cards confirmed in this visit, kept on screen with their result

  const load = () => apiFetch("/capture")
    .then(r => { setData(r); setErr(""); })
    .catch(e => setErr(errorMessage(e, "Could not load what is waiting to be confirmed.")));
  useEffect(() => {
    load();
    apiFetch("/finance/funds").then(f => setFunds(Array.isArray(f) ? f : [])).catch(() => setFunds([]));
  }, []);

  // The batch just read first, then every batch still waiting (a slip photographed earlier).
  const shownBatches = [batch, ...((data && data.batches) || []).filter(x => !batch || x.id !== batch.id)].filter(Boolean);
  const changed = opts => { announce(); if (!(opts && opts.silent)) load(); };

  const afterRead = r => {
    setBatch(r && r.batch ? r.batch : null);
    setRefused((r && r.refused) || []);
    changed();
  };

  const sendDropped = async () => {
    if (!dropped.length) return;
    setSending(true); setDropErr("");
    try {
      const r = await uploadCaptureFiles(dropped, { batch: dropped.length > 1 });
      setDropped([]);
      afterRead(r);
    } catch (e) { setDropErr(errorMessage(e, "The files could not be sent. Try again.")); }
    setSending(false);
  };

  if (!data) return <div data-testid="capture-inbox" style={{ padding: 32, color: T.ink3, fontSize: 13 }}>{err || "Loading…"}</div>;

  const waiting = data.waiting || [];
  const ids = new Set(waiting.map(c => c.id));
  const shown = [...waiting, ...Object.values(pinned).filter(c => !ids.has(c.id))];
  const n = (data.counts && data.counts.waiting) ?? waiting.length;

  return (
    <div data-testid="capture-inbox" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{CAPTURE_CSS}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div data-testid="capture-count" style={{ fontSize: 14, color: T.ink, lineHeight: 1.5 }}>
          {n === 0 ? "Nothing is waiting. Every gift that came in as paper or a document has been confirmed."
            : n === 1 ? "One item is waiting for you to confirm it."
            : `${n} items are waiting for you to confirm them.`}
          {" "}Nothing is logged until you tap, and nothing is sent to a donor.
        </div>
        {data.address && (
          <div data-testid="capture-address" style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, overflowWrap: "anywhere" }}>
            Forward anything to <strong style={{ color: T.ink, userSelect: "all" }}>{data.address}</strong>: a scan, a letter, a photo from your phone. It lands here. Only mail from your team is kept.
          </div>
        )}
        {data.ai && data.ai.on === false && (
          <div style={{ fontSize: 12.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 8, lineHeight: 1.5 }}>
            AI is off, so Steward will not read the images. Each card still shows the image beside an empty form for you to fill in.
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "stretch" }}>
        <div style={{ flex: "1 1 300px", minWidth: 0 }}>
          <SnapChecks isReadOnly={isReadOnly} onRead={afterRead} />
        </div>
        <div className="capture-drop-wide" data-testid="capture-drop" style={{ flex: "1 1 300px", minWidth: 0 }}>
          <Uploader accept={DROP_ACCEPT} acceptLabel="images or a PDF" multiple readAs="none" disabled={isReadOnly || sending} busy={sending}
            label="Drag check images or a scanned PDF here, or browse"
            hint={`Images or PDF, up to ${CAPTURE_MAX_LABEL} each. A PDF of several checks becomes one card per check.`}
            maxBytes={null}
            onFile={async ({ file }) => {
              if (file.size > CAPTURE_MAX_BYTES * 3) { setDropErr(`"${file.name}" is larger than ${CAPTURE_MAX_LABEL}.`); return; }
              const p = await prepareCaptureFile(file);
              if (p.error) { setDropErr(p.error); return; }
              setDropped(ds => [...ds, p]);
            }} />
          {dropped.length > 0 && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
              <span style={{ fontSize: 13, color: T.ink }}>{dropped.length === 1 ? "1 file ready" : `${dropped.length} files ready`}: {dropped.map(d => d.name).join(", ")}</span>
              <button type="button" data-testid="capture-drop-send" disabled={isReadOnly || sending} onClick={sendDropped}
                style={{ background: T.green, color: T.white, border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                {sending ? "Reading…" : dropped.length === 1 ? "Read it" : `Read these ${dropped.length}`}
              </button>
              <button type="button" onClick={() => setDropped([])} disabled={sending}
                style={{ background: "none", border: "none", color: T.ink3, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>Clear</button>
            </div>
          )}
          {dropErr && <div style={{ fontSize: 12.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 8, marginTop: 8 }}>{dropErr}</div>}
        </div>
      </div>

      {shownBatches.map(batch => batch && batch.sentence && (
        <div key={batch.id || "new"} data-testid="capture-batch" data-matches={batch.matches === true ? "yes" : batch.matches === false ? "no" : ""}
          style={{ fontSize: 13.5, color: T.ink, background: batch.matches === false ? T.gold50 : T.white,
                   border: "1px solid " + (batch.matches === false ? T.gold : T.bg2), borderRadius: 10, padding: "10px 14px", lineHeight: 1.5 }}>
          {batch.sentence}
        </div>
      ))}
      {refused.length > 0 && (
        <div data-testid="capture-refused" style={{ display: "flex", flexDirection: "column", gap: 4, borderLeft: "3px solid " + T.gold, paddingLeft: 10 }}>
          {refused.map((f, i) => <div key={i} style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.5 }}><strong>{f.name}</strong>: {f.sentence}</div>)}
        </div>
      )}

      {err && <div style={{ fontSize: 12.5, color: T.ink }}>{err}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {shown.map(c => (
          <CaptureCard key={c.id} card={c} funds={funds} isReadOnly={isReadOnly} onOpenThanks={onOpenThanks}
            onChanged={opts => {
              if (opts && opts.silent) setPinned(p => ({ ...p, [c.id]: c }));
              changed(opts);
              if (opts && opts.silent) load();
            }} />
        ))}
      </div>

      <DoneForYou items={data.doneForYou || []} isReadOnly={isReadOnly} onChanged={changed} />
    </div>
  );
}
