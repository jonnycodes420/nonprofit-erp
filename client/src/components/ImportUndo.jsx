// ImportUndo · FIX-52. The one Undo on an import receipt: in the import modal
// and in Settings, Imports. It asks first, with the counts it will remove
// (GET /imports/:id/undo-preview), then undoes and says what it did. It sends
// nothing and starts nothing. Offered whether or not the receipt reconciles:
// an import that went wrong is exactly when undo matters most.
import { useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";

const btn = kind => ({
  background: kind === "danger" ? T.terra700 : kind === "primary" ? T.greenDk : T.white,
  color: kind === "danger" || kind === "primary" ? T.white : T.ink,
  border: kind ? "none" : "1px solid " + T.bg3, borderRadius: 9, padding: "8px 14px", fontWeight: 800, fontSize: 13,
  cursor: "pointer", fontFamily: "inherit",
});

export default function ImportUndo({ importId, onUndone, disabled }) {
  const [step, setStep] = useState("idle");   // idle · asking · confirm · undoing · done
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState("");
  const [err, setErr] = useState("");

  const ask = async () => {
    setStep("asking"); setErr("");
    try { setPreview(await apiFetch(`/imports/${encodeURIComponent(importId)}/undo-preview`)); setStep("confirm"); }
    catch (e) { setErr(errorMessage(e, "Steward could not count what this import added.")); setStep("idle"); }
  };
  const undo = async () => {
    setStep("undoing"); setErr("");
    try {
      const r = await apiFetch(`/imports/${encodeURIComponent(importId)}/reverse`, { method: "POST", body: "{}" });
      setDone(r.sentence || "Undone."); setStep("done");
      if (onUndone) onUndone(r);
    } catch (e) { setErr(e?.body?.message || errorMessage(e, "That did not undo. Nothing was changed.")); setStep("confirm"); }
  };

  if (step === "done") return <div data-testid="import-undo-done" style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{done}</div>;
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
