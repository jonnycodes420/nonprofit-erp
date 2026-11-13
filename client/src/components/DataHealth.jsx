// DataHealth.jsx · CLEAN-1. Donors, Data health.
//
// One line per kind of mess: a count that opens its rows, a sentence that
// says what the count is, and the one action that fixes it. Steward suggests;
// a person approves. Every write goes through a POST the person pressed, and
// a merge can be undone for 30 days.
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, API, getToken } from "../api";
import { T, Card, Modal } from "./shared";
import { displayDate } from "../../../shared/displayDate.js";
import { countLabel } from "../../../shared/countWords.js";
import { displayOrgDate } from "../lib/orgDay";
import { KeptHeads, keptSentence } from "./merge/KeptHeads";   // FLOWS-2

const fmtMoney = c => "$" + (Number(c || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = countLabel;
const CONF_WORD = { high: "High", medium: "Medium", low: "Low" };
const btn = (primary, disabled) => ({
  background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink2,
  border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", fontSize: 13,
  fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap",
});
const linkBtn = { background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 13, cursor: "pointer", textDecoration: "underline" };
const chip = conf => ({
  display: "inline-block", borderRadius: 99, padding: "1px 9px", fontSize: 11, fontWeight: 800, letterSpacing: "0.03em",
  background: conf === "high" ? T.greenDk : conf === "medium" ? T.gold100 : T.bg2,
  color: conf === "high" ? T.white : conf === "medium" ? T.gold700 : T.ink2,
  border: conf === "medium" ? "1px solid " + T.gold300 : "1px solid transparent",
});
const rowStyle = { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 0", borderTop: "1px solid " + T.bg2 };
const show = v => (v === null || v === undefined || v === "" ? null : String(v));
// What a merge moves, in the words staff use. Scores are recomputed from
// gifts and touches, so they are not worth a word here.
const HIDDEN_TABLES = new Set(["donor_scores", "group_sweep_seen", "portal_audit_log"]);
const TABLE_WORDS = {
  gifts: ["gift", "gifts"], interactions: ["note or conversation", "notes and conversations"], pledges: ["pledge", "pledges"],
  tasks: ["task", "tasks"], threads: ["next step", "next steps"], receipts: ["receipt", "receipts"],
  gift_soft_credits: ["soft credit", "soft credits"], memberships: ["membership", "memberships"],
  recurring_subscriptions: ["recurring gift", "recurring gifts"], group_members: ["group", "groups"],
  volunteer_shifts: ["volunteer shift", "volunteer shifts"], event_attendees: ["event registration", "event registrations"],
  survey_responses: ["survey answer", "survey answers"], interaction_attachments: ["file", "files"],
  sequence_enrollments: ["journey", "journeys"], auction_bidders: ["auction bidder record", "auction bidder records"],
  // POLISH-4: the rest of what a hand merge moves, named.
  donor_relationships: ["link to someone", "links to people"], email_messages: ["email", "emails"], email_sends: ["email sent", "emails sent"],
  campaign_recipients: ["campaign email", "campaign emails"], planned_gifts: ["planned gift", "planned gifts"], donor_materials: ["file", "files"],
};
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const PAGE = 50;   // SWEEP-2: review lists come a page at a time
// FIX-59: when Data health last ran, and what made it run.
const RUN_WORDS = { import: "after your import", undo: "after an import was undone", merge: "after a merge", merge_undo: "after a merge was undone",
  delete: "after people were deleted", nightly: "overnight", manual: "when you asked" };
function checkedWords(run) {
  const at = new Date(run.created_at);
  if (isNaN(at)) return null;
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const sameDay = at.toDateString() === new Date().toDateString();
  return `Checked ${sameDay ? time : `${displayOrgDate(at) || at.toLocaleDateString()} at ${time}`}, ${RUN_WORDS[run.trigger] || "by hand"}.`;
}

function Line({ label, count, sentence, action, onOpen, onAction, open, testid, first }) {
  return (
    <div data-testid={testid} style={{ ...rowStyle, borderTop: first ? "none" : rowStyle.borderTop }}>
      {/* SWEEP-2: a line with nothing to count (People who moved, before a
          provider's file) draws no "0", only its sentence and its action */}
      {count == null ? <div aria-hidden style={{ minWidth: 64 }} /> :
      <button onClick={onOpen} aria-expanded={open} aria-label={`${label}: ${count}. Open the rows.`}
        style={{ background: open ? T.bg2 : T.white, border: "1px solid " + T.bg3, borderRadius: 10, minWidth: 64, padding: "8px 10px",
          fontFamily: "'DM Serif Display',serif", fontSize: 24, color: T.ink, cursor: "pointer", lineHeight: 1 }}>{count}</button>}
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>{label}</div>
        <div style={{ fontSize: 13, color: T.ink3, marginTop: 2 }}>{sentence}</div>
      </div>
      {action && <button onClick={onAction} style={btn(true)}>{action}</button>}
    </div>
  );
}

export function DataHealth({ onOpenDonor, isReadOnly = false }) {
  const [health, setHealth] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);
  const [flash, setFlash] = useState(null);
  // Bumped after every change, so the merges list (where Undo lives) reloads
  // the moment a merge lands rather than on the next visit.
  const [tick, setTick] = useState(0);
  const load = () => apiFetch("/data-health").then(setHealth).catch(e => setErr(e.message || "Data health couldn't load."));
  useEffect(() => { load(); }, []);
  const toggle = k => setOpen(o => (o === k ? null : k));
  // SWEEP-2: the pairs list re-reads on the tick, so an Undo below redraws the
  // pairs above it; the "Checked … after" line is re-read once the server's
  // re-check (half a second after a change) has run.
  const done = msg => { setFlash(msg); setTick(t => t + 1); load(); setTimeout(load, 1200); };

  if (err) return <Card><div style={{ color: T.ink2, fontSize: 14 }}>Data health couldn't load. {err}</div><button style={{ ...btn(false), marginTop: 10 }} onClick={() => { setErr(null); load(); }}>Try again</button></Card>;
  if (!health) return <Card><div style={{ color: T.ink3, fontSize: 13 }}>Checking your file…</div></Card>;
  const c = health.counts;
  // FIX-60: a line's examples are names from this org's own rows for that
  // line (GET /data-health `examples`), or there are none. Never typed here.
  const ex = health.examples || {};
  const quoted = names => (names && names.length ? ` (${names.map(n => `"${n}"`).join(", ")})` : "");
  const lines = [
    { id: "duplicates", label: "Possible duplicates", count: c.duplicates,
      sentence: c.duplicates ? `${plural(c.duplicates, "pair")} that may be the same person: ${c.duplicatesByConfidence.high} high, ${c.duplicatesByConfidence.medium} medium, ${c.duplicatesByConfidence.low} low confidence.` : "No two people on file look like the same person.",
      action: c.duplicates ? "Review pairs" : null },
    { id: "addresses", label: "Addresses to tidy", count: c.addressesToTidy,
      sentence: `${plural(c.addressesToTidy, "address", "addresses")} can be written the standard US way${c.addressesUnreadable ? `; ${c.addressesUnreadable === 1 ? "1 can't be read and is" : `${c.addressesUnreadable.toLocaleString("en-US")} can't be read and are`} listed for you to fix by hand` : ""}.`,
      action: c.addressesToTidy || c.addressesUnreadable ? "Review changes" : null },
    { id: "moved", label: "People who moved", count: c.hasNcoaFile ? c.moved : null,
      sentence: c.hasNcoaFile ? `${plural(c.moved, "change of address", "changes of address")} from the provider's file wait for you.` : "Prepare an address update file for a change-of-address provider, then bring their results back here.",
      action: c.hasNcoaFile && c.moved ? "Review moves" : "Prepare or bring in a file" },
    { id: "emails", label: "Emails to look at", count: c.emails,
      sentence: `${plural(c.emails, "email")} that bounce, aren't valid, look like a typo, or are a shared office address on a person.`,
      action: c.emails ? "Review emails" : null },
    // IMPORT-5: only shown when there is something to fix
    ...(c.couples ? [{ id: "couples", label: "Couples written as one name", count: c.couples,
      sentence: `${c.couples === 1 ? "1 name looks like a couple" : `${c.couples.toLocaleString("en-US")} names look like couples`} written as one person${quoted(ex.couples)}.`,
      action: "Fix them" }] : []),
    // FIX-58: pledges an import dated from the event's own day
    ...(c.pledgesOnEventDay ? [{ id: "pledgeDates", label: "Pledges due the day of the event", count: c.pledgesOnEventDay,
      sentence: `${c.pledgesOnEventDay === 1 ? "1 pledge has" : `${c.pledgesOnEventDay.toLocaleString("en-US")} pledges have`} a first installment dated the event day, so ${c.pledgesOnEventDay === 1 ? "it reads" : "they read"} overdue the week after.`,
      action: "Move to Dec 31" }] : []),
    // FIX-59: each only when there is something in it
    ...(c.eventDuplicatesByEvent || []).map(e => ({ id: `event:${e.eventId}`, label: `Possible duplicates within ${e.eventName}`, count: e.count,
      sentence: `${e.count === 1 ? "Two spellings of one name" : "Names spelled two ways"} on this event's list${(ex.eventPairs || {})[e.eventId] ? ` (${ex.eventPairs[e.eventId].map(n => `"${n}"`).join(" and ")})` : ""}. Answer Same person or Different for each.`, action: "Review" })),
    ...(c.namesWithNotes ? [{ id: "names", label: "Names with markup or a note in them", count: c.namesWithNotes,
      sentence: `${c.namesWithNotes === 1 ? "1 name has" : `${c.namesWithNotes.toLocaleString("en-US")} names have`} stars, underscores or a note in brackets typed into ${c.namesWithNotes === 1 ? "it" : "them"}${quoted(ex.namesWithNotes)}.`,
      action: "Clean them" }] : []),
    ...(c.families ? [{ id: "families", label: "Possible families", count: c.families,
      sentence: `${plural(c.families, "pair")} with one surname and two different first names share an address, phone or email: likely spouses or a parent and child, not duplicates.`,
      action: "Review" }] : []),
    // POLISH-4: only when there is something to link
    ...(c.businesses ? [{ id: "businesses", label: "People and their businesses", count: c.businesses,
      sentence: c.businessPeople != null
        ? `${plural(c.businessPeople, "person", "people")} and ${plural(c.businessOrgs, "organization")} on file look like one giving unit, each counted once. Linked, a gift from either keeps both off Lapsed.`
        : `${c.businesses === 1 ? "1 person looks" : `${c.businesses.toLocaleString("en-US")} people look`} linked to an organization on file. Linked, a gift from either keeps both off Lapsed.`,
      action: "Review" }] : []),
    // INTEGRITY-1: an email belongs to one person; a person and their household with the same gifts
    ...(c.sharedEmails ? [{ id: "sharedEmails", label: "One email on two people", count: c.sharedEmails,
      sentence: `${c.sharedEmails === 1 ? "1 email address is" : `${c.sharedEmails.toLocaleString("en-US")} email addresses are`} on more than one person. An email belongs to one person: change it on all but one, or merge them if they are the same.`,
      action: "Review" }] : []),
    ...(c.identicalGifts ? [{ id: "identicalGifts", label: "A person and their household with the same gifts", count: c.identicalGifts,
      sentence: `${plural(c.identicalGifts, "pair")} in one household or gives-through link hold exactly the same gifts, date and amount: one set was entered twice. Retention reports list the household once either way.`,
      action: "Review" }] : []),
    { id: "unreachable", label: "No way to reach", count: c.unreachable,
      sentence: `${plural(c.unreachable, "person", "people")} with no email, no phone and no mailable address.`,
      action: c.unreachable ? "Open the list" : null },
  ];
  // SWEEP-2: a check at zero hides. People who moved stays (it is a file to
  // prepare, not a count), and with nothing else to show, one sentence says so.
  const shown = lines.filter(l => l.id === "moved" || l.count > 0);
  const clean = !shown.some(l => l.count > 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="data-health">
      <Card>
        <div style={{ fontSize: 13, color: T.ink3, marginBottom: 6 }}>
          What looks messy in your file, with a reason for each. Nothing changes until you approve it.
          {health.lastRun && checkedWords(health.lastRun) && <span data-testid="dh-checked"> {checkedWords(health.lastRun)}</span>}
        </div>
        {flash && <div role="status" data-testid="dh-flash" style={{ background: T.green100, border: "1px solid " + T.green200, borderRadius: 8, padding: "8px 12px", fontSize: 13, color: T.ink, margin: "6px 0" }}>{flash}</div>}
        {clean && <div data-testid="dh-clean" style={{ fontSize: 14, color: T.ink, padding: "10px 0 4px" }}>
          {c.people ? "Nothing to tidy: no likely duplicates, every address is written the standard way, no email to look at, and everyone has a way to reach them."
            : "Nothing to check yet. Once people are on file, Steward looks here for duplicates, addresses to tidy, emails that bounce and people you can't reach. Bring in a file from Import & tools."}
        </div>}
        {shown.map((l, i) => (
          <Line key={l.id} {...l} first={i === 0 && !clean} testid={`dh-line-${l.id}`} open={open === l.id} onOpen={() => toggle(l.id)} onAction={() => setOpen(l.id)} />
        ))}
      </Card>
      {open === "duplicates" && <DuplicatesPanel tick={tick} onDone={done} onOpenDonor={onOpenDonor} isReadOnly={isReadOnly} />}
      {open === "addresses" && <AddressesPanel onDone={done} onOpenDonor={onOpenDonor} isReadOnly={isReadOnly} />}
      {open === "moved" && <MovedPanel onDone={done} isReadOnly={isReadOnly} note={health.ncoaNote} demo={!!health.demo} />}
      {open === "emails" && <EmailsPanel onDone={done} onOpenDonor={onOpenDonor} isReadOnly={isReadOnly} />}
      {open === "unreachable" && <UnreachablePanel onOpenDonor={onOpenDonor} />}
      {(open === "sharedEmails" || open === "identicalGifts") && <IntegrityPanel kind={open} onOpenDonor={onOpenDonor} />}
      {open === "couples" && <CouplesPanel onDone={done} isReadOnly={isReadOnly} />}
      {open === "pledgeDates" && <PledgeDatesPanel onDone={done} isReadOnly={isReadOnly} />}
      {open === "names" && <NamesPanel onDone={done} onOpenDonor={onOpenDonor} isReadOnly={isReadOnly} />}
      {open === "families" && <FamiliesPanel onDone={done} onOpenDonor={onOpenDonor} isReadOnly={isReadOnly} />}
      {open === "businesses" && <BusinessesPanel onDone={done} onOpenDonor={onOpenDonor} isReadOnly={isReadOnly} />}
      {open && open.startsWith("event:") && <EventPairsPanel key={open} eventId={open.slice(6)} onDone={done} onOpenDonor={onOpenDonor} isReadOnly={isReadOnly} />}
      <MergesPanel key={tick} onDone={done} isReadOnly={isReadOnly} />
    </div>
  );
}

// ── Duplicates ─────────────────────────────────────────────────────────────
function DuplicatesPanel({ onDone, onOpenDonor, isReadOnly, tick }) {
  const [pairs, setPairs] = useState(null);
  const [total, setTotal] = useState(0);
  const [shown, setShown] = useState(PAGE);
  const [cmp, setCmp] = useState(null);
  const [bulk, setBulk] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // SWEEP-2: the pairs come a page at a time; Show more asks for the next page.
  // LIST-2: Review pairs finishes, or says it failed. It never spins: a read
  // that takes over 20 seconds is stopped, and an answer with no pairs in it
  // is a failure in words, not an endless "Finding pairs…".
  const load = (limit = shown) => {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 20000) : null;
    setErr(null);
    return apiFetch(`/data-health/duplicates?limit=${limit}`, ctl ? { signal: ctl.signal } : {})
      .then(r => {
        if (!r || !Array.isArray(r.pairs)) throw new Error("Steward couldn't read the pairs.");
        setPairs(r.pairs); setTotal(r.total ?? r.pairs.length);
      })
      .catch(e => setErr(e && e.name === "AbortError" ? "Finding pairs took too long. Try again in a minute." : (e && (e.sentence || e.message)) || "Steward couldn't find the pairs."))
      .finally(() => { if (timer) clearTimeout(timer); });
  };
  useEffect(() => { load(); }, [tick]);   // eslint-disable-line react-hooks/exhaustive-deps
  const more = () => { const n = shown + PAGE; setShown(n); load(n); };
  const notDup = async p => {
    try { await apiFetch("/data-health/pairs/dismiss", { method: "POST", body: JSON.stringify({ a: p.a, b: p.b }) }); load(); onDone(`${p.left.name} and ${p.right.name} are marked as two different people. They won't be suggested again.`); }
    catch (e) { setErr(e.sentence || e.message); }
  };
  const openBulk = async () => { try { setBulk(await apiFetch("/data-health/bulk-preview")); } catch (e) { setErr(e.message); } };
  const runBulk = async () => {
    setBusy(true);
    try {
      const r = await apiFetch("/data-health/bulk-merge", { method: "POST", body: JSON.stringify({ keys: bulk.pairs.map(p => p.key) }) });
      setBulk(null); load();
      onDone(`${plural(r.merged.length, "pair")} merged.${r.skipped.length ? ` ${r.skipped.length} skipped: ${r.skipped.map(s => s.why).join("; ")}.` : ""} Each can be undone below for 30 days.`);
    } catch (e) { setErr(e.sentence || e.message); }
    finally { setBusy(false); }
  };
  if (!pairs) return <Card data-testid={err ? "dh-pairs-failed" : "dh-pairs-loading"}>{err ? <>Couldn't load the pairs. {err} <button style={linkBtn} onClick={() => load()}>Try again</button></> : "Finding pairs…"}</Card>;
  if (!pairs.length && !total) return <Card data-testid="dh-duplicates"><div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>No likely duplicates</div></Card>;
  const highs = pairs.filter(p => p.confidence === "high" && !p.crossHousehold).length;
  return (
    <Card data-testid="dh-duplicates">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{plural(total, "possible duplicate")}</div>
        {highs > 0 && <button style={btn(false, isReadOnly)} disabled={isReadOnly} onClick={openBulk}>Merge all high-confidence pairs</button>}
      </div>
      {err && <div style={{ color: T.ink2, fontSize: 13, marginTop: 8 }}>{err}</div>}
      {pairs.map(p => (
        <div key={p.key} style={rowStyle} data-testid="dh-pair">
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ fontSize: 14, color: T.ink }}>
              <button style={linkBtn} onClick={() => onOpenDonor && onOpenDonor(p.left.id)}>{p.left.name}</button>
              <span style={{ color: T.ink3 }}> and </span>
              <button style={linkBtn} onClick={() => onOpenDonor && onOpenDonor(p.right.id)}>{p.right.name}</button>
              {" "}<span style={chip(p.confidence)}>{CONF_WORD[p.confidence]}</span>
            </div>
            <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 3 }}>
              {cap(p.reasons.join("; "))}.{p.crossHousehold ? " They are in two different households, so they can only be merged here, one at a time." : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btn(true, isReadOnly)} disabled={isReadOnly} onClick={() => setCmp(p)}>Compare</button>
            <button style={btn(false, isReadOnly)} disabled={isReadOnly} onClick={() => notDup(p)}>Not a duplicate</button>
          </div>
        </div>
      ))}
      {pairs.length < total && <button data-testid="dh-pairs-more" style={{ ...btn(false), marginTop: 12 }} onClick={more}>
        Show {Math.min(PAGE, total - pairs.length)} more of {total.toLocaleString("en-US")}</button>}
      {cmp && <CompareModal pair={cmp} onClose={() => setCmp(null)} onMerged={msg => { setCmp(null); load(); onDone(msg); }} />}
      {bulk && (
        <Modal onClose={() => setBulk(null)} title="Merge all high-confidence pairs" width={620}
          footer={<div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button style={btn(false)} onClick={() => setBulk(null)}>Cancel</button>
            <button style={btn(true, busy || !bulk.pairs.length)} disabled={busy || !bulk.pairs.length} onClick={runBulk}>{busy ? "Merging…" : `Merge ${plural(bulk.pairs.length, "pair")}`}</button>
          </div>}>
          <div style={{ fontSize: 13, color: T.ink3, marginBottom: 8 }}>{bulk.sentence} For each pair the record with more gifts is kept; the newest non-empty value wins each field, and both emails and phones are kept.</div>
          {bulk.pairs.map(p => (
            <div key={p.key} style={{ ...rowStyle, padding: "8px 0" }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: T.ink }}>
                Keep <b>{p.kept.name}</b>, fold in <b>{p.merged.name}</b>
                <div style={{ fontSize: 12, color: T.ink3 }}>{p.reasons.join("; ")}. Lifetime giving after: {fmtMoney(p.lifetimeAfterCents)}.</div>
              </div>
            </div>
          ))}
        </Modal>
      )}
    </Card>
  );
}

