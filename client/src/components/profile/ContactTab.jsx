// ContactTab.jsx · CONTACT-1 item 3. EVERYTHING TO REACH THEM, WITHOUT EDIT.
//
// A pilot customer had to open Edit record to read an address for an invoice.
// This tab reads the person's own record and says, in four cards: the mailing
// block ready to copy (the block the window envelope prints, shared/ackLetter.js
// addressLines, with the addressee she picks), every email and phone with its
// flags, the do-not flags and the automatic-emails setting, and the household's
// people with their own details (HOUSEHOLD-1: each keeps their own). Edit opens
// the same Edit record dialog. It writes nothing. The rail's Contact section
// stays as it is. Ink, white, cream and brass only: no emerald on this tab, so
// Log a touch stays the one green button on the screen.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { Phone, T } from "../shared";
import { ContactFlag } from "./profileShared";
import { contactLines } from "../../../../shared/contactDetails.js";
import { addressLines } from "../../../../shared/ackLetter.js";

const LINE = "rgba(15,26,18,.12)";
const DIM = "rgba(15,26,18,.62)";
const H3 = { margin: 0, fontSize: 11.5, letterSpacing: ".08em", textTransform: "uppercase", color: T.ink, opacity: .72, fontWeight: 700 };
const BTN = { background: T.white, border: "1.5px solid " + T.ink, borderRadius: 9, padding: "8px 14px", font: "inherit", fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer", minHeight: 40 };
const SMALL = { background: T.white, border: "1px solid " + LINE, borderRadius: 7, padding: "4px 10px", font: "inherit", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", minHeight: 32 };
// A flag on the field it is about; the rest (deceased, do not contact, do not solicit) are about the person.
const FIELD_OF = { email_unreachable: "email", do_not_email: "email", phone_unreachable: "phone", do_not_call: "phone", address_unmailable: "address", do_not_mail: "address" };
const SHORT = { email_unreachable: "Bounced", do_not_email: "Opted out", phone_unreachable: "Marked wrong", do_not_call: "No calls", address_unmailable: "Mail came back", do_not_mail: "Do not mail" };

function Flag({ children }) {
  return <span data-contact-tab-flag="" style={{ display: "inline-block", marginLeft: 8, fontSize: 11.5, fontWeight: 700, color: T.ink, background: "rgba(201,168,76,.2)", border: "1px solid #C9A84C", borderRadius: 99, padding: "1px 8px", whiteSpace: "nowrap" }}>{children}</span>;
}

function Card({ title, aside, testid, children }) {
  return <section data-testid={testid} style={{ background: T.white, border: "1px solid " + LINE, borderRadius: 12, padding: "18px 20px" }}>
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}><h3 style={H3}>{title}</h3>{aside}</div>
    {children}
  </section>;
}

function Row({ label, testid, children, action }) {
  return <div className="ct-row" data-testid={testid} style={{ padding: "9px 0", borderTop: "1px solid " + LINE, fontSize: 14 }}>
    <div className="ct-l" style={{ color: DIM, fontSize: 12.5 }}>{label}</div>
    <div style={{ overflowWrap: "anywhere", color: T.ink, minWidth: 0 }}>{children}</div>
    <div>{action}</div>
  </div>;
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const DO_NOT = /^(do_not_|deceased$)/;   // the do-not flags; a bounce or a wrong number sits on its own row
const None = ({ children = "None on file" }) => <span style={{ color: DIM }}>{children}</span>;

// One copy button: says Copied for two seconds, or that the browser refused.
function CopyButton({ text, label = "Copy", testid, style = SMALL, what }) {
  const [said, setSaid] = useState("");
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setSaid("Copied"); }
    catch { setSaid("Couldn't copy: select it and copy by hand"); }
    setTimeout(() => setSaid(""), 2500);
  };
  return <button type="button" data-testid={testid} onClick={copy} aria-label={what ? `${label} ${what}` : label} style={style}>{said || label}</button>;
}

