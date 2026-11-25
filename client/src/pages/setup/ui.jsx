// ONBOARD-5 · THE SETUP PAGE'S OWN PIECES. One idea per page, a Fraunces
// headline that says what she gets, generous space (Jonathan, 24 Nov: "just
// make it look so good, logos are good, I love this Stripe screen").
// The four colours only: ink, white (cream its shade), emerald, brass.
import { useState } from "react";
import { T } from "../../components/shared";
import { countLabel } from "../../../../shared/countWords.js";

export const C = { ink: T.ink, white: T.white, cream: T.bg, emerald: T.green, brass: T.gold, dim: T.ink3, line: T.bg2, line2: T.bg3 };
export const SERIF = "'Fraunces','DM Serif Display',Georgia,serif";
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const usd = cents => "$" + Math.round(Number(cents || 0) / 100).toLocaleString("en-US");
export const count = countLabel;

// Fraunces, Steward's own file (client/public/fonts, OFL), loaded only on this page.
export const FONT_CSS = `@font-face{font-family:'Fraunces';font-style:normal;font-weight:600;font-display:swap;src:url(/fonts/fraunces-600-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212;}`;

export const card = { background: C.white, border: `1px solid ${C.line}`, borderRadius: 14, padding: "22px 24px", marginBottom: 14 };
export const label = { display: "block", fontWeight: 700, fontSize: 14.5, color: C.ink };
export const side = { fontSize: 13, color: C.dim, lineHeight: 1.5 };
export const input = { width: "100%", boxSizing: "border-box", border: `1px solid ${C.line2}`, borderRadius: 9, padding: "11px 12px", font: "inherit", fontSize: 15, marginTop: 6, background: C.white, color: C.ink };
export const why = { background: C.cream, borderRadius: 10, padding: "12px 14px", fontSize: 13.5, marginTop: 14, lineHeight: 1.5, color: C.ink };
const KIND = {
  primary: { background: C.emerald, color: C.white, border: 0 },
  quiet: { background: C.white, color: C.ink, border: `1.5px solid ${C.ink}` },
  ghost: { background: "transparent", color: C.dim, border: 0, textDecoration: "underline", textUnderlineOffset: 3 },
};
export const btn = (kind = "primary") => ({ ...KIND[kind], borderRadius: 10, padding: "11px 18px", font: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", minHeight: 44 });
export const chip = on => ({ borderRadius: 99, padding: "8px 15px", fontSize: 14, fontWeight: 600, background: on ? "rgba(13,92,58,.08)" : C.white,
  color: on ? C.emerald : C.ink, border: `1.5px solid ${on ? C.emerald : C.line2}`, cursor: "pointer", font: "inherit", minHeight: 40 });
export const link = { background: "none", border: 0, padding: 0, font: "inherit", color: C.emerald, fontWeight: 700, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 };

export function Card({ children, style, testid }) { return <div data-testid={testid} style={{ ...card, ...style }}>{children}</div>; }

export function Status({ children }) {
  return <span data-testid="setup-connected" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, color: C.emerald, fontSize: 14 }}>
    <span aria-hidden style={{ width: 9, height: 9, borderRadius: "50%", background: C.emerald, flex: "none" }} />{children}</span>;
}