// POLISH-4: the profile's More → Merge with… opens this too, on a pair she chose.
export function CompareModal({ pair, onClose, onMerged, undoWhere = "below" }) {
  const [d, setD] = useState(null);
  const [keptId, setKeptId] = useState(null);
  const [choices, setChoices] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    apiFetch(`/data-health/pair?a=${encodeURIComponent(pair.a)}&b=${encodeURIComponent(pair.b)}${pair.keep ? `&keep=${encodeURIComponent(pair.keep)}` : ""}`)   // FLOWS-4: keep the record she started from
      .then(r => { setD(r); setKeptId(r.keptId); setChoices(r.choices); })
      .catch(e => setErr(e.message));
  }, [pair.a, pair.b, pair.keep]);
  const otherId = d && (keptId === pair.a ? pair.b : pair.a);
  // ADDRESS-1: every field starts on the kept record's value, so keeping the
  // other record instead starts every field on that one's (choicesFor).
  const swap = () => { setChoices((d.choicesFor && d.choicesFor[otherId]) || Object.fromEntries(Object.entries(choices).map(([k, v]) => [k, v === "kept" ? "other" : "kept"]))); setKeptId(otherId); };
  // The name the record will have after the merge: the Name field's pick.
  const resultingName = () => { const K0 = d.records[keptId], O0 = d.records[otherId]; return ((choices.name === "other" ? O0 : K0).name) || K0.name; };
  const ADDR = ["address", "address2", "city", "state", "zip", "country"];
  const pick = (f, side) => setChoices(c => ADDR.includes(f) ? { ...c, ...Object.fromEntries(ADDR.map(k => [k, side])) } : { ...c, [f]: side });
  // FLOWS-6 (W-1110-Donors-44X): a teammate is named, never shown as a user id.
  const fieldVal = (rec, f) => f === "household_id" ? (rec.household_id ? (d.households[rec.household_id] || "A household") : null)
    : f === "assigned_to" ? (rec.assigned_to ? ((d.users || {})[rec.assigned_to] || rec.assigned_to_name || "A former teammate") : null) : show(rec[f]);
  const moving = useMemo(() => {
    if (!d || !otherId) return "";
    const m = d.moving[otherId] || {};
    const total = Object.values(m).reduce((a, b) => a + b, 0);
    const names = Object.entries(m).filter(([k]) => !HIDDEN_TABLES.has(k.split(".")[0]))
      .map(([k, n]) => { const [one, many] = TABLE_WORDS[k.split(".")[0]] || ["linked record", "linked records"]; return plural(n, one, many); });
    // POLISH-5: only rows she can't see (scores, logs) is not "Moves to the kept record: ."
    return names.length ? `Moves to the kept record: ${names.join(", ")}.` : "Nothing else points at the other record.";
  }, [d, otherId]);
  const merge = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch("/data-health/merge", { method: "POST", body: JSON.stringify({ keptId, mergedId: otherId, choices }) });
      const kept = { ...d.records[keptId], name: resultingName() };
      onMerged(`Merged into ${kept.name}. Lifetime giving is now ${fmtMoney(r.lifetime.keptAfterCents)}, the two records' ${fmtMoney(r.lifetime.keptBeforeCents)} and ${fmtMoney(r.lifetime.mergedBeforeCents)}. You can undo this ${undoWhere} for 30 days.`, { ...r, keptId, keptName: kept.name });
    } catch (e) { setErr(e.sentence || e.message); setBusy(false); }
  };
  if (!d) return <Modal onClose={onClose} title="Compare">{err || "Loading both records…"}</Modal>;
  const K = d.records[keptId], O = d.records[otherId];
  // FLOWS-1 item 10: the address is one block (ADDRESS-1), shown whole (Street,
  // Apt, City, State, ZIP) whenever either record has one, even where the two
  // agree, so every compare, from a profile or the Donors list, shows the
  // street that will be kept. Other fields show where they differ.
  const hasAddr = ADDR.some(k => show(K[k]) || show(O[k]));
  const differing = d.fields.filter(f => (hasAddr && ADDR.includes(f.key) && (f.key !== "country" || show(K[f.key]) || show(O[f.key])))
    || (show(K[f.key]) !== show(O[f.key]) && (show(K[f.key]) || show(O[f.key]))));
  const opt = (f, side, rec) => {
    const v = fieldVal(rec, f.key);
    const on = (choices[f.key] || "kept") === side;
    return (
      <button key={side} onClick={() => pick(f.key, side)} aria-pressed={on}
        style={{ flex: "1 1 200px", minWidth: 0, textAlign: "left", background: on ? T.green100 : T.white, border: "1px solid " + (on ? T.greenDk : T.bg3),
          borderRadius: 8, padding: "7px 10px", fontSize: 13, color: v ? T.ink : T.ink3, cursor: "pointer", overflowWrap: "anywhere" }}>
        {on ? "✓ " : ""}{v || "(empty)"}
      </button>
    );
  };
  return (
    <Modal onClose={onClose} title="Compare and merge" width={760}
      subtitle={d.reasons.length ? `${cap(d.reasons.join("; "))}${d.confidence ? `. ${CONF_WORD[d.confidence]} confidence.` : ""}` : "You chose these two records. Pick the one to keep and, where they differ, which value stays."}
      footer={<div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button style={btn(false)} onClick={onClose}>Cancel</button>
        <button type="button" data-commit style={btn(true, busy)} disabled={busy} onClick={merge} data-testid="dh-merge-confirm">{busy ? "Merging…" : `Merge into ${resultingName()}`}</button>
      </div>}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <div data-testid="merge-headline" style={{ fontSize: 13, color: T.ink }}>Keeping <b>{K.name}</b> ({plural(Number(K.gift_count || 0), "gift")}, {fmtMoney(d.lifetimeCents[keptId])}); folding in <b>{O.name}</b> ({plural(Number(O.gift_count || 0), "gift")}, {fmtMoney(d.lifetimeCents[otherId])}).</div>
        <button style={linkBtn} onClick={swap}>Keep the other record instead</button>
      </div>
      <KeptHeads kept={K} other={O} lifetimeCents={d.lifetimeCents} />
      <div data-testid="merge-sentence" style={{ fontSize: 13, color: T.ink, marginBottom: 10 }}>{keptSentence(resultingName(), keptId, O)} In each row below, the value on the left is the kept record's.</div>
      {d.crossHousehold && <div style={{ background: T.gold100, border: "1px solid " + T.gold300, borderRadius: 8, padding: "8px 12px", fontSize: 13, color: T.ink, marginBottom: 10 }}>These two are in different households. Check that they are one person before you merge.</div>}
      <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 6 }}>Lifetime giving after the merge: {fmtMoney(d.lifetimeCents[keptId] + d.lifetimeCents[otherId])}. {moving} Both emails and phones are kept.</div>
      {differing.length === 0 && <div style={{ fontSize: 13, color: T.ink3 }}>Every field already agrees.</div>}
      {differing.map(f => (
        <div key={f.key} style={{ padding: "8px 0", borderTop: "1px solid " + T.bg2 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.ink2, marginBottom: 5 }}>{f.label}
            {/* FLOWS-2: the one case the screen starts on the merged-in side, said */}
            {choices[f.key] === "other" && !fieldVal(K, f.key) && <span data-testid="merge-fill" style={{ fontWeight: 400, color: T.ink3 }}> · the kept record has none, so the merged-in record's starts picked</span>}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{opt(f, "kept", K)}{opt(f, "other", O)}</div>
        </div>
      ))}
      {err && <div role="alert" style={{ marginTop: 10, fontSize: 13, color: T.ink }}>{err}</div>}
    </Modal>
  );
}