function ContactTab({ donor, contact, household, contactPerson, isReadOnly, onEdit, onSelectRelatedDonor }) {
  const cx = contact || {};
  const lines = contactLines(donor);
  const flags = cx.flags || [];
  const on = field => flags.filter(f => FIELD_OF[f.key] === field);
  const personFlags = flags.filter(f => !FIELD_OF[f.key]);
  const members = household ? (household.people || []).filter(m => m.id !== donor.id) : [];
  const me = household ? (household.people || []).find(m => m.id === donor.id) : null;
  const shares = new Set((me && me.sameAddressAs) || []);
  const first = (donor.name || "").trim().split(/\s+/)[0] || "them";

  // Who the envelope is to: them, or them and whoever lives at this address
  // with them (never a household member who lives somewhere else).
  const jointName = me && me.addresseeHere;
  const together = !!jointName && jointName !== donor.name;
  const [to, setTo] = useState("person");
  useEffect(() => { setTo("person"); }, [donor.id]);
  const addressee = to === "household" && together ? jointName : donor.name;
  const block = addressLines({ ...donor, name: addressee });   // null unless street, city and state or ZIP are all there

  // SEND-GATE-1: the automatic-emails sentence, read as the rail reads it (prefetched with the profile).
  const [auto, setAuto] = useState(null);
  useEffect(() => {
    let live = true; setAuto(null);
    apiFetch(`/donors/${donor.id}/blocked-mail`).then(st => { if (live) setAuto(st && st.line ? cap(String(st.line).replace(/^automatic emails:\s*/i, "")) : null); }).catch(() => {});
    return () => { live = false; };
  }, [donor.id]);

  const addrFlags = on("address");
  return <div className="dp2-cream" data-testid="dp-tab-contact" data-ph-mask="" style={{ padding: "24px var(--dp-gutter,40px) 40px", display: "flex", flexDirection: "column", gap: 16 }}>
    <style>{`.ct-row{display:grid;grid-template-columns:120px minmax(0,1fr) auto;gap:10px;align-items:center}@media (max-width:600px){.ct-row{grid-template-columns:minmax(0,1fr) auto;row-gap:2px}.ct-l{grid-column:1/-1}}`}</style>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div style={{ fontSize: 14, color: DIM }}>Everything to reach {first}, without opening Edit.</div>
      {!isReadOnly && onEdit && <button type="button" data-testid="dp-contact-tab-edit" onClick={onEdit} style={BTN}>Edit</button>}
    </div>

    <Card title="Mailing address" testid="dp-contact-tab-address">
      {lines.address ? <>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div data-testid="dp-contact-tab-block" style={{ flex: "1 1 240px", fontSize: 15.5, lineHeight: 1.55, color: T.ink, background: "#F0EDE6", borderRadius: 8, padding: "14px 16px", whiteSpace: "pre-line", textDecoration: cx.addressBad ? "line-through" : undefined }}>
            {block ? block.join("\n") : `${addressee}\n${lines.address}`}
          </div>
          <div style={{ flex: "0 1 220px", display: "flex", flexDirection: "column", gap: 8 }}>
            {block
              ? <CopyButton text={block.join("\n")} label="Copy address" testid="dp-contact-copy-address" style={BTN}/>
              : <div data-testid="dp-contact-tab-partial" style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.45 }}>Not a full mailing address yet: an envelope needs the street, the city, and the state or ZIP.</div>}
            {block && <div style={{ fontSize: 12, color: DIM, lineHeight: 1.45 }}>Puts the name and full address on the clipboard, for an invoice or an envelope. The same block the window envelope prints.</div>}
            {together && <div role="radiogroup" aria-label="Address it to" style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.6 }}>
              {"Address it to: "}
              {[["person", donor.name], ["household", jointName]].map(([k, w], i) => <span key={k}>{i ? " or " : ""}
                <button type="button" role="radio" aria-checked={to === k} data-testid={`dp-contact-to-${k}`} onClick={() => setTo(k)}
                  style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer", color: to === k ? T.ink : DIM, fontWeight: to === k ? 700 : 400, textDecoration: "underline", textUnderlineOffset: 3 }}>{w}</button></span>)}
            </div>}
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 12.5, color: DIM }}>
          {members.length > 0 && (() => {
            const same = members.filter(m => shares.has(m.id)).map(m => m.name.split(" ")[0]);
            const apart = members.filter(m => !shares.has(m.id)).map(m => m.name.split(" ")[0]);
            return [same.length ? `Shared with ${same.join(", ")}` : null, apart.length ? `${apart.join(", ")} ${apart.length === 1 ? "lives" : "live"} at a different address` : null].filter(Boolean).join(" · ");
          })()}
          {addrFlags.length ? addrFlags.map(f => <Flag key={f.key}>{SHORT[f.key]}</Flag>) : <span>{members.length ? " · " : ""}Mail is fine</span>}
        </div>
      </> : <div data-testid="dp-contact-tab-no-address" style={{ fontSize: 14, color: DIM }}>No address on file.{!isReadOnly && onEdit && <> <button type="button" onClick={onEdit} style={{ ...SMALL, marginLeft: 6 }}>Add one</button></>}</div>}
    </Card>

    <Card title="Email and phone" testid="dp-contact-tab-reach">
      {contactPerson && <Row label="Contact person">{contactPerson}</Row>}
      <Row label="Email" testid="dp-contact-tab-email" action={lines.email && <CopyButton text={lines.email} what="email"/>}>
        {lines.email ? <>{lines.email}{on("email").map(f => <Flag key={f.key}>{SHORT[f.key]}</Flag>)}<ContactFlag flags={donor.contact_flags} field="email"/></> : <None/>}
      </Row>
      {lines.email2 && <Row label={lines.email ? "Other email" : "Email"} testid="dp-contact-tab-email2" action={<CopyButton text={lines.email2} what="other email"/>}>{lines.email2}</Row>}
      <Row label="Phone" testid="dp-contact-tab-phone" action={lines.phone && <CopyButton text={lines.phone} what="phone"/>}>
        {lines.phone ? <><Phone value={lines.phone} bad={on("phone").some(f => f.key === "phone_unreachable")}/>{on("phone").map(f => <Flag key={f.key}>{SHORT[f.key]}</Flag>)}<ContactFlag flags={donor.contact_flags} field="phone"/></> : <None/>}
      </Row>
      <Row label="Mobile" testid="dp-contact-tab-mobile" action={lines.mobile && <CopyButton text={lines.mobile} what="mobile"/>}>
        {lines.mobile ? <Phone value={lines.mobile}/> : <None/>}
      </Row>
    </Card>

    <Card title="Preferences" testid="dp-contact-tab-prefs">
      {cx.preferred && <Row label="Prefers">{cx.preferred}</Row>}
      <Row label="Do not" testid="dp-contact-tab-donot">
        {flags.some(f => DO_NOT.test(f.key)) ? [...personFlags, ...flags.filter(f => FIELD_OF[f.key])].filter(f => DO_NOT.test(f.key)).map(f => <Flag key={f.key}>{f.label}</Flag>)
          : <None>{flags.length ? "Nothing set" : "No restrictions: calls, mail and email are all fine"}</None>}
      </Row>
      <Row label="Automatic emails" testid="dp-contact-tab-auto">{auto || <None>Follows your settings</None>}</Row>
    </Card>

    {members.length > 0 && <Card title={`Household · ${household.name || ""}`} testid="dp-contact-tab-household" aside={<span style={{ fontSize: 12, color: DIM }}>Each person keeps their own details</span>}>
      {members.map(m => <div key={m.id} data-testid="dp-contact-tab-member" style={{ padding: "10px 0", borderTop: "1px solid " + LINE }}>
        <button type="button" onClick={() => onSelectRelatedDonor && onSelectRelatedDonor(m.id)} style={{ background: "none", border: "none", padding: 0, font: "inherit", fontSize: 14, fontWeight: 700, color: T.ink, cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3 }}>{m.name}</button>
        <div style={{ fontSize: 13, color: T.ink, marginTop: 3, overflowWrap: "anywhere" }}>{[m.email, m.phone].filter(Boolean).join(" · ") || <None>No email or phone of their own</None>}</div>
        <div style={{ fontSize: 12.5, color: DIM, marginTop: 2 }}>{shares.has(m.id) ? "Same address" : "A different address (open their profile to see it)"}{(m.preferences || []).length ? " · " + m.preferences.join(", ") : ""}</div>
      </div>)}
    </Card>}
  </div>;
}

export { ContactTab };