// A service's own logo on a white tile. Never redrawn (client/public/logos/README.md).
export function Logo({ name, src, size = 52 }) {
  return <div style={{ width: size, height: size, borderRadius: 12, border: `1px solid ${C.line}`, background: C.white, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
    <img src={src} alt={`${name} logo`} width={Math.round(size * 0.58)} height={Math.round(size * 0.58)} style={{ objectFit: "contain", display: "block" }} />
  </div>;
}

export function Message({ text, tone }) {
  if (!text) return null;
  return <p role={tone === "bad" ? "alert" : "status"} style={{ margin: "10px 0 0", fontSize: 13.5, color: C.ink, borderLeft: `3px solid ${tone === "bad" ? C.brass : C.emerald}`, paddingLeft: 10 }}>{text}</p>;
}

// A row of choices that always ends with Custom (Jonathan, 24 Nov). The custom
// value is validated by `check` and shown in a sample sentence before it counts.
export function Choices({ name, options, value, onPick, custom, testid }) {
  const isCustom = value && value.custom;
  return <div data-testid={testid} role="radiogroup" aria-label={name} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
    {options.map(o => {
      const on = !isCustom && value && value.key === o.key;
      return <button key={o.key} type="button" role="radio" aria-checked={on} data-choice={o.key} onClick={() => onPick({ key: o.key })} style={chip(on)}>{o.label}</button>;
    })}
    {custom !== false && <button type="button" role="radio" aria-checked={!!isCustom} data-choice="custom" onClick={() => onPick({ custom: true, key: "custom" })} style={chip(!!isCustom)}>Custom</button>}
  </div>;
}

// Read a chosen file as a data: URL.
export const readFile = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ""));
  r.onerror = () => reject(new Error("That file could not be read. Try again."));
  r.readAsDataURL(file);
});

// A drop zone that is also a file button.
export function Drop({ accept, onFile, children, testid, small }) {
  const [over, setOver] = useState(false);
  return <label data-testid={testid} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
    onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) onFile(f); }}
    style={{ display: "block", border: `2px dashed ${over ? C.emerald : "rgba(13,92,58,.35)"}`, borderRadius: 12, padding: small ? 14 : 26, textAlign: "center", color: C.dim, marginTop: 10, cursor: "pointer", background: over ? "rgba(13,92,58,.04)" : "transparent" }}>
    <input type="file" accept={accept} onChange={e => { const f = e.target.files && e.target.files[0]; if (f) onFile(f); e.target.value = ""; }}
      style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }} />
    {children}
  </label>;
}

// The line under every connection (the brief's words), with the exact scopes behind "What we can see".
export function TrustLine({ scopes }) {
  const [open, setOpen] = useState(false);
  return <div style={why}>
    Steward only reads what it needs and never sends a gift, email or payment without someone at your organization pressing a button.{" "}
    <button type="button" data-testid="setup-scopes" aria-expanded={open} style={link} onClick={() => setOpen(o => !o)}>What we can see</button>
    {open && <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
      {(scopes && scopes.length ? scopes : ["Read-only access to the records named on the service's own sign-in page."]).map(s => <li key={s}><code style={{ fontSize: 12.5 }}>{s}</code></li>)}
    </ul>}
  </div>;
}

// One connection, the mockup's Stripe page: logo, what it takes, one Connect, four things it does.
export function Connection({ name, logo, minutes, connectedAs, onConnect, onManage, busy, gets, children, scopes, testid, note }) {
  return <div data-testid={testid} style={card}>
    <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <Logo name={name} src={logo} />
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <h3 style={{ margin: 0, fontSize: 17, color: C.ink }}>{name}</h3>
        <p style={{ margin: "2px 0 0", color: C.dim, fontSize: 14 }}>{connectedAs ? <Status>Connected as {connectedAs}</Status>
          : `Takes about ${countLabel(minutes, "minute")}. You sign in on ${name}'s own page.`}</p>
      </div>
      <div className="setup-act">{connectedAs
        ? <button type="button" style={btn("quiet")} onClick={onManage}>Manage</button>
        : <button type="button" data-testid={`${testid}-connect`} style={btn("primary")} disabled={busy} onClick={onConnect}>{busy ? "Opening…" : `Connect ${name}`}</button>}</div>
    </div>
    {note}
    <ul className="setup-gets" style={{ margin: "16px 0 0", padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 18px", fontSize: 14 }}>
      {gets.map(g => <li key={g}><span aria-hidden style={{ color: C.emerald, fontWeight: 700 }}>✓ </span>{g}</li>)}
    </ul>
    {children}
    <TrustLine scopes={scopes} />
  </div>;
}
