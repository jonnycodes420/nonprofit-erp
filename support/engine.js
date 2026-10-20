// support/engine.js · SUPPORT-1. THE SUPPORT AGENT'S JUDGEMENT, IN ONE PURE FILE.
//
// The support agent answers questions about using Steward. It is grounded:
// every answer is built from passages in support/index.json (help articles,
// the site's FAQ and feature pages, the messaging, and what is true about each
// connection), and it cites the ones it used. It also reads, for a signed-in
// person, a few facts about their own organization: its connections and when
// they last synced, its recent imports, and counts. Never another org's, and
// never a donor's name.
//
// IT ONLY READS. SUPPORT_TOOLS is empty and is the whole of what the model is
// offered: there is no tool to call, so it can change no record, touch no
// money, send nothing and run no plan. It can link to the screen where the
// person does it themselves. support1-answers asserts on this list.
//
// Pure: no database, no network, no clock (today is a parameter). The route
// (routes/support.js) fetches the facts and calls the model; this file ranks,
// decides when to hand off, writes the prompt, and writes the template answer
// that stands in when AI is off.

const INDEX = require("./index.json");

// The model's tool list. Empty, on purpose, and nowhere else.
const SUPPORT_TOOLS = Object.freeze([]);

const JONATHAN = "jonathan@stewardapp.dev";

// ── RANKING ─────────────────────────────────────────────────────────────────
// Plain keyword ranking (BM25), no embeddings and no vendor. Title and heading
// words count extra. A passage about the screen the person is on gets a small
// lift, never enough to beat a passage that actually matches the words.
const STOP = new Set(("a an and are as at be by can do does did for from how i in is it its my of on or the to what when where which who why will with you your me we our us "
  + "this that there their they them was were has have had not no if so just get got any some all want need please hi hello thanks thank steward").split(" "));
const stem = w => w.length > 4 ? w.replace(/(ings|ing|ies|ied|es|ed|s)$/, m => (m === "ies" || m === "ied") ? "y" : "") : w;
function tokens(s) {
  return String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter(w => w.length > 1 && !STOP.has(w)).map(stem);
}

const DOCS = INDEX.passages.map(p => {
  const head = tokens(p.title + " " + p.heading), body = tokens(p.text), title = new Set(tokens(p.title));
  const tf = new Map();
  for (const w of body) tf.set(w, (tf.get(w) || 0) + 1);
  for (const w of head) tf.set(w, (tf.get(w) || 0) + 2);
  return { p, tf, title, len: body.length + head.length * 2 };
});
const AVG = DOCS.reduce((t, d) => t + d.len, 0) / Math.max(1, DOCS.length);
const DF = new Map();
for (const d of DOCS) for (const w of d.tf.keys()) DF.set(w, (DF.get(w) || 0) + 1);
const idf = w => Math.log(1 + (DOCS.length - (DF.get(w) || 0) + 0.5) / ((DF.get(w) || 0) + 0.5));

// The least score a passage needs before it counts as an answer. Below it,
// the honest reply is "I don't know" and an offer of Jonathan.
const MIN_SCORE = 4.5;

function rank(question, opts = {}) {
  const q = [...new Set(tokens(question))];
  if (!q.length) return [];
  const k1 = 1.2, b = 0.75;
  const out = [];
  for (const d of DOCS) {
    let s = 0, hits = 0;
    for (const w of q) {
      const f = d.tf.get(w);
      if (!f) continue;
      hits++;
      s += idf(w) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / AVG));
    }
    if (!hits) continue;
    // The article whose title is the thing asked about ("add a task" and Tasks).
    for (const w of q) if (d.title.has(w)) s += 1.5;
    // Matching more of the question's words matters more than repeating one.
    s *= 0.5 + 0.5 * hits / q.length;
    if (opts.screen && d.p.screen && (d.p.screen === opts.screen || d.p.screen === String(opts.screen).split(":")[0])) s += 0.75;
    out.push({ ...d.p, score: Math.round(s * 100) / 100 });
  }
  out.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
  // One article should not crowd out the rest: at most three passages from one link.
  const per = new Map(), picked = [];
  for (const r of out) {
    const n = per.get(r.link) || 0;
    if (n >= 3) continue;
    per.set(r.link, n + 1);
    picked.push(r);
    if (picked.length >= (opts.limit || 5)) break;
  }
  return picked;
}

