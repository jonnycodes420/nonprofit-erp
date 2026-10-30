// GIVE-EDIT-1 · EVERY GIVING PAGE IS EDITED IN ONE PLACE
//
// A giving page's own fields (headline, story, photo, the goal bar, where the
// gift goes, and the form: its amounts, which frequency it opens on, the
// fee-cover box and the thank-you) are edited in the one page editor
// (/portal-editor?page=gp_…), beside the blocks. They wait as a DRAFT in
// `giving_pages.draft_settings` until a person publishes, exactly like the
// blocks wait in `draft`. Publishing never touches the slug, so the link on a
// poster keeps working. Each publish is kept in `giving_page_versions`, with
// who did it, and any of them can be put back.
//
// Pure: no database, no network. The caller hands in the form-config module
// (shared/formConfig.js is ESM) and the org's own fund and campaign ids.

const IMAGE_PATH = /^\/portal-assets\/pa_[a-f0-9]{24}$/;

// ── THE TEMPLATES ─────────────────────────────────────────────────────────
// Each starts in plain, warm words a director could publish as they are, and
// none invents a number, a quote or a person. The form settings are only the
// ones that make the template what it is.
const TEMPLATES = {
  givingtuesday: {
    label: "GivingTuesday",
    blurb: "One day when people everywhere choose to give. A short page and a one-time gift.",
    title: "Give on GivingTuesday",
    story: "GivingTuesday is one day when people everywhere choose to give, and we would be so grateful if you chose us.\n\nEvery gift today goes straight to the work you already believe in. Thank you for standing with us.",
    form: { amountsCents: [2500, 5000, 10000, 25000], defaultFrequency: "once",
            thankYou: { message: "Thank you for giving on GivingTuesday. Your gift is already at work, and we will write to tell you what it made possible.", redirectUrl: "" } },
  },
  yearend: {
    label: "Year-end",
    blurb: "Close the year together. A gift before December 31 counts toward this year's taxes.",
    title: "Close the year with us",
    story: "This year you helped make real things happen. A gift before December 31 carries that work into the new year, and it counts toward this year's taxes.\n\nThank you for being part of it.",
    form: { amountsCents: [5000, 10000, 25000, 50000], defaultFrequency: "once",
            thankYou: { message: "Thank you for closing the year with us.", redirectUrl: "" } },
  },
  event: {
    label: "An event",
    blurb: "For the people in the room, and the ones who wish they could be.",
    title: "Give in honor of the evening",
    story: "Thank you for being with us. If you could not be there in person, or you would like to give a little more, a gift here supports the same work the evening celebrates.",
    form: { amountsCents: [2500, 5000, 10000, 25000], defaultFrequency: "once",
            thankYou: { message: "Thank you for being part of the evening. We are so glad you are with us.", redirectUrl: "" } },
  },
  tribute: {
    label: "In memory or in honor",
    blurb: "A gift in someone's name, with a place to tell us who it is for.",
    title: "Give in memory or in honor",
    story: "A gift in someone's name is a way to keep their story going.\n\nTell us who you are giving for and, if you would like, who should hear about it. We will let them know with care.",
    form: { amountsCents: [2500, 5000, 10000, 25000], defaultFrequency: "once", showTribute: true,
            thankYou: { message: "Thank you for this gift and for the person it honors. We will take good care of both.", redirectUrl: "" } },
  },
  monthly: {
    label: "Monthly giving",
    blurb: "The steadiest support there is. Opens on a monthly gift.",
    title: "Give every month",
    story: "A monthly gift is the steadiest support there is. It lets us plan ahead, say yes sooner and keep going through the quiet months.\n\nYou can change or stop it at any time.",
    form: { amountsCents: [1000, 2500, 5000, 10000], defaultFrequency: "monthly", offerMonthly: true,
            thankYou: { message: "Thank you for giving every month. You are the steady ground this work stands on.", redirectUrl: "" } },
  },
};
const templateList = () => Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, blurb: t.blurb }));

