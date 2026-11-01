// shared/numbers/events.js · EVENTS-3. AN EVENT COUNTS THE WAY THE GUEST LIST DOES.
//
// Justin's Place's Finding Joy list has 443 rows, and a couple who came
// together is one row. Steward counted each person in a couple, so the event
// page said 252 came where her own spreadsheet said 172. FIX-60 decided: an
// event's figures count PARTIES (giving units), as the rest of Steward counts
// donors, and say the PEOPLE beside them: "172 came · 252 people".
//
//   A party   a household once (`COALESCE(household_id, donor id)`), a person on
//             their own, or a walk-in typed at the door with no person record
//             (keyed by their guest row). Named the way the household reads
//             ("Kim and Robby King"); a party of one reads as that person.
//   People    the distinct persons under the parties that a list counts.
//
// Every list has a rule for its party and a rule for each person under it:
//   invited        on the list (a cancelled row is not)        · each person on it
//   registered     anyone in it said yes or came                · each who did
//   came           anyone in it came (or was checked in)        · each who came
//   cameGave       came, and the party gave                     · each who came
//   cameNoGift     came, and the party did not give             · each who came
//   saidYes        said yes and nobody in it came               · each who said yes
//   declined       on the list, nobody said yes, someone declined · each who declined
//   noReply        on the list, nobody answered                 · each on the list
//   gave           a gift for the event or a pledge made at it, by anyone in it
//                                                                · each who gave, and each who came
//   gaveNotCame    gave, and nobody in it came                  · each who gave
//   gaveNotInvited gave, and nobody in it was on the list       · each who gave
// So, in parties: Invited = Registered + Declined + No reply; Registered =
// Came + Said yes; Came = Came and gave + Came, didn't give; Gave = Came and
// gave + Gave, didn't come. Money is not here: it stays numbers.eventsRaised.
//
// The event page, After the event, the Events list, Home (Grow and the week's
// event), Fundraising, Ask and Atlas, Reports and the event-* figure sources
// read eventFigures(); none of them counts a guest on its own.
"use strict";
const { MONEY, LIVE } = require("./money");

// ── The SQL predicates (moved here from figureSources.js) ────────────────
// A gift is for an event when it is stamped with it, or (unstamped) carries
// its campaign or its name. A credit row and a deleted person's gift are not.
const EVENT_GIFT_MATCH = (g = "g", e = "e") =>
  `(${g}.event_id = ${e}.id
     OR (${g}.event_id IS NULL AND ${e}.campaign_id IS NOT NULL AND ${g}.campaign_id = ${e}.campaign_id)
     OR (${g}.event_id IS NULL AND ${e}.campaign_id IS NULL AND ${g}.campaign = ${e}.name))
   AND ${MONEY(g)}
   AND NOT EXISTS (SELECT 1 FROM donors dx WHERE dx.id = ${g}.donor_id AND dx.org_id = ${g}.org_id AND dx.deleted_at IS NOT NULL)`;
const EVENT_GUEST_LIVE = (a = "a") =>
  `NOT EXISTS (SELECT 1 FROM donors dx WHERE dx.id = ${a}.donor_id AND dx.org_id = ${a}.org_id AND dx.deleted_at IS NOT NULL)`;
