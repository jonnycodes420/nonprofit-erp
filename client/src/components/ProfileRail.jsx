// PROFILE-1 (header) · THE RAIL'S NEW CARDS.
//
// The rail runs the full height of the profile, on ink, and after Next step
// and the scores it reads: Giving rhythm, Recurring, Thank-yous, Coming up,
// (This year and Book a visit), Contact, Relationship owner, Journey,
// Volunteering, Connected. The facts come from one read, GET /donors/:id/rail
// (routes/crm.js), and every number or item carries the source its rows come
// from, so it opens them like any figure in Steward. A card with nothing to
// say is not drawn at all, never drawn empty.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, Modal, fmtFull } from "./shared";
import { Figure } from "./Figure";
import MetricBreakdownPanel from "./MetricBreakdownPanel";
import { displayDate, displayDateShort } from "../../../shared/displayDate";
import { orgTodayCivil } from "../lib/orgToday";
import { MEETING_ACTION } from "./MeetingPanels";
import { ClientFlag } from "./PrivacyPanel";

// Ink ground, light text. The greys are cream at reduced opacity, the design
// system's own answer for secondary text on ink.
export const RAIL = {
  bg:    T.railGreen,   // PROFILE-2: the profile rail's own deep green (Jonathan, 29 Oct)
  panel: T.bgElevated,
  line:  T.green650,
  text:  T.inkInverse,
  dim:   T.sage400,
};

