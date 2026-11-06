// MOPUP-2 item 5 · BULK TRASH ON THE DONORS LIST.
//
// Tick people (or "Select all N matching"), then More → Move to trash. The
// confirm names the count, and how many of them have gifts: those stay unless
// she ticks the box that names them, and the request carries the number she saw
// (POST /donors/bulk-delete, withGifts + withGiftsCount), so a selection that
// changed under her is refused whole. One request is one audit row; one Undo
// toast brings the whole batch back. The trash keeps them for 30 days.
import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { T, Modal } from "../shared";
import { offerUndo } from "../EditHistory";
import { errorMessage } from "../../lib/domainError";

const people = n => `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"}`;
const SERIF = "'DM Serif Display',Georgia,serif";

export function BulkTrash({ ids, disabled, onDone, flash }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [check, setCheck] = useState(null);     // { count, withGifts } | { error }
  const [include, setInclude] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!confirm) return undefined;
    let live = true;
    setCheck(null); setInclude(false);
    apiFetch("/donors/bulk-delete/check", { method: "POST", body: JSON.stringify({ ids }) })
      .then(r => { if (live) setCheck(r); })
      .catch(e => { if (live) setCheck({ error: errorMessage(e, "Steward could not count who has gifts. Nothing was changed.") }); });
    return () => { live = false; };
  }, [confirm]);

  const withGifts = check && !check.error ? Number(check.withGifts) || 0 : 0;
  const moving = include ? ids.length : ids.length - withGifts;

  async function go() {
    if (busy || !check || check.error || moving < 1) return;
    setBusy(true);
    try {
      const r = await apiFetch("/donors/bulk-delete", { method: "POST", body: JSON.stringify({
        ids, count: ids.length, withGifts: include ? "include" : "skip", withGiftsCount: withGifts }) });
      setConfirm(false);
      if (onDone) onDone();
      const n = Number(r.deleted) || 0, left = Number(r.skippedWithGifts) || 0;
      const undoIds = Array.isArray(r.undoIds) ? r.undoIds : [];
      const message = `Moved ${people(n)} to trash.${left ? ` Left ${people(left)} with gifts.` : ""}`;
      if (undoIds.length) {
        offerUndo({ undoSeconds: r.undoSeconds, message, undoAction: async () => {
          // HARDEN-1: one request, one transaction: all of them come back or none do.
          await apiFetch("/deleted-records/restore-people", { method: "POST", body: JSON.stringify({ ids: undoIds }) });
          if (onDone) onDone();
          return { restored: undoIds.length };
        } }, "people");
      } else if (flash) flash(message);
    } catch (e) {
      if (flash) flash(e && e.sentence ? e.sentence : errorMessage(e, "Nobody was moved to trash."));
    }
    setBusy(false);
  }

  const ghost = { background: "transparent", border: "1px solid " + T.gold500, borderRadius: 8, padding: "7px 12px", color: T.gold500, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
  return (
    <div style={{ position: "relative" }}>
      <button type="button" data-testid="bulk-more" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)} disabled={disabled}
        style={{ ...ghost, opacity: disabled ? 0.6 : 1 }}>More ▾</button>
      {open && (
        <div role="menu" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: T.bg, border: "1px solid " + T.bg3, borderRadius: 12, boxShadow: "0 8px 28px rgba(0,0,0,0.15)", zIndex: 500, minWidth: 170, overflow: "hidden" }}>
          <button type="button" role="menuitem" data-testid="bulk-trash" onClick={() => { setOpen(false); setConfirm(true); }}
            style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "10px 14px", fontSize: 13, color: T.ink, cursor: "pointer" }}>
            Move to trash
          </button>
        </div>
      )}
      {confirm && (
        <Modal className="commit-screen" onClose={() => setConfirm(false)} width={440} zIndex={900}
          backdrop="rgba(15,26,18,0.72)" blur={false} padding="36px 32px"
          ariaLabel="Move people to trash" dialogStyle={{ background: T.bg, borderRadius: 20 }}>
          <div data-testid="bulk-trash-confirm">
            <div style={{ fontSize: 24, fontWeight: 400, color: T.ink, fontFamily: SERIF, letterSpacing: "-0.02em", marginBottom: 12, lineHeight: 1.2 }}>
              Move {people(ids.length)} to trash?
            </div>
            <div style={{ fontSize: 14, color: T.ink3, lineHeight: 1.65, marginBottom: 16 }}>
              They leave every list. Undo brings them back now, and the trash keeps them for 30 days.
            </div>
            {!check && <div style={{ fontSize: 13, color: T.ink3, marginBottom: 20 }}>Counting who has gifts…</div>}
            {check && check.error && <div style={{ fontSize: 13, color: T.ink, marginBottom: 20 }}>{check.error}</div>}
            {check && !check.error && withGifts > 0 && (
              <div data-testid="bulk-trash-gifts" style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.6, marginBottom: 20 }}>
                {withGifts === ids.length ? (ids.length === 1 ? "This person has gifts" : `All ${people(ids.length)} have gifts`) : `${people(withGifts)} of them ${withGifts === 1 ? "has" : "have"} gifts`}, so {withGifts === 1 ? "that one stays" : "they stay"} unless you say otherwise.
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, cursor: "pointer" }}>
                  <input type="checkbox" data-testid="bulk-trash-include" checked={include} onChange={e => setInclude(e.target.checked)} style={{ marginTop: 3 }} />
                  <span>Move the {people(withGifts)} with gifts too, and their gift history with them.</span>
                </label>
              </div>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setConfirm(false)}
                style={{ flex: 1, background: "transparent", border: "1px solid " + T.bg3, borderRadius: 10, padding: "11px 16px", color: T.ink3, fontSize: 13, fontWeight: 600, cursor: "pointer", minWidth: 100 }}>
                Cancel
              </button>
              <button type="button" data-commit data-testid="bulk-trash-go" onClick={go} disabled={busy || !check || !!check.error || moving < 1}
                style={{ flex: 1, background: T.terracotta, border: "none", borderRadius: 10, padding: "11px 16px", color: T.white, fontSize: 13, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", opacity: busy || !check || moving < 1 ? 0.7 : 1, minWidth: 100 }}>
                {busy ? "Moving…" : moving < 1 ? "Nobody to move" : `Move ${people(moving)} to trash`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
