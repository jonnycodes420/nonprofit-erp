// server/atlas/groupAsk.js · ATLAS-7. A GROUP ASK, THE JOURNEY SHE DESCRIBED, ONE CONFIRM.
//
// Jonathan, 11 Nov: "log every donor that gave over 1000 in my top 100 and then
// put them in a journey for specifically a top 100 journey where I contact them
// every three months for a year I'm just a phone call." Atlas read one person
// ("them"), asked which of two existing journeys he meant, and answered "Done."
// over "I couldn't tell who that was about". Here:
//
//   READ     in code, before any model: a group ("every donor who gave over
//            1000", "everyone in my Top 100", "lapsed donors in Lexington"),
//            what to do with it (add to the Top 100, put in a journey), and the
//            journey she described ("a phone call every 3 months for a year").
//            The group's words go through Show me's own reader (shared/showMe.js),
//            which only ever yields the Donors list's filters.
//   ASK      once, everything at once: the money window with each window's live
//            count (the Donors list's /donors/ids for those exact rules), and
//            which journey, "Create 'Top 100': …" first when hers doesn't exist.
//   PROPOSE  one confirm card with real numbers: who (count and names), the
//            list (how many added, how many already on it), the journey (new or
//            existing, its steps, who it leaves out and why), when the first
//            calls land. Nothing is written before "Do it".
//   RUN      "Do it": the list adds (POST /top100/members), the journey (POST
//            /journeys, by hand, its steps tasks for staff; nothing sends), the
//            enrollments through the one start path, each first call on its own
//            working day. One line per action, with its count, and Undo for all.
//   UNDO     enrollments out (POST /journeys/:id/apply/undo), the journey made in
//            this run archived when nobody else is in it, the list adds off.
"use strict";
const SM = () => import("../../shared/showMe.js");
const GO = require("../../shared/numbers/gaveOver");
const P = require("../../prospect");
const { newId } = require("../shared/newId");

const MAX_PEOPLE = 2000;          // the journey apply's own limit
const SPREAD_OVER = 10;           // working days: the next two weeks
const SPREAD_FROM = 10;           // more than this many first calls are spread
const j = v => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);

