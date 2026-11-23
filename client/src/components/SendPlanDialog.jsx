// SENDS-2 · THE ONE DIALOG FOR A SEND TO MORE THAN ONE PERSON.
//
// Nothing goes to a person until someone has seen exactly who it goes to. Every
// bulk Send button calls
//
//   const r = await askSendPlan({ kind: "volunteer", ids });   // null when she cancels
//
// which asks the server for the plan (POST /send-plans: who, which subject, and
// what will be refused and why), shows it, and only on her Send commits that
// exact list (POST /send-plans/:id/commit). It resolves with the commit's answer
// ({ sent, skipped, failed, message }). Send is the emerald action; the list
// scrolls. The host mounts itself on first use, as askConfirm's does.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { apiFetch } from "../api";
import { T, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";

let show = null;
let mounted = false;
const waiting = [];
const btn = { font: "inherit", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const row = { display: "flex", gap: 10, alignItems: "baseline", padding: "7px 2px", borderTop: "1px solid " + T.bg2, flexWrap: "wrap" };

function SendPlanHost() {
  const [q, setQ] = useState(null);
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // A second ask while one is open answers the first with null.
    show = o => setQ(prev => { if (prev) prev.resolve(null); return o; });
    if (waiting.length) show(waiting.shift());
    return () => { show = null; };
  }, []);
  useEffect(() => {
    if (!q) return;
    setPlan(null); setErr(""); setBusy(false);
    let live = true;
    apiFetch("/send-plans", { method: "POST", body: JSON.stringify({ kind: q.kind, ids: q.ids || [] }) })
      .then(p => { if (live) setPlan(p); })
      .catch(e => { if (live) setErr(errorMessage(e, "The list did not load. Nothing was sent.")); });
    return () => { live = false; };
  }, [q]);
  if (!q) return null;
  const done = v => { setQ(null); q.resolve(v); };
  const send = async () => {
    setBusy(true); setErr("");
    try { done(await apiFetch(`/send-plans/${plan.planId}/commit`, { method: "POST", body: "{}" })); }
    catch (e) { setErr(errorMessage(e, "Nothing was sent.")); setBusy(false); }
  };
  const n = plan ? plan.count : 0;
  const noun = plan ? plan.noun[n === 1 ? 0 : 1] : "";
  const title = !plan ? "Getting the list…" : n ? `Send ${n} ${noun}?` : "Nothing to send";
  return (
    <Modal onClose={() => !busy && done(null)} title={title} width={560} zIndex={500} ariaLabel={title}
      footer={<>
        <button type="button" data-testid="send-plan-cancel" disabled={busy} onClick={() => done(null)}
          style={{ ...btn, background: T.white, color: T.ink, border: "1px solid " + T.ink }}>{n ? "Cancel" : "Close"}</button>
        {n > 0 && <button type="button" data-testid="send-plan-send" disabled={busy} onClick={send}
          style={{ ...btn, background: T.green, color: T.white, border: "none", opacity: busy ? 0.7 : 1 }}>{busy ? "Sending…" : `Send ${n} ${noun}`}</button>}
      </>}>
      <div data-testid="send-plan" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {plan && <div data-testid="send-plan-to" style={{ fontSize: 14, lineHeight: 1.6, color: T.ink }}>{plan.toLine}</div>}
        {plan && n > 0 && (
          <div data-testid="send-plan-list" style={{ maxHeight: 280, overflowY: "auto", borderBottom: "1px solid " + T.bg2 }}>
            {plan.recipients.map(r => (
              <div key={r.ref} style={row}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{r.name || r.email}</span>
                <span style={{ fontSize: 12, color: T.ink3 }}>{r.email}</span>
                <span style={{ fontSize: 12, color: T.ink2, flexBasis: "100%" }}>{r.subject}</span>
              </div>
            ))}
          </div>
        )}
        {plan && plan.refused.length > 0 && (
          <div data-testid="send-plan-refused">
            <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 2 }}>
              {plan.refused.length === 1 ? "1 won't go" : `${plan.refused.length} won't go`}
            </div>
            <div style={{ maxHeight: 160, overflowY: "auto" }}>
              {plan.refused.map(r => (
                <div key={r.ref} style={row}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{r.name || r.email || "Someone"}</span>
                  <span style={{ fontSize: 12, color: T.ink2, flexBasis: "100%" }}>{r.why}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {plan && n > 0 && <div style={{ fontSize: 12, color: T.ink3 }}>This list holds for {plan.minutes} minutes. Anything changed after you opened it is skipped and named.</div>}
        {err && <div role="alert" style={{ fontSize: 13, color: T.ink, fontWeight: 600 }}>{err}</div>}
      </div>
    </Modal>
  );
}

export function askSendPlan({ kind, ids }) {
  return new Promise(resolve => {
    const o = { kind, ids, resolve };
    if (show) { show(o); return; }
    waiting.push(o);
    if (!mounted && typeof document !== "undefined") {
      mounted = true;
      const el = document.createElement("div");
      el.setAttribute("data-send-plan-host", "");
      document.body.appendChild(el);
      createRoot(el).render(<SendPlanHost />);
    }
  });
}
