// STALE-1 · ONE REFRESH, EVERYWHERE.
//
// Muse's Walk B (5 Nov 2026): "totals frequently show the old figure until
// reload". An event's Raised said $0 after a $100 event gift, the volunteer
// hours header, a deleted group's card and the Tasks badge all waited for a
// reload. Each past fix gave one page its own refresh (COUNTS-1's
// profileRefresh, taskBadge and eventRows, WALKB-1's writeRev), and every page
// nobody had patched stayed stale.
//
// Now there is one channel. Every change is ANNOUNCED with the KINDS it touched
// (a gift, a pledge, an event, a task...) and the ids it names, and every
// mounted view that shows a figure SUBSCRIBES to the kinds it shows and
// re-reads only for those. Three doors announce:
//   1. every write through api.js, when it lands (kindsOfWrite reads its path
//      and body: POST /donors/d1/gifts {eventId:"e1"} is a gift, the person
//      d1, the event e1, and the org's totals);
//   2. Atlas, Tell Steward, an import and its undo, through VOICE-4's told(),
//      which may have changed anything, so it is every kind;
//   3. the worker. Its after-change step writes on the server, where no path
//      of the browser's names it. The bell already asks GET /atlas/activity
//      every 60 seconds; its answer now carries the org's latest change mark
//      per table (orgSummary's org_changes), and a table that moved since the
//      last answer is announced as its kinds. No request is added.
//
// A view that is not mounted hears nothing and asks for nothing.
import { useEffect, useRef, useState } from "react";

export const KINDS = ["person", "gift", "pledge", "event", "grant", "task", "group", "volunteer", "fund", "totals", "note", "import", "draft"];
const ALL = KINDS;

// ── WHAT A WRITE TOUCHED ─────────────────────────────────────────────────────
// First matching rule wins; a write no rule names is "other", which only the
// kept lists hear (api.js onWrite), so an unnamed write never re-reads a page.
const GIFT = ["gift", "person", "totals", "fund"];
const RULES = [
  // COMMS-1: a draft dismissed, restored, sent, approved or skipped moves every count of drafts waiting.
  [/^\/(drafts|milestone-drafts|thank-yous)\b|^\/agent\/(waiting|drafts?)\b/, ["draft", "task"]],
  [/^\/(atlas|tell|voice|memos?|requests)\b/, ALL],
  [/^\/(imports?|spreadsheet-import|csv|history-import|old-reports)\b|\/undo\b.*import|import.*\/undo\b/, ALL],
  [/^\/donors\/[^/]+\/gifts\b|^\/gifts\b|^\/donations\b|^\/checks?\b|^\/deposits?\b|^\/batches?\b|^\/recurring\b|^\/refunds?\b|^\/soft-credits?\b|^\/ledger\b|^\/finance\b/, GIFT],
  [/^\/pledges?\b|\/pledges?\b/, ["pledge", "gift", "person", "totals"]],
  // STALE-2: a grant's deadlines are tasks too (trg_milestone_task_sync).
  [/^\/grants?\b|^\/funders?\b/, ["grant", "pledge", "gift", "person", "totals", "task"]],
  [/^\/events?\b/, ["event", "person"]],
  [/^\/tasks?\b|^\/next-steps?\b|^\/follow-?ups?\b/, ["task", "person"]],
  [/^\/groups?\b|^\/removals\/group\b|^\/segments?\b/, ["group", "person"]],
  [/volunteer|^\/shifts?\b|\/kiosk\b|\/check-?in\b|^\/removals\/(shift|volunteer)\b|^\/hours\b/i, ["volunteer", "person"]],
  [/^\/funds?\b|^\/financials?\b|^\/budget/, ["fund", "totals"]],
  // STALE-2 (W-1107-Volunteers-15): a Thread's next step IS a task (the
  // database's trg_thread_task_sync writes it), so snoozing it to revisit,
  // dismissing it or setting a new one moves the Tasks views and the badge.
  [/^\/threads\b/, ["note", "person", "task"]],
  [/^\/(interactions|attachments|notes|conversations|files)\b/, ["note", "person"]],
  [/^\/removals\b|^\/trash\b|^\/merge|\/merge\b|^\/households?\b|^\/donors\b|^\/people\b|^\/relationships?\b/, ["person", "gift", "pledge", "group", "totals", "task", "note"]],
  [/^\/(campaigns?|appeals?|goals?|moves?|portfolio|major-gifts|memberships?)\b/, ["person", "totals", "pledge"]],
];
const ID_KEYS = { person: ["donorId", "donor_id", "personId", "funderId", "funder_donor_id"], event: ["eventId", "event_id"],
  pledge: ["pledgeId", "pledge_id"], grant: ["grantId", "grant_id"], group: ["groupId", "group_id"], task: ["taskId", "task_id"] };