const EVENT_INVITED = (a = "a") => `COALESCE(${a}.status, 'invited') NOT IN ('cancelled','canceled')`;
const EVENT_DECLINED = (a = "a") => `${a}.status = 'declined'`;
const EVENT_CAME = (a = "a") => `(${a}.status = 'attended' OR (${a}.checked_in_at IS NOT NULL AND COALESCE(${a}.status, 'invited') NOT IN ('cancelled','canceled','declined')))`;
const EVENT_REGISTERED_STATUSES = ["registered", "confirmed", "attended", "no_show"];
const EVENT_REGISTERED = (a = "a") => `(${a}.status IN (${EVENT_REGISTERED_STATUSES.map(x => `'${x}'`).join(",")}) OR ${EVENT_CAME(a)})`;
const EVENT_NO_REPLY = (a = "a") => `(${EVENT_INVITED(a)} AND NOT ${EVENT_REGISTERED(a)} AND NOT ${EVENT_DECLINED(a)})`;
// A person `d` gave to event `e` (their own gift above zero, or a pledge made
// there), or, with household, anyone in their household did. groups.js and the
// journeys' audience read it for "event guests who gave".
const EVENT_GUEST_GAVE = (d = "d", e = "e", household = true) => {
  const who = (x) => household ? `(${x}.id = ${d}.id OR (${d}.household_id IS NOT NULL AND ${x}.household_id = ${d}.household_id))` : `${x}.id = ${d}.id`;
  return `(EXISTS (SELECT 1 FROM gifts g JOIN donors gd ON gd.id = g.donor_id AND gd.org_id = g.org_id
             WHERE g.org_id = ${e}.org_id AND g.amount > 0 AND ${EVENT_GIFT_MATCH("g", e)}
               AND ${who("gd")})
    OR EXISTS (SELECT 1 FROM pledges p JOIN donors pd ON pd.id = p.donor_id AND pd.org_id = p.org_id
                WHERE p.org_id = ${e}.org_id AND p.event_id = ${e}.id AND p.status <> 'cancelled' AND pd.deleted_at IS NULL
                  AND ${who("pd")}))`;
};
// The party a guest row or a person belongs to.
const PARTY = (d = "d", a = "a") => `COALESCE(${d}.household_id, ${d}.id${a ? `, ${a}.id` : ""})`;

// ── The one sentence for each list ───────────────────────────────────────
const ONCE = "A household is one party, its people listed under it.";
const EVENT_GUEST_WORDS = {
  invited: `Every party on the event's list, once, whatever they answered. ${ONCE} A cancelled row is not on the list.`,
  registered: `Each party in which someone said they were coming or came, once. ${ONCE} Declined and no reply are not counted.`,
  attended: `Each party in which someone was marked as having come, or was checked in at the door, once. ${ONCE} Nobody is counted until somebody said they came.`,
  declined: `Each party on the event's list that said it would not come, with nobody in it saying yes. ${ONCE}`,
  noReply: `Each party on the event's list with no answer: Invited less Registered less Declined. ${ONCE}`,
  cameNoGift: `Each party that came, with no gift or pledge tied to this event for anyone in it. ${ONCE}`,
  cameGave: `Each party that came, with a gift or pledge tied to this event for someone in it. ${ONCE}`,
  invitedNoShow: `Each party that said it was coming and was not marked as having come: Registered less Came. Shown once the event's day has passed. ${ONCE}`,
  saidYes: `Each party that said it was coming and was not marked as having come yet. ${ONCE}`,
  gave: `Each party with a gift for this event or a pledge made at it, once. ${ONCE}`,
  gaveNotCame: `Each party that gave or pledged for this event with nobody in it marked as having come. ${ONCE}`,
  gaveNotInvited: `Each party that gave or pledged for this event with nobody in it on the event's list. ${ONCE}`,
};
EVENT_GUEST_WORDS.came = EVENT_GUEST_WORDS.attended;
const LIST_KEYS = ["invited", "registered", "came", "cameGave", "cameNoGift", "saidYes", "invitedNoShow", "declined", "noReply", "gave", "gaveNotCame", "gaveNotInvited"];

// ── A party's name, the way the household reads ─────────────────────────
// One person: their name. Two or more sharing a last name: "Kim and Robby
// King"; otherwise each full name: "Kim King and Robby Jones". The order is
// the household's own name's order where it has one ("Ulla & Grady ...").
function partyName(people, householdName) {
  if (!people.length) return "";
  if (people.length === 1) return people[0].name;
  const hh = String(householdName || "");
  const split = n => { const s = String(n || "").trim(); const i = s.lastIndexOf(" "); return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, ""]; };
  const at = p => { const i = hh.indexOf(split(p.name)[0]); return i < 0 ? Infinity : i; };
  const ps = people.slice().sort((a, b) => at(a) - at(b) || String(a.name).localeCompare(String(b.name)));
  const parts = ps.map(p => split(p.name));
  const last = parts[0][1];
  const same = !!last && parts.every(x => x[1] === last);
  const names = same ? parts.map(x => x[0]) : ps.map(p => p.name);
  const joined = names.length === 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return same ? `${joined} ${last}` : joined;
}