// ── WHEN A PERSON SHOULD ANSWER ─────────────────────────────────────────────
// Money, billing, data loss, a security concern, cancelling, and somebody who
// is frustrated go to Jonathan. The agent still says what it can, and offers
// the hand-off in the same breath; for cancelling and billing it does not try
// to answer at all, because those are a person's to handle.
const HANDOFF_RULES = [
  { kind: "cancel", answer: false, re: /\b(cancel|close|delete|terminate|end)\b[^.?!]{0,30}\b(account|subscription|plan|steward)\b|\bunsubscribe from steward\b|\bstop paying\b/i,
    sentence: "Cancelling is something Jonathan handles himself, so nothing is lost by accident." },
  { kind: "billing", answer: false, re: /\b(bill|billing|billed|invoice|receipt from steward|refund|charged me|overcharg|my card was charged|subscription (fee|cost)|discount|coupon|my payment method)\b/i,
    sentence: "Billing questions go to Jonathan, so you get an exact answer about your account." },
  { kind: "security", answer: true, re: /\b(hack|hacked|breach|phish|phishing|suspicious|compromis|leak|leaked|stolen|unauthori[sz]ed|someone (else )?(logged|signed) in|security (issue|concern|problem))\b/i,
    sentence: "Anything about security goes to Jonathan straight away." },
  { kind: "data_loss", answer: true, re: /\b(lost|disappeared|vanished|gone|deleted|wiped|erased|missing)\b[^.?!]{0,40}\b(data|donors?|gifts?|records?|notes?|everything|history|people|contacts?)\b|\b(data|donors?|gifts?|records?) (are|is|went) (gone|missing)\b/i,
    sentence: "If records may be lost, Jonathan should look himself; nothing gets deleted while he does." },
  { kind: "money", answer: true, re: /\b(payout|deposit|refund|wrong amount|money (is )?missing|missing money|didn.?t get paid|double charged|charged twice|stripe balance|chargeback|dispute)\b/i,
    sentence: "When money may be wrong, Jonathan should check it with you." },
  { kind: "frustrated", answer: true, re: /\b(frustrat\w*|ridiculous|useless|terrible|awful|furious|angry|hate this|fed up|waste of time|still (not|doesn.?t|isn.?t) work\w*|again\?!|wtf|not working again)\b|!{3,}/i,
    sentence: "I'm sorry this has been a struggle. Jonathan can sort it out with you directly." },
];
function handoffFor(question) {
  const s = String(question || "");
  for (const r of HANDOFF_RULES) if (r.re.test(s)) return { kind: r.kind, answer: r.answer, sentence: r.sentence };
  // Shouting counts as frustration: most of a long message in capitals.
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 12 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.7)
    return { kind: "frustrated", answer: true, sentence: HANDOFF_RULES[5].sentence };
  return null;
}

// ── THE ORG'S OWN FACTS ─────────────────────────────────────────────────────
// `ctx` is what the route read for this person, in this org, for their role:
//   { connections: [{ name, provider, status, lastSyncedAt, lastError }],
//     imports: [{ name, committedOn, rowsIn, giftsCreated, donorsCreated, rowsSetAside, rowsErrored }],
//     counts: { donors, gifts }, role, screen }
// This turns the part of it the question is about into sentences, each with
// the screen to fix it on. Nothing here names a donor.
// A question about a connection, and one about something going wrong with
// one. Only the second kind lists the org's broken connections unasked.
const CONNECTION_WORDS = /\b(connect\w*|sync\w*|reconnect|link\w*|gifts? (are|is)?\s*(not|n.?t) (showing|coming|appearing|there)|not (showing|coming in|appearing)|missing gifts?|pull\w* in)\b/i;
const PROBLEM_WORDS = /\b(not|n.?t|never|stopp\w*|broke\w*|fail\w*|error\w*|wrong|missing|sync\w*|disconnect\w*|expired?)\b/i;
const IMPORT_WORDS = /\b(import\w*|upload\w*|spreadsheet|csv|file|move report|set aside|rows?)\b/i;
const DAY = 86400000;
function ago(iso, today) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  const now = today ? Date.parse(today) : t;
  const d = Math.max(0, Math.floor((now - t) / DAY));
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}
const CONNECTIONS_ROUTE = "/app/settings?section=connections";
const IMPORTS_ROUTE = "/app/settings?section=imports";

