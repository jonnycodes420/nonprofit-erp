import { useState } from "react";
import { T } from "./publicTheme";

// ── PARITY-1 E · SHARE THIS PAGE ────────────────────────────────────────────
// Plain links and nothing else: no share widget, no third-party script, nothing
// that tells another company who gave. Each one opens the network's own page
// with the giving page's address in it, and the donor decides from there.
// PARITY-2 Part 1: moved here from Donate.jsx so the membership page shares
// the same row. `text` and `heading` default to the thank-you screen's words,
// so that screen renders exactly as it did.
// PARITY-2 Part 2: a fundraiser's page passes `p2pShare` (shared/p2p.js
// shareLinks, from the server): every link carries its UTM tags, so a gift
// that arrives through one is attributed like any other.
export default function ShareRow({ url, orgName, th, text: textIn, heading = "", subject, p2pShare = null }) {
  const [copied, setCopied] = useState(false);
  const text = textIn || `I just gave to ${orgName}. Join me:`;
  const enc = encodeURIComponent;
  const links = p2pShare ? [
    ["Email", p2pShare.email], ["Text", p2pShare.text], ["Facebook", p2pShare.facebook], ["WhatsApp", p2pShare.whatsapp],
  ] : [
    ["Email", `mailto:?subject=${enc(subject || `Give to ${orgName}`)}&body=${enc(`${text} ${url}`)}`],
    ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`],
    ["X", `https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(text)}`],
    ["LinkedIn", `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`],
  ];
  const copyUrl = p2pShare ? p2pShare.copy : url;
  function copy() {
    try {
      navigator.clipboard.writeText(copyUrl).then(() => setCopied(true), () => setCopied(false));
    } catch { setCopied(false); }
  }
  const pill = { display: "inline-block", padding: "8px 14px", borderRadius: 99, border: `1px solid ${T.bg3}`,
                 background: T.white, color: T.ink, fontSize: 13, fontWeight: 600, textDecoration: "none",
                 cursor: "pointer", fontFamily: th.sans };
  return (
    <div className="thanks-share" style={{ marginTop: 26, maxWidth: 420 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 10 }}>{heading || "Ask a friend to give too"}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
        <button type="button" className="thanks-share-copy" onClick={copy} style={pill}>{copied ? "Link copied" : "Copy link"}</button>
        {links.map(([label, href]) => (
          <a key={label} className="thanks-share-link" data-net={label} href={href}
             target={label === "Email" || label === "Text" ? undefined : "_blank"} rel="noopener noreferrer" style={pill}>{label}</a>
        ))}
      </div>
    </div>
  );
}
