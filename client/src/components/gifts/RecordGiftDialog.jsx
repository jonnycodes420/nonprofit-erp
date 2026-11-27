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
// QUICKADD-1 (a beta customer, six Good Giving Challenge donors):
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
import { track } from "../../lib/analyticsDoor";   // ANALYTICS-1
import { T, Modal, fmtFull } from "../shared";
import { errorMessage } from "../../lib/domainError";
import { orgTodayCivil } from "../../lib/orgToday";
import { personNamed } from "../../lib/people";
import { lastGift, rememberGift } from "../../lib/stickyGift";
import FromPerson from "./FromPerson";   // FLOWS-7: the Donors list's person search, on the page
import EventField from "./EventField";
import FundField, { emptyFund, fundBody, fundLinesProblem } from "./FundField";
import AttributionField from "./AttributionField";
import NewPersonFields, { splitName, personName } from "./NewPersonFields";
import SameAsLast from "./SameAsLast";
import TributeFields, { tributeBody } from "./TributeFields";   // THANKS-1 item 5: the full form's tribute, here too
import DateInput from "../inputs/LazyDateInput";   // POLISH-6: the one date box, loaded when first shown

const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", color: T.ink, fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box", width: "100%" };
const lbl = { fontSize: 11.5, fontWeight: 700, color: T.ink3, marginBottom: 4, display: "block" };
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
import { methodChoices, methodValue, NOT_SET } from "../../../../shared/giftMethods.js";   // GIFTS-3: one list of methods
import { giftAmountProblem } from "../../lib/amountCheck";   // INPUT-1
import { isFarOutside, askFarOutside } from "../../lib/farOutside";   // IMPORT-11
import { confirmGiftDate } from "../../lib/giftDateCheck";   // INPUT-1: Jan 1, 1900 asks first
import { askConfirm } from "../ConfirmDialog";

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
  const [picked, setPicked] = useState(person);   // FLOWS-7: the person chosen from the matches
  const [{ f, same }, setForm] = useState(() => startForm(eventId, carry));
  const setF = patch => setForm(s => ({ f: { ...s.f, ...patch }, same: Object.fromEntries(Object.entries(s.same).filter(([k]) => !(k in patch))) }));
  const [np, setNp] = useState(null);          // the new person's fields, or null
  const [dup, setDup] = useState(null);        // { sentence, matches } from a 409
  const [saved, setSaved] = useState("");      // "Saved $60 from Kit Ravensworth." after Save and add another
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const idem = useRef(null);
  const newPersonOk = !fixedPerson;
  const [tribOpen, setTribOpen] = useState(false);
  const typedAs = k => t => setForm(s => ({ ...s, f: { ...s.f, typed: { ...(s.f.typed || {}), [k]: t } } }));
  const pickAs = k => v => setForm(s => ({ ...s, f: { ...s.f, [k]: v, typed: { ...(s.f.typed || {}), [k]: "" } } }));

  const giftBody = () => ({
    amount: f.amount, date: f.date, type: "cash", payment_method: methodValue(f.method), ...fundBody(f.fund), anonymous: !!f.anonymous,
    campaignId: (!pledgeId && f.campaign && f.campaign.id) || undefined,
    appealId: (f.appeal && f.appeal.id) || undefined,
    givingPageId: (f.page && f.page.givingPageId) || undefined, peerFundraiserId: (f.page && f.page.peerFundraiserId) || undefined,
    eventId: f.eventId || undefined, pledgeId: pledgeId || undefined, idempotencyKey: idem.current, ...tributeBody(f),
  });

  const done = (r, p, another) => {
    idem.current = null;
    rememberGift(f);
    track("gift_recorded", { via: eventId ? "event" : pledgeId ? "pledge" : "dialog", new_person: !!np, tribute: !!f.tribType, split_funds: Array.isArray(f.fund) && f.fund.length > 1 });
    onSaved && onSaved(r, p);
    if (!another) { onClose(); return; }
    setSaved(`Saved ${fmtFull(Number(f.amount) || 0)} from ${p.name}.`);
    setWho(""); setPicked(null); setNp(null); setDup(null); setTribOpen(false);
    setForm(startForm(eventId, true));
  };

  const save = async (another = false, answer = null) => {
    setErr(""); setSaved("");
    if (giftAmountProblem(f.amount)) { setErr(giftAmountProblem(f.amount)); return; }   // INPUT-1: said, keeping what she typed
    if (!(Number(f.amount) > 0)) { setErr("Type the amount."); return; }
    // GIFTS-3 item 2: text typed into a picker and never picked is not saved, and not dropped either.
    const unpicked = Object.entries(f.typed || {}).find(([k, t]) => t && !f[k]);
    if (unpicked) { setErr(`You typed '${unpicked[1]}' for the ${{ page: "fundraiser or giving page", trib: "person the tribute honors" }[unpicked[0]] || unpicked[0]} but did not pick one. Pick it from the list, or clear the box.`); return; }
    const fundProblem = fundLinesProblem(f.amount, f.fund);
    if (fundProblem) { setErr(fundProblem); return; }
    if (f.tribType && !f.trib) { setErr("Pick who the tribute honors, or choose Not a tribute gift."); return; }
    if (np && !personName(np)) { setErr("Type the new person's first or last name."); return; }
    if (!answer && !(await confirmGiftDate(askConfirm, f.date))) return;   // INPUT-1: "Change it" leaves the form as it is
    let p = null;
    if (!np) {
      p = picked && who === picked.name ? picked : await personNamed(who.trim()).catch(() => null);
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
        // IMPORT-11: a gift far outside the pattern asks first, in the server's words
        const post = far => apiFetch(`/donors/${p.id}/gifts`, { method: "POST", body: JSON.stringify({ ...giftBody(), confirmFarOutside: far }) });
        let r;
        try { r = await post(undefined); }
        catch (e) { if (!isFarOutside(e)) throw e; if (!(await askFarOutside(askConfirm, e))) { setBusy(false); return; } r = await post(true); }
        done(r, p, another);
      }
    } catch (e) {
      const b = (e && e.body) || e || {};
      if (b.code === "possible_duplicate" || b.error === "possible_duplicate") setDup({ sentence: b.sentence, matches: b.matches || [], another });
      else setErr(errorMessage(e, "The gift could not be saved."));
    }
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} width={520} ariaLabel={title}>
      <div data-testid={testid} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{title}</div>
        {saved && <div role="status" data-testid={testid + "-saved"} style={{ fontSize: 12.5, color: T.greenDk, fontWeight: 700 }}>{saved}</div>}
        {np ? <NewPersonFields value={np} onChange={v => { setNp(v); setDup(null); }} testid={testid + "-np"} onCancel={() => { setNp(null); setDup(null); }} />
          : <div><span style={lbl}>From</span>
            {fixedPerson ? <div data-testid={testid + "-who"} style={{ fontSize: 14, color: T.ink, fontWeight: 700 }}>{who}</div>
              : <FromPerson value={who} chosen={picked} onType={setWho} onChoose={x => { setPicked(x); setWho(x.name); setErr(""); }}
                  onNew={t => { setNp(splitName(t)); setErr(""); }} newPersonOk={newPersonOk} inputStyle={inp} testid={testid} />}
          </div>}
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
              <option value="">{NOT_SET}</option>
              {methodChoices(f.method).map(m => <option key={m} value={m}>{m}</option>)}
            </select></label>
        </div>
        <SameAsLast carried={{ date: same.date && f.date, method: same.method && f.method, fund: same.fund && f.fund }} testid={testid}
          onClear={k => setF({ [k]: k === "date" ? orgTodayCivil() : k === "method" ? "Check" : emptyFund() })} />
        <FundField value={f.fund} amount={f.amount} onChange={v => setF({ fund: v })} testid={testid + "-fund"} />
        {!pledgeId && <AttributionField kind="campaign" value={f.campaign} sticky={!!same.campaign} date={f.date} testid={testid + "-campaign"} onChange={v => setF({ campaign: v })} onTyped={t => setForm(s => ({ ...s, f: { ...s.f, typed: { ...(s.f.typed || {}), campaign: t } } }))} />}
        <AttributionField kind="appeal" value={f.appeal} sticky={!!same.appeal} campaignId={f.campaign && f.campaign.id} testid={testid + "-appeal"} onChange={v => setF({ appeal: v })} onTyped={t => setForm(s => ({ ...s, f: { ...s.f, typed: { ...(s.f.typed || {}), appeal: t } } }))} />
        <AttributionField kind="page" value={f.page} sticky={!!same.page} testid={testid + "-page"} onChange={v => setF({ page: v })} onTyped={t => setForm(s => ({ ...s, f: { ...s.f, typed: { ...(s.f.typed || {}), page: t } } }))} />
        {!pledgeId && <label><span style={lbl}>Event</span>
          <EventField value={f.eventId} onChange={id => setF({ eventId: id })} testid={testid + "-event"} /></label>}
        {tribOpen || f.tribType
          ? <div data-testid={testid + "-tribute"} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <TributeFields form={f} set={setF} pickPerson={pickAs} typed={typedAs} inp={inp} testid={testid + "-trib"} /></div>
          : <button type="button" onClick={() => setTribOpen(true)} data-testid={testid + "-tribute-toggle"}
              style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 12.5, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>In honor or in memory of someone</button>}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: T.ink }}>
          <input type="checkbox" checked={!!f.anonymous} onChange={e => setF({ anonymous: e.target.checked })} data-testid={testid + "-anonymous"} style={{ accentColor: T.greenDk }} />
          Anonymous (the gift stays theirs; public lists say Anonymous)
        </label>
        {/* THANKS-1 item 5 (LEDGER-3): a gift recorded by hand posts at once; imports wait to post */}
        <div data-testid={testid + "-posts"} style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>Saved here, the gift goes on the books at once, to its fund. Imported gifts wait on Finance under Waiting to post.</div>
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