function contextFacts(question, ctx, today) {
  if (!ctx) return { facts: [], route: null };
  const q = String(question || "").toLowerCase();
  const facts = [];
  let route = null;
  const conns = Array.isArray(ctx.connections) ? ctx.connections : [];
  const named = conns.filter(c => {
    const n = String(c.name || "").toLowerCase(), p = String(c.provider || "").toLowerCase();
    return (n && q.includes(n)) || (p && q.includes(p));
  });
  const aboutConnections = named.length || CONNECTION_WORDS.test(q);
  if (aboutConnections) {
    const list = named.length ? named : PROBLEM_WORDS.test(q) ? conns.filter(c => c.status === "broken" || c.status === "quiet") : [];
    for (const c of list.slice(0, 3)) {
      const when = ago(c.lastSyncedAt, today);
      const parts = [];
      if (c.status === "not_connected") parts.push(`${c.name} is not connected in your organization yet.`);
      else parts.push(`${c.name} ${when ? "last synced " + when : "has not synced yet"}${c.status === "broken" ? " and its last check failed" : c.status === "quiet" ? ", and it has been quieter than usual" : ""}.`);
      if (c.lastError) parts.push(`It says: "${String(c.lastError).slice(0, 220)}"`);
      if (c.status === "broken") parts.push("Reconnect it in Settings, Connections.");
      if (c.status === "not_connected") parts.push("You can connect it in Settings, Connections.");
      facts.push({ kind: "connection", name: c.name, status: c.status, text: parts.join(" ") });
      route = CONNECTIONS_ROUTE;
    }
    if (!list.length && conns.length && !named.length && PROBLEM_WORDS.test(q))
      facts.push({ kind: "connection", text: `Every connection your organization has turned on checked in without an error${conns.some(c => c.lastSyncedAt) ? "" : ", though none has synced yet"}.` });
  }
  const imps = Array.isArray(ctx.imports) ? ctx.imports : [];
  if (IMPORT_WORDS.test(q) && imps.length) {
    const i = imps[0];
    const bits = [`${i.rowsIn} rows read`, `${i.donorsCreated} people added`, `${i.giftsCreated} gifts added`];
    if (i.rowsSetAside) bits.push(`${i.rowsSetAside} set aside`);
    if (i.rowsErrored) bits.push(`${i.rowsErrored} that could not be read`);
    facts.push({ kind: "import", text: `Your most recent import, "${i.name}"${i.committedOn ? " on " + i.committedOn : ""}: ${bits.join(", ")}.${i.rowsSetAside || i.rowsErrored ? " Open it in Settings, Imports to see which rows and why." : ""}` });
    route = route || IMPORTS_ROUTE;
  }
  return { facts, route };
}

// ── THE PROMPT ──────────────────────────────────────────────────────────────
const SUPPORT_SYSTEM = [
  "You are Steward's help assistant, inside Steward, a donor CRM for small nonprofits. You are not Jonathan and never say or imply that you are; Jonathan is the person who built Steward and answers when you hand off.",
  "Answer ONLY from the numbered sources and the facts about the person's organization below. Never use outside knowledge about Steward, never invent a feature, a setting or a button, and never promise anything about the roadmap. If the sources do not answer the question, reply with exactly NOT_COVERED and nothing else.",
  "You only read. You cannot change a record, move money, send anything or run anything. When the person wants something done, tell them where to do it themselves.",
  "Never say when, or whether, something not available today will become available.",
  "Mention a fact about their organization only when it bears on this question. Say about a thing only what a source says about that same thing; never carry a sentence about one screen, connection or feature over to another.",
  "Cite the sources you used as [1], [2] after the sentence they support. Use numbered steps when the source does.",
  "Voice: short, warm and plain. Two to five sentences, or a few steps. Invitation, not pressure. Say people or your team, not users. No em dashes. No statistics.",
].join(" ");

