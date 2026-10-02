// routes/surveys.js — SURVEY-1. Ask donors and volunteers, keep the answers.
//
// STAFF SIDE (signed in): build a survey, read its results (every number opens
// its responses, figure source survey-answers), export them, and "Send this
// survey", which writes DRAFTS into the review queue for a person to send.
// Nothing here emails anybody: Steward prepares, staff send.
//
// PUBLIC SIDE: /survey/:orgSlug/:slug, a server-rendered page in the org's own
// band colour and logo (shared/publicPage.js, the shell the volunteer and event
// pages use), embeddable in an iframe. Its first card says, in the words of
// shared/surveyShape.privacySentence, whether it is named or anonymous.
//
// ANONYMOUS MEANS ANONYMOUS. An anonymous answer is stored with no person, no
// name, no email and no internet address: the personal link is not even read,
// the table has no IP column, a CHECK constraint refuses a person on an
// anonymous row, and the audit row for the submission is written without the
// IP (req.audit.withoutIp). It is never put on a timeline.
const express = require("express");
const SL = require("../surveyLinks");

const routers = { r0: express.Router() };

function mount(ctx) {
const {
  actor, checkWriteAccess, donateLimiter, orgToday, orgTz, query, requireAuth, resolveOrgBrandTheme, run, uuid, wrap,
} = ctx;

let S = null, PP = null;
const READY = Promise.all([
  import("../shared/surveyShape.js").then(m => { S = m; }),
  import("../shared/publicPage.js").then(m => { PP = m; }),
]);
const app = routers.r0;
const esc = s => PP.escapeHtml(s);
const parse = v => (typeof v === "string" ? JSON.parse(v || "null") : v);
const shape = r => r && ({
  id: r.id, slug: r.slug, title: r.title, intro: r.intro || "", thankYou: r.thank_you || "", mode: r.mode, audience: r.audience,
  sections: parse(r.sections) || [], status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
  responses: r.responses != null ? Number(r.responses) : undefined,
});
const slugify = t => String(t || "survey").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "survey";
async function uniqueSlug(orgId, title) {
  const base = slugify(title);
  for (let i = 0; i < 50; i++) {
    const s = i ? `${base}-${i + 1}` : base;
    const [hit] = await query("SELECT 1 FROM surveys WHERE org_id=? AND slug=?", [orgId, s]);
    if (!hit) return s;
  }
  return `${base}-${uuid().slice(0, 6)}`;
}
async function orgRow(orgId) { const [o] = await query("SELECT id, name, org_slug FROM orgs WHERE id=?", [orgId]); return o; }
async function ownSurvey(req) {
  const [r] = await query("SELECT * FROM surveys WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  return r || null;
}

// ── STAFF ───────────────────────────────────────────────────────────────────
app.get("/surveys", requireAuth, wrap(async (req, res) => {
  await READY;
  const o = await orgRow(req.user.orgId);
  const rows = await query(
    `SELECT s.*, (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id = s.id)::int AS responses
       FROM surveys s WHERE s.org_id=? ORDER BY s.created_at DESC`, [req.user.orgId]);
  const [org] = await query("SELECT volunteer_survey_id FROM orgs WHERE id=?", [req.user.orgId]);
  res.json({ surveys: rows.map(r => ({ ...shape(r), url: SL.publicUrl(o.org_slug, r.slug) })),
    volunteerSurveyId: (org && org.volunteer_survey_id) || null, types: S.QUESTION_TYPES });
}));

app.post("/surveys", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const n = S.normalizeSurvey(req.body);
  if (n.error) return res.status(400).json({ error: n.error });
  const id = "sv_" + uuid().slice(0, 10), who = actor(req);
  const slug = await uniqueSlug(req.user.orgId, n.title);
  await run(`INSERT INTO surveys (id,org_id,slug,title,intro,thank_you,mode,audience,sections,created_by,created_by_name)
             VALUES (?,?,?,?,?,?,?,?,?::jsonb,?,?)`,
    [id, req.user.orgId, slug, n.title, n.intro, n.thankYou, n.mode, n.audience, JSON.stringify(n.sections), who.id, who.name]);
  const [r] = await query("SELECT * FROM surveys WHERE id=?", [id]);
  res.status(201).json(shape(r));
}));

