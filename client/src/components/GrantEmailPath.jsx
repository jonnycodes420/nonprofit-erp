// GRANTS-1 · WHICH WAY FUNDER EMAIL ARRIVES.
//
// One sentence from GET /grants/email-path: a staff mailbox, the BCC address,
// or neither. The server decides the path and writes the sentence; this only
// shows it.
//
// POLISH-5: it was a banner across the top of the pipeline. It is a small
// "Log emails" link now, and the sentence, the address and its Copy button
// open in a popover beside it. The address also lives in Settings →
// Connections, where the rest of the inbox settings are.

import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";

const copyBtn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", minHeight: 32 };
const linkBtn = { background: "none", border: "none", padding: "4px 0", color: T.greenDk, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", textUnderlineOffset: 3 };

export default function GrantEmailPath() {
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState("");
  const box = useRef(null);

  useEffect(() => {
    let live = true;
    apiFetch("/grants/email-path").then(r => { if (live) setInfo(r); }).catch(() => { /* the line is a hint; without it the screen still works */ });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const away = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (!info || !info.sentence) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(info.bccAddress); setCopied("Copied."); }
    catch { setCopied("Copy it by hand; the browser would not."); }
  };

  return (
    <span ref={box} data-testid="grant-email-path" style={{ position: "relative", display: "inline-block" }}>
      <button type="button" data-testid="grant-email-path-link" aria-expanded={open} onClick={() => setOpen(o => !o)} style={linkBtn}>Log emails</button>
      {open && (
        <div role="dialog" aria-label="Log funder emails" data-testid="grant-email-path-popover"
          style={{ position: "absolute", top: "100%", left: 0, zIndex: 40, marginTop: 6, width: "min(360px, calc(100vw - 32px))", boxSizing: "border-box",
            background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px", boxShadow: "0 8px 24px rgba(15,26,18,0.12)",
            fontSize: 13, color: T.ink, lineHeight: 1.5, display: "flex", flexDirection: "column", gap: 8 }}>
          <span>{info.sentence}</span>
          {info.path === "bcc" && info.bccAddress && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <code style={{ fontSize: 12, overflowWrap: "anywhere" }}>{info.bccAddress}</code>
              <button type="button" onClick={copy} style={copyBtn}>Copy</button>
              {copied && <span role="status" style={{ fontSize: 12 }}>{copied}</span>}
            </span>
          )}
          <span style={{ fontSize: 12, color: T.ink3 }}>{"The address is also in Settings › Connections."}</span>
        </div>
      )}
    </span>
  );
}
