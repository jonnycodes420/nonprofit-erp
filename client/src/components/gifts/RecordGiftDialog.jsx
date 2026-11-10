// RecordGiftDialog.jsx · GIFTS-1. RECORD A GIFT FROM WHERE YOU ARE.
//
// The event page's "Record a gift" (the attendee menu prefills the person and
// the event; the page's own button prefills only the event), a grant's
// "Record a payment received" (the funder and the award pledge fixed), and
// QUICKADD-1's "Record a gift" on Donors. Every one saves through POST
// /donors/:id/gifts, the gift form's own route, so the gift is recorded,
// receipted, put on the ledger and waiting for its deposit exactly as one typed
// on the profile. Nothing here counts anything: the event's Raised, the
// attendee's row and the grant's Received re-read.
//
// QUICKADD-1 (Allie Barnett, six Good Giving Challenge donors):
//   · the person search ends with "+ New person: 'Maria Lopez'", which opens
//     first name, last name, email, phone and address; Save adds the person
//     and the gift in one write (POST /gifts/new-person), and a name already
//     on file asks "Maria Lopez is already on file. Use that record?";
//   · Campaign, Appeal and Fundraiser / giving page, each searched, Campaign
//     and Appeal made inline;
//   · Save and add another, with the date, method, fund, campaign, appeal and
//     fundraiser carried as "Same as last" (lib/stickyGift.js).
import { useRef, useState } from "react";
import { apiFetch } from "../../api";
import { T, Modal, fmtFull } from "../shared";
import { errorMessage } from "../../lib/domainError";
import { orgTodayCivil } from "../../lib/orgToday";
import { personNamed } from "../../lib/people";
import { lastGift, rememberGift } from "../../lib/stickyGift";
import { PeopleDatalist } from "../PeopleDatalist";
import EventField from "./EventField";
import FundField, { emptyFund, fundBody, fundLinesProblem } from "./FundField";
import AttributionField from "./AttributionField";
import NewPersonFields, { splitName, personName } from "./NewPersonFields";
import SameAsLast from "./SameAsLast";
import DateInput from "../inputs/LazyDateInput";   // POLISH-6: the one date box, loaded when first shown

const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", color: T.ink, fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box", width: "100%" };
const lbl = { fontSize: 11.5, fontWeight: 700, color: T.ink3, marginBottom: 4, display: "block" };
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const METHODS = ["Check", "Cash", "Card", "ACH / bank transfer", "Wire", "Other"];

// The form's starting values: today, Check, the org's default fund, nothing
// attributed; or, when `carry`, what the last gift said (and which fields those were).
function startForm(eventId, carry) {
  const base = { amount: "", date: orgTodayCivil(), method: "Check", fund: emptyFund(), campaign: null, appeal: null, page: null, eventId: eventId || "" };
  if (!carry) return { f: base, same: {} };
  const last = lastGift(), same = {}, f = { ...base };
  for (const k of ["date", "method", "fund", "campaign", "appeal", "page"]) if (last[k] != null && last[k] !== "") { f[k] = last[k]; same[k] = true; }
  return { f, same };
}

