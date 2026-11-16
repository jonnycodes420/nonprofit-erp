// client/src/pages/OrgBrandHeader.jsx · FLOWS-13 item 2 (W-1114-Atlas-15). WHOSE PAGE THIS IS.
//
// "test-photo.jpg saved with "Logo saved." … the "What a visitor sees" form
// preview showed no logo or org header, and the public giving page showed
// "Not open yet" with no logo or header." The volunteer page drew the logo;
// the embedded form and the not-open giving page drew nothing. Both draw this
// now: the saved logo (the giving page's own, else Settings, Organization) and
// the organization's name. With no logo, the name alone.
import { T } from "./publicTheme";

export default function OrgBrandHeader({ logo, name, compact = false, font }) {
  if (!logo && !name) return null;
  return (
    <div data-testid="org-brand-header" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
      padding: compact ? "10px 14px" : "0 0 20px", fontFamily: font || "inherit",
      // On the org's own site the form sits on any colour, so its header carries its own white card.
      ...(compact ? { background: T.white, borderRadius: 12, width: "100%", maxWidth: 480, boxSizing: "border-box", marginBottom: 10 } : {}) }}>
      {logo && <img data-testid="org-brand-logo" src={logo} alt={name || ""} onError={e => { e.target.style.display = "none"; }}
        style={{ height: compact ? 32 : 48, maxWidth: compact ? 140 : 200, objectFit: "contain" }} />}
      {name && <span style={{ fontSize: compact ? 15 : 18, fontWeight: 700, color: T.ink }}>{name}</span>}
    </div>
  );
}

// The giving page's answer when it is not open (or not found): the header, then the sentence.
export function PageNotOpen({ base, notOpen, brand, sentence }) {
  return (
    <div style={{ ...base, justifyContent: "center", textAlign: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      {notOpen && brand && <OrgBrandHeader logo={brand.logo} name={brand.name} />}
      <div data-testid="give-not-open" style={{ fontSize: 16, fontWeight: 700, color: notOpen ? T.ink : T.terra700, marginBottom: 8 }}>{notOpen === "paused" ? "Not taking gifts" : notOpen ? "Not open yet" : "Page not found"}</div>
      <div style={{ fontSize: 13, color: T.ink3 }}>{sentence}</div>
    </div>
  );
}
