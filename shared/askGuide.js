// shared/askGuide.js · ASK-3. WHY AND WHAT: THE GUIDED QUESTIONS.
//
// Home and a donor's profile carry two buttons, Why and What. Each opens a
// rail of questions Steward can always answer, written from the org's own
// names (its latest appeal, the person on the page). Every answer then offers
// two to four follow-up questions of its own, built from what that answer
// found ("Who are the 11 who haven't given?", "What should I ask Nerissa
// for?"). Only questions with a computation behind them are offered here; a
// question Steward can't work out yet is never put on a button.
//
// Each question is { text, go }. `go` says how it is asked:
//   { via: "why", key, campaign?, donor?, part? }   POST /why/ask
//   { via: "ask", text, thread? }                   POST /ask (thread: send the last plan)
//   { via: "ask", plan }                            POST /ask with a typed plan
//   { via: "person", donor, intent }                POST /ask, one person (ASK-3 Part 1)
//
// Pure: no DB, no network, no JSX. House style: no colons, no em dashes.

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const spell = n => (n >= 0 && n < 10 ? WORDS[n] : String(n));
export const firstName = name => String(name || "").trim().split(/\s+/)[0] || "them";
const q = (text, go) => ({ text, go });

// The question a part of the appeal's breakdown is asked as.
export function partQuestion(part, count) {
  const n = spell(count);
  return ({ lapsed: `Who are the ${n} who haven't given?`, more: "Who gave more than last time?", less: "Who gave less than last time?",
    timing: "Who gave later last time?", new: "Who is new?", back: "Who came back?" })[part] || "Who are they?";
}

// The lists behind the two buttons.
//   campaigns   the org's appeals with a campaign a year earlier to compare
//               with, newest first ({ id, name })
//   canSeeMore  Room to give is for admins and major gifts staff only
//   donor       on a profile: { id, name }
export function guidedLists({ campaigns = [], canSeeMore = false, donor = null } = {}) {
  if (donor) {
    const f = firstName(donor.name);
    return {
      why: [
        ...(donor.lapsed ? [q(`Why did ${f} stop giving?`, { via: "person", donor: donor.id, intent: "stopped" })] : []),
        ...(donor.gave ? [q(`Why did ${f}'s giving change?`, { via: "person", donor: donor.id, intent: "changed" })] : []),
      ],
      what: [
        q(`What should I ask ${f} for?`, { via: "person", donor: donor.id, intent: "ask" }),
        q(`What's the next step with ${f}?`, { via: "person", donor: donor.id, intent: "next" }),
        q(`What has ${f} given to?`, { via: "person", donor: donor.id, intent: "given" }),
      ],
    };
  }
  const why = [];
  for (const c of campaigns.slice(0, 2)) why.push(q(`Why did ${c.name} come in where it did?`, { via: "why", key: "appeal", campaign: c.id }));
  why.push(q("Why are these donors drifting?", { via: "why", key: "lapse" }));
  why.push(q("Why did retention change this year?", { via: "why", key: "retention" }));
  why.push(q("Why haven't our first-time donors given again?", { via: "why", key: "second" }));
  const what = [
    q("Who should I call tomorrow?", { via: "why", key: "call" }),
    ...(canSeeMore ? [q("Who could give more?", { via: "why", key: "more" })] : []),
    q("How much did we raise last month?", { via: "ask", text: "How much did we raise last month?" }),
    q("Who are my top 20 donors this year?", { via: "ask", text: "Who are my top 20 donors this year?" }),
    q("What's our retention rate?", { via: "ask", text: "What's our retention rate?" }),
    q("This year vs last year by fund", { via: "ask", text: "This year vs last year by fund" }),
    q("How many monthly donors do we have?", { via: "ask", text: "How many monthly donors do we have?" }),
    q("Which volunteers should we ask to give?", { via: "why", key: "volunteers" }),
  ];
  return { why, what };
}

