// shared/formConfig.js — BUILD-102 (Steward Give) Part 1. WHAT A DONATION FORM IS.
//
// ── A FORM IS A GIVING PAGE WITH A FORM CONFIG. THERE IS NO FORMS TABLE ────
// BUILD-95 §5B settled that a giving page is `giving_pages` + a widget list, and
// that the form is NOT a widget — a page whose whole job is taking a gift must
// not be able to lose it. A form is therefore the SAME row plus a
// `form_config` JSONB beside the widgets: what the donor is offered, in one
// place, validated once.
//
// A second `forms` table would mean two ways to reach one Stripe account, two
// places a designation could be set, and two answers to "which form took this
// gift". The whole premise of this product is that the form and the CRM are one
// system; a second table is the first step to them being two.
//
// ── THIS MODULE IS THE ONE VALIDATOR, AND THAT IS THE POINT ────────────────
// The `shared/pageWidgets.js` pattern, for the same reason: before that module a
// widget was declared in three places nothing kept in step, and no test could
// see the drift because there was nothing to compare the three against. A form
// config has exactly the same shape of risk — the editor offers a field, the
// server validates a different set, the renderer draws a third — so the editor,
// the server and the renderer all read THIS.
//
// ── AND `formSpec` IS THE ONE RENDERER'S INPUT ─────────────────────────────
// The editor's phone preview and the page a stranger opens from a QR code draw
// from the SAME spec, derived here. Not "the same component fed similar props" —
// the same function, so a preview cannot show a field the donor will not get.
//
// AMOUNTS ARE INTEGER CENTS everywhere in here. A suggested-amount list is money
// on a screen; `money.js` is the seam and a float is how $25 becomes $24.99.
//
// Pure: no DB, no network, no clock, no JSX. The caller supplies the org's own
// fund ids, because whether a fund belongs to this org is a fact about the
// database and this module may not guess at it.

// ── THE SHAPE ──────────────────────────────────────────────────────────────
export const FREQUENCIES = ["once", "monthly"];
export const DEFAULT_FREQUENCY = "once";

export const DESIGNATION_MODES = [
  { key: "none",   label: "Undesignated",
    blurb: "The gift arrives without a fund, and whoever posts it decides. Steward records that nobody chose." },
  { key: "fixed",  label: "One fund, chosen by you",
    blurb: "Every gift through this form goes to the fund you name. The donor is not asked." },
  { key: "choice", label: "The donor picks",
    blurb: "The donor chooses from the funds you list, and only from those." },
];
export const DESIGNATION_MODE_KEYS = DESIGNATION_MODES.map(m => m.key);

export const QUESTION_TYPES = [
  { key: "text",  label: "Short text",  cfType: "text" },
  { key: "choice", label: "Choose one", cfType: "select" },
  { key: "yesno", label: "Yes or no",   cfType: "checkbox" },
];
export const QUESTION_TYPE_KEYS = QUESTION_TYPES.map(q => q.key);
export function questionType(key) { return QUESTION_TYPES.find(q => q.key === key) || null; }

// A CUSTOM QUESTION IS A CUSTOM FIELD ON THE PERSON, so its key obeys the report
// builder's own rule — that is what makes an answer filterable in a saved report
// like any other field rather than a string in a JSONB nobody can query.
export const QUESTION_KEY = /^[a-z][a-z0-9_]{0,59}$/;

export const LIMITS = {
  amounts: 8,          // eight buttons is already more than a phone can show well
  amountCentsMax: 100000000,   // $1,000,000 — a form is not how a capital gift arrives
  questions: 5,        // a donation form is not a survey
  choiceOptions: 12,
  labelChars: 120,
  messageChars: 2000,
};

export const DEFAULT_AMOUNTS_CENTS = [2500, 5000, 10000, 25000];

export const DEFAULT_CONFIG = Object.freeze({
  amountsCents: [...DEFAULT_AMOUNTS_CENTS],
  allowOther: true,
  defaultFrequency: DEFAULT_FREQUENCY,
  offerMonthly: true,
  designation: { mode: "none", fundId: null, fundIds: [] },
  showTribute: false,
  showEmployerMatch: false,
  questions: [],
  thankYou: { message: "", redirectUrl: "" },
  headline: "",
});

