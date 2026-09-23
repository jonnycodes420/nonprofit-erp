// shared/audiences.js — BUILD-97. AN AUDIENCE IS A THING WITH A NAME.
//
// Until now a campaign's audience was an anonymous JSON blob typed into the
// builder and thrown away on send. That is the difference between Steward and
// the product Allie is actually paying for: in Mailchimp an audience is a
// noun. It has a name, a count you can look at on a Tuesday without composing
// anything, and it is the same list next month.
//
// So this file is the ONE definition of what audiences exist, and both sides
// read it — the server resolves against it and the hub rail renders from it.
// Two registries would drift, and the way they would drift is a campaign that
// went to a different list than the screen said it would.
//
// BUILT-IN vs SAVED. The four built-ins are not rows: they are the populations
// the product already understands, and an org should not have to create "all
// donors" before it can mail its donors. A SAVED audience is a row — a name
// over one of the existing segment modes — and it is how "Lapsed sponsors" or
// "Barn Buddies volunteers" becomes something she can point at.
//
// Pure. No database, no express.

// `mode` values here MUST exist in resolveCampaignRecipients (server.js). The
// suite walks every one of these back to that function, so a built-in cannot
// be added here and silently resolve to nobody.
export const BUILT_IN_AUDIENCES = [
  {
    id: "builtin:donors",
    name: "All donors",
    description: "Everyone who has given, and nobody who hasn't.",
    mode: "donors",
    kind: "builtin",
    tone: "green",
  },
  {
    id: "builtin:volunteers",
    name: "Volunteers",
    description: "People who give time. Invisible to every number that means money.",
    mode: "volunteers",
    kind: "builtin",
    tone: "gold",
  },
  {
    id: "builtin:staff_board",
    name: "Staff and board",
    description: "The people inside the organisation.",
    mode: "staff_board",
    kind: "builtin",
    tone: "greenDk",
  },
  {
    // The one audience that deliberately crosses every type. It is the
    // Mailchimp audience, and it is the reason she is still paying them.
    id: "builtin:everyone",
    name: "Everyone with an email",
    description: "Every person on file who can be reached. Crosses every type.",
    mode: "everyone",
    kind: "builtin",
    tone: "terracotta",
  },
];

export const BUILT_IN_IDS = BUILT_IN_AUDIENCES.map(a => a.id);
export const isBuiltInId = (id) => BUILT_IN_IDS.includes(String(id || ""));
export const builtInById = (id) => BUILT_IN_AUDIENCES.find(a => a.id === id) || null;

// The segment modes a SAVED audience is allowed to be built on. Deliberately a
// subset: "manual" (a frozen list of ids) is not here, because a saved
// audience whose membership can never change is a mailing list pretending to
// be a segment, and it would quietly go stale the first time somebody new
// qualified for it.
export const SAVABLE_MODES = ["donors", "volunteers", "staff_board", "everyone", "byStage", "byTier", "lapsed", "major"];

export const AUDIENCE_NAME_MAX = 60;
export const AUDIENCE_DESC_MAX = 200;

// One validator, used by the create route and the editor, so the screen
// refuses exactly what the server would.
export function validateAudience(input) {
  const errors = [];
  const name = String(input?.name || "").trim();
  const description = String(input?.description || "").trim();
  const mode = String(input?.mode || "").trim();

  if (!name) errors.push("An audience needs a name — it is how you will find it again.");
  else if (name.length > AUDIENCE_NAME_MAX) errors.push(`Keep the name under ${AUDIENCE_NAME_MAX} characters.`);
  if (description.length > AUDIENCE_DESC_MAX) errors.push(`Keep the description under ${AUDIENCE_DESC_MAX} characters.`);
  if (!SAVABLE_MODES.includes(mode)) errors.push("That is not an audience this product knows how to keep.");

  // An empty explicit selection selects NOBODY (the BUILD-88c rule). Saving
  // one is legal but it must be deliberate, so it is named rather than
  // silently accepted as "everyone".
  if (mode === "byStage" && !(input?.stages || []).length) errors.push("Choose at least one stage, or this audience is nobody.");
  if (mode === "byTier" && !(input?.tiers || []).length) errors.push("Choose at least one tier, or this audience is nobody.");

  return { ok: errors.length === 0, errors, name, description, mode };
}

// The segment blob a saved audience resolves to — the SAME shape the campaign
// builder has always produced, so there is one resolver and not two.
export function segmentFor(audience) {
  if (!audience) return { mode: "manual", donorIds: [] };  // nobody, never everybody
  const seg = { mode: audience.mode };
  if (audience.mode === "byStage") seg.stages = audience.stages || [];
  if (audience.mode === "byTier") seg.tiers = audience.tiers || [];
  return seg;
}
