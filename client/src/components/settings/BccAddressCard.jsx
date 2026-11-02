import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { T, SectionLabel } from "../shared";
import { countLabel } from "../../../../shared/countWords.js";

// ── FIX-11 Part 5 — THE BCC ADDRESS ───────────────────────────────────────
// One address for the organisation, said plainly, with a copy button, and the
// honest sentence about what it does and does not do. It is NOT a private
// inbox: Steward knows a message came from you because you sent it, and a
// message that names nobody on file is held for a human or stored nowhere.
export function BccAddressCard() {
  const [d, setD] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    apiFetch("/settings/inbound-email").then(r => { if (alive) setD(r); }).catch(() => { if (alive) setD({ enabled: false }); });
    return () => { alive = false; };
  }, []);
  if (!d) return null;
  const copy = () => {
    if (!d.address) return;
    navigator.clipboard?.writeText(d.address).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2200);
    }, () => setCopied(false));
  };
  return (
    <div data-testid="bcc-address" style={{ background:T.white, border:"1px solid "+T.bg3, borderRadius:16, padding:"24px 28px", marginTop:16 }}>
      <SectionLabel>Logging email by BCC</SectionLabel>
      <div style={{ fontSize:13, color:T.ink3, lineHeight:1.65, maxWidth:620, marginBottom:d.enabled?14:0 }}>
        {d.sentence}
      </div>
      {d.enabled && d.address && (
        <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
          <code data-testid="bcc-address-value"
            style={{ fontSize:13.5, fontWeight:700, color:T.ink, background:T.bg, border:"1px solid "+T.bg3,
                     borderRadius:8, padding:"9px 14px", fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace" }}>
            {d.address}
          </code>
          <button data-testid="bcc-copy" onClick={copy}
            style={{ background:T.greenDk, border:"none", borderRadius:8, padding:"9px 16px", color:T.white,
                     fontSize:12.5, fontWeight:700, cursor:"pointer" }}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {d.enabled && d.droppedCount > 0 && (
        <div style={{ fontSize:12, color:T.ink3, marginTop:10 }}>
          {countLabel(d.droppedCount, "message")} arrived that Steward stored nothing from, because {d.droppedCount === 1 ? "it named" : "they named"} nobody on file.
        </div>
      )}
    </div>
  );
}