// FIX-41: a cover's words for a screen reader and its focal point (0..1).
function readImageMeta(v) {
  const m = v && typeof v === "object" ? v : {};
  const n = x => { const f = Number(x); return Number.isFinite(f) ? Math.min(1, Math.max(0, Math.round(f * 1000) / 1000)) : 0.5; };
  // EDITOR-1: a photo from Steward's stock library says so until it is
  // replaced (the settings route keeps the mark only on a real stock photo).
  return { alt: String(m.alt || "").slice(0, 200), fx: n(m.fx ?? 0.5), fy: n(m.fy ?? 0.5), ...(m.stock === true ? { stock: true } : {}) };
}

// ── THE SETTINGS OF A PAGE, AS THE EDITOR SEES THEM ───────────────────────
function settingsOf(row, F, orgFundIds) {
  return {
    title: String(row.title || ""),
    story: String(row.story || ""),
    imageUrl: String(row.image_url || ""),
    imageMeta: readImageMeta(row.image_meta),   // FIX-41: the cover's words and focal point
    showGoal: row.show_goal !== false,
    goalAmount: row.goal_amount != null ? Number(row.goal_amount) : null,
    fundId: row.fund_id || null,
    campaignId: row.campaign_id || null,
    form: F.normalizeFormConfig(row.form_config, { orgFundIds }),
    // GIVE-3: the layout, impact lines, trust panel and other ways to give
    // (shared/givingPageDesign.js normalizes it).
    design: row.design && typeof row.design === "object" && !Array.isArray(row.design) ? row.design : {},
  };
}

// The settings a person is looking at in the editor: her draft if she has one,
// otherwise what is live.
function currentSettings(row, F, orgFundIds) {
  const live = settingsOf(row, F, orgFundIds);
  const d = row.draft_settings && typeof row.draft_settings === "object" ? row.draft_settings : null;
  return d ? { ...live, ...d, form: F.normalizeFormConfig(d.form || live.form, { orgFundIds }) } : live;
}

// Merge a partial edit onto `base` and check every field. Every bad field is
// named, as the form editor does. `imageUrl` arrives already stored (the route
// turns a data: URI into an asset path before calling this).
function validateSettings(base, patch, F, { orgFundIds = [], orgCampaignIds = [], D = null } = {}) {
  const p = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const out = { ...base };
  const errors = [];
  if (p.title !== undefined) {
    const t = String(p.title || "").trim();
    if (!t) errors.push({ field: "title", message: "A page needs a headline." });
    else if (t.length > 200) errors.push({ field: "title", message: "Keep the headline under 200 characters." });
    else out.title = t;
  }
  if (p.story !== undefined) {
    const s = String(p.story || "");
    if (s.length > 5000) errors.push({ field: "story", message: "The story is up to 5,000 characters." });
    else out.story = s;
  }
  if (p.imageUrl !== undefined) {
    const u = String(p.imageUrl || "").trim();
    if (u && !IMAGE_PATH.test(u) && !/^https:\/\/\S{1,1990}$/.test(u)) errors.push({ field: "imageUrl", message: "Choose a photo, or use a full https:// address." });
    else out.imageUrl = u;
  }
  if (p.imageMeta !== undefined) out.imageMeta = readImageMeta(p.imageMeta);
  if (p.showGoal !== undefined) {
    if (typeof p.showGoal !== "boolean") errors.push({ field: "showGoal", message: "Whether the goal shows is yes or no." });
    else out.showGoal = p.showGoal;
  }
  if (p.goalAmount !== undefined) {
    if (p.goalAmount === null || p.goalAmount === "") out.goalAmount = null;
    else {
      const g = Number(p.goalAmount);
      if (!Number.isFinite(g) || g <= 0 || g > 100000000) errors.push({ field: "goalAmount", message: "A goal is an amount above zero." });
      else out.goalAmount = Math.round(g * 100) / 100;
    }
  }
  if (p.fundId !== undefined) {
    if (p.fundId && !orgFundIds.includes(String(p.fundId))) errors.push({ field: "fundId", message: "Choose one of your own funds." });
    else out.fundId = p.fundId ? String(p.fundId) : null;
  }
  if (p.campaignId !== undefined) {
    if (p.campaignId && !orgCampaignIds.includes(String(p.campaignId))) errors.push({ field: "campaignId", message: "Choose one of your own campaigns." });
    else out.campaignId = p.campaignId ? String(p.campaignId) : null;
  }
  if (p.form !== undefined) {
    if (!p.form || typeof p.form !== "object" || Array.isArray(p.form)) errors.push({ field: "form", message: "The form settings are a set of choices." });
    else {
      const v = F.validateFormConfig({ ...base.form, ...p.form }, { orgFundIds });
      if (!v.ok) errors.push(...v.errors.map(e => ({ field: "form." + e.field, message: e.message })));
      else out.form = v.config;
    }
  }
  if (p.design !== undefined) {
    // GIVE-3: merged onto the current design, so one field can change alone.
    const v = D ? D.validateDesign({ ...(base.design || {}), ...(p.design || {}) }) : { ok: false, errors: [{ field: "design", message: "The page design could not be checked." }] };
    if (!v.ok) errors.push(...v.errors);
    else out.design = v.design;
  }
  return { ok: errors.length === 0, errors, settings: errors.length ? null : out };
}