// Every key this module knows. AN UNKNOWN KEY IS REFUSED BY NAME rather than
// ignored: a config silently dropping `suggestedAmounts` because the real key is
// `amountsCents` is an editor saving nothing and saying it saved.
export const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG);

const isInt = v => Number.isInteger(v);
const str = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

// ── VALIDATION ─────────────────────────────────────────────────────────────
// `orgFundIds` is the set of fund ids that belong to THIS org. A designation
// naming anything else is refused — the BUILD-37 B9 rule applied to a config
// rather than a request: the caller does not get to assert what it owns.
export function validateFormConfig(raw, { orgFundIds = [], existingQuestionKeys = [] } = {}) {
  const errors = [];
  const own = new Set(orgFundIds || []);
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: [{ field: "config", message: "A form configuration is a set of settings." }], config: null };
  }

  for (const k of Object.keys(input)) {
    if (!CONFIG_KEYS.includes(k)) {
      errors.push({ field: k, message: `"${k}" is not a setting on a donation form. The settings are: ${CONFIG_KEYS.join(", ")}.` });
    }
  }

  const out = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  // AMOUNTS. Integer cents, ascending, each over zero, no duplicates — a form
  // offering $50 twice is a form somebody edited in two places.
  if (input.amountsCents !== undefined) {
    const a = Array.isArray(input.amountsCents) ? input.amountsCents : null;
    if (!a) errors.push({ field: "amountsCents", message: "Suggested amounts are a list." });
    // AN EMPTY LIST IS A REAL FORM: just a box to type an amount into, which is
    // what some orgs want and what Zeffy's form does. Refusing it here also made
    // the "nobody can give" rule below UNREACHABLE — a guard that cannot fire,
    // which the suite caught on its first run.
    else if (!a.length) out.amountsCents = [];
    else if (a.length > LIMITS.amounts) errors.push({ field: "amountsCents", message: `At most ${LIMITS.amounts} suggested amounts — more than that will not fit on a phone.` });
    else {
      const bad = a.find(v => !isInt(v) || v <= 0 || v > LIMITS.amountCentsMax);
      if (bad !== undefined) errors.push({ field: "amountsCents", message: "Every suggested amount is a whole number of cents above zero." });
      else if (new Set(a).size !== a.length) errors.push({ field: "amountsCents", message: "The same amount is listed twice." });
      else out.amountsCents = [...a].sort((x, y) => x - y);
    }
  }
  if (input.allowOther !== undefined) {
    if (typeof input.allowOther !== "boolean") errors.push({ field: "allowOther", message: "Whether a donor may type their own amount is yes or no." });
    else out.allowOther = input.allowOther;
  }
  if (out.allowOther === false && (!out.amountsCents || !out.amountsCents.length)) {
    errors.push({ field: "amountsCents", message: "With no suggested amounts and no box to type one in, nobody can give." });
  }

  if (input.defaultFrequency !== undefined) {
    if (!FREQUENCIES.includes(input.defaultFrequency)) {
      errors.push({ field: "defaultFrequency", message: `A form opens on one-time or monthly.` });
    } else out.defaultFrequency = input.defaultFrequency;
  }
  if (input.offerMonthly !== undefined) {
    if (typeof input.offerMonthly !== "boolean") errors.push({ field: "offerMonthly", message: "Whether monthly is offered is yes or no." });
    else out.offerMonthly = input.offerMonthly;
  }
  // A FORM THAT OPENS ON MONTHLY MUST OFFER MONTHLY. The two settings can
  // contradict each other and the donor would meet a frequency they cannot pick.
  if (out.defaultFrequency === "monthly" && out.offerMonthly === false) {
    errors.push({ field: "offerMonthly", message: "This form opens on monthly giving, so monthly has to be one of the choices." });
  }

  if (input.designation !== undefined) {
    const d = input.designation && typeof input.designation === "object" && !Array.isArray(input.designation) ? input.designation : null;
    if (!d) errors.push({ field: "designation", message: "The designation is a setting with a mode." });
    else if (!DESIGNATION_MODE_KEYS.includes(d.mode)) {
      errors.push({ field: "designation.mode", message: `A designation is one of: ${DESIGNATION_MODES.map(m => m.label).join(", ")}.` });
    } else if (d.mode === "fixed") {
      if (!d.fundId || !own.has(String(d.fundId))) {
        errors.push({ field: "designation.fundId", message: "Name one of your own funds. A fund that is not on your chart of accounts cannot take a gift." });
      } else out.designation = { mode: "fixed", fundId: String(d.fundId), fundIds: [] };
    } else if (d.mode === "choice") {
      const ids = Array.isArray(d.fundIds) ? d.fundIds.map(String) : [];
      const foreign = ids.filter(id => !own.has(id));
      if (!ids.length) errors.push({ field: "designation.fundIds", message: "List the funds a donor may choose from." });
      else if (foreign.length) {
        errors.push({ field: "designation.fundIds", message: `${foreign.length === 1 ? "One fund is" : `${foreign.length} funds are`} not yours. A donor may only be offered funds on your own chart of accounts.`, foreign });
      } else if (new Set(ids).size !== ids.length) {
        errors.push({ field: "designation.fundIds", message: "The same fund is listed twice." });
      } else out.designation = { mode: "choice", fundId: null, fundIds: ids };
    } else {
      out.designation = { mode: "none", fundId: null, fundIds: [] };
    }
  }

  for (const k of ["showTribute", "showEmployerMatch"]) {
    if (input[k] !== undefined) {
      if (typeof input[k] !== "boolean") errors.push({ field: k, message: "That setting is yes or no." });
      else out[k] = input[k];
    }
  }

  // QUESTIONS. Each becomes a custom field on the person, so each needs a key
  // the report builder will accept and a label somebody wrote.
  if (input.questions !== undefined) {
    const qs = Array.isArray(input.questions) ? input.questions : null;
    if (!qs) errors.push({ field: "questions", message: "Questions are a list." });
    else if (qs.length > LIMITS.questions) {
      errors.push({ field: "questions", message: `At most ${LIMITS.questions} questions. A donation form is not a survey, and every extra question costs gifts.` });
    } else {
      const seen = new Set(), clean = [];
      qs.forEach((q, i) => {
        const at = `questions[${i}]`;
        if (!q || typeof q !== "object") { errors.push({ field: at, message: "A question is a setting with a label and a type." }); return; }
        const label = str(q.label, LIMITS.labelChars);
        if (!label) { errors.push({ field: at + ".label", message: "A question needs the words the donor reads." }); return; }
        if (!QUESTION_TYPE_KEYS.includes(q.type)) {
          errors.push({ field: at + ".type", message: `A question is one of: ${QUESTION_TYPES.map(t => t.label).join(", ")}.` }); return;
        }
        const key = String(q.key || "");
        if (!QUESTION_KEY.test(key)) {
          errors.push({ field: at + ".key", message: "A question's key is lower-case letters, digits and underscores, starting with a letter." }); return;
        }
        if (seen.has(key)) { errors.push({ field: at + ".key", message: `Two questions both answer to "${key}".` }); return; }
        seen.add(key);
        let options = [];
        if (q.type === "choice") {
          options = (Array.isArray(q.options) ? q.options : []).map(o => str(o, LIMITS.labelChars)).filter(Boolean);
          if (options.length < 2) { errors.push({ field: at + ".options", message: "A choice needs at least two answers to choose between." }); return; }
          if (options.length > LIMITS.choiceOptions) { errors.push({ field: at + ".options", message: `At most ${LIMITS.choiceOptions} answers.` }); return; }
          if (new Set(options).size !== options.length) { errors.push({ field: at + ".options", message: "The same answer is offered twice." }); return; }
        }
        clean.push({ key, label, type: q.type, options, required: q.required === true });
      });
      if (!errors.some(e => e.field.startsWith("questions"))) out.questions = clean;
    }
  }

  if (input.thankYou !== undefined) {
    const t = input.thankYou && typeof input.thankYou === "object" && !Array.isArray(input.thankYou) ? input.thankYou : null;
    if (!t) errors.push({ field: "thankYou", message: "The thank-you is a message and an optional redirect." });
    else {
      const message = str(t.message, LIMITS.messageChars);
      const redirectUrl = String(t.redirectUrl || "").trim().slice(0, 500);
      // A REDIRECT IS AN OUTBOUND LINK A DONOR FOLLOWS immediately after paying,
      // so https only and no credentials in it (the BUILD-37 G5 shape). A
      // malformed one is refused rather than quietly dropped — a page that says
      // it redirects and does not is worse than one that never offered to.
      if (redirectUrl) {
        let u = null;
        try { u = new URL(redirectUrl); } catch { u = null; }
        if (!u || u.protocol !== "https:") {
          errors.push({ field: "thankYou.redirectUrl", message: "A redirect has to be a full https:// address." });
        } else if (u.username || u.password) {
          errors.push({ field: "thankYou.redirectUrl", message: "A redirect cannot carry a username or a password." });
        } else out.thankYou = { message, redirectUrl: u.toString() };
      } else out.thankYou = { message, redirectUrl: "" };
    }
  }
  if (input.headline !== undefined) out.headline = str(input.headline, LIMITS.labelChars);

  return { ok: errors.length === 0, errors, config: errors.length ? null : out };
}

