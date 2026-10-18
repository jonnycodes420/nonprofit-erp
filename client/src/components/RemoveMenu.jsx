// FIX-41 · ANYTHING YOU CAN ADD, YOU CAN REMOVE.
//
// The one Remove every list uses. The server decides what removing means
// (removal.js: retire when people or money are attached, archive a page with
// gifts, otherwise delete) and writes the confirm sentence from what is
// attached; this file only shows it, asks once, does it, and offers the shared
// Undo toast for ten seconds. A screen never words its own confirm.
//
//   <RemoveMenu kind="ticket_type" id={l.id} onDone={reload} />
//       a "More" button on the row, with Remove (and any `items` before it)
//   removeOne({ kind, id, onDone })      the same, from a screen's own button
//   removeMany({ kind, ids, onDone })    Remove selected: one confirm, one Undo
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { askConfirm } from "./ConfirmDialog";
import { offerUndo } from "./EditHistory";
import { errorMessage } from "../lib/domainError";

// A volunteer coordinator reaches only the volunteer surfaces, so the
// volunteer kinds answer under /volunteer-hub too (routes/removal.js).
const VOLUNTEER_KINDS = new Set(["volunteer_role", "shift", "volunteer_signup"]);
const base = kind => (VOLUNTEER_KINDS.has(kind) ? "/volunteer-hub/removals" : "/removals");
const post = (path, body) => apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) });
const menuItem = { background: "transparent", border: "none", textAlign: "left", padding: "8px 12px", fontSize: 13, color: T.ink, cursor: "pointer", borderRadius: 6, fontFamily: "inherit", width: "100%" };

async function confirmPlan(plan) {
  if (plan.mode === "refuse") {
    await askConfirm({ title: plan.title, body: plan.body, yes: "OK", no: "Close" });
    return false;
  }
  return askConfirm({ title: plan.title, body: plan.body, yes: plan.yes, danger: plan.mode === "delete" });
}

function offer(kind, r, onDone, onError) {
  offerUndo({
    message: r.sentence,
    undoSeconds: r.undoSeconds,
    undoAction: async () => { const x = await post(base(kind) + "/undo", { undoIds: r.undoIds }); onDone && onDone(); return x; },
  }, kind);
  onDone && onDone(r);
  return r;
}

export async function removeOne({ kind, id, onDone, onError }) {
  try {
    const plan = await apiFetch(`${base(kind)}/${kind}/${encodeURIComponent(id)}`);
    if (!(await confirmPlan(plan))) return null;
    const r = await post(`${base(kind)}/${kind}/${encodeURIComponent(id)}`);
    return offer(kind, r, onDone, onError);
  } catch (e) {
    const msg = errorMessage(e, "That could not be removed.");
    if (onError) onError(msg); else await askConfirm({ title: "Not removed", body: msg, yes: "OK", no: "Close" });
    return null;
  }
}

export async function removeMany({ kind, ids, onDone, onError }) {
  if (!ids || !ids.length) return null;
  try {
    const plan = await post(`${base(kind)}/${kind}/plan`, { ids });
    if (!(await askConfirm({ title: plan.title, body: plan.body, yes: plan.yes, danger: false }))) return null;
    const r = await post(`${base(kind)}/${kind}`, { ids });
    return offer(kind, r, onDone, onError);
  } catch (e) {
    const msg = errorMessage(e, "Those could not be removed.");
    if (onError) onError(msg); else await askConfirm({ title: "Not removed", body: msg, yes: "OK", no: "Close" });
    return null;
  }
}

// The row's More menu. `items` are [{ label, onClick }] shown above Remove;
// `removeLabel` names the remove ("Remove winner"). Hidden when read-only.
export default function RemoveMenu({ kind, id, onDone, onError, items = [], removeLabel = "Remove", disabled = false, label = "More" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (disabled) return null;
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }} onClick={e => e.stopPropagation()}>
      <button type="button" data-testid="row-more" data-kind={kind} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "4px 10px", fontSize: 12.5, fontWeight: 700, color: T.ink, cursor: "pointer", fontFamily: "inherit" }}>
        {label}
      </button>
      {open && (
        <div role="menu" style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, zIndex: 30, background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, boxShadow: "0 8px 24px rgba(15,26,18,0.12)", padding: 4, minWidth: 160, display: "flex", flexDirection: "column" }}>
          {items.filter(Boolean).map(it => (
            <button key={it.label} type="button" role="menuitem" style={menuItem} onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>
          ))}
          <button type="button" role="menuitem" data-testid="row-remove" style={menuItem}
            onClick={() => { setOpen(false); removeOne({ kind, id, onDone, onError }); }}>{removeLabel}</button>
        </div>
      )}
    </span>
  );
}
