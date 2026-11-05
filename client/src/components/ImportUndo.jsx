// ImportUndo · FIX-52. The one Undo on an import receipt: in the import modal
// and in Settings, Imports. It asks first, with the counts it will remove
// (GET /imports/:id/undo-preview), then undoes and says what it did. It sends
// nothing and starts nothing. Offered whether or not the receipt reconciles:
// an import that went wrong is exactly when undo matters most.
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";

const btn = kind => ({
  background: kind === "danger" ? T.terra700 : kind === "primary" ? T.greenDk : T.white,
  color: kind === "danger" || kind === "primary" ? T.white : T.ink,
  border: kind ? "none" : "1px solid " + T.bg3, borderRadius: 9, padding: "8px 14px", fontWeight: 800, fontSize: 13,
  cursor: "pointer", fontFamily: "inherit",
});

// IMPORT-7: a big import is undone on the queue (POST answers 202); the screen
// follows it (GET /imports/:id/undo-status) with its progress until it is
// done or has stopped, and says which. It never waits on one request.
const FOLLOW_MS = 1000;

export default function ImportUndo({ importId, onUndone, disabled }) {
  const [step, setStep] = useState("idle");   // idle · asking · confirm · undoing · following · done
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState("");
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState(null);
  // IMPORT-8: the people who stayed (activity since the import), and her
  // choice to remove them too: the ordinary delete, to the trash
  const [stayed, setStayed] = useState(null);
  const [removing, setRemoving] = useState("");
  const live = useRef(true);

  const finish = r => {
    setDone(r.sentence || (r.stayedCount ? `Undone, except for ${r.stayedCount} people.` : "Undone."));
    setStayed(r.stayedCount ? { count: r.stayedCount, people: r.stayed || [] } : null);
    setStep("done"); if (onUndone) onUndone(r);
  };
  const removeStayed = async () => {
    const ids = (stayed.people || []).map(p => p.id);
    setRemoving("working"); setErr("");
    try {
      await apiFetch("/donors/bulk-delete", { method: "POST", body: JSON.stringify({ ids, count: ids.length }) });
      setRemoving(`${ids.length.toLocaleString("en-US")} ${ids.length === 1 ? "person" : "people"} removed too, with what was added to them since. They are in the trash for 30 days.`);
    } catch (e) { setRemoving(""); setErr(e?.body?.sentence || errorMessage(e, "They were not removed. Nothing was changed.")); }
  };
  const follow = async () => {
    setStep("following");
    for (;;) {
      await new Promise(z => setTimeout(z, FOLLOW_MS));
      if (!live.current) return;
      const s = await apiFetch(`/imports/${encodeURIComponent(importId)}/undo-status`, { cache: "no-store" }).catch(() => null);
      if (!live.current) return;
      if (!s) continue;
      if (s.status === "done") return finish({ reversed: true, ...(s.result || {}), sentence: s.sentence });
      if (s.status === "failed") { setErr(s.sentence); setProgress(null); setStep("confirm"); return; }
      setProgress(s);
    }
  };
  // A receipt opened (or drawn again) while its undo runs on the queue
  // follows it from where it is, never shows Undo for an undo under way.
  useEffect(() => {
    live.current = true;
    apiFetch(`/imports/${encodeURIComponent(importId)}/undo-status`, { cache: "no-store" })
      .then(s => {
        if (!live.current || !s) return;
        if (s.status === "running") { setProgress(s); follow(); }
        // IMPORT-8: an undo that kept people says so wherever it is opened again, with Remove them too
        else if (s.status === "done" && s.result && s.result.stayedCount) {
          setDone(s.sentence || s.result.sentence); setStayed({ count: s.result.stayedCount, people: s.result.stayed || [] }); setStep("done");
        }
      })
      .catch(() => {});
    return () => { live.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importId]);

  const ask = async () => {
    setStep("asking"); setErr("");
    try { setPreview(await apiFetch(`/imports/${encodeURIComponent(importId)}/undo-preview`)); setStep("confirm"); }
    catch (e) { setErr(errorMessage(e, "Steward could not count what this import added.")); setStep("idle"); }
  };
  const undo = async () => {
    setStep("undoing"); setErr("");
    try {
      const r = await apiFetch(`/imports/${encodeURIComponent(importId)}/reverse`, { method: "POST", body: "{}" });
      if (r && r.status === "running") { setProgress(r); return follow(); }
      finish(r);
    } catch (e) {
      // HARDEN-1: a lost answer is not "nothing was changed". The undo may
      // have run (the network dropped on the way back, or another press got
      // there first); whether it did is the server's to say, so ask it.
      // no-store: an answer the browser kept from before the undo is not an answer.
      const now = await apiFetch(`/imports/${encodeURIComponent(importId)}/undo-preview`, { cache: "no-store" }).catch(() => null);
      if (now && now.reversedAt) {
        const r = { reversed: true, already: true, sentence: "Undone. The whole import was removed." };
        setDone(r.sentence); setStep("done");
        if (onUndone) onUndone(r);
        return;
      }
      setErr(now ? (e?.body?.message || errorMessage(e, "That did not undo. Nothing was changed."))
        : "Steward could not reach the server to check whether this undid. Try again: an import is never undone twice.");
      setStep("confirm");
    }
  };

  if (step === "done") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div data-testid="import-undo-done" style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{done}</div>
      {stayed && stayed.people.length > 0 && !/removed too/.test(removing) && (
        <div data-testid="import-undo-stayed" style={{ fontSize: 13, color: T.ink }}>
          <button type="button" data-testid="import-undo-remove-stayed" style={btn(null)} disabled={removing === "working"} onClick={removeStayed}>
            {removing === "working" ? "Removing…" : `Remove ${stayed.people.length === 1 ? "them" : `these ${stayed.people.length.toLocaleString("en-US")}`} too`}
          </button>
          <div style={{ fontSize: 12, color: T.ink3, marginTop: 4 }}>What was added to them since goes with them, to the trash, where it can be brought back for 30 days.{stayed.count > stayed.people.length ? ` The first ${stayed.people.length.toLocaleString("en-US")} of ${stayed.count.toLocaleString("en-US")}; the rest are on the Donors list.` : ""}</div>
        </div>
      )}
      {/removed too/.test(removing) && <div data-testid="import-undo-stayed-removed" style={{ fontSize: 13, color: T.ink }}>{removing}</div>}
      {err && <div role="alert" style={{ fontSize: 12.5, color: T.terra700 }}>{err}</div>}
    </div>
  );
  if (step === "following") {
    const pct = progress && progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
    return (
      <div data-testid="import-undo-progress" role="status" style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: T.ink }}>
        <div>{(progress && progress.sentence) || "Undoing…"}</div>
        <div style={{ height: 6, background: T.bg3, borderRadius: 3, overflow: "hidden" }}>
          <div style={{ width: pct + "%", height: "100%", background: T.greenDk, transition: "width .3s" }} />
        </div>
        <div style={{ fontSize: 12, color: T.ink3 }}>A big import is undone in the background. You can close this; the receipt in Settings, Imports says when it is done.</div>
      </div>
    );
  }
  return (
    <div data-testid="import-undo" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {step === "confirm" && preview && (
        <div data-testid="import-undo-confirm" style={{ fontSize: 13, color: T.ink, background: T.bg, border: "1px solid " + T.bg3, borderRadius: 9, padding: "10px 12px", lineHeight: 1.5 }}>
          {preview.canUndo ? preview.sentence : preview.reversedAt ? "This import was already undone." : "This import can no longer be undone as a whole. Correct it gift by gift instead."}
        </div>
      )}
      {err && <div role="alert" style={{ fontSize: 12.5, color: T.terra700 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {step !== "confirm" && step !== "undoing" && (
          <button type="button" data-testid="import-undo-open" style={btn(null)} disabled={disabled || step === "asking"} onClick={ask}>
            {step === "asking" ? "Counting…" : "Undo this import"}
          </button>
        )}
        {(step === "confirm" || step === "undoing") && preview && preview.canUndo && (
          <button type="button" data-commit data-testid="import-undo-yes" style={btn("danger")} disabled={step === "undoing"} onClick={undo}>
            {step === "undoing" ? "Undoing…" : "Yes, undo it"}
          </button>
        )}
        {step === "confirm" && <button type="button" style={btn(null)} onClick={() => setStep("idle")}>Keep it</button>}
      </div>
    </div>
  );
}