// A stored config may predate a setting, so reading one fills from the defaults
// and never throws. `normalizeFormConfig` is what every READ goes through.
//
// IT TAKES THE ORG'S FUND IDS, and that is not a second ownership check — the
// ownership question was settled at WRITE time. At read time the funds handed in
// ARE the org's own, and without them a `choice` designation would fail its own
// validation and the form would fall back to undesignated: a live form quietly
// stopping asking the question it was built to ask. (The first cut did exactly
// that, and the smoke test caught it in one line.)
export function normalizeFormConfig(stored, { orgFundIds = [] } = {}) {
  const opts = { orgFundIds };
  const v = validateFormConfig(stored && typeof stored === "object" ? stored : {}, opts);
  if (v.ok) return v.config;
  // A stored config that no longer validates (a fund was deleted, a setting was
  // retired) still has to render a working form — so take the keys that DO
  // validate and let the rest fall back. Refusing to render is the one outcome a
  // live donation form may never have.
  const out = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  for (const k of CONFIG_KEYS) {
    if (!stored || stored[k] === undefined) continue;
    const one = validateFormConfig({ [k]: stored[k] }, opts);
    if (one.ok) out[k] = one.config[k];
  }
  return out;
}

// ── THE SPEC BOTH SURFACES RENDER ──────────────────────────────────────────
// `funds` is [{id, name}] for the org, so the spec carries NAMES and the
// renderer never looks anything up. Three steps, because the brief says three
// and because a donor who has typed an amount is committed in a way a donor
// staring at one long form is not.
export const STEPS = [
  { key: "amount",  label: "Your gift" },
  { key: "details", label: "About you" },
  { key: "payment", label: "Payment" },
];

