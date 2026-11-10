// NewPersonFields.jsx · QUICKADD-1. "+ NEW PERSON", OPENED INLINE.
//
// First name, last name, email, phone and address, typed where the gift is
// being typed. Saving the gift adds the person (POST /gifts/new-person), with
// the usual duplicate check. `splitName("Maria Lopez")` fills the first two
// from what she typed in the search.
import { T } from "../shared";

export const emptyPerson = () => ({ firstName: "", lastName: "", email: "", phone: "", address: "", city: "", state: "", zip: "" });
export function splitName(text) {
  const parts = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (parts.length < 2) return { ...emptyPerson(), firstName: parts[0] || "" };
  return { ...emptyPerson(), firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}
export const personName = p => [p && p.firstName, p && p.lastName].map(x => String(x || "").trim()).filter(Boolean).join(" ");

export default function NewPersonFields({ value, onChange, testid, compact = false, onCancel }) {
  const fs = compact ? 12 : 13;
  const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: compact ? "6px 8px" : "8px 10px", color: T.ink, fontSize: fs, outline: "none", fontFamily: "inherit", boxSizing: "border-box", width: "100%", minWidth: 0 };
  const lbl = { fontSize: 11, fontWeight: 700, color: T.ink3, marginBottom: 3, display: "block" };
  const set = k => e => onChange({ ...value, [k]: e.target.value });
  const field = (k, label, extra = {}) => (
    <label style={{ minWidth: 0 }}><span style={lbl}>{label}</span>
      <input value={value[k] || ""} onChange={set(k)} data-testid={`${testid}-${k === "firstName" ? "first" : k === "lastName" ? "last" : k}`} style={inp} autoComplete="off" {...extra} /></label>);
  return (
    <div data-testid={testid} style={{ border: "1px solid " + T.bg3, borderRadius: 10, padding: compact ? 8 : 12, background: T.white, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: fs, fontWeight: 800, color: T.ink }}>New person</span>
        {onCancel && <button type="button" onClick={onCancel} data-testid={`${testid}-cancel`}
          style={{ background: "none", border: "none", padding: 0, color: T.ink3, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Choose someone on file instead</button>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {field("firstName", "First name")}{field("lastName", "Last name")}
        {field("email", "Email", { type: "email" })}{field("phone", "Phone", { type: "tel" })}
      </div>
      {field("address", "Street address")}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
        {field("city", "City")}{field("state", "State")}{field("zip", "ZIP")}
      </div>
    </div>
  );
}