// person: { id, name } or null (then she types a name on file, or a new one);
// eventId: the event, or "" for none; pledgeId: the pledge this pays (a grant's
// award); title: the dialog's name. `carry` starts from the last gift's values
// (Donors passes it; an event's or a grant's dialog starts clean).
export default function RecordGiftDialog({ person = null, eventId = "", pledgeId = null, title = "Record a gift", fixedPerson = false, onClose, onSaved, testid = "record-gift", carry = false }) {
  const [who, setWho] = useState(person ? person.name : "");
  const [{ f, same }, setForm] = useState(() => startForm(eventId, carry));
  const setF = patch => setForm(s => ({ f: { ...s.f, ...patch }, same: Object.fromEntries(Object.entries(s.same).filter(([k]) => !(k in patch))) }));
  const [np, setNp] = useState(null);          // the new person's fields, or null
  const [dup, setDup] = useState(null);        // { sentence, matches } from a 409
  const [saved, setSaved] = useState("");      // "Saved $60 from Kit Ravensworth." after Save and add another
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const idem = useRef(null);
  const newPersonOk = !fixedPerson;

  const giftBody = () => ({
    amount: f.amount, date: f.date, type: "cash", payment_method: f.method || null, ...fundBody(f.fund),
    campaignId: (!pledgeId && f.campaign && f.campaign.id) || undefined,
    appealId: (f.appeal && f.appeal.id) || undefined,
    givingPageId: (f.page && f.page.givingPageId) || undefined, peerFundraiserId: (f.page && f.page.peerFundraiserId) || undefined,
    eventId: f.eventId || undefined, pledgeId: pledgeId || undefined, idempotencyKey: idem.current,
  });

  const done = (r, p, another) => {
    idem.current = null;
    rememberGift(f);
    onSaved && onSaved(r, p);
    if (!another) { onClose(); return; }
    setSaved(`Saved ${fmtFull(Number(f.amount) || 0)} from ${p.name}.`);
    setWho(""); setNp(null); setDup(null);
    setForm(startForm(eventId, true));
  };

  const save = async (another = false, answer = null) => {
    setErr(""); setSaved("");
    if (!(Number(f.amount) > 0)) { setErr("Type the amount."); return; }
    const fundProblem = fundLinesProblem(f.amount, f.fund);
    if (fundProblem) { setErr(fundProblem); return; }
    if (np && !personName(np)) { setErr("Type the new person's first or last name."); return; }
    let p = null;
    if (!np) {
      p = person && who === person.name ? person : await personNamed(who.trim()).catch(() => null);
      if (!p) { setErr(`${who.trim() || "That name"} is not on file. Choose someone from your records${newPersonOk ? ", or add them as a new person" : ""}.`); return; }
    }
    setBusy(true);
    if (!idem.current) idem.current = crypto.randomUUID();
    try {
      if (np) {
        // QUICKADD-1: the person and the gift in one write. `answer` is her
        // reply to "already on file": { useExistingId } or { confirmNew }.
        const r = await apiFetch("/gifts/new-person", { method: "POST", body: JSON.stringify({ person: np, ...giftBody(), ...(answer || {}) }) });
        const d = r && r.donor;
        done(r, { id: d ? d.id : (r.person && r.person.id), name: d ? d.name : personName(np) }, another);
      } else {
        const r = await apiFetch(`/donors/${p.id}/gifts`, { method: "POST", body: JSON.stringify(giftBody()) });
        done(r, p, another);
      }
    } catch (e) {
      const b = (e && e.body) || e || {};
      if (b.code === "possible_duplicate" || b.error === "possible_duplicate") setDup({ sentence: b.sentence, matches: b.matches || [], another });
      else setErr(errorMessage(e, "The gift could not be saved."));
    }
    setBusy(false);
  };

  const typed = who.trim();
  return (
    <Modal onClose={onClose} width={520} ariaLabel={title}>
      <div data-testid={testid} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{title}</div>
        {saved && <div role="status" data-testid={testid + "-saved"} style={{ fontSize: 12.5, color: T.greenDk, fontWeight: 700 }}>{saved}</div>}
        {np ? <NewPersonFields value={np} onChange={v => { setNp(v); setDup(null); }} testid={testid + "-np"} onCancel={() => { setNp(null); setDup(null); }} />
          : <label><span style={lbl}>From</span>
            {fixedPerson ? <div data-testid={testid + "-who"} style={{ fontSize: 14, color: T.ink, fontWeight: 700 }}>{who}</div>
              : <><input list="record-gift-people" value={who} onChange={e => setWho(e.target.value)} placeholder="Search people on file, or type a new name" data-testid={testid + "-who"} style={inp} autoComplete="off" />
                <PeopleDatalist id="record-gift-people" text={who} />
                {newPersonOk && typed && (!person || who !== person.name) && (
                  <button type="button" data-testid={testid + "-new-person"} onClick={() => { setNp(splitName(typed)); setErr(""); }}
                    style={{ background: "none", border: "none", padding: "6px 0 0", color: T.greenDk, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                    + New person: '{typed}'</button>)}</>}
          </label>}
        {dup && (
          <div data-testid={testid + "-dup"} role="alert" style={{ border: "1px solid " + T.gold300, background: T.gold50, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 13, color: T.ink }}>{dup.sentence}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {dup.matches[0] && <button type="button" style={btn(true)} data-testid={testid + "-dup-use"} disabled={busy}
                onClick={() => save(dup.another, { useExistingId: dup.matches[0].id })}>Use {dup.matches[0].name}</button>}
              <button type="button" style={btn(false)} data-testid={testid + "-dup-new"} disabled={busy}
                onClick={() => save(dup.another, { confirmNew: true })}>No, add a new person</button>
            </div>
          </div>)}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <label><span style={lbl}>Amount ($)</span>
            <input type="number" min="0" step="0.01" value={f.amount} onChange={e => setF({ amount: e.target.value })} data-testid={testid + "-amount"} style={inp} autoFocus /></label>
          <label><span style={lbl}>Date</span>
            <DateInput value={f.date} onChange={e => setF({ date: e.target.value })} data-testid={testid + "-date"} style={inp} /></label>
          <label><span style={lbl}>Method</span>
            <select value={f.method} onChange={e => setF({ method: e.target.value })} data-testid={testid + "-method"} style={inp}>
              {(METHODS.includes(f.method) ? METHODS : [f.method, ...METHODS]).map(m => <option key={m} value={m}>{m}</option>)}
            </select></label>
        </div>
        <SameAsLast carried={{ date: same.date && f.date, method: same.method && f.method, fund: same.fund && f.fund }} testid={testid}
          onClear={k => setF({ [k]: k === "date" ? orgTodayCivil() : k === "method" ? "Check" : emptyFund() })} />
        <FundField value={f.fund} amount={f.amount} onChange={v => setF({ fund: v })} testid={testid + "-fund"} />
        {!pledgeId && <AttributionField kind="campaign" value={f.campaign} sticky={!!same.campaign} date={f.date} testid={testid + "-campaign"} onChange={v => setF({ campaign: v })} />}
        <AttributionField kind="appeal" value={f.appeal} sticky={!!same.appeal} campaignId={f.campaign && f.campaign.id} testid={testid + "-appeal"} onChange={v => setF({ appeal: v })} />
        <AttributionField kind="page" value={f.page} sticky={!!same.page} testid={testid + "-page"} onChange={v => setF({ page: v })} />
        {!pledgeId && <label><span style={lbl}>Event</span>
          <EventField value={f.eventId} onChange={id => setF({ eventId: id })} testid={testid + "-event"} /></label>}
        {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" style={btn(false)} onClick={onClose}>{saved ? "Done" : "Cancel"}</button>
          {!fixedPerson && <button type="button" style={btn(false)} onClick={() => save(true)} disabled={busy} data-testid={testid + "-save-another"}>Save and add another</button>}
          <button type="button" style={btn(true)} onClick={() => save(false)} disabled={busy} data-testid={testid + "-save"}>{busy ? "Saving…" : "Save the gift"}</button>
        </div>
      </div>
    </Modal>
  );
}