function MergesPanel({ onDone, isReadOnly }) {
  const [rows, setRows] = useState(null);
  const load = () => apiFetch("/data-health/merges").then(r => setRows(r.merges)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const [err, setErr] = useState(null);
  const undo = async m => {
    try { await apiFetch(`/data-health/merges/${m.id}/undo`, { method: "POST", body: "{}" }); load(); onDone(`Undone. ${m.kept_name} and ${m.merged_name} are two records again, with everything back where it was.`); }
    catch (e) { setErr(e.sentence || e.message); }
  };
  const live = (rows || []).filter(m => !m.undone_at);
  if (!live.length) return null;
  return (
    <Card data-testid="dh-merges">
      <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>Recent merges</div>
      <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>Any merge can be undone for 30 days. Undo brings back both records and every gift, note and row that moved.</div>
      {err && <div role="alert" style={{ fontSize: 13, color: T.ink, marginTop: 6 }}>{err}</div>}
      {live.map(m => (
        <div key={m.id} style={rowStyle}>
          <div style={{ flex: "1 1 240px", fontSize: 13, color: T.ink }}>
            <b>{m.merged_name}</b> into <b>{m.kept_name}</b>
            <div style={{ fontSize: 12, color: T.ink3 }}>{displayOrgDate(m.created_at)} by {m.created_by_name || "staff"}{m.bulk ? ", in a bulk merge" : ""}</div>
          </div>
          <button style={btn(false, isReadOnly)} disabled={isReadOnly} onClick={() => undo(m)}>Undo</button>
        </div>
      ))}
    </Card>
  );
}

// ── Addresses ──────────────────────────────────────────────────────────────
function AddressesPanel({ onDone, onOpenDonor, isReadOnly }) {
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const load = () => apiFetch("/data-health/addresses").then(r => { setData(r); setSel(new Set()); }).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const apply = async ids => {
    setBusy(true);
    try {
      const r = await apiFetch("/data-health/addresses/apply", { method: "POST", body: JSON.stringify({ donorIds: ids }) });
      // FIX-25: the approved rows leave the list now; the re-read confirms it.
      const gone = new Set(ids);
      setData(d => (d && Array.isArray(d.tidy) ? { ...d, tidy: d.tidy.filter(x => !gone.has(x.donorId)) } : d));
      load(); onDone(`${plural(r.applied, "address", "addresses")} tidied. The old ones are kept in each person's address history.`);
    } catch (e) { setErr(e.sentence || e.message); }
    finally { setBusy(false); }
  };
  const leave = async id => { try { await apiFetch("/data-health/addresses/dismiss", { method: "POST", body: JSON.stringify({ donorId: id }) }); load(); } catch (e) { setErr(e.message); } };
  if (!data) return <Card>{err ? `Couldn't load the addresses. ${err}` : "Reading addresses…"}</Card>;
  const all = data.tidy.map(r => r.donorId);
  return (
    <Card data-testid="dh-addresses">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{plural(data.tidy.length, "address", "addresses")} to tidy</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btn(false, busy || isReadOnly || !sel.size)} disabled={busy || isReadOnly || !sel.size} onClick={() => apply([...sel])}>Approve selected ({sel.size})</button>
          <button style={btn(true, busy || isReadOnly || !all.length)} disabled={busy || isReadOnly || !all.length} onClick={() => apply(all)}>Approve all {all.length}</button>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>Street words shortened the postal way, units on their own line, two-letter states, ZIP+4 written with a dash, capitals fixed. Worked out on Steward's own server; no address is sent anywhere.</div>
      {err && <div role="alert" style={{ fontSize: 13, color: T.ink, marginTop: 6 }}>{err}</div>}
      {data.tidy.map(r => (
        <label key={r.donorId} style={{ ...rowStyle, cursor: "pointer", alignItems: "flex-start" }} data-testid="dh-address">
          <input type="checkbox" checked={sel.has(r.donorId)} onChange={e => setSel(s => { const n = new Set(s); e.target.checked ? n.add(r.donorId) : n.delete(r.donorId); return n; })} style={{ marginTop: 3 }} />
          <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 13 }}>
            <div style={{ fontWeight: 700, color: T.ink }}>{r.name}</div>
            <div style={{ color: T.ink3, overflowWrap: "anywhere" }}>Now: {r.currentLine}</div>
            <div style={{ color: T.ink, overflowWrap: "anywhere" }}>Tidied: {r.proposedLine}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btn(false, isReadOnly)} disabled={isReadOnly} onClick={e => { e.preventDefault(); apply([r.donorId]); }}>Approve</button>
            <button style={btn(false, isReadOnly)} disabled={isReadOnly} onClick={e => { e.preventDefault(); leave(r.donorId); }}>Leave as is</button>
          </div>
        </label>
      ))}
      {data.unreadable.length > 0 && <>
        <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, marginTop: 14 }}>{plural(data.unreadable.length, "address", "addresses")} Steward can't read</div>
        <div style={{ fontSize: 12.5, color: T.ink3 }}>These are flagged rather than guessed at. Open the person to fix the address by hand.</div>
        {data.unreadable.map(r => (
          <div key={r.donorId} style={rowStyle}>
            <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 13 }}>
              <button style={linkBtn} onClick={() => onOpenDonor && onOpenDonor(r.donorId)}>{r.name}</button>
              <div style={{ color: T.ink3, overflowWrap: "anywhere" }}>{r.currentLine}: {r.why}.</div>
            </div>
          </div>
        ))}
      </>}
    </Card>
  );
}

