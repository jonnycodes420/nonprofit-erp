import { errorMessage, isProgrammerError } from "./lib/domainError";
import { setOrgTimezone } from "./lib/orgToday";

// GRANTS-1: one adapter for a legacy grant row, used by the first load and by
// the Grants screen when it opens a grant created since (a planned renewal).
export function adaptGrant(g) {
  return {
    id:        g.id,
    funder:    g.funder,
    program:   g.program || "",
    // BUILD-100 Part 1 migrated `grants.amount`/`received` INTEGER →
    // NUMERIC(12,2), and pg serialises NUMERIC as a STRING. Four client sums
    // read these (the Kanban column totals, the pipeline totals, and the
    // summary strip's "In the works" / "Received"), and `0 + "5000.00"`
    // CONCATENATES: two grants summed to "05000.003000.00". parseFloat here
    // fixes all four at the boundary rather than patching each reduce —
    // exactly what BUILD-08 Phase B did to `adaptDonor` when the gift columns
    // made the same move.
    amount:    parseFloat(g.amount) || 0,
    received:  parseFloat(g.received) || 0,
    status:    g.status,
    deadline:  g.deadline || "",
    reportDue: g.report_due || null,
    officer:   g.officer || "",
    notes:     g.notes || "",
    campaignId: g.campaign_id || null,   // attribution FIX — awarded amount counts toward this campaign
    history:   Array.isArray(g.history) ? g.history : JSON.parse(g.history || "[]"),
    funderId:  g.funder_donor_id || null,
    description: g.description || "",
    requirements: g.requirements || "",
  };
}

export const API = import.meta.env.VITE_API_URL || "https://nonprofit-erp-production.up.railway.app";

export const getToken = () => localStorage.getItem("npe_token");

// ── A 401 ON A REQUEST THAT CARRIED A TOKEN IS AN UNUSABLE TOKEN ──────────
//
// This used to be an ALLOWLIST of three codes, and requireAuth returns SIX:
// `session_revoked`, `user_not_found` and `account_deactivated` were never on
// it. The token was therefore never cleared for any of them, so the app sat on
// a "Failed to connect / Retry" screen where Retry could not possibly work —
// the exact dead end handleAuthFailure exists to prevent. Found live on
// 2026-09-28, showing requireAuth's own `session_revoked` words.
//
// So the rule is inverted, and it cannot rot: if WE sent a token and the
// server answered 401, that token cannot be used, whatever it chose to call
// the reason. A seventh code tomorrow is handled the day it ships.
//
// The codes below no longer decide WHETHER it is an auth failure. They decide
// only the WORDING, and an unknown one falls through to the general sentence.
const AUTH_MESSAGES = {
  token_expired:       "Your session expired, please log in again.",
  no_token:            "Please log in again.",
  account_deactivated: "This account has been removed from the organization. Ask an admin to add you back.",
  user_not_found:      "That account no longer exists. Please log in again.",
};
const AUTH_FALLBACK_MESSAGE = "Your session is no longer valid, please log in again.";

// Human, admin-facing copy for a failed billing call (create-checkout /
// create-portal). The server returns TYPED billing-config errors
// (plan_mode_mismatch / plan_not_configured / portal_not_configured) with clean
// messages already — prefer those verbatim; for anything else (incl. a raw
// "Internal server error") show a safe fallback so we never surface a 500 or
// Stripe internals to the user. `err` is what apiFetch throws (has .error/.message/.status).
const BILLING_CONFIG_CODES = ["plan_mode_mismatch", "plan_not_configured", "portal_not_configured"];
export function billingErrorMessage(err, fallback = "Something went wrong with billing. Please try again, or reach out if it keeps happening.") {
  // FIX (2026-09-10) — this is a TYPED mapper over billing's own error codes,
  // which is why it is exempt from the blanket `errorMessage` rewrite: it
  // deliberately never surfaces a raw message it does not recognise. But a
  // ReferenceError in the caller has no billing code and no useful message, and
  // "Something went wrong with billing" would be a claim about Stripe for a bug
  // in us. The one rule holds here too. (client/src/lib/domainError.js)
  if (isProgrammerError(err)) return errorMessage(err, fallback);
  const code = err?.error || "";
  const raw = err?.message || "";
  if (BILLING_CONFIG_CODES.includes(code)) return raw || fallback;
  if (code === "founding_forbidden") return "That plan is assigned privately.";
  if (err?.status === 403 || /admin/i.test(raw)) return "Only an admin can change billing. Ask your workspace admin.";
  if (!raw || /internal server error/i.test(raw)) return fallback;
  return raw;
}

