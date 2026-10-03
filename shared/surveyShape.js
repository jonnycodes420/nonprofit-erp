// shared/surveyShape.js — SURVEY-1. What a survey is, in one place: the
// builder, the public page, the server's validation and the results all read
// this file, so a question type the builder offers is a type the page can draw
// and the results can count.

export const QUESTION_TYPES = Object.freeze([
  { key: "short",  label: "Short text" },
  { key: "long",   label: "Long text" },
  { key: "one",    label: "One choice" },
  { key: "many",   label: "Several choices" },
  { key: "scale",  label: "0 to 10 scale" },
  { key: "yesno",  label: "Yes or no" },
]);
const TYPE_KEYS = QUESTION_TYPES.map(t => t.key);
export const CHOICE_TYPES = ["one", "many"];
export const MODES = ["named", "anonymous"];
export const AUDIENCES = ["donors", "volunteers", "anyone"];
// PARITY-1 Part D — or a Group: "group:<id>", who the drafts go to is the
// group's members at the moment the drafts are made.
export const GROUP_AUDIENCE_RE = /^group:[A-Za-z0-9_\-]{1,60}$/;
export const groupOfAudience = a => (GROUP_AUDIENCE_RE.test(String(a || "")) ? String(a).slice(6) : null);
export const LIMITS = { title: 140, intro: 2000, thankYou: 1000, label: 300, option: 120, options: 20, questions: 60, sections: 12, answer: 4000 };

// What the page tells respondents, at the top, before the first question.
// Named: who sees it and where it goes. Anonymous: what is NOT kept.
export function privacySentence(mode, orgName) {
  const org = orgName || "This organisation";
  return mode === "anonymous"
    ? `This survey is anonymous. ${org} will see your answers but not who gave them: your name, email address and internet address are not saved with them, and they are not added to anyone's record.`
    : `This survey is not anonymous. Your answers are saved with your name on ${org}'s record of you, so the people there can read them and follow up. They are not shared with anyone else.`;
}

const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const slugId = (p, i) => `${p}${i + 1}`;

// A survey as typed in the builder -> a clean, bounded survey, or { error }.
export function normalizeSurvey(input) {
  const s = input || {};
  const title = clip(s.title, LIMITS.title);
  if (!title) return { error: "A survey needs a title." };
  const mode = MODES.includes(s.mode) ? s.mode : "named";
  const audience = AUDIENCES.includes(s.audience) || GROUP_AUDIENCE_RE.test(String(s.audience || "")) ? s.audience : "anyone";
  const sectionsIn = Array.isArray(s.sections) && s.sections.length ? s.sections : [{ title: "", questions: s.questions || [] }];
  const sections = [];
  let qCount = 0;
  const seen = new Set();
  for (const [si, sec] of sectionsIn.slice(0, LIMITS.sections).entries()) {
    const questions = [];
    for (const [qi, q] of (Array.isArray(sec && sec.questions) ? sec.questions : []).entries()) {
      if (qCount >= LIMITS.questions) break;
      const type = TYPE_KEYS.includes(q && q.type) ? q.type : "short";
      const label = clip(q && q.label, LIMITS.label);
      if (!label) continue;
      let id = clip(q && q.id, 40).replace(/[^a-z0-9_]/gi, "") || slugId(`q${si + 1}_`, qi);
      while (seen.has(id)) id += "x";
      seen.add(id);
      const out = { id, type, label, required: !!(q && q.required) };
      if (CHOICE_TYPES.includes(type)) {
        const opts = [...new Set((Array.isArray(q.options) ? q.options : []).map(o => clip(o, LIMITS.option)).filter(Boolean))].slice(0, LIMITS.options);
        if (opts.length < 2) return { error: `"${label}" needs at least two choices.` };
        out.options = opts;
      }
      questions.push(out);
      qCount++;
    }
    sections.push({ id: clip(sec && sec.id, 40).replace(/[^a-z0-9_]/gi, "") || `s${si + 1}`, title: clip(sec && sec.title, LIMITS.title), questions });
  }
  if (!qCount) return { error: "A survey needs at least one question." };
  return { title, intro: clip(s.intro, LIMITS.intro), thankYou: clip(s.thankYou, LIMITS.thankYou) || "Thank you. Your answers are in.", mode, audience, sections };
}

export const allQuestions = survey => (survey.sections || []).flatMap(s => s.questions || []);

// Raw form values -> stored answers, or { error } naming the first problem.
// Only known question ids are kept; anything else in the submission is dropped.
export function readAnswers(survey, raw) {
  const answers = {};
  for (const q of allQuestions(survey)) {
    let v = raw ? raw[q.id] : undefined;
    if (q.type === "many") {
      const list = (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(String).filter(x => q.options.includes(x));
      if (q.required && !list.length) return { error: `Please answer: ${q.label}` };
      if (list.length) answers[q.id] = [...new Set(list)];
      continue;
    }
    v = v == null ? "" : String(Array.isArray(v) ? v[0] : v).trim();
    if (!v) { if (q.required) return { error: `Please answer: ${q.label}` }; continue; }
    if (q.type === "one" && !q.options.includes(v)) return { error: `Please choose one of the options for: ${q.label}` };
    if (q.type === "scale") { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 10) return { error: `Please choose 0 to 10 for: ${q.label}` }; answers[q.id] = n; continue; }
    if (q.type === "yesno") { if (v !== "yes" && v !== "no") return { error: `Please answer yes or no: ${q.label}` }; answers[q.id] = v; continue; }
    answers[q.id] = v.slice(0, LIMITS.answer);
  }
  return { answers };
}

// The buckets a question's results are counted in. Text questions have one
// bucket: "answered".
export function bucketsFor(q) {
  if (CHOICE_TYPES.includes(q.type)) return q.options.map(o => ({ key: o, label: o }));
  if (q.type === "scale") return Array.from({ length: 11 }, (_, i) => ({ key: String(i), label: String(i) }));
  if (q.type === "yesno") return [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }];
  return [{ key: "answered", label: "Answered" }];
}
export function answerHits(q, answer, bucketKey) {
  if (answer === undefined || answer === null || answer === "") return false;
  if (q.type === "many") return Array.isArray(answer) && answer.includes(bucketKey);
  if (q.type === "short" || q.type === "long") return bucketKey === "answered";
  return String(answer) === bucketKey;
}
