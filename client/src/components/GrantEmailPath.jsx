// GRANTS-1 · WHICH WAY FUNDER EMAIL ARRIVES.
//
// One sentence from GET /grants/email-path: a staff mailbox, the BCC address,
// or neither. When it is the BCC address, the address is shown in full and can
// be copied, because the sentence is only useful if she can put it in Bcc.
// The server decides the path and writes the sentence; this only shows it.

import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";

const copyBtn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", minHeight: 32 };

export default function GrantEmailPath() {
  const [info, setInfo] = useState(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let live = true;
    apiFetch("/grants/email-path").then(r => { if (live) setInfo(r); }).catch(() => { /* the line is a hint; without it the screen still works */ });
    return () => { live = false; };
  }, []);

  if (!info || !info.sentence) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(info.bccAddress); setCopied("Copied."); }
    catch { setCopied("Copy it by hand; the browser would not."); }
  };

  return (
    <div data-testid="grant-email-path" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13, color: T.ink, lineHeight: 1.5 }}>
      <span>{info.sentence}</span>
      {info.path === "bcc" && info.bccAddress && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <code style={{ fontSize: 12, overflowWrap: "anywhere" }}>{info.bccAddress}</code>
          <button type="button" onClick={copy} style={copyBtn}>Copy</button>
          {copied && <span role="status" style={{ fontSize: 12 }}>{copied}</span>}
        </span>
      )}
    </div>
  );
}