function buildSupportPrompt({ messages, passages, facts, visitor }) {
  const src = (passages || []).map((p, i) => `[${i + 1}] ${p.title}${p.heading ? " · " + p.heading : ""}\n${p.text}`).join("\n\n");
  const about = visitor
    ? "The person is a visitor on Steward's website and is not signed in. You know nothing about their organization."
    : (facts || []).length ? "Facts about the person's own organization, read just now. They are already shown to the person word for word above your answer, so do not repeat them; say what they mean and what to do:\n" + facts.map(f => "- " + f.text).join("\n") : "No facts about the person's organization bear on this question.";
  const turns = (messages || []).slice(-8).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.text || "").slice(0, 2000) }));
  // The sources ride on the newest question, so the model reads them last.
  const last = turns.pop() || { role: "user", content: "" };
  return {
    system: SUPPORT_SYSTEM,
    messages: [...dropLeadingAssistant(turns), { role: "user", content: `Sources:\n\n${src || "(none matched)"}\n\n${about}\n\nQuestion: ${last.content}` }],
  };
}
function dropLeadingAssistant(turns) {
  const out = [];
  for (const t of turns) {
    if (!out.length && t.role === "assistant") continue;
    if (out.length && out[out.length - 1].role === t.role) out[out.length - 1].content += "\n\n" + t.content;
    else out.push({ ...t });
  }
  // Two turns in a row from the person would merge into the question; keep
  // the history ending on an answer so the question stands alone.
  if (out.length && out[out.length - 1].role === "user") out.pop();
  return out;
}

// ── THE ANSWER ──────────────────────────────────────────────────────────────
// Which sources the model cited, by number, kept in order and only real ones.
function citedFrom(text, passages) {
  const nums = [...String(text || "").matchAll(/\[(\d{1,2})\]/g)].map(m => Number(m[1]) - 1);
  const seen = new Set(), out = [];
  for (const n of nums) if (passages[n] && !seen.has(n)) { seen.add(n); out.push(passages[n]); }
  return out;
}
const cite = p => ({ id: p.id, title: p.title, heading: p.heading || null, link: p.link, source: p.source });
const dedupeLinks = list => { const s = new Set(); return list.filter(c => !s.has(c.link) && s.add(c.link)); };

// The screen the answer ends on, as a button. An org fact's screen wins (the
// fix is there), then the best help passage's screen.
const SCREEN_LABEL = r => {
  if (!r) return null;
  if (r === "/dashboard") return "Open Home";
  if (r === "/donors") return "Open Donors";
  const sec = r.match(/section=([a-z]+)/);
  if (sec) return "Open Settings, " + sec[1][0].toUpperCase() + sec[1].slice(1);
  const tab = r.match(/^\/app\/([a-z0-9]+)/);
  return tab ? "Open " + (TAB_NAMES[tab[1]] || tab[1][0].toUpperCase() + tab[1].slice(1)) : "Open it";
};
const TAB_NAMES = { p2p: "Peer-to-peer", fundraising: "Fundraising", communications: "Communications", portal: "Donor Portal" };
function screenButton(route, visitor, label) {
  if (!route || visitor) return null;
  return { label: label || SCREEN_LABEL(route), route };
}

// The template answer: what shows with AI off, when the model fails, and on
// the website. The org's facts first, then the best passage in its own words.
function templateAnswer({ passages, facts }) {
  const top = (passages || [])[0];
  if (!top) return (facts || []).length ? "That is what Steward can see in your organization right now." : "";
  const t = top.text.split("\n").slice(0, 6).join("\n");
  return `${(facts || []).length ? "From the help center, " : ""}${top.title}${top.heading ? ", " + top.heading : ""}:\n${t}`;
}

const NOT_COVERED_SENTENCE = "I couldn't find that in Steward's help, and I'd rather not guess. Jonathan can answer it.";
const VISITOR_NOT_COVERED = "I couldn't find that in Steward's help or on this site, and I'd rather not guess. Jonathan can answer it.";

/**
 * Everything but the model call: what the agent knows, and what it says if it
 * cannot write the sentence itself.
 * @returns { handoff, passages, facts, route, covered }
 */
function prepare({ messages, screen, ctx, visitor, today }) {
  const userTurns = (messages || []).filter(m => m.role !== "assistant");
  const question = String((userTurns[userTurns.length - 1] || {}).text || "").trim();
  const handoff = handoffFor(question);
  // A follow-up ("and then?") ranks with the turn before it.
  const prev = userTurns.length > 1 ? String(userTurns[userTurns.length - 2].text || "") : "";
  let passages = rank(question, { screen, limit: 6 });
  if ((!passages.length || passages[0].score < MIN_SCORE) && prev && tokens(question).length < 4) {
    // ...but only when the answer is still about something THIS question asked:
    // "and Square?" after a PayPal question, not "payroll?" answered with the last FAQ.
    const own = new Set(tokens(question));
    const joint = rank(prev + " " + question, { screen, limit: 6 });
    if (joint[0] && tokens(joint[0].title + " " + joint[0].heading + " " + joint[0].text).some(w => own.has(w))) passages = joint;
  }
  passages = passages.filter(p => p.score >= MIN_SCORE * 0.6);
  const { facts, route: factRoute } = visitor ? { facts: [], route: null } : contextFacts(question, ctx, today);
  const covered = facts.length > 0 || (passages[0] && passages[0].score >= MIN_SCORE);
  const top = passages[0] && passages[0].score >= MIN_SCORE ? passages[0] : null;
  const route = factRoute || (top && top.route) || null;
  // The button says where it goes: the article's own name for a help screen.
  const routeLabel = factRoute ? null : top && top.route && (top.source === "help" || top.source === "helpdoc") ? "Open " + top.title : null;
  return { question, handoff, passages: covered ? passages : [], facts, route, routeLabel, covered: !!covered };
}