// A present-but-unusable token can never succeed on retry. Clear the stale
// session and send the user to /login with an explanation, instead of leaving
// them on a dead-end "Failed to connect / Retry" screen.
// True from the moment we START sending somebody to /login until the browser
// gets there. A render that happens in between must not paint an outage over
// a navigation that is already on its way — that is what put the dead-end
// screen in front of somebody whose session had simply been revoked.
let _leavingForLogin = false;
export const leavingForLogin = () => _leavingForLogin;

export function handleAuthFailure(code) {
  localStorage.removeItem("npe_token");
  localStorage.removeItem("npe_user");
  localStorage.removeItem("npe_org");
  const msg = AUTH_MESSAGES[code] || AUTH_FALLBACK_MESSAGE;
  try { sessionStorage.setItem("steward_auth_message", msg); } catch {}
  if (!window.location.pathname.startsWith("/login")) {
    // The flag is set only when a navigation is actually starting. On /login
    // there is nowhere to go, and a flag set there would strand the screen.
    _leavingForLogin = true;
    // FIX-13 Part 6 — come back to this exact page after signing in.
    const here = window.location.pathname + window.location.search;
    window.location.replace(here && here !== "/" ? "/login?next=" + encodeURIComponent(here) : "/login");
  }
}

// ── FIX-22: THE SAME READ, ASKED TWICE, IS ASKED ONCE ──────────────────────
// A walk of Home, one profile and Reports made ~30 requests a screen, and most
// of the repeats were the same reference reads fired by several components
// (sample-data status 10 times, the officer list 6, custom fields 6). A demo
// at a brisk pace reached the 1,000-request limit in 15 minutes with no
// polling at all. Two rules, both safe:
//   1. Identical GETs IN FLIGHT share one request.
//   2. A short list of reference reads (below) is kept for 60 seconds.
// Any write (a non-GET) empties the cache, so nothing stale survives a change
// made on this screen. Each caller gets its own copy of the answer.
const SHARED_READS = [
  /^\/org\/sample-data-status$/, /^\/portfolio\/officers$/, /^\/custom-fields(\?|$)/, /^\/org\/team$/,
  /^\/me\/nav-layout$/, /^\/billing\/donor-band$/, /^\/status\/summary$/, /^\/changelog\/hidden$/,
  /^\/org\/welcome$/, /^\/billing\/status$/,
];
const SHARED_TTL_MS = 60000;
const inFlight = new Map();
const kept = new Map();
const copy = v => (v && typeof v === "object" ? structuredClone(v) : v);
export function forgetReads() { kept.clear(); }

export async function apiFetch(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  // FIX-25: a write also forgets the reads in flight. A read asked for after a
  // write must not be handed the answer to a read that left before it, or a
  // list re-read after "Approve all" comes back as it was before the approval.
  if (method !== "GET") { kept.clear(); inFlight.clear(); return apiFetchNow(path, options); }
  if (options.body || options.signal) return apiFetchNow(path, options);
  const key = getToken() + " " + path;
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < SHARED_TTL_MS) return copy(hit.value);
  if (!inFlight.has(key)) {
    inFlight.set(key, apiFetchNow(path, options)
      .then(v => { if (SHARED_READS.some(r => r.test(path))) kept.set(key, { at: Date.now(), value: v }); return v; })
      .finally(() => inFlight.delete(key)));
  }
  return copy(await inFlight.get(key));
}