const PATH_IDS = [[/\/donors\/([^/?]+)/, "person"], [/\/events\/([^/?]+)/, "event"], [/\/pledges\/([^/?]+)/, "pledge"],
  [/\/grants\/([^/?]+)/, "grant"], [/\/groups\/([^/?]+)/, "group"], [/\/tasks\/([^/?]+)/, "task"]];
const NOT_IDS = new Set(["bulk", "counts", "new", "undo", "import", "export", "merge", "bundle", "summaries", "search", "money", "seen"]);

function parseBody(body) {
  if (!body || typeof body !== "string") return body && typeof body === "object" && !(body instanceof FormData) ? body : null;
  try { return JSON.parse(body); } catch { return null; }
}

// { kinds: Set, ids: { person: Set, event: Set, ... } } for one write.
export function kindsOfWrite(path, method, body) {
  const p = String(path || "").split("?")[0];
  const rule = RULES.find(([re]) => re.test(p));
  const kinds = new Set(rule ? rule[1] : ["other"]);
  const ids = {};
  const add = (k, v) => { if (v == null || v === "") return; (ids[k] || (ids[k] = new Set())).add(String(v)); };
  for (const [re, k] of PATH_IDS) { const m = p.match(re); if (m && !NOT_IDS.has(m[1])) add(k, m[1]); }
  const b = parseBody(body);
  if (b) for (const [k, keys] of Object.entries(ID_KEYS)) for (const key of keys) if (b[key] != null) { add(k, b[key]); }
  // A gift that names an event or a pledge moves that event's or pledge's figures.
  if (kinds.has("gift")) { if (ids.event) kinds.add("event"); if (ids.pledge) kinds.add("pledge"); }
  if (ids.person) kinds.add("person");
  return { kinds, ids, method: String(method || "").toUpperCase(), path: p };
}

// ── THE CHANNEL ──────────────────────────────────────────────────────────────
const subs = new Set();
const log = [];   // the last few announcements, for tests (window.__stewardChanges)
// The first hearer: api.js, which forgets the answers it holds for a change it
// did not make itself (told(), the worker), before any view asks again.
const first = new Set();
export function onAnyChange(fn) { first.add(fn); return () => first.delete(fn); }
export function announce(change) {
  const c = { kinds: change.kinds instanceof Set ? change.kinds : new Set(change.kinds || []), ids: change.ids || {}, source: change.source || "write", path: change.path || null, method: change.method || null };
  log.push({ kinds: [...c.kinds], source: c.source, path: c.path, at: Date.now() }); if (log.length > 50) log.shift();
  for (const f of first) { try { f(c); } catch { /* never stops the announcement */ } }
  for (const s of subs) { try { s(c); } catch { /* one view's re-read never stops another */ } }
}
if (typeof window !== "undefined") { try { Object.defineProperty(window, "__stewardChanges", { value: log, configurable: true }); } catch { /* read-only window */ } }

// Does this change reach a view showing `kinds`, scoped to `ids` (an object of
// kind → id; a view of event e1 does not hear a gift to event e2)? A change
// that names no id of a kind reaches every view of that kind.
export function reaches(change, kinds, ids) {
  const hit = kinds.filter(k => change.kinds.has(k));
  if (!hit.length) return false;
  if (!ids) return true;
  return hit.some(k => {
    const want = ids[k];
    const named = change.ids && change.ids[k];
    return want == null || !named || !named.size || named.has(String(want));
  });
}

// fn(change) shortly after a change that reaches this view (several writes in
// a burst, a write's own told() after it, re-read once).
// Two changes heard inside one wait are one change: every kind and id of both
// (a told() and the worker's marks on the bell read it set off arrive 10ms
// apart, and keeping only the last lost the told's kinds). told() wins the
// source, since it is every kind; then a write, whose path a view may read.
const RANK = { told: 3, write: 2 };
export function mergeChanges(a, b) {
  if (!a) return b;
  const kinds = new Set([...a.kinds, ...b.kinds]);
  const ids = {};
  // A kind one of them names without ids reaches every view of that kind, so
  // the merge does too.
  const open = (c, k) => c.kinds.has(k) && !((c.ids || {})[k] && (c.ids || {})[k].size);
  for (const k of new Set([...Object.keys(a.ids || {}), ...Object.keys(b.ids || {})])) {
    if (open(a, k) || open(b, k)) continue;
    ids[k] = new Set([...((a.ids || {})[k] || []), ...((b.ids || {})[k] || [])]);
  }
  const lead = (RANK[b.source] || 1) >= (RANK[a.source] || 1) ? b : a;
  const w = b.source === "write" ? b : a.source === "write" ? a : lead;
  return { kinds, ids, source: lead.source, path: w.path, method: w.method };
}