app.put("/surveys/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const r = await ownSurvey(req);
  if (!r) return res.status(404).json({ error: "Not found" });
  const b = req.body || {};
  if (b.status !== undefined && Object.keys(b).length === 1) {
    if (!["open", "closed"].includes(b.status)) return res.status(400).json({ error: "A survey is open or closed." });
    await run("UPDATE surveys SET status=?, updated_at=NOW() WHERE id=? AND org_id=?", [b.status, r.id, req.user.orgId]);
    return res.json({ ok: true, status: b.status });
  }
  const n = S.normalizeSurvey(b);
  if (n.error) return res.status(400).json({ error: n.error });
  // A survey's promise to the people who already answered it cannot change
  // under them: named stays named, anonymous stays anonymous.
  const [{ c }] = await query("SELECT COUNT(*)::int AS c FROM survey_responses WHERE survey_id=?", [r.id]);
  if (c > 0 && n.mode !== r.mode) return res.status(409).json({ error: "mode_locked",
    sentence: `${c} ${c === 1 ? "person has" : "people have"} already answered this survey as ${r.mode}. Make a new survey to ask it the other way.` });
  await run(`UPDATE surveys SET title=?, intro=?, thank_you=?, mode=?, audience=?, sections=?::jsonb, updated_at=NOW() WHERE id=? AND org_id=?`,
    [n.title, n.intro, n.thankYou, n.mode, n.audience, JSON.stringify(n.sections), r.id, req.user.orgId]);
  const [out] = await query("SELECT * FROM surveys WHERE id=?", [r.id]);
  res.json(shape(out));
}));

// Which survey rides on the volunteer hours thank-you draft (or none).
app.put("/surveys-volunteer-followup", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const want = req.body && req.body.surveyId ? String(req.body.surveyId) : null;
  if (want) {
    const [s] = await query("SELECT id FROM surveys WHERE id=? AND org_id=?", [want, req.user.orgId]);
    if (!s) return res.status(400).json({ error: "Choose one of your surveys." });
  }
  await run("UPDATE orgs SET volunteer_survey_id=? WHERE id=?", [want, req.user.orgId]);
  res.json({ ok: true, surveyId: want });
}));

// RESULTS. Per question, per answer: a count, and the source that opens the
// responses behind it. Text questions also carry their answers.
app.get("/surveys/:id/results", requireAuth, wrap(async (req, res) => {
  await READY;
  const r = await ownSurvey(req);
  if (!r) return res.status(404).json({ error: "Not found" });
  const sv = shape(r);
  const resp = await query(
    `SELECT r.id, r.anonymous, r.answers, r.submitted_at, r.donor_id, COALESCE(d.name, r.respondent_name) AS name
       FROM survey_responses r LEFT JOIN donors d ON d.id = r.donor_id AND d.org_id = r.org_id
      WHERE r.survey_id=? AND r.org_id=? ORDER BY r.submitted_at DESC`, [r.id, req.user.orgId]);
  const questions = S.allQuestions(sv).map(q => {
    const buckets = S.bucketsFor(q).map(b => ({
      ...b, count: resp.filter(x => S.answerHits(q, (parse(x.answers) || {})[q.id], b.key)).length,
      source: { key: "survey-answers", params: { survey: r.id, question: q.id, bucket: b.key } },
    }));
    const answered = resp.filter(x => { const a = (parse(x.answers) || {})[q.id]; return a !== undefined && a !== null && a !== "" && !(Array.isArray(a) && !a.length); }).length;
    return { id: q.id, type: q.type, label: q.label, required: q.required, buckets, answered,
      answeredSource: { key: "survey-answers", params: { survey: r.id, question: q.id } } };
  });
  const o = await orgRow(req.user.orgId);
  res.json({ survey: { ...sv, url: SL.publicUrl(o.org_slug, r.slug) }, total: resp.length,
    totalSource: { key: "survey-answers", params: { survey: r.id } }, questions,
    privacy: S.privacySentence(r.mode, o.name) });
}));