export function formSpec(storedConfig, { funds = [], orgName = "", currency = "USD" } = {}) {
  const byId = new Map((funds || []).map(f => [String(f.id), String(f.name || "")]));
  // A FUND DELETED SINCE THE FORM WAS SAVED DROPS OUT, and the rest of the choice
  // survives. Handing the stored list straight to the validator made the whole
  // designation invalid (one dead id = "not yours") and the form fell back to
  // undesignated — a live form that quietly stopped asking the question it was
  // built to ask. So the survivors are filtered FIRST, then validated.
  let stored = storedConfig;
  const d = storedConfig && storedConfig.designation;
  if (d && d.mode === "choice" && Array.isArray(d.fundIds)) {
    stored = { ...storedConfig, designation: { ...d, fundIds: d.fundIds.map(String).filter(id => byId.has(id)) } };
    if (!stored.designation.fundIds.length) stored.designation = { mode: "none", fundId: null, fundIds: [] };
  } else if (d && d.mode === "fixed" && d.fundId && !byId.has(String(d.fundId))) {
    stored = { ...storedConfig, designation: { mode: "none", fundId: null, fundIds: [] } };
  }
  const c = normalizeFormConfig(stored, { orgFundIds: [...byId.keys()] });
  const designation =
    c.designation.mode === "fixed"
      ? { mode: "fixed", fundId: c.designation.fundId, fundName: byId.get(String(c.designation.fundId)) || null }
      : c.designation.mode === "choice"
        // A fund that has since been deleted drops out of the list rather than
        // rendering an option that cannot be honoured.
        ? { mode: "choice", options: c.designation.fundIds.filter(id => byId.has(String(id)))
              .map(id => ({ fundId: String(id), fundName: byId.get(String(id)) })) }
        : { mode: "none" };
  if (designation.mode === "choice" && !designation.options.length) designation.mode = "none";

  return {
    currency, orgName: String(orgName || ""),
    // WHETHER ANYBODY HAS CONFIGURED THIS FORM. `formSpec` always returns a
    // working form, which is what makes a NULL config safe — but the PAGE needs
    // to know the difference, because an unconfigured giving page must render
    // byte-for-byte what it always did (the BUILD-95 §5B rule: an unbuilt page is
    // unchanged). The three-step flow is the Steward Give product; it does not
    // retro-fit itself onto every giving page that already exists.
    configured: !!(storedConfig && typeof storedConfig === "object" && Object.keys(storedConfig).length),
    headline: c.headline,
    steps: STEPS.map(s => ({ ...s })),
    amount: {
      amountsCents: [...c.amountsCents],
      allowOther: c.allowOther,
      frequencies: c.offerMonthly ? [...FREQUENCIES] : ["once"],
      defaultFrequency: c.offerMonthly ? c.defaultFrequency : "once",
    },
    designation,
    details: { tribute: c.showTribute, employerMatch: c.showEmployerMatch,
               questions: c.questions.map(q => ({ ...q, options: [...q.options] })) },
    thankYou: { ...c.thankYou },
    // THE SENTENCE UNDER THE FORM. Not a boast and not a fee disclosure — the one
    // fact a donor deciding whether to type a card number wants: where the money
    // goes, and who takes a cut. Steward takes none, and never touches it.
    trustLine: `Your gift goes to ${String(orgName || "this organisation")} directly. Steward never holds or moves it.`,
  };
}