export function useChanged(kinds, fn, ids = null, delayMs = 120) {
  const ref = useRef({ fn, kinds, ids });
  ref.current = { fn, kinds, ids };
  useEffect(() => {
    let t = null, last = null;
    const on = c => {
      const r = ref.current;
      if (!reaches(c, r.kinds, r.ids)) return;
      last = mergeChanges(last, c);
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; const m = last; last = null; if (ref.current.fn) ref.current.fn(m); }, delayMs);
    };
    subs.add(on);
    return () => { subs.delete(on); if (t) clearTimeout(t); };
  }, [delayMs]);
}

// A number that moves after each change that reaches this view; put it in a
// read's dependencies.
export function useChangeRev(kinds, ids = null) {
  const [rev, setRev] = useState(0);
  useChanged(kinds, () => setRev(r => r + 1), ids);
  return rev;
}

// ── TOLD: ATLAS, TELL STEWARD, IMPORT, UNDO ──────────────────────────────────
// told() names what it did when it knows ({ gift }, { task }, { import });
// anything else (a memo, a plan, Atlas's yes) may have changed anything.
export function kindsOfTold(d) {
  const ids = {};
  if (d && d.donorId) ids.person = new Set([String(d.donorId)]);
  if (d && d.import) return { kinds: new Set(ALL), ids: {} };
  if (d && d.gift) return { kinds: new Set(["gift", "person", "totals", "fund", "pledge", "event"]), ids };
  if (d && d.task) return { kinds: new Set(["task", "person"]), ids };
  return { kinds: new Set(ALL), ids: {} };
}
if (typeof window !== "undefined") {
  try { window.addEventListener("steward:told", e => announce({ ...kindsOfTold((e && e.detail) || {}), source: "told" })); } catch { /* no window */ }
}

// ── THE WORKER ───────────────────────────────────────────────────────────────
// GET /atlas/activity carries { changes: { mark, tables: { gifts: 812, ... } } }:
// the org's latest change id per table. The first answer is the baseline; a
// table whose id moved after it is announced. What the browser wrote itself
// moves a table too, and is announced again, once, on the next poll: the
// worker's after-change step lands on those same rows a moment after it.
const TABLE_KINDS = [
  [/^(gifts|gift_|donations|recurring|soft_credits|ledger|deposits|checks|batches)/, GIFT],
  [/^(pledge|installment)/, ["pledge", "gift", "totals"]],
  [/^(grant|funder)/, ["grant", "pledge", "totals"]],
  [/^(event|attendee|guest|ticket|table_)/, ["event"]],
  [/^(task)/, ["task"]],
  [/^(milestone_drafts|agent_drafts|thank_you_drafts)/, ["draft"]],   // COMMS-1
  [/^(group|segment)/, ["group"]],
  [/^(volunteer|shift|hours)/, ["volunteer"]],
  [/^(fund|financial|budget)/, ["fund", "totals"]],
  [/^(donors|donor_rhythm|households|relationships|person)/, ["person", "totals"]],
  [/^(interactions|notes|threads|attachments|conversations)/, ["note"]],
  [/^(imports?|import_)/, ALL],
];
let seen = null;
export function noteServerChanges(changes) {
  const tables = changes && changes.tables;
  if (!tables || typeof tables !== "object") return;
  if (!seen) { seen = { ...tables }; return; }
  const kinds = new Set();
  for (const [t, id] of Object.entries(tables)) {
    if (seen[t] != null && Number(id) <= Number(seen[t])) continue;
    seen[t] = id;
    const rule = TABLE_KINDS.find(([re]) => re.test(t));
    if (rule) for (const k of rule[1]) kinds.add(k);
  }
  if (kinds.size) announce({ kinds, ids: {}, source: "worker" });
}
export function forgetServerMark() { seen = null; }

// tests/stale1.test.js §8 counts what one gift costs on Home, which has no
// gift form of its own: the page posts the gift and hands the write to this
// channel exactly as api.js does. Only where a test turned it on.
if (typeof window !== "undefined") {
  try { if (window.localStorage.getItem("steward_test_hooks") === "1") window.__stewardWrote = (p, m, b) => announce(kindsOfWrite(p, m, b)); } catch { /* storage blocked */ }
}