// ── eventFigures: every event's lists, by party, with the people under each ─
//   opts.ids        only these events
//   opts.from/to    only events dated in this window (civil days)
//   opts.asOf       the org's today, for "has the event's day passed"
async function eventFigures(query, orgId, { ids = null, from = null, to = null, asOf = null } = {}) {
  const args = [orgId];
  let where = "";
  if (ids) { where += " AND e.id = ANY(?)"; args.push(ids); }
  if (from) { where += " AND LEFT(e.date::text, 10) >= ?"; args.push(from); }
  if (to) { where += " AND LEFT(e.date::text, 10) <= ?"; args.push(to); }
  const [events, guests, givers] = await Promise.all([
    query(`SELECT e.id, e.name, LEFT(e.date::text, 10) AS date, e.date_unknown FROM events e WHERE e.org_id = ?${where}`, args),
    // each person on each list once, at their best answer (came, said yes, declined)
    query(`SELECT DISTINCT ON (e.id, COALESCE(d.id, a.id)) e.id AS event_id, COALESCE(d.id, a.id) AS person_id, d.id AS donor_id,
                  COALESCE(d.name, a.name) AS name, ${PARTY("d", "a")} AS party_id, h.name AS household_name,
                  ${EVENT_CAME("a")} AS came, ${EVENT_REGISTERED("a")} AS registered, ${EVENT_DECLINED("a")} AS declined
             FROM event_attendees a
             JOIN events e ON e.id = a.event_id AND e.org_id = a.org_id
             LEFT JOIN donors d ON d.id = a.donor_id AND d.org_id = a.org_id
             LEFT JOIN households h ON h.id = d.household_id AND h.org_id = d.org_id
            WHERE a.org_id = ? AND ${EVENT_INVITED("a")} AND ${EVENT_GUEST_LIVE("a")}${where}
            ORDER BY e.id, COALESCE(d.id, a.id), ${EVENT_CAME("a")} DESC, ${EVENT_REGISTERED("a")} DESC, ${EVENT_DECLINED("a")} DESC`, args),
    // each person with their own gift for the event (above zero) or a pledge made at it
    query(`SELECT DISTINCT x.event_id, d.id AS person_id, d.name, ${PARTY("d", null)} AS party_id, h.name AS household_name
             FROM (SELECT e.id AS event_id, g.donor_id FROM events e JOIN gifts g ON g.org_id = e.org_id AND g.amount > 0 AND ${EVENT_GIFT_MATCH("g", "e")}
                    WHERE e.org_id = ?${where}
                   UNION
                   SELECT e.id, p.donor_id FROM events e JOIN pledges p ON p.org_id = e.org_id AND p.event_id = e.id AND p.status <> 'cancelled'
                    WHERE e.org_id = ?${where}) x
             JOIN donors d ON d.id = x.donor_id AND d.org_id = ? AND ${LIVE("d")}
             LEFT JOIN households h ON h.id = d.household_id AND h.org_id = d.org_id`, [...args, ...args, orgId]),
  ]);
  const byEvent = new Map(events.map(e => [e.id, { ev: e, parties: new Map() }]));
  const partyOf = (slot, r) => slot.parties.get(r.party_id) || slot.parties.set(r.party_id,
    { id: r.party_id, householdName: r.household_name || null, members: new Map() }).get(r.party_id);
  const member = (party, r) => party.members.get(r.person_id) || party.members.set(r.person_id,
    { id: r.person_id, name: r.name, noRecord: !r.donor_id, onList: false, came: false, registered: false, declined: false, gave: false }).get(r.person_id);
  for (const r of guests) {
    const slot = byEvent.get(r.event_id); if (!slot) continue;
    Object.assign(member(partyOf(slot, r), r), { onList: true, came: !!r.came, registered: !!r.registered, declined: !!r.declined });
  }
  for (const r of givers) {
    const slot = byEvent.get(r.event_id); if (!slot) continue;
    member(partyOf(slot, { ...r, donor_id: r.person_id }), { ...r, donor_id: r.person_id }).gave = true;
  }
  const byName = (a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id));
  return events.map(e => {
    const past = !!(e.date_unknown || !asOf || e.date <= asOf);
    const lists = Object.fromEntries(LIST_KEYS.map(k => [k, []]));
    for (const p of byEvent.get(e.id).parties.values()) {
      const ms = [...p.members.values()];
      const any = f => ms.some(f);
      const onList = any(m => m.onList), came = any(m => m.came), registered = any(m => m.registered), gave = any(m => m.gave);
      const put = (k, keep) => {
        const people = ms.filter(keep).map(m => ({ id: m.id, name: m.name, ...(m.noRecord ? { noRecord: true } : {}) })).sort(byName);
        const withRecord = people.find(x => !x.noRecord);
        lists[k].push({ id: p.id, name: partyName(people, p.householdName), people, donorId: withRecord ? withRecord.id : null,
          ...(withRecord ? {} : { noRecord: true }) });
      };
      if (onList) {
        put("invited", m => m.onList);
        if (registered) put("registered", m => m.registered);
        if (came) { put("came", m => m.came); put(gave ? "cameGave" : "cameNoGift", m => m.came); }
        else if (registered) { put("saidYes", m => m.registered); if (past) put("invitedNoShow", m => m.registered); }
        else if (any(m => m.declined)) put("declined", m => m.declined);
        else put("noReply", m => m.onList);
      }
      if (gave) {
        put("gave", m => m.gave || m.came);
        if (!came) put("gaveNotCame", m => m.gave);
        if (!onList) put("gaveNotInvited", m => m.gave);
      }
    }
    for (const k of LIST_KEYS) lists[k].sort(byName);
    const counts = Object.fromEntries(LIST_KEYS.map(k => [k, {
      parties: lists[k].length, people: lists[k].reduce((n, p) => n + p.people.length, 0) }]));
    return {
      id: e.id, name: e.name, date: e.date_unknown ? null : e.date, past, lists, counts, definitions: EVENT_GUEST_WORDS,
      // the shape the screens read: each list's parties, and the three totals in parties
      cameGave: lists.cameGave, cameNoGift: lists.cameNoGift, saidYes: lists.saidYes, notYet: lists.saidYes,
      declined: lists.declined, noReply: lists.noReply, invitedNoShow: lists.invitedNoShow,
      came: counts.came.parties, registered: counts.registered.parties, invited: counts.invited.parties,
    };
  });
}

// One list as figure rows: a row per party, its people under it.
function partyRows(ev, list) {
  return ((ev && ev.lists[list]) || []).map(p => ({
    id: p.id, type: p.people.length > 1 ? "party" : "person", donor_id: p.donorId, name: p.name,
    date: ev.date, amount: null, detail: p.people.length > 1 ? p.people.map(x => x.name).join(", ") : null, people: p.people,
  }));
}

// "172 came · 252 people": the people beside the parties, when they differ.
function peopleWords(c) {
  if (!c || c.people === c.parties) return null;
  return `${c.people.toLocaleString("en-US")} ${c.people === 1 ? "person" : "people"}`;
}

module.exports = {
  EVENT_GIFT_MATCH, EVENT_GUEST_LIVE, EVENT_INVITED, EVENT_DECLINED, EVENT_CAME, EVENT_REGISTERED_STATUSES, EVENT_REGISTERED,
  EVENT_NO_REPLY, EVENT_GUEST_GAVE, PARTY, EVENT_GUEST_WORDS, LIST_KEYS, partyName, eventFigures, partyRows, peopleWords,
};