// ── Couples written with a comma (IMPORT-5) ────────────────────────────────
// Before and after for each, applied only when she clicks, with Undo.
function CouplesPanel({ onDone, isReadOnly }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [batch, setBatch] = useState(null);
  const load = () => apiFetch("/data-health/couples").then(setData).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const apply = async ids => {
    setBusy(true); setErr(null);
    try { const r = await apiFetch("/data-health/couples/apply", { method: "POST", body: JSON.stringify({ donorIds: ids }) }); setBatch(r.batchId); load(); onDone(r.sentence); }
    catch (e) { setErr(e.sentence || e.message); }
    finally { setBusy(false); }
  };
  const undo = async () => {
    setBusy(true); setErr(null);
    try { const r = await apiFetch("/data-health/couples/undo", { method: "POST", body: JSON.stringify({ batchId: batch }) }); setBatch(null); load(); onDone(r.sentence); }
    catch (e) { setErr(e.sentence || e.message); }
    finally { setBusy(false); }
  };
  if (!data) return <Card>{err ? `Couldn't load the names. ${err}` : "Reading names…"}</Card>;
  const all = data.rows.map(r => r.donorId);
  return (
    <Card data-testid="dh-couples">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{data.sentence}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {batch && <button data-testid="dh-couples-undo" style={btn(false, busy || isReadOnly)} disabled={busy || isReadOnly} onClick={undo}>Undo</button>}
          <button data-testid="dh-couples-apply" style={btn(true, busy || isReadOnly || !all.length)} disabled={busy || isReadOnly || !all.length} onClick={() => apply(all)}>Fix all {all.length}</button>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>Two first names and a surname with a comma between the first names read as "Last, First". Fixed, each becomes two people in one household; their gifts stay with the first.</div>
      {err && <div role="alert" style={{ fontSize: 13, color: T.ink, marginTop: 6 }}>{err}</div>}
      {data.rows.map(r => (
        <div key={r.donorId} style={{ ...rowStyle, alignItems: "flex-start" }} data-testid="dh-couple">
          <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 13 }}>
            <div style={{ color: T.ink3 }}>Now: {r.before}</div>
            <div style={{ color: T.ink, fontWeight: 700 }}>Fixed: {r.after} ({r.people.join(" and ")})</div>
          </div>
          <button style={btn(false, busy || isReadOnly)} disabled={busy || isReadOnly} onClick={() => apply([r.donorId])}>Fix</button>
        </div>
      ))}
    </Card>
  );
}