// One shape for every rail section: a hairline above it, an uppercase title,
// an optional action beside the title, and an optional fold. A folded section
// says how much is inside ON ITS LABEL, so folding never hides a count.
export function RailSection({ title, actionNode, children, fold = false, foldOpenLabel = "Hide", foldShutLabel = "Show", testid, first = false }) {
  const [open, setOpen] = useState(!fold);
  const btn = { background: "none", border: "none", padding: 0, color: RAIL.dim, fontSize: 12, fontWeight: 600, letterSpacing: 0, textTransform: "none", cursor: "pointer", fontFamily: "inherit" };
  return (
    <section data-testid={testid} data-rail-section={fold ? (open ? "open" : "folded") : "plain"}
      style={{ borderTop: first ? "none" : "1px solid " + RAIL.line, padding: first ? "0 0 16px" : "16px 0" }}>
      <h4 style={{ margin: "0 0 10px", fontSize: 10.5, fontWeight: 800, color: T.gold500, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span>{title}</span>
        {fold
          ? <button onClick={() => setOpen(o => !o)} aria-expanded={open} style={btn}>{open ? foldOpenLabel : foldShutLabel}</button>
          : (actionNode || null)}
      </h4>
      {open && children}
    </section>
  );
}

const ROW = { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, lineHeight: 1.45, alignItems: "baseline" };
const DIM = { color: RAIL.dim };
const linkBtn = { background: "none", border: "none", padding: 0, color: RAIL.text, font: "inherit", textAlign: "left", cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3 };

// A word or a line that opens rows, on ink.
function Opens({ source, title, explanation, children, testid }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid={testid} data-source-key={source && source.key} onClick={() => setOpen(true)} style={linkBtn}>{children}</button>
      {open && <MetricBreakdownPanel open onClose={() => setOpen(false)} title={title} explanation={explanation} source={source} />}
    </>
  );
}

export function RhythmCard({ rhythm }) {
  if (!rhythm) return null;
  return (
    <RailSection title="Giving rhythm" testid="dp-rail-rhythm">
      <div style={{ fontSize: 14, fontWeight: 700, color: T.white }}>
        <Opens source={rhythm.source} title="Their gifts" explanation={rhythm.sentence} testid="dp-rail-rhythm-open">{rhythm.sentence}</Opens>
      </div>
      {rhythm.expectedNext && <div style={{ ...ROW, marginTop: 6 }}>
        <span style={DIM}>Next gift expected</span>
        <span data-testid="dp-rail-rhythm-next" style={{ color: rhythm.late ? T.gold500 : RAIL.text, fontWeight: rhythm.late ? 700 : 400 }}>
          {displayDate(rhythm.expectedNext)}{rhythm.late ? " · Late" : ""}
        </span>
      </div>}
    </RailSection>
  );
}

export function RecurringCard({ recurring }) {
  if (!recurring) return null;
  const r = recurring;
  return (
    <RailSection title="Recurring" testid="dp-rail-recurring">
      <div style={{ fontSize: 14, fontWeight: 700, color: T.white }}>{r.sentence}</div>
      {r.given && <div style={{ ...ROW, marginTop: 6 }}>
        <span style={DIM}>Given through it</span>
        <Figure value={r.given.value} kind="money" label="Given through this plan" definition="Every gift this plan has charged, to the cent." source={r.source} variant="inline" figureKey="profile.rail.recurring" />
      </div>}
      {r.failed
        ? <div data-testid="dp-rail-recurring-failed" style={{ fontSize: 12.5, color: T.gold500, fontWeight: 700, marginTop: 6 }}>The last charge failed.</div>
        : r.paused ? <div style={{ fontSize: 12.5, ...DIM, marginTop: 6 }}>Paused.</div>
        : r.nextCharge ? <div style={{ ...ROW, marginTop: 6 }}><span style={DIM}>Next charge</span><span>{displayDate(r.nextCharge)}</span></div> : null}
    </RailSection>
  );
}

// A drafted thank-you opens its draft; a gift with no draft yet opens the gift.
function ThankYouRow({ t, donorId }) {
  const [draft, setDraft] = useState(null);
  const [gift, setGift] = useState(false);
  const [copied, setCopied] = useState(false);
  const open = () => {
    if (!t.draftId) { setGift(true); return; }
    apiFetch("/thank-yous").then(r => {
      const d = ((r && r.drafts) || []).find(x => x.id === t.draftId) || { id: t.draftId, body: "" };
      setDraft(d);
      // The same record Home keeps: a draft somebody has read.
      if (!d.opened) apiFetch(`/thank-yous/${t.draftId}/opened`, { method: "POST" }).catch(() => {});
    }).catch(() => setDraft({ id: t.draftId, body: "", failed: true }));
  };
  const day = String(t.date || "").slice(0, 10);
  return (
    <div style={ROW}>
      <button type="button" data-testid="dp-rail-thankyou" onClick={open} style={linkBtn}>
        {fmtFull(t.amount)} on {displayDateShort(day, new Date())}
      </button>
      <span style={{ ...DIM, fontSize: 12 }}>{t.draftId ? "Draft ready" : "No draft yet"}</span>
      {gift && <MetricBreakdownPanel open onClose={() => setGift(false)} title="The gift"
        explanation="The gift waiting for a thank-you, with any other gift this person gave the same day."
        source={{ key: "gifts", params: { donor: donorId, from: day, to: day } }} />}
      {draft && <Modal onClose={() => setDraft(null)} width={560} title="The thank-you draft">
        {draft.failed ? <div style={{ fontSize: 13, color: T.ink3 }}>The draft could not be loaded just now.</div>
          : <><div data-testid="dp-rail-thankyou-draft" style={{ fontSize: 14, color: T.ink, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{draft.body}</div>
            <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(draft.body || ""); setCopied(true); } catch { setCopied(false); } }}
              style={{ marginTop: 12, background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{copied ? "Copied" : "Copy the draft"}</button></>}
      </Modal>}
    </div>
  );
}

export function ThankYousCard({ thankYous, source, donorId }) {
  if (!thankYous || !thankYous.length) return null;
  return (
    <RailSection title="Thank-yous" testid="dp-rail-thankyous"
      actionNode={source ? <span style={{ textTransform: "none", letterSpacing: 0 }}><Figure value={thankYous.length} kind="count" label="Gifts waiting for a thank-you"
        definition="Gifts from this person still waiting for a thank-you." source={source} variant="inline" figureKey="profile.rail.thankyous" /></span> : null}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {thankYous.map(t => <ThankYouRow key={t.giftId} t={t} donorId={donorId} />)}
      </div>
    </RailSection>
  );
}

const WHEN_WORD = { birthday: "Birthday", event: "Event", meeting: "Meeting", journey: "Journey step" };
export function ComingUpCard({ items, onNavigate }) {
  if (!items || !items.length) return null;
  const today = orgTodayCivil();
  const act = it => {
    if (it.kind === "meeting") { window.dispatchEvent(new CustomEvent(MEETING_ACTION, { detail: { action: "prep", eventId: it.id } })); return; }
    if (it.kind === "event" && onNavigate) { onNavigate("events", it.id ? { eventId: it.id } : undefined); return; }
    if (it.kind === "journey") { const el = document.querySelector('[data-testid="dp-rail-journey-panel"]'); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }
  };
  return (
    <RailSection title="Coming up" testid="dp-rail-coming-up">
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {items.map((it, i) => (
          <div key={it.kind + (it.id || i)} data-coming={it.kind} style={ROW}>
            {it.kind === "birthday"
              ? <span>{it.label}</span>
              : <button type="button" data-testid={"dp-rail-coming-" + it.kind} onClick={() => act(it)} style={linkBtn}>{it.label}</button>}
            <span style={{ ...DIM, whiteSpace: "nowrap" }} title={WHEN_WORD[it.kind]}>{it.date === today ? "Today" : displayDateShort(it.date, new Date())}</span>
          </div>
        ))}
      </div>
    </RailSection>
  );
}

export function VolunteeringCard({ volunteering }) {
  if (!volunteering) return null;
  const v = volunteering;
  return (
    <RailSection title="Volunteering" testid="dp-rail-volunteering">
      <div style={ROW}>
        <span style={DIM}>Hours given</span>
        <Figure value={v.hours} kind="count" label="Volunteer hours" definition="Every volunteer shift logged for this person, in hours." source={v.source} variant="inline" figureKey="profile.rail.volunteer-hours" />
      </div>
      {v.lastShift && <div style={{ ...ROW, marginTop: 4 }}><span style={DIM}>Last shift</span><span>{displayDate(v.lastShift)}</span></div>}
    </RailSection>
  );
}

export function ConnectedCard({ connected }) {
  if (!connected || !connected.length) return null;
  return (
    <RailSection title="Connected" testid="dp-rail-connected">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {connected.map(c => (
          <div key={c.provider + (c.source && c.source.params && c.source.params.ref || "")} data-connected={c.provider} style={ROW}>
            <span>{c.label}<span style={DIM}> · {c.count} {c.count === 1 ? "gift" : "gifts"}</span></span>
            <Figure value={c.total} kind="money" label={`Gifts through ${c.label}`} definition={`Every gift from this person that came through ${c.label}.`} source={c.source} variant="inline" figureKey={"profile.rail.connected." + c.provider} />
          </div>
        ))}
      </div>
    </RailSection>
  );
}

// The contact card's extra lines: the address, the preferred way, and every
// do-not flag said plainly.
export function ContactExtras({ contact, donorId, isReadOnly }) {
  if (!contact) return null;
  return (
    <>
      {donorId && (contact.privacyOn || contact.isClient) && <><dt style={DIM}>Privacy</dt><dd style={{ margin: 0 }}><ClientFlag donorId={donorId} isClient={contact.isClient} isReadOnly={isReadOnly} /></dd></>}
      {contact.address && <><dt style={DIM}>Address</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }} data-testid="dp-rail-address"><span style={contact.addressBad ? { textDecoration: "line-through" } : undefined}>{contact.address}</span></dd></>}
      {contact.preferred && <><dt style={DIM}>Prefers</dt><dd style={{ margin: 0 }}>{contact.preferred}</dd></>}
      {(contact.flags || []).length > 0 && <><dt style={DIM}>Careful</dt><dd style={{ margin: 0, display: "flex", flexDirection: "column", gap: 3 }} data-testid="dp-rail-flags">
        {contact.flags.map(f => <span key={f.key} style={{ color: T.gold500, fontWeight: 700 }}>{f.label}</span>)}
      </dd></>}
    </>
  );
}