// The responses as a file. A named survey carries the person; an anonymous
// one has nobody to carry.
app.get("/surveys/:id/export.csv", requireAuth, wrap(async (req, res) => {
  await READY;
  const r = await ownSurvey(req);
  if (!r) return res.status(404).json({ error: "Not found" });
  const qs = S.allQuestions(shape(r));
  const resp = await query(
    `SELECT r.*, d.name AS donor_name, d.email AS donor_email FROM survey_responses r
       LEFT JOIN donors d ON d.id = r.donor_id AND d.org_id = r.org_id WHERE r.survey_id=? AND r.org_id=? ORDER BY r.submitted_at`,
    [r.id, req.user.orgId]);
  const cell = v => { const s = Array.isArray(v) ? v.join("; ") : v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["Submitted", "Respondent", "Email", ...qs.map(q => q.label)];
  const lines = [head.map(cell).join(",")];
  for (const x of resp) {
    const a = parse(x.answers) || {};
    lines.push([new Date(x.submitted_at).toISOString(), x.anonymous ? "Anonymous" : (x.donor_name || x.respondent_name || ""),
      x.anonymous ? "" : (x.donor_email || x.respondent_email || ""), ...qs.map(q => a[q.id])].map(cell).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${slugify(r.title)}-responses.csv"`);
  res.send(lines.join("\n") + "\n");
}));

// SEND THIS SURVEY: one DRAFT per person, in the review queue a person sends
// from. A named survey's draft carries that person's own link. Nothing is sent.
app.post("/surveys/:id/drafts", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const r = await ownSurvey(req);
  if (!r) return res.status(404).json({ error: "Not found" });
  const orgId = req.user.orgId, o = await orgRow(orgId), who = actor(req);
  let people;
  if (Array.isArray(req.body && req.body.donorIds) && req.body.donorIds.length) {
    people = await query(`SELECT id, name, email FROM donors WHERE org_id=? AND id = ANY(?) AND deleted_at IS NULL AND COALESCE(email,'') <> ''`,
      [orgId, req.body.donorIds.map(String).slice(0, 200)]);
  } else if (r.audience === "volunteers") {
    people = await query(`SELECT DISTINCT d.id, d.name, d.email FROM donors d JOIN volunteer_shifts s ON s.person_id = d.id AND s.org_id = d.org_id
       WHERE d.org_id=? AND d.deleted_at IS NULL AND COALESCE(d.email,'') <> '' AND s.date >= (CURRENT_DATE - 365)::text LIMIT 200`, [orgId]);
  } else {
    people = await query(`SELECT d.id, d.name, d.email FROM donors d WHERE d.org_id=? AND d.deleted_at IS NULL AND COALESCE(d.email,'') <> ''
       AND EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND g.date >= (CURRENT_DATE - 730)::text)
       ORDER BY d.last_gift_date DESC NULLS LAST LIMIT 200`, [orgId]);
  }
  const key = `survey:${r.id}`;
  const have = new Set((await query(`SELECT donor_id FROM milestone_drafts WHERE org_id=? AND milestone_key=? AND status='pending_review'`, [orgId, key])).map(x => x.donor_id));
  let made = 0;
  for (const p of people) {
    if (have.has(p.id)) continue;
    const link = r.mode === "named" ? SL.personalUrl(o.org_slug, r.slug, r.id, p.id) : SL.publicUrl(o.org_slug, r.slug);
    const first = String(p.name || "").trim().split(/\s+/)[0] || "there";
    const body = `Dear ${first},\n\nWe would like to know what you think. It is a short survey and takes a few minutes:\n\n${link}\n\n`
      + (r.mode === "anonymous" ? "It is anonymous: we will see your answers but not who gave them.\n\n" : "Your answers come straight to us, with your name, so we can follow up.\n\n")
      + `Thank you,\n${o.name}`;
    await run(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,created_by,created_by_name)
               VALUES (?,?,?,?,?,?, 'pending_review', 'survey', ?, ?)`,
      ["md_" + uuid().slice(0, 12), orgId, p.id, key, r.title, body, who.id, who.name]);
    made++;
  }
  req.audit.label(`${made} survey drafts for "${r.title}"`);
  res.status(201).json({ drafts: made, skipped: people.length - made,
    sentence: made ? `${made} draft${made === 1 ? " is" : "s are"} waiting in Communications for you to read and send. Nothing has been sent.`
      : "Everyone this would go to already has a draft waiting. Nothing has been sent." });
}));

// ── PUBLIC ──────────────────────────────────────────────────────────────────
async function publicSurvey(orgSlug, slug) {
  const [r] = await query(
    `SELECT s.*, o.name AS org_name, o.org_slug FROM surveys s JOIN orgs o ON o.id = s.org_id WHERE o.org_slug=? AND s.slug=?`,
    [String(orgSlug), String(slug)]);
  return r || null;
}
async function brandOf(orgId) {
  const t = await resolveOrgBrandTheme(orgId).catch(() => null);
  return t || { band: "#0d5c3a", bandFg: "#ffffff", displayName: "", logoDataUri: null, logoAbsUrl: null };
}
function framable(res) {
  res.setHeader("Cache-Control", "no-store");
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
}
function questionHtml(q, val) {
  const req = q.required ? ` <span class="small">(required)</span>` : "";
  const name = esc(q.id);
  if (q.type === "long") return `<label for="${name}">${esc(q.label)}${req}</label><textarea id="${name}" name="${name}">${esc(val || "")}</textarea>`;
  if (q.type === "short") return `<label for="${name}">${esc(q.label)}${req}</label><input id="${name}" name="${name}" value="${esc(val || "")}">`;
  const opts = q.type === "scale" ? Array.from({ length: 11 }, (_, i) => String(i)) : q.type === "yesno" ? ["yes", "no"] : q.options;
  const kind = q.type === "many" ? "checkbox" : "radio";
  const words = o => (q.type === "yesno" ? (o === "yes" ? "Yes" : "No") : o);
  const chosen = o => (Array.isArray(val) ? val.includes(o) : String(val ?? "") === o);
  const inline = q.type === "scale" || q.type === "yesno";
  return `<fieldset style="border:none;padding:0;margin:14px 0 0"><legend style="font-size:13px;font-weight:600;padding:0">${esc(q.label)}${req}</legend>
    ${q.type === "scale" ? `<div class="small" style="display:flex;justify-content:space-between"><span>0, not at all</span><span>10, completely</span></div>` : ""}
    <div style="display:flex;flex-wrap:wrap;gap:${inline ? "6px" : "4px"};flex-direction:${inline ? "row" : "column"}">
    ${opts.map(o => `<label style="display:flex;align-items:center;gap:8px;font-weight:400;margin:0;min-height:44px;${inline ? "min-width:44px;justify-content:center;border:1px solid #d4cfc6;border-radius:9px;padding:0 10px" : ""}">
      <input type="${kind}" name="${name}" value="${esc(o)}" ${chosen(o) ? "checked" : ""} style="width:20px;min-height:20px;height:20px;margin:0">${esc(words(o))}</label>`).join("")}
    </div></fieldset>`;
}
function surveyPage({ r, brand, token, err, values, embed }) {
  const sv = shape(r);
  const named = r.mode === "named";
  const who = named && !token
    ? `<div class="card"><h2>About you</h2><p class="small">So ${esc(r.org_name)} knows whose answers these are.</p>
        <label for="__name">Your name</label><input id="__name" name="__name" autocomplete="name" value="${esc(values.__name || "")}" required>
        <label for="__email">Your email</label><input id="__email" name="__email" type="email" autocomplete="email" value="${esc(values.__email || "")}" required></div>` : "";
  const sections = sv.sections.map(s => `<div class="card">${s.title ? `<h2>${esc(s.title)}</h2>` : ""}${s.questions.map(q => questionHtml(q, values[q.id])).join("")}</div>`).join("");
  return PP.publicPage({ title: `${sv.title} · ${brand.displayName || r.org_name}`, brand: embed ? { ...brand, displayName: "", logoDataUri: null, logoAbsUrl: null } : brand,
    footer: "Surveys by Steward.", body: `
    <div class="card"><h1>${esc(sv.title)}</h1>${sv.intro ? `<p>${esc(sv.intro)}</p>` : ""}
      <p class="small" data-privacy="${esc(r.mode)}"><strong>${named ? "Named." : "Anonymous."}</strong> ${esc(S.privacySentence(r.mode, r.org_name))}</p></div>
    ${err ? `<div class="err">${esc(err)}</div>` : ""}
    <form method="post">
      ${token && named ? `<input type="hidden" name="t" value="${esc(token)}">` : ""}
      <input class="hp" name="__website" tabindex="-1" autocomplete="off" aria-hidden="true">
      ${who}${sections}
      <button class="btn" type="submit">Send my answers</button>
    </form>` });
}

app.get("/survey/:orgSlug/:slug", donateLimiter, wrap(async (req, res) => {
  await READY;
  const r = await publicSurvey(req.params.orgSlug, req.params.slug);
  const brand = r ? await brandOf(r.org_id) : { band: "#0d5c3a", bandFg: "#fff", displayName: "" };
  framable(res);
  if (!r) return res.status(404).send(PP.publicPage({ title: "Not found", brand, footer: "Surveys by Steward.",
    body: `<div class="card"><h1>That survey is not here.</h1><p class="muted">The link may have changed. Ask the organisation for its current link.</p></div>` }));
  if (r.status !== "open") return res.send(PP.publicPage({ title: r.title, brand, footer: "Surveys by Steward.",
    body: `<div class="card"><h1>${esc(r.title)}</h1><p class="muted">This survey has closed. Thank you for looking.</p></div>` }));
  // A named survey reads the personal link; an anonymous one never does.
  const token = r.mode === "named" && SL.readToken(r.id, req.query.t) ? String(req.query.t) : null;
  res.send(surveyPage({ r, brand, token, err: null, values: {}, embed: req.query.embed === "1" }));
}));

app.post("/survey/:orgSlug/:slug", donateLimiter, express.urlencoded({ extended: false, limit: "200kb" }), wrap(async (req, res) => {
  await READY;
  const r = await publicSurvey(req.params.orgSlug, req.params.slug);
  framable(res);
  if (!r || r.status !== "open") return res.status(404).send(PP.publicPage({ title: "Not found", brand: { band: "#0d5c3a", bandFg: "#fff", displayName: "" },
    footer: "Surveys by Steward.", body: `<div class="card"><h1>That survey is not open.</h1></div>` }));
  const brand = await brandOf(r.org_id);
  const body = req.body || {};
  const anonymous = r.mode === "anonymous";
  req.audit.org(r.org_id);
  if (anonymous) {
    // Nothing about who sent this is read, kept or logged.
    req.audit.withoutIp();
    req.audit.actor({ kind: "anonymous", id: null, name: "An anonymous survey answer" });
  }
  if (body.__website) { req.audit.skip("a form filled in by a robot"); return res.send(thanksPage(r, brand)); }
  const sv = shape(r);
  const got = S.readAnswers(sv, body);
  const values = anonymous ? Object.fromEntries(Object.entries(body).filter(([k]) => !k.startsWith("__") && k !== "t")) : body;
  if (got.error) { req.audit.skip("an answer was missing"); return res.status(400).send(surveyPage({ r, brand, token: anonymous ? null : body.t, err: got.error, values, embed: false })); }

  let donorId = null, name = null, email = null;
  if (!anonymous) {
    donorId = SL.readToken(r.id, body.t);
    if (donorId) {
      const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [donorId, r.org_id]);
      if (!d) donorId = null;
    }
    if (!donorId) {
      name = String(body.__name || "").trim().slice(0, 200);
      email = String(body.__email || "").trim().toLowerCase().slice(0, 254);
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        req.audit.skip("name or email missing");
        return res.status(400).send(surveyPage({ r, brand, token: null, err: "Please give your name and email so we know whose answers these are.", values, embed: false }));
      }
      const [d] = await query("SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND lower(email)=? ORDER BY created_at LIMIT 1", [r.org_id, email]);
      if (d) { donorId = d.id; name = null; email = null; }
    }
  }
  const id = "svr_" + uuid().slice(0, 12);
  await run(`INSERT INTO survey_responses (id,org_id,survey_id,anonymous,donor_id,respondent_name,respondent_email,answers,created_by,created_by_name)
             VALUES (?,?,?,?,?,?,?,?::jsonb,?,?)`,
    [id, r.org_id, r.id, anonymous, donorId, name, email, JSON.stringify(got.answers),
     anonymous ? "system:survey-anonymous" : "system:survey", anonymous ? "An anonymous survey answer" : "A survey answer"]);
  // ON THE TIMELINE, for a named answer that reached a person. It is a touch:
  // engagement.js counts the response itself, so this line is what a person
  // reads, not a second count.
  if (donorId) {
    await run(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,metadata,created_by,logged_by_name)
               VALUES (?,?,?,'survey',?, ?, ?, 'system:survey', 'Survey')`,
      ["int_" + uuid().slice(0, 10), r.org_id, donorId, `Answered the survey "${r.title}"`,
       orgToday(await orgTz(r.org_id)), JSON.stringify({ survey_id: r.id, response_id: id })]);   // ORG_TZ_SEAM_OK
  }
  req.audit.entity("survey_response", id, r.title);
  req.audit.after({ survey: r.title, anonymous, linked_to_a_person: !!donorId });
  res.send(thanksPage(r, brand));
}));
function thanksPage(r, brand) {
  return PP.publicPage({ title: r.title, brand, footer: "Surveys by Steward.",
    body: `<div class="card"><h1>${esc(r.title)}</h1><div class="ok">${esc(r.thank_you || "Thank you. Your answers are in.")}</div></div>` });
}
}

module.exports = { routers, mount };
