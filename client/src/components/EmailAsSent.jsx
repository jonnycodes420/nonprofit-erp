// FIX-40 · ONE EMAIL, AS IT WENT, AND EVERYONE IT WENT TO.
//
// Reads one of the routes/emailsSent.js paths (a campaign, a sequence step, a
// journey email, or one email to one person) and shows the subject, who it was
// from, when it went, the body for one example person, the delivered / bounced
// / unsubscribed counts, and the recipients, each a real link to the profile.
// The body sits in a sandboxed frame, as the template preview does, so nothing
// in an email can run on this page.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { donorHref } from "../lib/appUrls";
import { apiFetch } from "../api";
import { T, Spin, Modal } from "./shared";
import { DonorLink } from "./RecordLink";
import { displayDateTime } from "../../../shared/displayDate";

const KIND = { campaign: "Campaign", sequence: "Sequence step", journey: "Journey email", "thank-you": "Thank-you", "email tool": "From your email tool" };

export function EmailAsSentPanel({ path, onClose, onSelectDonor }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const navigate = useNavigate();
  // A name opens the profile and closes this dialog, so it never sits over the page it opened.
  const openDonor = (donorId, donorName) => () => {
    if (onClose) onClose();
    if (onSelectDonor) onSelectDonor({ donorId, donorName });
    else navigate(donorHref(donorId));
  };
  useEffect(() => {
    let live = true;
    setData(null); setErr(null);
    apiFetch(path).then(d => { if (live) setData(d); }).catch(e => { if (live) setErr(e.message || "Could not load this email."); });
    return () => { live = false; };
  }, [path]);

  const ex = data && data.example;
  const subject = (ex && ex.subject) || (data && data.subject) || "";
  const from = data && data.from && (data.from.name ? `${data.from.name} <${data.from.email}>` : data.from.email);
  const count = (key, label) => (
    <div data-testid={`eas-count-${key}`} style={{ flex: "1 1 90px", border: "1px solid " + T.bg3, borderRadius: 10, padding: "8px 12px" }}>
      <div style={{ fontSize: 10.5, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: T.ink }}>{Number(data.counts[key] || 0).toLocaleString()}</div>
    </div>
  );

  return (
    <Modal onClose={onClose} width={760} ariaLabel="The email as it went"
      title={data ? data.name : "The email"} subtitle={data ? KIND[data.kind] || "" : ""}>
      <div data-testid="email-as-sent" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {err && <div style={{ color: T.ink2, fontSize: 13 }}>{err}</div>}
        {!data && !err && <div style={{ color: T.ink3, fontSize: 13 }}><Spin /> Loading the email…</div>}
        {data && <>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 13 }}>
            <span style={{ color: T.ink3 }}>Subject</span><span data-testid="eas-subject" style={{ color: T.ink, fontWeight: 600 }}>{subject || "No subject"}</span>
            <span style={{ color: T.ink3 }}>From</span><span data-testid="eas-from" style={{ color: T.ink }}>{from || "You, from your own email"}</span>
            <span style={{ color: T.ink3 }}>When</span><span data-testid="eas-when" style={{ color: T.ink }}>{data.sentAt ? displayDateTime(data.sentAt) : "Not sent yet"}</span>
            {ex && <><span style={{ color: T.ink3 }}>Shown for</span><span style={{ color: T.ink }}>
              {ex.donorId ? <DonorLink id={ex.donorId} onOpen={openDonor(ex.donorId, ex.name)}
                style={{ color: T.ink, textDecoration: "underline" }}>{ex.name}</DonorLink> : ex.name}
            </span></>}
          </div>
          {ex && ex.note && <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>{ex.note}</div>}
          {ex && ex.body
            ? <iframe data-testid="eas-body" title="The email" sandbox="" srcDoc={ex.body}
                style={{ width: "100%", height: 420, border: "1px solid " + T.bg3, borderRadius: 10, background: T.white }} />
            : <div data-testid="eas-body" style={{ fontSize: 13, color: T.ink3, border: "1px solid " + T.bg3, borderRadius: 10, padding: 14 }}>
                {data.kind === "email tool" ? "Steward does not read this email's body." : "There is nobody on file to show this email for."}
              </div>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {count("delivered", "Delivered")}{count("bounced", "Bounced")}{count("unsubscribed", "Unsubscribed")}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 6 }}>
              Who it went to ({data.recipients.length.toLocaleString()})
            </div>
            <div style={{ border: "1px solid " + T.bg3, borderRadius: 10, maxHeight: 280, overflowY: "auto" }}>
              {data.recipients.map((r, i) => (
                <div key={(r.donorId || r.email || "") + i} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "8px 12px", borderTop: i ? "1px solid " + T.bg3 : undefined, fontSize: 13 }}>
                  <span style={{ flex: "1 1 auto", minWidth: 0 }}>
                    {r.donorId
                      ? <DonorLink id={r.donorId} data-testid="eas-recipient" onOpen={openDonor(r.donorId, r.name)}
                          style={{ color: T.ink, textDecoration: "underline" }}>{r.name}</DonorLink>
                      : <span title="Not a person on file">{r.name}</span>}
                  </span>
                  <span style={{ color: T.ink3, fontSize: 12 }}>
                    {r.status === "delivered" ? "Delivered" : r.status === "bounced" ? "Bounced" : "Not sent"}{r.unsubscribed ? ", unsubscribed" : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>}
      </div>
    </Modal>
  );
}

// FIX-40 · THE EMAILS TAB'S FIRST SECTION: every email Steward knows this
// person was sent (campaigns, sequence steps, journey emails, thank-yous, and
// the email tool's campaigns they opened or clicked), newest first. Each row
// opens the email as THEY got it.
export function EmailsReceived({ donorId, firstName }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    apiFetch(`/donors/${encodeURIComponent(donorId)}/emails-received`)
      .then(d => { if (live) setRows(d.emails || []); }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [donorId]);
  if (rows === null) return null;
  return (
    <section data-testid="dp-emails-received" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 13, letterSpacing: "0.12em", fontWeight: 600, textTransform: "uppercase", color: T.ink }}>
        Emails sent to {firstName || "them"}
      </h2>
      {rows.length === 0
        ? <div style={{ fontSize: 13, color: T.ink3 }}>No campaign, sequence, journey email or thank-you on file for {firstName || "this person"} yet.</div>
        : rows.map(e => (
          <button key={e.kind + e.ref} type="button" data-testid="dp-email-received-row" data-kind={e.kind} onClick={() => setOpen(e.open.path)}
            style={{ display: "flex", flexWrap: "wrap", width: "100%", columnGap: 12, rowGap: 2, alignItems: "baseline", textAlign: "left", background: "none", border: "none", borderTop: "1px solid " + T.bg3, padding: "8px 0", cursor: "pointer", font: "inherit" }}>
            <span style={{ fontSize: 11, color: T.ink3, minWidth: 104 }}>{KIND[e.kind] || e.kind}</span>
            <span style={{ flex: "1 1 220px", minWidth: 0, fontSize: 13, color: T.ink, textDecoration: "underline" }}>{e.subject || e.title}
              {e.subject && e.title && e.subject !== e.title && <span style={{ color: T.ink3, textDecoration: "none" }}> · {e.title}</span>}</span>
            <span style={{ fontSize: 12, color: T.ink3, whiteSpace: "nowrap" }}>{e.sentAt ? displayDateTime(e.sentAt) : ""}</span>
          </button>
        ))}
      {open && <EmailAsSentPanel path={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

export default EmailAsSentPanel;