async function apiFetchNow(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    // WE SENT A TOKEN AND GOT A 401. Whatever the server called it, this token
    // cannot be used, and no amount of retrying will change that.
    if (res.status === 401 && token) {
      handleAuthFailure(err.error);
      // `authHandled` tells a caller's catch that somebody is already being
      // sent to /login, so it must not render this as an outage.
      throw Object.assign(new Error(err.message || err.error || "Request failed"),
        { status: 401, authHandled: true, ...err });
    }
    throw Object.assign(new Error(err.message || err.error || "Request failed"), { status: res.status, ...err });
  }
  return res.json();
}

export async function streamAI(systemPrompt, userMessage, onChunk) {
  const token = getToken();
  const res = await fetch(`${API}/ai/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ systemPrompt, userMessage }),
  });
  if (!res.ok) {
    // Same rule as apiFetch: a token we sent, refused with a 401, is a token
    // that cannot be used.
    if (res.status === 401 && token) {
      const err = await res.json().catch(() => ({}));
      handleAuthFailure(err.error);
    }
    // FIX-10 D — THE STATUS CODE NEVER REACHES A CUSTOMER. This threw
    // "Stream failed: 503", and every caller's catch quotes e.message, so the
    // donor profile's Suggested panel printed an HTTP code at her. The code is
    // in the console for a developer, and `aiUnavailable` lets a caller show
    // its own sentence with a retry rather than parse this one.
    // `warn`, not `error`: drafting being off on a deployment is an expected
    // condition (the ANTHROPIC_API_KEY gate), and the browser walk's
    // console-error gate must stay a guard against real bugs. The status is
    // still here for a developer.
    console.warn(`[ai] /ai/stream answered ${res.status}`);
    // FIX-12 Part 3: the org's own AI switch says so in its own words.
    const off = res.status === 403 && (await res.json().catch(() => ({}))).code === "ai_off";
    throw Object.assign(new Error(off ? "AI is turned off for your organization." : "Steward couldn't reach drafting just now."),
      { status: res.status, aiUnavailable: true });
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") return full;
      try {
        const j = JSON.parse(payload);
        if (j.text) { full += j.text; onChunk(full); }
        if (j.error) throw new Error(j.error);
      } catch {}
    }
  }
  return full;
}

// ── Data adapter: API shapes → component shapes ────────────────────────────
// Single-donor mapping, exported so any call site that receives a raw donor
// row back from an API response (e.g. Donors.jsx's EditDonorModal save
// handler) can re-adapt it the same way adaptData() below does, rather than
// hand-duplicating a second, shorter field list that silently drifts out of
// sync — that drift previously dropped assignedTo/assignedToName (among
// other fields) from local state after every donor edit, even though the
// database itself was never affected.
export function adaptDonor(d) {
  return {
    id:             d.id,
    // ENGAGE-1 — the stored scores, when the list read carried them.
    engagement:     d.engagement_score == null ? null : Number(d.engagement_score),
    engagementBand: d.engagement_band || null,
    // PARITY-1 — the closeness word (Close, Warm, On track, Cooling, New), the band in words.
    closeness: d.closeness || null,
    generosity:     d.generosity_score == null ? null : Number(d.generosity_score),
    name:           d.name,
    email:          d.email || "",
    phone:          d.phone || "",
    // parseFloat: these are NUMERIC since the cover-fees migration, and pg
    // serializes numerics as strings — "51.81" would concatenate in sums.
    total:          parseFloat(d.total_giving) || 0,
    // BUILD-79 Part 4 — a donor with no gift on file has lastGift null,
    // rendered "no gift on file". The old || today here told the whole client
    // that 1,111 giftless imports gave TODAY (the "Sep 2026" column, the
    // 35-score, un-drifting every surface). Read paths default to nothing.
    lastGift:       d.last_gift_date || null,
    lastAmount:     parseFloat(d.last_gift_amount) || 0,
    gifts:          d.gift_count || 0,
    status:         d.status,
    stage:          d.stage || "cultivate",
    tags:           Array.isArray(d.tags) ? d.tags : JSON.parse(d.tags || "[]"),
    notes:          d.notes || "",
    lastTouchpoint: d.last_touchpoint || null,
    interactions:   [],
    wealthScore:           d.wealth_score ?? null,
    capacityTier:          d.capacity_tier ?? null,
    scoreConfidence:       d.score_confidence ?? null,
    scoreRationale:        d.score_rationale ?? null,
    stripeSubscriptionId:  d.stripe_subscription_id ?? null,
    stripeSubscriptionStatus: d.stripe_subscription_status ?? null,
    assignedTo:    d.assigned_to ?? null,
    assignedToName: d.assigned_to_name ?? null,
    pendingAssigneeInviteId: d.pending_assignee_invite_id ?? null,
    pendingAssigneeName: d.pending_assignee_name ?? null,
    city:          d.city ?? null,
    state:         d.state ?? null,
    zip:           d.zip ?? null,
    plannedGiving: d.planned_giving ?? false,
    employer:      d.employer ?? null,
    // PARITY-3 6a — month and day, year optional (shared/birthday.js).
    birthday:      d.birth_month && d.birth_day ? { month: Number(d.birth_month), day: Number(d.birth_day), year: d.birth_year == null ? null : Number(d.birth_year) } : null,
    matchingGift:  d.matching_gift ?? null,
    householdId:   d.household_id ?? null,
    deceased:      d.deceased === true,          // BUILD-58 Part 2 — safety flags
    doNotContact:  d.do_not_contact === true,
    doNotSolicit:  d.do_not_solicit === true,    // BUILD-77 Part 1 — the flag family
    doNotMail:     d.do_not_mail === true,
    doNotEmail:    d.do_not_email === true,
    deceasedDate:  d.deceased_date ?? null,
    address:       d.address ?? null,
    importedSustainer: d.imported_sustainer === true,   // BUILD-77 Part 5 — the third recurring state
    importedSustainerAmount: d.imported_sustainer_amount != null ? parseFloat(d.imported_sustainer_amount) : null,
    importedSustainerLastGift: d.imported_sustainer_last_gift ?? null,
    // FIX-33 — Room to give, server-set on list rows from prospect.roomToGive
    // (the adaptDonor trap: a field this adapter drops renders as nothing).
    room:          d.room ?? null,
    drift:         d.drift ?? null,              // BUILD-76 — the badge field, server-computed (one truth)
    // BUILD-89S 89f — the sentence for a donor giving monthly through a
    // connected source, built server-side from the ONE phrase builder so the
    // record and the recurring dashboard cannot say different things. (The
    // BUILD-89 adaptDonor trap: a field the server sets and this adapter does
    // not carry reaches the profile as undefined and renders as nothing.)
    sourceRecurring: d.source_recurring ?? null,
    // PROFILE-1 — the four figures the profile draws, each with the SOURCE
    // that opens the rows behind it. Built by the server (routes/crm.js
    // donorProfileFigures) so the value and the rows are one computation.
    // This line is the BUILD-89 adaptDonor trap again: without it the server
    // sets `figures`, the profile reads undefined, and the whole row of
    // numbers silently does not render. It cost twenty minutes here too.
    figures:       d.figures ?? null,
    // BUILD-84 P0-2 — the donor type and the contact person on an
    // organization's record. `kind` null on a legacy row reads as a person.
    kind:          d.kind ?? null,
    contactName:   d.contact_name ?? null,
    // BUILD-84 P0-4 — the coordinates the write-time geocoding job stored. The
    // map draws from THESE and makes no geocoder request of its own.
    country:       d.country ?? null,
    latitude:      d.latitude  != null ? Number(d.latitude)  : null,
    longitude:     d.longitude != null ? Number(d.longitude) : null,
    geocodeStatus: d.geocode_status ?? null,
    // BUILD-94 Part 1 — the signed, expiring URL for this person's photo, or
    // null for the initials mark. (The BUILD-89 adaptDonor trap again: a field
    // the server sets and this adapter drops reaches the profile as undefined.)
    photoUrl:      d.photo_url ?? null,
    // BUILD-94 Part 2 — Donor / Volunteer / Staff and board / Other, and a
    // person can be more than one. A row with nothing stored is a legacy row,
    // and every legacy row is a donor — the same rule the server's predicate
    // and the segment count both hold, so the three cannot disagree.
    personTypes:   (Array.isArray(d.person_types) && d.person_types.length) ? d.person_types : ["donor"],
  };
}

export function adaptData({ org, donors, grants, volunteers, tasks, board, financials }) {
  // FIX-14 Part 1 — the org's zone, for every client "today" (lib/orgToday.js).
  setOrgTimezone(org && org.timezone);
  return {
    org: {
      id:         org.id,
      name:       org.name,
      org_slug:   org.org_slug || "",
      mission:    org.mission || "",
      focus_area: org.focus_area || "",
      annual_budget: org.annual_budget || "",
      founded_year: org.founded_year || "",
      website:    org.website || "",
      programs:   [],
      ein:        org.ein || "",
      plan:       org.plan || "",           // BUILD-58 W-2 — the shell branches on the portal tier
      fiscalYear: "Jan-Dec",
      logo:        org.logo_data || "",       // BUILD-13 branding
      brandAccent: org.brand_accent || "",
      brandAccentFg: org.brand_accent_fg || "",
      // BUILD-84 — the zone every date in the product is read in, and whether
      // a HUMAN chose it. The timed step reminder is unavailable until they do.
      // BUILD-86 Part B — her words. The RAW stored value rides through; the
      // pure module normalises it, so there is one place defaults are decided.
      vocabulary:  org.vocabulary_json || null,
      vocabularySetAt: org.vocabulary_set_at || null,
      timezone:    org.timezone || "",
      timezone_confirmed_at: org.timezone_confirmed_at || null,
      // ── INCIDENT 2026-09-22 / BUILD-97 Part 0 — THE TWO FLAGS THAT DECIDE
      // WHETHER MAIL LEAVES THIS ORGANISATION, ON THE SCREEN RATHER THAN ONLY
      // IN THE DATABASE. `orgMaySendEmail()` has read them since the incident;
      // nothing rendered them, so an org whose mail was off looked exactly like
      // an org whose mail was on, and the only way to tell was a production
      // query. A person cannot be held to a state they cannot see.
      //
      // THIS WHITELIST IS THE TRAP. `GET /org` returns `SELECT *`, so both
      // columns were already crossing the wire and being thrown away HERE —
      // the same shape as BUILD-89's adaptDonor defect, where assignedTo was
      // dropped on every refresh because the adapter did not name it.
      isDemoOrg:     org.is_demo_org === true,
      emailsEnabled: org.emails_enabled !== false,
    },
    donors: donors.map(adaptDonor),
    grants: grants.map(adaptGrant),
    volunteers: volunteers.map(v => ({
      id:              v.id,
      name:            v.name,
      email:           v.email || "",
      hours:           v.hours || 0,
      skills:          Array.isArray(v.skills) ? v.skills : JSON.parse(v.skills || "[]"),
      lastActive:      v.last_active || "",
      donorId:         v.donor_id || null,
      convertPotential: v.convert_potential || "medium",
      employer:        v.employer || "",
      notes:           v.notes || "",
    })),
    tasks: tasks.map(t => ({
      id:       t.id,
      title:    t.title,
      due:      t.due || "",
      priority: t.priority,
      type:     t.type,
      done:     !!t.done,
      donorId:  t.donor_id || null,
    })),
    board: board.map(b => ({
      id:          b.id,
      name:        b.name,
      role:        b.role,
      employer:    b.employer || "",
      term:        b.term || "",
      givingLevel: b.giving_level || "$0",
      committees:  Array.isArray(b.committees) ? b.committees : JSON.parse(b.committees || "[]"),
      attendance:  b.attendance ?? 100,
    })),
    financials: {
      revenue: financials.months.map(m => ({
        month:      m.month,
        individual: m.individual || 0,
        grants:     m.grants || 0,
        events:     m.events || 0,
        other:      m.other_revenue || 0,
      })),
      expenses: financials.months.map(m => ({
        month:       m.month,
        programs:    m.programs || 0,
        admin:       m.admin || 0,
        fundraising: m.fundraising || 0,
      })),
      funds: financials.funds.map(f => ({
        name:       f.name,
        balance:    f.balance || 0,
        restricted: !!f.restricted,
      })),
    },
  };
}