// ── Pledges due the day of the event (FIX-58) ────────────────────────────
// Before and after for each, applied only when she clicks, with Undo.
function PledgeDatesPanel({ onDone, isReadOnly }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [batch, setBatch] = useState(null);
  const load = () => apiFetch("/data-health/pledge-dates").then(setData).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const apply = async ids => {
    setBusy(true); setErr(null);
    try { const r = await apiFetch("/data-health/pledge-dates/apply", { method: "POST", body: JSON.stringify({ pledgeIds: ids }) }); setBatch(r.batchId); load(); onDone(r.sentence); }
    catch (e) { setErr(e.sentence || e.message); }
    finally { setBusy(false); }
  };
  const undo = async () => {
    setBusy(true); setErr(null);
    try { const r = await apiFetch("/data-health/pledge-dates/undo", { method: "POST", body: JSON.stringify({ batchId: batch }) }); setBatch(null); load(); onDone(r.sentence); }
    catch (e) { setErr(e.sentence || e.message); }
    finally { setBusy(false); }
  };
  if (!data) return <Card>{err ? `Couldn't load the pledges. ${err}` : "Reading pledges…"}</Card>;
  const all = data.rows.map(r => r.pledgeId);
  const dates = list => list.map(i => displayDate(i) || "No date").join(", ");
  return (
    <Card data-testid="dh-pledge-dates">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{data.sentence}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {batch && <button data-testid="dh-pledge-dates-undo" style={btn(false, busy || isReadOnly)} disabled={busy || isReadOnly} onClick={undo}>Undo</button>}
          {all.length > 0 && <button data-testid="dh-pledge-dates-apply" style={btn(true, busy || isReadOnly)} disabled={busy || isReadOnly} onClick={() => apply(all)}>Move to Dec 31</button>}
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>A pledge made at an event is due by Dec 31 of the event's year, then each Dec 31 after. Amounts don't change, and a paid installment stays paid.</div>
      {err && <div role="alert" style={{ fontSize: 13, color: T.ink, marginTop: 6 }}>{err}</div>}
      {data.rows.map(r => (
        <div key={r.pledgeId} style={{ ...rowStyle, alignItems: "flex-start" }} data-testid="dh-pledge-date">
          <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 13 }}>
            <div style={{ color: T.ink, fontWeight: 700 }}>{r.name} · ${r.amount.toLocaleString("en-US")} at {r.eventName}</div>
            <div style={{ color: T.ink3 }}>Now: {dates(r.installments.map(i => i.before))}</div>
            <div style={{ color: T.ink, fontWeight: 700 }}>Moved: {dates(r.installments.map(i => i.after))}</div>
          </div>
          <button style={btn(false, busy || isReadOnly)} disabled={busy || isReadOnly} onClick={() => apply([r.pledgeId])}>Move</button>
        </div>
      ))}
    </Card>
  );
}