// ── READ ────────────────────────────────────────────────────────────────────
const NUM = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const num = w => (w == null ? null : /^\d+$/.test(w) ? Number(w) : NUM[String(w).toLowerCase()] || null);
// Where a group starts: "every donor", "all donors", "everyone", "donors who", "lapsed donors".
const GROUP_START = /\b(?:every(?:one|body)\b|(?:every|all(?: of)?(?: the| my| our)?|each)\s+(?:\w+\s+)?(?:donors?|people|givers?|supporters?|persons?|members?)\b|(?:lapsed|lapsing|new|major|mid[- ]level|monthly|recurring|current|retained)\s+(?:donors?|givers?|people|supporters?)\b|(?:donors?|people|givers?|supporters?)\s+(?:who|that)\b)/i;
// Where the group's words end: the list, the next action, a clause break.
const GROUP_END = /\s+(?:in|on|to|into|onto)\s+(?:my|our|the)\s+top\s*100\b|\s+(?:to|into|in)\s+(?:a|the|my|our)\s+[\w' -]{0,40}?journey\b|\s+and\s+(?:then\s+)?(?:put|add|start|enrol|enroll|log|move|give)\b|\s+then\b|,(?!\d{3})|[.;:!?](?!\d)|\s+to\s+(?:the|my|our)\s+/i;
const WINDOW_WORDS = /\s*\b(?:in (?:a|one) (?:single )?gift|(?:a )?single gift|in one go|(?:in|over|during) the (?:last|past) (?:12|twelve) months|(?:in |over )?the (?:last|past) year|this calendar year|this year|so far this year|year to date|in (?:their )?lifetime|lifetime|all[- ]time|ever|in total|altogether)\b/gi;
const TOP100 = /\btop\s*100\b(?!\s+journey)/i;
const ADD_VERB = /\b(log|add|put|include|place|move|get)\b/i;

// Her words, first letter up ("top 100" is "Top 100", "major donor" is "Major donor").
const title = s => { const t = String(s).trim().replace(/\s+/g, " "); return t ? t[0].toUpperCase() + t.slice(1).replace(/\btop\s*100\b/gi, "Top 100") : t; };
const HOW = [[/\bphone call|\bcall(s|ing)?\b|\bphone\b|\bring\b/i, "Phone call", "calls"], [/\bvisit|\bmeet|\bcoffee|\blunch/i, "Visit", "visits"],
  [/\b(e-?mail|note|letter|card|write)\b/i, "Write to them", "notes"]];

// The journey she described: its name and, when she said how often, its steps.
function readJourney(t) {
  if (!/\bjourney\b/i.test(t)) return null;
  let name = "";
  const called = t.match(/\bjourney\s+(?:called|named)\s+["“']?([^"”',.;]{1,60})/i);
  if (called) name = called[1];
  else {
    for (const m of t.matchAll(/\b(?:a|an|the|my|our)\s+((?:specifically\s+|new\s+|special\s+|separate\s+)*)((?:[\w'&-]+\s+){0,5}?)journey\b/gi)) {
      const w = String(m[2] || "").replace(/\b(specifically|new|special|separate|own)\b/gi, " ").trim();
      if (w) name = w;
    }
  }
  const every = t.match(/\bevery\s+(\d+|one|two|three|four|five|six|a|an)?\s*(week|month)s?\b/i) || (/\bquarterly\b/i.test(t) ? [null, "3", "month"] : /\bmonthly\b/i.test(t) ? [null, "1", "month"] : null);
  const span = t.match(/\bfor\s+(?:the\s+next\s+)?(\d+|a|an|one|two|three|six|twelve|eighteen)\s+(year|month)s?\b/i);
  let steps = null, words = "";
  if (every) {
    const n = num(every[1]) || 1;
    const stepDays = /week/i.test(every[2]) ? n * 7 : Math.round(n * 365 / 12);
    const totalDays = span ? Math.round((num(span[1]) || 1) * (/year/i.test(span[2]) ? 365 : 365 / 12)) : 365;
    // "Every 3 months for a year" is 4 calls (day 0, 91, 182, 273): as many as start inside the span.
    const count = Math.max(1, Math.min(12, Math.floor(totalDays / stepDays)));
    const [, label, plural] = HOW.find(([re]) => re.test(t)) || [null, "Get in touch", "touches"];
    steps = Array.from({ length: count }, (_, k) => ({ type: "follow_up", label, offsetDays: k * stepDays }));
    const unit = /week/i.test(every[2]) ? "week" : "month";
    const howOften = n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
    const forWords = !span ? "for a year" : `for ${(num(span[1]) || 1) === 1 ? `a ${span[2].toLowerCase()}` : `${num(span[1])} ${span[2].toLowerCase()}s`}`;
    words = `${label === "Phone call" ? "a phone call" : label === "Visit" ? "a visit" : label === "Write to them" ? "a note" : "a touch"} ${howOften} ${forWords} (${count} ${count === 1 ? plural.replace(/s$/, "") : plural})`;
  }
  return { name: name ? title(name) : "", steps, words };
}

// { step } for a group ask, or null when her words name no group with something to do.
// A group with nothing Atlas can do with it is left to the usual read (a "show me" list).
async function read(text) {
  const t = String(text || "").replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
  const g = GROUP_START.exec(t);
  if (!g) return null;
  const top100Said = TOP100.test(t);
  const journey = readJourney(t);
  if (!top100Said && !journey) return null;
  const rest = t.slice(g.index);
  const end = GROUP_END.exec(rest);
  let words = (end ? rest.slice(0, end.index) : rest).trim();
  const window = GO.windowFromWords(words) || GO.windowFromWords(t.replace(/\bfor a year\b|\bevery \w+ months?\b/gi, " "));
  const S = await SM();
  // "everyone in my Top 100": the list itself is the group.
  const membersOnly = /^(every(one|body)|all( of)?( the| my| our)?( \w+)? (donors?|people)|each)$/i.test(words) && /^(every(one|body)|all|each)\b[^.]{0,40}?\b(in|on)\s+(my|our|the)\s+top\s*100\b/i.test(rest);
  let rules = {};
  let unsupported = null;
  if (!membersOnly) {
    const spec = S.templateSpec(words.replace(WINDOW_WORDS, " ").replace(/\s+/g, " ").trim(), {});
    rules = (spec && spec.rules) || {};
    unsupported = (spec && spec.unsupported) || (!Object.keys(rules).length ? words : null);
  }
  // "Log them in my top 100" adds the group to the list; "everyone in my Top 100" reads it.
  const top100Add = top100Said && !membersOnly && ADD_VERB.test(t.slice(0, t.search(TOP100)));
  if (!top100Add && !journey) return null;
  return { kind: "group_plan", who: "", target: "", amountWords: "", whenWords: "", how: "", words: t,
    group: { said: words, rules, unsupported, window: rules.gaveOver !== undefined && !rules.gaveFrom ? window : null, membersOnly, top100Add, journey } };
}

// ── THE DONORS LIST'S OWN ANSWERS ───────────────────────────────────────────
const qs = rules => new URLSearchParams(Object.entries(rules).map(([k, v]) => [k, String(v)])).toString();
// The count the Donors list shows for these rules (its "select all").
async function countFor(asHer, rules) {
  const r = await asHer("GET", `/donors/ids?${qs(rules)}`);
  if (r.status >= 300) return null;
  return r.body.total == null ? { n: null, capped: true } : { n: Number(r.body.total) };
}
// Everyone behind the count, in the list's order (largest lifetime first).
async function idsFor(asHer, rules) {
  const out = [];
  for (let offset = 0; offset != null && out.length <= MAX_PEOPLE;) {
    const r = await asHer("GET", `/donors/ids?${qs({ ...rules, offset })}`);
    if (r.status >= 300) break;
    out.push(...(r.body.ids || []));
    offset = r.body.next;
  }
  return out;
}

// The rules the group is, once the window is known.
function rulesOf(group, window, today) {
  if (group.membersOnly) return null;
  if (group.rules.gaveOver !== undefined && !group.rules.gaveFrom && window) {
    const { gaveOver, ...others } = group.rules;
    return { ...others, ...GO.rulesFor(gaveOver, window, today) };
  }
  return group.rules;
}

// ── ASK ─────────────────────────────────────────────────────────────────────
// Every question this group ask leaves, with its live counts. Sets step.window
// and step.journeyId / step.createJourney from her answers.
async function resolve({ query, asHer, orgId, today }, st, answers, ask) {
  const g = st.group;
  if (g.unsupported) return;
  if (g.rules.gaveOver !== undefined && !g.rules.gaveFrom) {
    const w = g.window || (GO.WINDOWS.includes(answers.window) ? answers.window : null);
    if (w) st.window = w;
    else {
      const counts = await Promise.all(GO.WINDOWS.map(k => countFor(asHer, rulesOf(g, k, today))));
      const usd = `$${Number(g.rules.gaveOver).toLocaleString("en-US")}`;
      ask({ id: "window", kind: "window", said: g.said, sentence: `"Gave over ${usd}": over what time?`,
        options: GO.WINDOWS.map((k, i) => ({ id: k, name: GO.LABEL[k],
          detail: `${counts[i] == null ? "can't count just now" : counts[i].capped ? "more than 25,000 people" : `${counts[i].n} ${counts[i].n === 1 ? "person" : "people"}`}${k === "last12" || k === "calendar" ? ` · ${GO.windowWords(k, today).replace(/^.*\((.*)\)$/, "$1")}` : ""}` })) });
    }
  }
  if (g.journey) {
    const rows = await query("SELECT id, name, journey_enabled FROM cultivation_templates WHERE org_id=? AND archived_at IS NULL ORDER BY name", [orgId]);
    const sing = s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter(Boolean).map(w => w.replace(/s$/, "")).join(" ");
    const same = g.journey.name ? rows.filter(r => sing(r.name) === sing(g.journey.name)) : [];
    const a = answers.journey;
    if (same.length === 1) { st.journeyId = same[0].id; st.journeyName = same[0].name; }
    else if (a === "new" && g.journey.steps && g.journey.name) { st.createJourney = true; st.journeyName = g.journey.name; }
    else if (a && rows.some(r => r.id === a)) { const r = rows.find(x => x.id === a); st.journeyId = r.id; st.journeyName = r.name; }
    else {
      const make = g.journey.steps && g.journey.name ? [{ id: "new", name: `Create '${g.journey.name}': ${g.journey.words}`, detail: "A new journey. Each step is a task for your team; nothing is sent." }] : [];
      ask({ id: "journey", kind: "journey", said: g.journey.name, sentence: g.journey.name ? `There's no "${g.journey.name}" journey yet. Make it, or use one you have?` : "Which journey?",
        options: [...make, ...rows.map(r => ({ id: r.id, name: r.name, detail: r.journey_enabled ? "Yours already" : "Off: it can't take people until it's turned on" }))] });
    }
  }
}

// ── PROPOSE ─────────────────────────────────────────────────────────────────
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayWord = day => { const d = new Date(day + "T12:00:00Z"); return `${DOW[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const isWorkday = day => { const w = new Date(day + "T12:00:00Z").getUTCDay(); return w !== 0 && w !== 6; };

// Each person's first day, in order (largest giver first). Up to SPREAD_FROM
// people all start on the first working day; more are spread evenly over the
// next SPREAD_OVER working days, the earliest days to the largest givers.
function spreadDays(n, today) {
  const days = [];
  for (let d = today; days.length < SPREAD_OVER; d = addDays(d, 1)) if (isWorkday(d)) days.push(d);
  if (n <= SPREAD_FROM) return Array.from({ length: n }, () => days[0]);
  return Array.from({ length: n }, (_, i) => days[Math.floor(i * SPREAD_OVER / n)]);
}
function spreadSentence(dates, what) {
  if (!dates.length) return "";
  const first = dates[0], last = dates[dates.length - 1];
  if (first === last) return `Every first ${what} is due ${dayWord(first)}.`;
  const perDay = new Map(); for (const d of dates) perDay.set(d, (perDay.get(d) || 0) + 1);
  const lo = Math.min(...perDay.values()), hi = Math.max(...perDay.values());
  return `First ${what}s are spread over ${perDay.size} working days, ${dayWord(first)} to ${dayWord(last)}, ${lo === hi ? lo : `${lo} or ${hi}`} a day, largest givers first.`;
}

const LEFT_OUT = { deceased: "deceased", do_not_contact: "do not contact", already: "already in it" };

// Builds the plan with real numbers and keeps it on the request. Returns the line to log.
async function propose({ req, query, run, asHer, memoId, step: st, today }) {
  const orgId = req.user.orgId;
  const g = st.group;
  if (g.unsupported) return { kind: "refused", state: "refused", line: `I can't pick out "${String(g.unsupported).slice(0, 80)}" from Steward's filters yet, so I did nothing. Try Donors' filters, then "Add to a journey".` };
  let ids;
  const rules = rulesOf(g, st.window, today);
  if (g.membersOnly) ids = (await query(`SELECT m.donor_id FROM portfolio_members m JOIN donors d ON d.id = m.donor_id AND d.org_id = m.org_id
                                          WHERE m.org_id=? AND d.deleted_at IS NULL ORDER BY m.rank`, [orgId])).map(r => r.donor_id);
  else ids = await idsFor(asHer, rules);
  // "gave over $1,000 in the last 12 months (Nov 12, 2025 to Nov 11, 2026)": from the rules, not her words echoed.
  const whoWords = g.membersOnly ? "everyone on your Top 100"
    : st.window ? `gave over $${Number(g.rules.gaveOver).toLocaleString("en-US")} ${GO.windowWords(st.window, today)}`
    : g.said.replace(/^(every(one|body)?|all( of)?( the| my| our)?|each)\s+((\w+\s+)?(donors?|people|givers?|supporters?|persons?|members?)\s+)?((who|that)\s+)?/i, "").trim();
  if (!ids.length) return { kind: "answer", state: "done", line: `Nobody in Steward matches that (${whoWords}), so there's nothing to do.` };
  if (ids.length > MAX_PEOPLE) return { kind: "refused", state: "refused", line: `That's more than ${MAX_PEOPLE.toLocaleString("en-US")} people at once, so I did nothing. Narrow it on Donors first.` };
  const people = await query(`SELECT id, name, deceased, do_not_contact FROM donors WHERE org_id=? AND id = ANY(?::text[])`, [orgId, ids]);
  const byId = new Map(people.map(p => [p.id, p]));
  const ordered = ids.filter(id => byId.has(id));
  const plan = { id: newId("gp"), said: g.said, whoWords, rules, count: ordered.length,
    people: ordered.map(id => ({ id, name: byId.get(id).name })), list: null, journey: null, doneAt: null };
  if (g.top100Add) {
    if (!(await P.canSee(req.user.userId, orgId))) plan.list = { refused: "The Top 100 is for admins and staff with the major gifts permission." };
    else {
      const [l] = await query("SELECT name FROM portfolio_lists WHERE org_id=?", [orgId]);
      const on = new Set((await query("SELECT donor_id FROM portfolio_members WHERE org_id=? AND donor_id = ANY(?::text[])", [orgId, ordered])).map(r => r.donor_id));
      plan.list = { name: (l && l.name) || "Top 100", add: ordered.filter(id => !on.has(id)).length, already: on.size, cap: null };
    }
  }
  if (g.journey && (st.journeyId || st.createJourney)) {
    const inIt = st.journeyId ? new Set((await query(`SELECT donor_id FROM cultivation_plans WHERE org_id=? AND template_id=? AND status='active' AND donor_id = ANY(?::text[])`,
      [orgId, st.journeyId, ordered])).map(r => r.donor_id)) : new Set();
    const [t] = st.journeyId ? await query("SELECT steps, journey_enabled FROM cultivation_templates WHERE id=? AND org_id=?", [st.journeyId, orgId]) : [null];
    const steps = st.createJourney ? g.journey.steps : (j(t && t.steps) || []).map(s => ({ type: s.type, label: s.label, offsetDays: Number(s.offsetDays) || 0 }));
    const left = { deceased: 0, do_not_contact: 0, already: 0 };
    const join = [];
    for (const id of ordered) {
      const p = byId.get(id);
      if (p.deceased === true) left.deceased++;
      else if (p.do_not_contact === true) left.do_not_contact++;
      else if (inIt.has(id)) left.already++;
      else join.push(id);
    }
    const what = String((steps[0] && steps[0].label) || "step").toLowerCase();
    const dates = spreadDays(join.length, today);
    plan.journey = { id: st.journeyId || null, create: !!st.createJourney, name: st.journeyName, words: st.createJourney ? g.journey.words : "",
      off: t ? t.journey_enabled !== true : false, steps, join, joinCount: join.length, dates,
      leftOut: Object.entries(left).filter(([, n]) => n).map(([k, n]) => `${n} ${LEFT_OUT[k]}`),
      spread: spreadSentence(dates, what) };
  }
  const [x] = await query("SELECT read FROM voice_memos WHERE id=? AND org_id=?", [memoId, orgId]);
  const r = j(x && x.read) || {};
  r.atlas = { ...(r.atlas || {}), groupPlan: plan };
  await run("UPDATE voice_memos SET read=? WHERE id=? AND org_id=?", [JSON.stringify(r), memoId, orgId]);
  return { kind: "group_plan", state: "waiting", waits: true, link: { tab: "donors" },
    line: `Here's the plan for ${plan.count} ${plan.count === 1 ? "person" : "people"}. Nothing is changed until you press Do it.` };
}

// What the card shows (the people's names, at most 200 of them).
function publicPlan(plan) {
  if (!plan) return null;
  const { people, journey, ...rest } = plan;
  return { ...rest, people: (people || []).slice(0, 200), more: Math.max(0, (people || []).length - 200),
    journey: journey ? (({ join, dates, ...jr }) => ({ ...jr, firstDay: (dates || [])[0] || null }))(journey) : null };
}

// ── RUN ─────────────────────────────────────────────────────────────────────
// Claims the plan (one Do it, however many presses), then each action in turn.
async function runPlan({ req, query, run, asHer, log, startJourney, memoId }) {
  const orgId = req.user.orgId;
  const at = new Date().toISOString();
  const took = await run(`UPDATE voice_memos SET read = jsonb_set(read::jsonb, '{atlas,groupPlan,doneAt}', to_jsonb(?::text))
                           WHERE id=? AND org_id=? AND undone_at IS NULL AND read->'atlas'->'groupPlan' IS NOT NULL
                             AND COALESCE(read->'atlas'->'groupPlan'->>'doneAt', '') = ''
                             AND EXISTS (SELECT 1 FROM atlas_actions a WHERE a.org_id=voice_memos.org_id AND a.request_id=voice_memos.id AND a.kind='group_plan' AND a.state='waiting')`,
    [at, memoId, orgId]);
  if (!took || took.changes === 0) return { already: true };
  const [x] = await query("SELECT read FROM voice_memos WHERE id=? AND org_id=?", [memoId, orgId]);
  const r = j(x.read) || {};
  const plan = r.atlas.groupPlan;
  const ids = plan.people.map(p => p.id);
  const ran = {};
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // 1. The list.
  if (plan.list && !plan.list.refused) {
    const before = new Set((await query("SELECT donor_id FROM portfolio_members WHERE org_id=? AND donor_id = ANY(?::text[])", [orgId, ids])).map(x2 => x2.donor_id));
    let failed = null;
    for (let i = 0; i < ids.length && !failed; i += 500) {
      const res = await asHer("POST", "/top100/members", { donorIds: ids.slice(i, i + 500) });
      if (res.status >= 300) failed = (res.body && (res.body.sentence || res.body.error)) || "it did not go through";
    }
    const after = new Set((await query("SELECT donor_id FROM portfolio_members WHERE org_id=? AND donor_id = ANY(?::text[])", [orgId, ids])).map(x2 => x2.donor_id));
    ran.listAdded = ids.filter(id => after.has(id) && !before.has(id));
    await log({ kind: "group_list", state: ran.listAdded.length ? "done" : failed ? "failed" : "done", undoable: ran.listAdded.length > 0, link: { tab: "top100" }, place: "home",
      line: failed && !ran.listAdded.length ? `I couldn't add them to your ${plan.list.name}: ${failed}.`
        : `Added ${plural(ran.listAdded.length, "person", "people")} to your ${plan.list.name}${before.size ? `; ${before.size} ${before.size === 1 ? "was" : "were"} already on it` : ""}.` });
  } else if (plan.list && plan.list.refused) await log({ kind: "refused", state: "refused", line: plan.list.refused });
  // 2. The journey, made from her words when she chose to.
  const jr = plan.journey;
  let journeyId = jr ? jr.id : null;
  if (jr && jr.create) {
    const res = await asHer("POST", "/journeys", { name: jr.name, trigger: "by_hand", steps: jr.steps, enabled: true,
      description: `Made by Atlas from your words: ${jr.words}. Each step is a task for your team; nothing is sent.` });
    if (res.status === 201 && res.body && res.body.id) {
      journeyId = res.body.id; ran.journeyMade = journeyId;
      await log({ kind: "group_journey_new", state: "done", undoable: true, place: "journey", placeId: journeyId, link: { tab: "journeys", journeyId },
        line: `Made the journey "${jr.name}": ${jr.words}. It's in Journeys, where you can change it.` });
    } else {
      await log({ kind: "group_journey_new", state: "failed", line: `I couldn't make the journey "${jr.name}": ${(res.body && (res.body.message || res.body.sentence || res.body.error)) || "it did not go through"}.` });
      journeyId = null;
    }
  }
  // 3. The people, each first call on its own day (the one start path, by hand).
  if (jr && journeyId) {
    const planIds = [], skipped = [];
    for (const [i, id] of jr.join.entries()) {
      const out = await startJourney(orgId, id, "by_hand", { forceJourneyId: journeyId, joinOthers: true, today: jr.dates[i] });
      if (out && out.started && out.planId) planIds.push(out.planId); else skipped.push((out && out.reason) || "not started");
    }
    ran.journeyId = journeyId; ran.planIds = planIds;
    const span = planIds.length ? ` ${jr.spread}` : "";
    const left = [...jr.leftOut, ...(skipped.length ? [`${skipped.length} the journey turned away`] : [])];
    await log({ kind: "group_journey", state: planIds.length ? "done" : "failed", undoable: planIds.length > 0, place: "journey", placeId: journeyId, link: { tab: "journeys", journeyId },
      line: `Put ${plural(planIds.length, "person", "people")} in "${jr.name}".${span}${left.length ? ` Left out: ${left.join(", ")}.` : ""}` });
  }
  await run("UPDATE voice_memos SET read = jsonb_set(read::jsonb, '{atlas,groupPlan,ran}', ?::jsonb) WHERE id=? AND org_id=?", [JSON.stringify(ran), memoId, orgId]);
  await run("UPDATE atlas_actions SET state='done', waits=false, line=?, updated_at=NOW() WHERE org_id=? AND request_id=? AND kind='group_plan' AND state='waiting'",
    [`You pressed Do it for ${plural(plan.count, "person", "people")}.`, orgId, memoId]);
  return { ran };
}

// ── UNDO ────────────────────────────────────────────────────────────────────
const GROUP_KINDS = new Set(["group_list", "group_journey_new", "group_journey"]);
// One line's Undo. The whole request's Undo runs them newest first: the
// enrollments, then the journey (archived only when nobody is in it), then the list.
async function undoLine({ query, asHer, orgId }, a) {
  const [x] = await query("SELECT read FROM voice_memos WHERE id=? AND org_id=?", [a.request_id, orgId]);
  const ran = (((j(x && x.read) || {}).atlas || {}).groupPlan || {}).ran || {};
  if (a.kind === "group_journey" && ran.journeyId && (ran.planIds || []).length) {
    const res = await asHer("POST", `/journeys/${encodeURIComponent(ran.journeyId)}/apply/undo`, { planIds: ran.planIds });
    return res.status < 300 ? Number(res.body && res.body.undone) || 0 : 0;
  }
  if (a.kind === "group_journey_new" && ran.journeyMade) {
    const [n] = await query("SELECT COUNT(*)::int AS n FROM cultivation_plans WHERE org_id=? AND template_id=?", [orgId, ran.journeyMade]);
    if (Number(n && n.n) > 0) return 0;   // somebody else is in it: it stays
    const res = await asHer("DELETE", `/journeys/${encodeURIComponent(ran.journeyMade)}`);
    return res.status < 300 ? 1 : 0;
  }
  if (a.kind === "group_list" && (ran.listAdded || []).length) {
    let n = 0;
    for (const id of ran.listAdded) { const res = await asHer("DELETE", `/top100/members/${encodeURIComponent(id)}`); if (res.status < 300) n++; }
    return n;
  }
  return 0;
}

// Words that name a group of people, not one person ("every donor who gave over 1000").
const namesGroup = words => GROUP_START.test(String(words || ""));
const GROUP_LINE = "That names a group of people, not one person, and I couldn't tell what to do with them. Say who they are and what to do (\"add everyone who gave over $1,000 to my Top 100\"), and I'll show you the plan before anything changes.";

module.exports = { namesGroup, GROUP_LINE, read, resolve, propose, publicPlan, runPlan, undoLine, GROUP_KINDS, spreadDays, spreadSentence, readJourney, MAX_PEOPLE };