// A stable fingerprint of the spec, so a suite can assert the editor's preview
// and the public page derive the SAME form rather than two similar ones. Key
// order is normalised, so a reordered object is the same form.
export function specFingerprint(spec) {
  const norm = v => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.keys(v).sort().reduce((o, k) => { o[k] = norm(v[k]); return o; }, {});
    }
    return v;
  };
  return JSON.stringify(norm(spec));
}

// The sentence the editor shows beside the designation choice, from the registry
// rather than a copy of it (the BUILD-86 C.3 rule).
export function designationBlurb(mode) {
  const m = DESIGNATION_MODES.find(x => x.key === mode);
  return m ? m.blurb : "";
}

// ── BUILD-102 Part 2 — THE FORM'S CONFIG CONSTRAINS THE CHARGE ─────────────
// The server already prices every charge; this is the narrower rule the config
// adds: a form that offers four amounts and no box to type in may not be charged
// $3.17 because somebody edited the request. `checkRequestedAmount` is the ONE
// place that decides, and the donate route calls it — so the rule cannot live on
// the page, where it is a suggestion.
export function checkRequestedAmount(config, requestedCents, { funds = [] } = {}) {
  const c = normalizeFormConfig(config, { orgFundIds: (funds || []).map(f => String(f.id)) });
  const cents = Number(requestedCents);
  if (!Number.isInteger(cents) || cents <= 0) {
    return { ok: false, code: "bad_amount", message: "Choose an amount." };
  }
  if (!c.allowOther && !c.amountsCents.includes(cents)) {
    // THE MESSAGE NAMES WHAT IS ON OFFER, because a donor who typed a number and
    // was refused needs to know what to press instead.
    return { ok: false, code: "amount_not_offered",
      message: "Choose one of the amounts on the form.", amountsCents: [...c.amountsCents] };
  }
  return { ok: true, amountCents: cents };
}

