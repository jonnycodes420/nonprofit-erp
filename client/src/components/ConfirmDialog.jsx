// FIX-22: THE IN-APP CONFIRM. One dialog for the whole app, in place of the
// browser's window.confirm (which cannot be styled, blocks the tab, and reads
// like a system error). Most deletes need no confirm at all: they happen at
// once and offer Undo for ten seconds (useUndo in EditHistory.jsx). This is
// for what cannot be undone or moves money: a gift, a send, an erase.
//
//   if (!(await askConfirm({ title, body, yes: "Delete", danger: true }))) return;
//
// It resolves true or false. `danger` paints the yes button terracotta, the
// one place red reaches a screen (a destructive confirm); otherwise it is the
// emerald action. The host mounts itself on first use, so no screen has to
// render anything for it.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { T, Modal } from "./shared";

let show = null;
let mounted = false;
const waiting = [];

function ConfirmHost() {
  const [q, setQ] = useState(null);
  useEffect(() => {
    // A second ask while one is open answers the first with "no".
    show = o => setQ(prev => { if (prev) prev.resolve(false); return o; });
    if (waiting.length) show(waiting.shift());
    return () => { show = null; };
  }, []);
  if (!q) return null;
  const done = v => { setQ(null); q.resolve(v); };
  const btn = { font: "inherit", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
  return (
    <Modal onClose={() => done(false)} title={q.title || "Are you sure?"} width={440} zIndex={500}
      footer={<>
        <button type="button" data-testid="confirm-no" onClick={() => done(false)}
          style={{ ...btn, background: T.white, color: T.ink, border: "1px solid " + T.ink }}>{q.no || "Cancel"}</button>
        <button type="button" data-testid="confirm-yes" onClick={() => done(true)}
          style={{ ...btn, background: q.danger ? T.terracotta : T.green, color: T.white, border: "none" }}>{q.yes || "Confirm"}</button>
      </>}>
      {q.body && <div style={{ fontSize: 14, lineHeight: 1.6, color: T.ink, whiteSpace: "pre-line" }}>{q.body}</div>}
    </Modal>
  );
}

export function askConfirm(opts) {
  return new Promise(resolve => {
    const o = { ...(typeof opts === "string" ? { body: opts } : (opts || {})), resolve };
    if (show) { show(o); return; }
    waiting.push(o);
    if (!mounted && typeof document !== "undefined") {
      mounted = true;
      const el = document.createElement("div");
      el.setAttribute("data-confirm-host", "");
      document.body.appendChild(el);
      createRoot(el).render(<ConfirmHost />);
    }
  });
}