// Key-sorted JSON, so two configs that differ only in key order are the same.
function sameJson(a, b) {
  const norm = v => Array.isArray(v) ? v.map(norm)
    : v && typeof v === "object" ? Object.keys(v).sort().reduce((o, k) => { o[k] = norm(v[k]); return o; }, {}) : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

// What a version keeps: everything that decides what a donor sees.
function snapshotOf(row) {
  return {
    widgets: Array.isArray(row.published) ? row.published : null,
    formPosition: row.form_position || null,
    settings: {
      title: row.title, story: row.story || "", imageUrl: row.image_url || "", imageMeta: readImageMeta(row.image_meta),
      showGoal: row.show_goal !== false,
      goalAmount: row.goal_amount != null ? Number(row.goal_amount) : null,
      fundId: row.fund_id || null, campaignId: row.campaign_id || null,
      design: row.design && typeof row.design === "object" ? row.design : null,
      // The STORED config, not the normalized one, so a page that never had a
      // form configured is put back with none (its original one-step form).
      formConfig: row.form_config && typeof row.form_config === "object" && Object.keys(row.form_config).length ? row.form_config : null,
    },
  };
}

// ── THE ORG-WIDE DONATION FORM ────────────────────────────────────────────
// /give/<org> is not a giving_pages row. Its amounts are the two ladders on
// portal_settings, with the same rule PUT /portal-settings applies.
function validateLadder(raw, label) {
  if (!Array.isArray(raw)) return { error: `${label} are a list of dollar amounts.` };
  const clean = raw.map(n => Math.round(Number(n))).filter(n => Number.isFinite(n) && n >= 1 && n <= 1000000);
  if (clean.length < 3 || clean.length > 6 || clean.length !== raw.length) return { error: `${label} are 3 to 6 whole-dollar amounts between $1 and $1,000,000.` };
  return { ladder: clean };
}
function validateOrgForm(base, patch) {
  const p = patch && typeof patch === "object" ? patch : {};
  const out = { ...base };
  const errors = [];
  for (const [key, label] of [["onetimeAmounts", "One-time amounts"], ["monthlyAmounts", "Monthly amounts"]]) {
    if (p[key] === undefined) continue;
    const v = validateLadder(p[key], label);
    if (v.error) errors.push({ field: key, message: v.error });
    else out[key] = v.ladder;
  }
  return { ok: errors.length === 0, errors, settings: errors.length ? null : out };
}

module.exports = {
  readImageMeta, TEMPLATES, templateList, settingsOf, currentSettings, validateSettings, sameJson, snapshotOf, validateOrgForm, IMAGE_PATH };
