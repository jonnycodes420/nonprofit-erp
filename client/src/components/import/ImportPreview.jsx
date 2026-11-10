// ONBOARD-1 · "Preview first": a file into a customer's org can go in hidden,
// held out of every count and list until the customer checks it on the
// Verify page and makes it live. Offered only for the first file into an org
// (server/onboard/staging.js says why). The batch is hidden inside the
// import's own transaction, so there is no moment when it counts.
import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";

export function usePreviewChoice() {
  const [elig, setElig] = useState(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    apiFetch("/onboard/preview-eligible").then(r => { if (live) setElig(r); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return { eligible: !!(elig && elig.eligible), sentence: elig && elig.sentence, on: !!(on && elig && elig.eligible), setOn };
}

export function PreviewToggle({ choice }) {
  if (!choice || !choice.eligible) return null;
  return (
    <label data-testid="import-preview-toggle" style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "4px 0 12px", fontSize: 13, color: T.ink2 }}>
      <input type="checkbox" checked={choice.on} onChange={e => choice.setOn(e.target.checked)} style={{ marginTop: 2 }} />
      <span>{choice.sentence}</span>
    </label>
  );
}

export function StagedNotice({ staged }) {
  if (!staged) return null;
  return (
    <div data-testid="import-staged" style={{ background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 10, padding: "12px 14px", margin: "0 0 12px", fontSize: 13.5, color: T.ink }}>
      <div>{staged.sentence}</div>
      {staged.staged && staged.verifyUrl ? <a href={staged.verifyUrl} data-testid="import-verify-link" style={{ color: T.green600, fontWeight: 600 }}>Check the file and make it live →</a> : null}
    </div>
  );
}
