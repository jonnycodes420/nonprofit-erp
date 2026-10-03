// shared/volunteerApply.js · PARITY-3 Part 2. THE APPLICATION FORM'S RULES.
//
// The org's public volunteer page has an Apply button. The form asks the
// person's name, email and phone, the custom questions the org wrote, and
// when they are free. A question is one of four kinds:
//   text    a few words or a paragraph
//   choice  one of the options the org listed
//   yesno   yes or no
//   file    a file they attach, usually a signed waiver (PDF or a photo)
// Questions are validated when the org saves them and answers when somebody
// applies, by these two functions, in the browser and again on the server.
export const QUESTION_TYPES = ["text", "choice", "yesno", "file"];
export const TYPE_WORDS = { text: "Text", choice: "Choice", yesno: "Yes or no", file: "File upload" };
export const MAX_QUESTIONS = 15;
export const AVAILABILITY = ["Weekday mornings", "Weekday afternoons", "Weekday evenings", "Saturdays", "Sundays"];

export function validateQuestions(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const errors = [], out = [], ids = new Set();
  if (list.length > MAX_QUESTIONS) errors.push(`Ask up to ${MAX_QUESTIONS} questions.`);
  list.slice(0, MAX_QUESTIONS).forEach((q, i) => {
    const label = String((q && q.label) || "").trim().slice(0, 200);
    const type = String((q && q.type) || "");
    if (!label) { errors.push(`Question ${i + 1} needs words.`); return; }
    if (!QUESTION_TYPES.includes(type)) { errors.push(`Question ${i + 1} is text, a choice, yes or no, or a file.`); return; }
    let id = String((q && q.id) || "").replace(/[^a-z0-9_]/gi, "").slice(0, 24) || `q${i + 1}`;
    while (ids.has(id)) id += "x";
    ids.add(id);
    const options = type === "choice"
      ? [...new Set((Array.isArray(q.options) ? q.options : String(q.options || "").split("\n")).map(o => String(o).trim().slice(0, 80)).filter(Boolean))].slice(0, 12)
      : [];
    if (type === "choice" && options.length < 2) { errors.push(`"${label}" needs at least two choices.`); return; }
    out.push({ id, label, type, required: q.required === true, options });
  });
  return { ok: errors.length === 0, errors, questions: out };
}

// The answers somebody gave, against the questions as they stand. `files`
// maps a question id to an uploaded file the caller has already checked.
export function validateAnswers(questions, body = {}, files = {}) {
  const errors = [], answers = [];
  for (const q of questions || []) {
    const raw = body[`q_${q.id}`];
    let answer = null, answerText = "";
    if (q.type === "text") { answer = String(raw || "").trim().slice(0, 2000) || null; answerText = answer || ""; }
    else if (q.type === "choice") { const v = String(raw || ""); answer = q.options.includes(v) ? v : null; answerText = answer || ""; }
    else if (q.type === "yesno") { answer = raw === "yes" ? true : raw === "no" ? false : null; answerText = answer === null ? "" : answer ? "Yes" : "No"; }
    else if (q.type === "file") { const f = files[q.id]; answer = f ? { assetId: f.assetId, fileName: f.fileName } : null; answerText = f ? f.fileName : ""; }
    if (q.required && (answer === null || answer === "")) errors.push(`Please answer: ${q.label}`);
    answers.push({ questionId: q.id, question: q.label, type: q.type, answer, answerText });
  }
  const availability = (Array.isArray(body.availability) ? body.availability : body.availability ? [body.availability] : [])
    .map(String).filter(a => AVAILABILITY.includes(a));
  return { ok: errors.length === 0, errors, answers, availability: [...new Set(availability)] };
}