// ── FIX-59 · names with markup or a note in them ───────────────────────────
function NamesPanel({ onDone, onOpenDonor, isReadOnly }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [batch, setBatch] = useState(null);
  const load = () => apiFetch("/data-health/names").then(setData).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const call = async (path, body, after) => {
    setBusy(true); setErr(null);
    try { const r = await apiFetch(path, { method: "POST", body: JSON.stringify(body) }); after(r); load(); onDone(r.sentence); }
    catch (e) { setErr(e.sentence || e.message); }
    finally { setBusy(false); }
  };
  if (!data) return <Card>{err ? `Couldn't load the names. ${err}` : "Reading names…"}</Card>;
  const all = data.rows.map(r => r.donorId);
  return (
    <Card data-testid="dh-names">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{data.sentence}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {batch && <button data-testid="dh-names-undo" style={btn(false, busy || isReadOnly)} disabled={busy || isReadOnly} onClick={() => call("/data-health/names/undo", { batchId: batch }, () => setBatch(null))}>Undo</button>}
          <button data-testid="dh-names-apply" style={btn(true, busy || isReadOnly || !all.length)} disabled={busy || isReadOnly || !all.length} onClick={() => call("/data-health/names/apply", { donorIds: all }, r => setBatch(r.batchId))}>Clean all {all.length}</button>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>The name keeps only the name. A note in brackets moves to the person's Notes, word for word.</div>
      {err && <div role="alert" style={{ fontSize: 13, color: T.ink, marginTop: 6 }}>{err}</div>}
      {data.rows.map(r => (
        <div key={r.donorId} style={{ ...rowStyle, alignItems: "flex-start" }} data-testid="dh-name">
          <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 13 }}>
            <div style={{ color: T.ink3 }}>Now: <button style={linkBtn} onClick={() => onOpenDonor && onOpenDonor(r.donorId)}>{r.before}</button></div>
            <div style={{ color: T.ink, fontWeight: 700 }}>Cleaned: {r.after}{r.notes.length ? ` · to Notes: ${r.notes.join("; ")}` : ""}</div>
          </div>
          <button style={btn(false, busy || isReadOnly)} disabled={busy || isReadOnly} onClick={() => call("/data-health/names/apply", { donorIds: [r.donorId] }, x => setBatch(x.batchId))}>Clean</button>
        </div>
      ))}
    </Card>
  );
}

// ── POLISH-4 · people and their businesses ─────────────────────────────────
function BusinessesPanel({ onDone, onOpenDonor, isReadOnly }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [made, setMade] = useState(null);
  const [shown, setShown] = useState(PAGE);
  const load = (limit = shown) => apiFetch(`/data-health/businesses?limit=${limit}`).then(setData).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const link = async f => {
    try { const r = await apiFetch("/data-health/businesses/link", { method: "POST", body: JSON.stringify({ a: f.a, b: f.b }) }); setMade(r.id); load(); onDone(r.sentence); }
    catch (e) { setErr(e.sentence || e.error || e.message); }
  };
  const undoLink = async () => {
    try { await apiFetch(`/donor-relationships/${encodeURIComponent(made)}`, { method: "DELETE" }); setMade(null); load(); onDone("Undone. The link is gone and both are as they were."); }
    catch (e) { setErr(e.sentence || e.error || e.message); }
  };
  const notLinked = async f => {
    try { await apiFetch("/data-health/businesses/dismiss", { method: "POST", body: JSON.stringify({ a: f.a, b: f.b }) }); load(); onDone(`${f.person.name} and ${f.business.name} won't be suggested again.`); }
    catch (e) { setErr(e.sentence || e.message); }
  };
  if (!data) return <Card>{err ? `Couldn't load the suggestions. ${err}` : "Reading people and organizations…"}</Card>;
  return (
    <Card data-testid="dh-businesses">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{data.sentence}</div>
        {made && <button data-testid="dh-business-undo" style={btn(false, isReadOnly)} disabled={isReadOnly} onClick={undoLink}>Undo</button>}
      </div>
      {err && <div role="alert" style={{ fontSize: 13, color: T.ink, marginTop: 6 }}>{err}</div>}
      {data.rows.map(f => (
        <div key={f.key} style={rowStyle} data-testid="dh-business">
          <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 14, color: T.ink }}>
            <button style={linkBtn} onClick={() => onOpenDonor && onOpenDonor(f.a)}>{f.person.name}</button>
            <span style={{ color: T.ink3 }}> and </span>
            <button style={linkBtn} onClick={() => onOpenDonor && onOpenDonor(f.b)}>{f.business.name}</button>
            <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 3 }}>{cap(f.reasons.join("; "))}.</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button data-testid="dh-business-link" style={btn(true, isReadOnly)} disabled={isReadOnly} onClick={() => link(f)}>Link: gives through</button>
            <button style={btn(false, isReadOnly)} disabled={isReadOnly} onClick={() => notLinked(f)}>Not linked</button>
          </div>
        </div>
      ))}
      {data.rows.length < (data.total ?? data.rows.length) && <button style={{ ...btn(false), marginTop: 12 }}
        onClick={() => { const n = shown + PAGE; setShown(n); load(n); }}>
        Show {Math.min(PAGE, data.total - data.rows.length)} more of {data.total.toLocaleString("en-US")}</button>}
    </Card>
  );
}

// ── FIX-59 · possible families (never duplicates) ──────────────────────────
function FamiliesPanel({ onDone, onOpenDonor, isReadOnly }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [made, setMade] = useState(null);
  const [shown, setShown] = useState(PAGE);
  const load = (limit = shown) => apiFetch(`/data-health/families?limit=${limit}`).then(setData).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const link = async f => {
    try {
      const h = await apiFetch("/households", { method: "POST", body: JSON.stringify({ memberIds: [f.a, f.b], primaryDonorId: f.a }) });
      setMade(h && (h.id || (h.household && h.household.id)) || null); load();
      onDone(`${f.left.name} and ${f.right.name} are one household now.`);
    } catch (e) { setErr(e.sentence || e.error || e.message); }
  };
  const undoLink = async () => {
    try { await apiFetch(`/households/${encodeURIComponent(made)}`, { method: "DELETE" }); setMade(null); load(); onDone("Undone. The household is gone and both people are as they were."); }
    catch (e) { setErr(e.sentence || e.error || e.message); }
  };
  const notFamily = async f => {
    try { await apiFetch("/data-health/families/dismiss", { method: "POST", body: JSON.stringify({ a: f.a, b: f.b }) }); load(); onDone(`${f.left.name} and ${f.right.name} won't be suggested as a family again.`); }
    catch (e) { setErr(e.sentence || e.message); }
  };
  if (!data) return <Card>{err ? `Couldn't load the families. ${err}` : "Reading families…"}</Card>;
  return (
    <Card data-testid="dh-families">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{data.sentence}</div>
        {made && <button style={btn(false, isReadOnly)} disabled={isReadOnly} onClick={undoLink}>Undo</button>}
      </div>
      {err && <div role="alert" style={{ fontSize: 13, color: T.ink, marginTop: 6 }}>{err}</div>}
      {data.rows.map(f => (
        <div key={f.key} style={rowStyle} data-testid="dh-family">
          <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 14, color: T.ink }}>
            <button style={linkBtn} onClick={() => onOpenDonor && onOpenDonor(f.a)}>{f.left.name}</button>
            <span style={{ color: T.ink3 }}> and </span>
            <button style={linkBtn} onClick={() => onOpenDonor && onOpenDonor(f.b)}>{f.right.name}</button>
            <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 3 }}>{cap(f.reasons.join("; "))}.</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btn(true, isReadOnly)} disabled={isReadOnly} onClick={() => link(f)}>Make one household</button>
            <button style={btn(false, isReadOnly)} disabled={isReadOnly} onClick={() => notFamily(f)}>Not a family</button>
          </div>
        </div>
      ))}
      {data.rows.length < (data.total ?? data.rows.length) && <button data-testid="dh-families-more" style={{ ...btn(false), marginTop: 12 }}
        onClick={() => { const n = shown + PAGE; setShown(n); load(n); }}>
        Show {Math.min(PAGE, data.total - data.rows.length)} more of {data.total.toLocaleString("en-US")}</button>}
    </Card>
  );
}