// SEND-GATE-1 · AUTOMATIC EMAILS. The person's switch (off until somebody on
// staff turns it on, with a confirm) and every automatic message Steward held
// because it was off, each with Send: that one message, after a confirm.
const SMALL_BTN = { background: "none", border: "1px solid " + RAIL.line, borderRadius: 8, padding: "5px 10px", color: RAIL.text, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const GO_BTN = { ...SMALL_BTN, background: T.greenDk, border: "none", color: T.white };
export function AutoEmailCard({ donorId, email, isReadOnly }) {
  const [st, setSt] = useState(null);
  const [asking, setAsking] = useState(false);
  const [sendAsk, setSendAsk] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch(`/donors/${donorId}/blocked-mail`).then(setSt).catch(() => setSt(null));
  useEffect(() => { if (donorId) load(); }, [donorId]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!st) return null;
  // SEND-GATE-2: three choices. Always include asks first; the others save at once.
  const setMode = async mode => {
    setBusy(true); setMsg("");
    try { await apiFetch(`/donors/${donorId}/auto-email`, { method: "POST", body: JSON.stringify({ mode, confirm: true }) }); setAsking(false); await load(); }
    catch (e) { setMsg((e && e.sentence) || "That didn't save."); }
    setBusy(false);
  };
  const send = async id => {
    if (busy) return;   // a second click while the first is on its way sends nothing
    setBusy(true); setMsg("");
    try { await apiFetch(`/donors/${donorId}/blocked-mail/${id}/send`, { method: "POST", body: JSON.stringify({ confirm: true }) }); setSendAsk(null); await load(); }
    catch (e) { setSendAsk(null); setMsg((e && e.sentence) || "It wasn't sent."); await load(); }
    setBusy(false);
  };
  const held = (st.blocked || []).filter(b => !b.sentAt);
  const sent = (st.blocked || []).filter(b => b.sentAt);
  const CHOICES = [["follows", "Follows your settings"], ["always", "Always include"], ["never", "Never"]];
  return (
    <RailSection title="Automatic emails" testid="dp-rail-auto-email">
      <div data-testid="dp-auto-email-state" style={{ fontSize: 12.5, lineHeight: 1.5, color: RAIL.text }}>{st.line}</div>
      {!isReadOnly && <div role="radiogroup" aria-label="Automatic emails for this person" style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {CHOICES.map(([m, label]) => (
          <button key={m} type="button" role="radio" aria-checked={st.mode === m} data-testid={`dp-auto-email-${m}`} disabled={busy}
            onClick={() => st.mode === m ? null : m === "always" ? setAsking(true) : setMode(m)}
            style={{ ...SMALL_BTN, ...(st.mode === m ? { background: RAIL.line, color: T.white } : {}) }}>{label}</button>
        ))}
      </div>}
      {asking && <div data-testid="dp-auto-email-confirm" style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: RAIL.text }}>Include this person in emails you send only to donors you choose?</span>
        <button type="button" data-testid="dp-auto-email-yes" disabled={busy} style={GO_BTN} onClick={() => setMode("always")}>Always include</button>
        <button type="button" disabled={busy} style={{ ...SMALL_BTN, border: "none", textDecoration: "underline" }} onClick={() => setAsking(false)}>Cancel</button>
      </div>}
      {held.map(b => (
        <div key={b.id} data-testid="dp-held-mail" style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.45, color: RAIL.text }}>
          <div>{b.what} not sent: {b.why || "automatic emails are off"} <span style={DIM}>({new Date(b.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})</span></div>
          {!isReadOnly && (sendAsk === b.id
            ? <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={DIM}>Send this one message{email ? " to " + email : ""}?</span>
                <button type="button" data-commit data-testid="dp-held-send-yes" disabled={busy} style={GO_BTN} onClick={() => send(b.id)}>Send</button>
                <button type="button" disabled={busy} style={{ ...SMALL_BTN, border: "none", textDecoration: "underline" }} onClick={() => setSendAsk(null)}>Cancel</button>
              </div>
            : <button type="button" data-testid="dp-held-send" style={{ ...SMALL_BTN, marginTop: 4 }} onClick={() => setSendAsk(b.id)}>Send</button>)}
        </div>
      ))}
      {sent.map(b => <div key={b.id} style={{ marginTop: 8, fontSize: 12, color: RAIL.dim }}>{b.what}: sent by {b.sentBy || "a person"}</div>)}
      {msg && <div style={{ marginTop: 8, fontSize: 12, color: T.gold500 }}>{msg}</div>}
    </RailSection>
  );
}