// THE DESIGNATION IS THE FORM'S, NOT THE REQUEST'S. A fixed form ignores whatever
// fund the request carried; a choice form accepts only from its own list; an
// undesignated form lands undesignated, which is a real answer rather than a
// guess. This is the BUILD-88a rule ("which fund is the default is the SERVER's
// to say") applied to a public page.
export function resolveDesignation(config, requestedFundId, { funds = [] } = {}) {
  const ids = (funds || []).map(f => String(f.id));
  const c = normalizeFormConfig(config, { orgFundIds: ids });
  const asked = requestedFundId ? String(requestedFundId) : null;
  if (c.designation.mode === "fixed") {
    // Silently, and deliberately: the donor was never asked, so there is nothing
    // to report to them. The form said where this money goes.
    return { fundId: c.designation.fundId, from: "form_fixed", ignoredRequest: !!asked && asked !== c.designation.fundId };
  }
  if (c.designation.mode === "choice") {
    const allowed = c.designation.fundIds.filter(id => ids.includes(id));
    if (!asked) return { fundId: null, from: "donor_chose_nothing" };
    if (!allowed.includes(asked)) {
      return { fundId: null, from: "refused", code: "fund_not_offered",
        message: "That fund is not one this form offers." };
    }
    return { fundId: asked, from: "donor_choice" };
  }
  // `none`: an amount arriving with a fund nobody was offered is refused rather
  // than honoured — the form did not ask, so the request cannot answer.
  if (asked) {
    return { fundId: null, from: "refused", code: "fund_not_offered",
      message: "This form does not ask which fund a gift goes to." };
  }
  return { fundId: null, from: "undesignated" };
}

// ── THE UPSELL ─────────────────────────────────────────────────────────────
// A one-time gift at or above the org's threshold is asked ONCE whether it could
// be monthly. The suggestion is a THIRD of the gift, rounded to a whole dollar,
// because a third of $150 is $50 and "$50 a month" is a sentence somebody can
// picture — $12.50 a month is a decimal nobody chooses.
//
// It is asked ONCE. A decline is final for that session, and the reason is not
// politeness: a second ask is the pattern every donor recognises as a trick, and
// it costs the one-time gift that was already in hand.
export const UPSELL_DEFAULT_THRESHOLD_CENTS = 10000;   // $100
export const UPSELL_FRACTION = 3;                      // a third
export const UPSELL_MIN_MONTHLY_CENTS = 500;           // $5 — below that it is not worth asking

export function monthlySuggestionCents(oneTimeCents) {
  const c = Number(oneTimeCents);
  if (!Number.isInteger(c) || c <= 0) return null;
  // Whole dollars, rounded to the NEAREST — a third of $100 is $33, not $33.33
  // and not $34.
  const dollars = Math.round(c / UPSELL_FRACTION / 100);
  return dollars * 100;
}

export function upsellFor(oneTimeCents, { thresholdCents = UPSELL_DEFAULT_THRESHOLD_CENTS,
                                          offerMonthly = true, frequency = "once" } = {}) {
  const c = Number(oneTimeCents);
  const threshold = Number.isInteger(Number(thresholdCents)) ? Number(thresholdCents) : UPSELL_DEFAULT_THRESHOLD_CENTS;
  // A MONTHLY GIFT IS NEVER UPSOLD. It is already the thing being asked for, and
  // asking a monthly donor to go monthly is the software not reading its own page.
  if (frequency !== "once") return { offer: false, why: "already_recurring" };
  if (!offerMonthly) return { offer: false, why: "monthly_not_offered" };
  if (!Number.isInteger(c) || c < threshold) return { offer: false, why: "below_threshold" };
  const monthlyCents = monthlySuggestionCents(c);
  if (!monthlyCents || monthlyCents < UPSELL_MIN_MONTHLY_CENTS) return { offer: false, why: "suggestion_too_small" };
  return { offer: true, monthlyCents, annualCents: monthlyCents * 12, why: null };
}

// The sentence, which states the arithmetic rather than selling it. `fm` takes
// cents. No exclamation mark, no "just" — a monthly gift is a commitment and
// pretending otherwise is how it gets cancelled in March.
export function upsellSentence(u, fm) {
  const f = typeof fm === "function" ? fm : (c => String(c));
  if (!u || !u.offer) return "";
  return `${f(u.monthlyCents)} a month comes to ${f(u.annualCents)} over a year, and it lets them plan.`;
}