// ── FIX-59 · two spellings of one person on one event's list ───────────────
function EventPairsPanel({ eventId, onDone, onOpenDonor, isReadOnly }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);
  const load = () => apiFetch(`/data-health/event-pairs?eventId=${encodeURIComponent(eventId)}`).then(r => setRows(r.rows)).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const answer = async (p, a) => {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch("/data-health/event-pairs/answer", { method: "POST", body: JSON.stringify({ a: p.a, b: p.b, answer: a }) });
      setLast({ ...p, answer: a, mergeId: r.mergeId || null }); load(); onDone(r.sentence);
    } catch (e) { setErr(e.sentence || e.message); }
    finally { setBusy(false); }
  };
  const undo = async () => {
    setBusy(true); setErr(null);
    try {
      if (last.mergeId) await apiFetch(`/data-health/merges/${last.mergeId}/undo`, { method: "POST", body: "{}" });
      else await apiFetch("/data-health/pairs/undismiss", { method: "POST", body: JSON.stringify({ a: last.a, b: last.b }) });
      setLast(null); load(); onDone(`Undone. ${last.question} is asked again.`);
    } catch (e) { setErr(e.sentence || e.message); }
    finally { setBusy(false); }
  };
  if (!rows) return <Card>{err ? `Couldn't load the pairs. ${err}` : "Reading the list…"}</Card>;
  return (
    <Card data-testid="dh-event-pairs">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{rows.length ? `${plural(rows.length, "possible duplicate")} within ${rows[0].eventName}` : "Nothing left to answer on this list."}</div>
        {last && <button style={btn(false, busy || isReadOnly)} disabled={busy || isReadOnly} onClick={undo}>Undo</button>}
      </div>
      <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>Same person merges the two records (it can be undone for 30 days). Different is remembered, so it isn't asked again.</div>
      {err && <div role="alert" style={{ fontSize: 13, color: T.ink, marginTop: 6 }}>{err}</div>}
      {rows.map(p => (
        <div key={p.key} style={rowStyle} data-testid="dh-event-pair">
          <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 14, color: T.ink }}>
            Is <button style={linkBtn} onClick={() => onOpenDonor && onOpenDonor(p.a)}>{p.left.name}</button> the same as <button style={linkBtn} onClick={() => onOpenDonor && onOpenDonor(p.b)}>{p.right.name}</button>?
            <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 3 }}>{cap(p.sentence)}.</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btn(true, busy || isReadOnly)} disabled={busy || isReadOnly} onClick={() => answer(p, "same")}>Same person</button>
            <button style={btn(false, busy || isReadOnly)} disabled={busy || isReadOnly} onClick={() => answer(p, "different")}>Different</button>
          </div>
        </div>
      ))}
    </Card>
  );
}

// ── People who moved (NCOA) ────────────────────────────────────────────────
// FIX-25 · THE SAMPLE RESULTS FILE, for a demo org only. It is the file
// Steward prepares, answered the way a provider answers it: most people not
// moved, a few moved with a new address, two moved and left none. It goes in
// through the same import as a real provider's file, so the demo shows the
// whole flow without a vendor. The picks are by row position, never random,
// so every run of the demo reads the same.
function readCsvRows(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ""));
}
const csvOut = v => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const SAMPLE_NEW = [["41 Harbor View Rd", "Portland", "ME", "04101"], ["9 Common St", "Newburyport", "MA", "01950"], ["220 Pleasant St", "Concord", "NH", "03301"],
  ["17 Orchard Ln", "Ipswich", "MA", "01938"], ["5 Elm Ct", "Providence", "RI", "02906"], ["88 Lake Ave", "Burlington", "VT", "05401"]];
function sampleNcoaReturn(prepared) {
  const rows = readCsvRows(prepared).slice(1);
  const out = [["Record ID", "Full Name", "NCOA Return Code", "Move Type", "Move Effective Date", "New Address Line 1", "New Address Line 2", "New City", "New State", "New ZIP Code"]];
  const step = Math.max(1, Math.floor(rows.length / 8));
  rows.forEach((r, i) => {
    const slot = i % step === 0 ? i / step : -1;
    const n = slot >= 0 && slot < SAMPLE_NEW.length ? SAMPLE_NEW[slot] : null;
    if (n) out.push([r[0], r[1], "A", slot % 3 === 1 ? "F" : "I", `2026${String(4 + slot).padStart(2, "0")}`, n[0], "", n[1], n[2], n[3]]);
    else if (slot === SAMPLE_NEW.length || slot === SAMPLE_NEW.length + 1) out.push([r[0], r[1], "02", "I", "202607", "", "", "", "", ""]);
    else out.push([r[0], r[1], "", "", "", "", "", "", "", ""]);
  });
  return out.map(r => r.map(csvOut).join(",")).join("\r\n") + "\r\n";
}

function MovedPanel({ onDone, isReadOnly, note, demo = false }) {
  const [moves, setMoves] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => apiFetch("/data-health/ncoa/moves").then(r => { setMoves(r.moves); setSel(new Set()); }).catch(e => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const download = async () => {
    const r = await fetch(`${API}/data-health/ncoa/file`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!r.ok) { setMsg("The file couldn't be prepared."); return; }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `address-update-file-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setMsg(`File prepared with ${plural(Number(r.headers.get("X-Row-Count") || 0), "mailable address", "mailable addresses")}. Send it to your provider, then bring their results back here.`);
  };
  const fileInput = useRef(null);
  const importText = async (filename, text) => {
    const r = await apiFetch("/data-health/ncoa/results", { method: "POST", body: JSON.stringify({ filename, text }) });
    setMsg(r.sentence); load(); onDone(r.sentence);
  };
  const bringIn = async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    try { await importText(f.name, await f.text()); }
    catch (err) { setMsg(err.sentence || err.message); }
    finally { setBusy(false); }
  };
  const useSample = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API}/data-health/ncoa/file`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!r.ok) throw new Error("The sample file couldn't be made.");
      await importText("sample-change-of-address-results.csv", sampleNcoaReturn(await r.text()));
    } catch (err) { setMsg(err.sentence || err.message); }
    finally { setBusy(false); }
  };
  const apply = async ids => {
    setBusy(true);
    try { const r = await apiFetch("/data-health/ncoa/apply", { method: "POST", body: JSON.stringify({ ids }) }); setMoves(ms => (ms || []).filter(m => !ids.includes(m.id))); setSel(new Set()); load(); onDone(`${plural(r.applied, "change of address", "changes of address")} approved. Each old address is kept in the person's history and their timeline says so.`); }
    catch (err) { setMsg(err.sentence || err.message); }
    finally { setBusy(false); }
  };
  const skip = async ids => { try { await apiFetch("/data-health/ncoa/dismiss", { method: "POST", body: JSON.stringify({ ids }) }); load(); } catch (err) { setMsg(err.message); } };
  const TYPE = { person: "a person", family: "a family", business: "a business" };
  return (
    <Card data-testid="dh-moved">
      <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>People who moved</div>
      <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>{note}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button style={btn(false)} onClick={download}>Prepare an address update file</button>
        {/* FIX-25: a real button. It was a label wrapping a hidden input, which
            read as plain text, could not be reached by keyboard and was not a
            control to anything reading the page. */}
        <button type="button" style={btn(true, busy || isReadOnly)} disabled={busy || isReadOnly} data-testid="dh-ncoa-bring"
          onClick={() => fileInput.current && fileInput.current.click()}>{busy ? "Reading…" : "Bring in the results"}</button>
        <input ref={fileInput} type="file" accept=".csv,text/csv,.txt" onChange={bringIn} disabled={busy || isReadOnly} style={{ display: "none" }} data-testid="dh-ncoa-input" />
        {demo && <button type="button" style={btn(false, busy || isReadOnly)} disabled={busy || isReadOnly} data-testid="dh-ncoa-sample" onClick={useSample}>Use the sample results file</button>}
      </div>
      {demo && <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 6 }}>This is a demo organization, so no provider is involved. The sample file answers the way a provider would, using the people on file here.</div>}
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink, marginTop: 8 }}>{msg}</div>}
      {moves && moves.length > 0 && <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>{plural(moves.length, "move")} waiting</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btn(false, busy || isReadOnly || !sel.size)} disabled={busy || isReadOnly || !sel.size} onClick={() => apply([...sel])}>Approve selected ({sel.size})</button>
            <button style={btn(true, busy || isReadOnly)} disabled={busy || isReadOnly} onClick={() => apply(moves.map(m => m.id))}>Approve all {moves.length}</button>
          </div>
        </div>
        {moves.map(m => (
          <label key={m.id} style={{ ...rowStyle, alignItems: "flex-start", cursor: "pointer" }} data-testid="dh-move">
            <input type="checkbox" checked={sel.has(m.id)} onChange={e => setSel(s => { const n = new Set(s); e.target.checked ? n.add(m.id) : n.delete(m.id); return n; })} style={{ marginTop: 3 }} />
            <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 13 }}>
              <div style={{ fontWeight: 700, color: T.ink }}>{m.name}{m.move_type ? <span style={{ fontWeight: 400, color: T.ink3 }}> · moved as {TYPE[m.move_type] || m.move_type}</span> : null}{m.move_date ? <span style={{ fontWeight: 400, color: T.ink3 }}> · {displayDate(m.move_date)}</span> : null}</div>
              <div style={{ color: T.ink3, overflowWrap: "anywhere" }}>Old: {m.oldLine}</div>
              <div style={{ color: T.ink, overflowWrap: "anywhere" }}>{m.kind === "move" ? `New: ${m.newLine}` : `No forwarding address (${m.words}). Approving marks the address not mailable and keeps it on file.`}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={btn(false, isReadOnly)} disabled={isReadOnly} onClick={e => { e.preventDefault(); apply([m.id]); }}>Approve</button>
              <button style={btn(false, isReadOnly)} disabled={isReadOnly} onClick={e => { e.preventDefault(); skip([m.id]); }}>Skip</button>
            </div>
          </label>
        ))}
      </>}
    </Card>
  );
}