/**
 * The reply the person reads. `modelText` is what the model wrote, or null.
 */
function compose(prep, { modelText, visitor, aiOff } = {}) {
  const { handoff, passages, facts, route } = prep;
  let covered = prep.covered;
  let text = null, cited = [], usedModel = false;
  if (handoff && !handoff.answer) {
    return { text: handoff.sentence + " Tap Talk to Jonathan and he will read this whole conversation.", citations: [],
      screen: null, offerJonathan: true, handoff: handoff.kind, covered: false, mode: "handoff" };
  }
  const model = String(modelText || "").trim();
  if (model && /\bNOT_COVERED\b/.test(model)) covered = false;
  else if (model && covered) {
    cited = citedFrom(model, passages); if (!cited.length) cited = passages.slice(0, 2);
    // The sources show as named links under the answer, so the [n] markers go.
    usedModel = true;
    text = model.replace(/\s*\[\d{1,2}\](?:\s*\[\d{1,2}\])*/g, "").replace(/ +([.,;:])/g, "$1").trim();
  }
  if (!text && covered) { text = templateAnswer({ passages, facts }); cited = passages.slice(0, 1); }
  if (!covered) text = visitor ? VISITOR_NOT_COVERED : NOT_COVERED_SENTENCE;
  if (handoff) text += "\n\n" + handoff.sentence;
  return {
    text,
    // The org's own facts, shown as they were read, above whatever the model
    // wrote: the model words the answer, it never states the facts.
    facts: (facts || []).map(f => f.text),
    citations: covered ? dedupeLinks(cited.map(cite)) : [],
    screen: covered ? screenButton(route, visitor, prep.routeLabel) : null,
    // Something Steward does not do (a "does not do" section, a connection
    // that is not built or not offered yet) is said plainly, with Jonathan offered.
    offerJonathan: !covered || !!handoff || !!(passages[0] && (passages[0].kind === "limits" || passages[0].status === "not built" || passages[0].status === "waiting")),
    handoff: handoff ? handoff.kind : (covered ? null : "not_covered"),
    covered,
    mode: !covered ? "not_covered" : usedModel ? "model" : aiOff ? "ai_off" : "template",
  };
}

// The hand-off email: the whole conversation, the org, the screen, the person.
function handoffEmail({ messages, org, user, screen, reason, visitor }) {
  const who = visitor ? `${visitor.name || "A visitor"}${visitor.email ? " <" + visitor.email + ">" : ""} (on the website, not signed in)`
    : `${user.name || user.email} <${user.email}>, ${user.role || "member"} at ${org.name} (${org.id})`;
  const convo = (messages || []).map(m => `${m.role === "assistant" ? "Steward's help assistant" : "Them"}: ${String(m.text || "").trim()}`).join("\n\n");
  return {
    subject: `[Support] ${visitor ? "Website visitor" : org.name}: ${String(((messages || []).filter(m => m.role !== "assistant").pop() || {}).text || "a question").slice(0, 80)}`,
    text: `${who} asked to talk to you${reason ? " (" + reason.replace("_", " ") + ")" : ""}.\n\nScreen: ${screen || "not given"}\n\nThe whole conversation:\n\n${convo || "(no messages)"}\n\nReply to them directly; the assistant has told them a person will.`,
  };
}

module.exports = {
  SUPPORT_TOOLS, SUPPORT_SYSTEM, JONATHAN, MIN_SCORE, INDEX,
  tokens, rank, handoffFor, contextFacts, buildSupportPrompt, prepare, compose, templateAnswer, handoffEmail, screenButton,
};