// The follow-ups under one answer: two to four, each about what this answer
// found. `answer` is the response of /why/ask or /ask; `canSeeMore` as above.
export function followUpsFor(answer, { canSeeMore = false } = {}) {
  if (!answer || answer.answered === false) return [];
  const out = [];
  const add = (text, go) => { if (out.length < 4 && !out.some(x => x.text === text)) out.push(q(text, go)); };
  const who = answer.who || [];
  const person = (p, intent, text) => p && p.donorId && add(text, { via: "person", donor: p.donorId, intent });
  const key = answer.question && answer.question.key;
  const reasons = answer.reasons || [];
  const part = k => reasons.find(r => r.key === k);

  const one = answer.person || (key === "stopped" && answer.donor ? { ...answer.donor, intent: "stopped" } : null);
  if (one) {
    // A person's answer: the other things you can ask about them.
    const p = { donorId: one.id }, f = firstName(one.name), i = one.intent;
    if (i !== "ask") person(p, "ask", `What should I ask ${f} for?`);
    if (i !== "next") person(p, "next", `What's the next step with ${f}?`);
    if (i !== "stopped" && one.lapsed) person(p, "stopped", `Why did ${f} stop giving?`);
    if (i !== "given") person(p, "given", `What has ${f} given to?`);
    return out.slice(0, 3);
  }
  if (answer.part) {
    person(who[0], "ask", `What should I ask ${firstName(who[0] && who[0].name)} for?`);
    if (who[1]) person(who[1], "ask", `What should I ask ${firstName(who[1].name)} for?`);
    add("Who should I call tomorrow?", { via: "why", key: "call" });
    return out;
  }
  if (key === "appeal" && answer.campaign && answer.compare) {
    const lapsed = part("lapsed"), more = part("more"), less = part("less");
    if (lapsed && lapsed.count) add(partQuestion("lapsed", lapsed.count), { via: "why", key: "appeal", campaign: answer.campaign.id, part: "lapsed" });
    const firstLapsed = who.find(w => /nothing yet/i.test(w.reason || "")) || who[0];
    person(firstLapsed, "ask", `What should I ask ${firstName(firstLapsed && firstLapsed.name)} for?`);
    if (less && less.count) add(partQuestion("less"), { via: "why", key: "appeal", campaign: answer.campaign.id, part: "less" });
    if (more && more.count) add(partQuestion("more"), { via: "why", key: "appeal", campaign: answer.campaign.id, part: "more" });
    return out;
  }
  if (key === "call") {
    person(who[0], "ask", `What should I ask ${firstName(who[0] && who[0].name)} for?`);
    add("Who is drifting from their usual gift?", { via: "why", key: "lapse" });
    if (canSeeMore) add("Who could give more?", { via: "why", key: "more" });
    return out;
  }
  if (key === "lapse") {
    person(who[0], "stopped", `Why did ${firstName(who[0] && who[0].name)} stop giving?`);
    person(who[0], "ask", `What should I ask ${firstName(who[0] && who[0].name)} for?`);
    add("Who should I call tomorrow?", { via: "why", key: "call" });
    return out;
  }
  if (key === "retention") {
    add("Who is drifting from their usual gift?", { via: "why", key: "lapse" });
    add("Which first-time donors need a second ask?", { via: "why", key: "second" });
    add("What's our retention rate?", { via: "ask", text: "What's our retention rate?" });
    return out;
  }
  if (key === "more" || key === "second" || key === "volunteers") {
    person(who[0], "ask", `What should I ask ${firstName(who[0] && who[0].name)} for?`);
    if (who[1]) person(who[1], "ask", `What should I ask ${firstName(who[1].name)} for?`);
    add("Who should I call tomorrow?", { via: "why", key: "call" });
    return out;
  }
  if (answer.kind === "answer" && answer.plan) {
    // A figure: its own "who are they?" first, then the usual next turns.
    for (const s of answer.steps || []) if (s.kind === "ask") add(s.label, { via: "ask", text: s.text, thread: true });
    const p = answer.plan;
    const period = p.period && p.period.kind;
    if (p.kind === "who" && answer.people && answer.people[0]) person(answer.people[0], "ask", `What should I ask ${firstName(answer.people[0].name)} for?`);
    if (p.kind !== "who" && !p.compare && period && !["all_time", "last_year"].includes(period)) add("And last year?", { via: "ask", text: "And last year?", thread: true });
    if (p.kind !== "who" && !p.groupBy && answer.plan.metric === "raised") add("By fund", { via: "ask", text: "By fund", thread: true });
    return out;
  }
  return out;
}