// ── Emails ─────────────────────────────────────────────────────────────────
function EmailRow({ r, onSaved, onOpenDonor, isReadOnly }) {
  const suggestion = (r.issues.find(i => i.suggestion) || {}).suggestion || "";
  const [val, setVal] = useState(suggestion || r.email);
  const [confirmBounce, setConfirmBounce] = useState(false);
  const [err, setErr] = useState(null);
  const save = async email => {
    setErr(null);
    try {
      const res = await apiFetch("/data-health/emails/fix", { method: "POST", body: JSON.stringify({ donorId: r.donorId, email }) });
      if (res.stillMarkedBounced) setConfirmBounce(true); else onSaved(`${r.name}'s email is now ${email}.`);
    } catch (e) { setErr(e.sentence || e.message); }
  };
  const clear = async () => { try { await apiFetch("/data-health/emails/clear-bounce", { method: "POST", body: JSON.stringify({ donorId: r.donorId, confirm: true }) }); onSaved(`${r.name}'s new address is confirmed and the bounce mark is cleared.`); } catch (e) { setErr(e.sentence || e.message); } };
  const fine = async kind => { try { await apiFetch("/data-health/emails/dismiss", { method: "POST", body: JSON.stringify({ donorId: r.donorId, kind }) }); onSaved(`${r.name}'s email is left as it is.`); } catch (e) { setErr(e.message); } };
  const dismissable = r.issues.find(i => i.kind === "role" || i.kind === "typo");
  return (
    <div style={{ ...rowStyle, alignItems: "flex-start" }} data-testid="dh-email">
      <div style={{ flex: "1 1 240px", minWidth: 0, fontSize: 13 }}>
        <button style={linkBtn} onClick={() => onOpenDonor && onOpenDonor(r.donorId)}>{r.name}</button>
        <div style={{ color: T.ink, overflowWrap: "anywhere" }}>{r.email}</div>
        <div style={{ color: T.ink3 }}>{r.issues.map(i => i.words).join("; ")}.</div>
        {err && <div role="alert" style={{ color: T.ink }}>{err}</div>}
      </div>
      {confirmBounce ? (
        <div style={{ flex: "1 1 260px", fontSize: 13, color: T.ink }}>
          Saved. Mail to the old address bounced. Is the new one right?
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            <button style={btn(true, isReadOnly)} disabled={isReadOnly} onClick={clear}>Yes, clear the bounce mark</button>
            <button style={btn(false)} onClick={() => onSaved(`${r.name}'s email is saved; the bounce mark stays.`)}>Not yet</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: "1 1 300px" }}>
          <input value={val} onChange={e => setVal(e.target.value)} aria-label={`New email for ${r.name}`}
            style={{ flex: "1 1 180px", minWidth: 0, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink }} />
          <button style={btn(true, isReadOnly || !val.trim() || val.trim() === r.email)} disabled={isReadOnly || !val.trim() || val.trim() === r.email} onClick={() => save(val.trim())}>{suggestion && val === suggestion ? "Use this" : "Save"}</button>
          {dismissable && <button style={btn(false, isReadOnly)} disabled={isReadOnly} onClick={() => fine(dismissable.kind)}>It's right</button>}
        </div>
      )}
    </div>
  );
}
function EmailsPanel({ onDone, onOpenDonor, isReadOnly }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => apiFetch("/data-health/emails").then(r => setRows(r.rows)).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (!rows) return <Card>{err ? `Couldn't load the emails. ${err}` : "Checking emails…"}</Card>;
  return (
    <Card data-testid="dh-emails">
      <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{plural(rows.length, "email")} to look at</div>
      <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>A suggested fix is filled in where one is obvious. Nothing changes until you save it, and a bounce mark stays until you confirm the new address.</div>
      {rows.map(r => <EmailRow key={r.donorId + r.email} r={r} onOpenDonor={onOpenDonor} isReadOnly={isReadOnly} onSaved={m => { load(); onDone(m); }} />)}
    </Card>
  );
}

function UnreachablePanel({ onOpenDonor }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { apiFetch("/data-health/unreachable").then(r => setRows(r.rows)).catch(() => setRows([])); }, []);
  if (!rows) return <Card>Finding them…</Card>;
  return (
    <Card data-testid="dh-unreachable">
      <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{plural(rows.length, "person", "people")} with no way to reach them</div>
      <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>Open a person to add an email, a phone or an address.</div>
      {rows.map(r => (
        <div key={r.donorId} style={{ ...rowStyle, padding: "8px 0" }}>
          <button style={linkBtn} onClick={() => onOpenDonor && onOpenDonor(r.donorId)}>{r.name}</button>
          <span style={{ fontSize: 12.5, color: T.ink3 }}>{r.why}</span>
        </div>
      ))}
    </Card>
  );
}

// INTEGRITY-1: the rows behind "One email on two people" and "the same gifts"
function IntegrityPanel({ kind, onOpenDonor }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { setRows(null); apiFetch(kind === "sharedEmails" ? "/data-health/shared-emails" : "/data-health/identical-gifts").then(r => setRows(r.rows)).catch(() => setRows([])); }, [kind]);
  if (!rows) return <Card>Finding them…</Card>;
  const who = (id, name) => <button key={id} style={linkBtn} onClick={() => onOpenDonor && onOpenDonor(id)}>{name || "A person with no name"}</button>;
  return (
    <Card data-testid={`dh-${kind}`}>
      <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{kind === "sharedEmails" ? `${plural(rows.length, "email")} on more than one person` : `${plural(rows.length, "pair")} with the same gifts`}</div>
      <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>Open a person to change their email, or merge the two from Possible duplicates.</div>
      {rows.map(r => kind === "sharedEmails" ? (
        <div key={r.email} style={{ ...rowStyle, padding: "8px 0", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: T.ink3 }}>{r.email}</span>{r.people.map(p => who(p.id, p.name))}
        </div>
      ) : (
        <div key={`${r.a}:${r.b}`} style={{ ...rowStyle, padding: "8px 0", gap: 8, flexWrap: "wrap" }}>
          {who(r.a, r.a_name)}<span style={{ fontSize: 12.5, color: T.ink3 }}>and</span>{who(r.b, r.b_name)}
          <span style={{ fontSize: 12.5, color: T.ink3 }}>({r.how}): {plural(r.gifts, "gift")} each, the same dates and amounts</span>
        </div>
      ))}
    </Card>
  );
}
