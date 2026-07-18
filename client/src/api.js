export const API = import.meta.env.VITE_API_URL || "https://nonprofit-erp-production.up.railway.app";

export const getToken = () => localStorage.getItem("npe_token");

// Error codes returned by requireAuth for an unusable token. Legacy string
// messages are matched too so this keeps working during the backend deploy
// window (old server still returns "Invalid token"/"No token provided").
const AUTH_ERROR_CODES = ["token_expired", "invalid_token", "no_token"];
const LEGACY_AUTH_MESSAGES = ["Invalid token", "No token provided"];

function isAuthError(err) {
  return AUTH_ERROR_CODES.includes(err?.error) || LEGACY_AUTH_MESSAGES.includes(err?.error);
}

// A present-but-unusable token can never succeed on retry. Clear the stale
// session and send the user to /login with an explanation, instead of leaving
// them on a dead-end "Failed to connect / Retry" screen.
export function handleAuthFailure(code) {
  localStorage.removeItem("npe_token");
  localStorage.removeItem("npe_user");
  localStorage.removeItem("npe_org");
  const msg = code === "token_expired"
    ? "Your session expired — please log in again."
    : "Your session is no longer valid — please log in again.";
  try { sessionStorage.setItem("steward_auth_message", msg); } catch {}
  if (!window.location.pathname.startsWith("/login")) {
    window.location.replace("/login");
  }
}

export async function apiFetch(path, options = {}) {
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
    if (res.status === 401 && isAuthError(err)) {
      handleAuthFailure(err.error);
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
    if (res.status === 401) {
      const err = await res.json().catch(() => ({}));
      if (isAuthError(err)) handleAuthFailure(err.error);
    }
    throw new Error(`Stream failed: ${res.status}`);
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
    name:           d.name,
    email:          d.email || "",
    phone:          d.phone || "",
    // parseFloat: these are NUMERIC since the cover-fees migration, and pg
    // serializes numerics as strings — "51.81" would concatenate in sums.
    total:          parseFloat(d.total_giving) || 0,
    lastGift:       d.last_gift_date || new Date().toISOString().split("T")[0],
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
    city:          d.city ?? null,
    state:         d.state ?? null,
    zip:           d.zip ?? null,
    plannedGiving: d.planned_giving ?? false,
    employer:      d.employer ?? null,
    matchingGift:  d.matching_gift ?? null,
  };
}

export function adaptData({ org, donors, grants, volunteers, tasks, board, financials }) {
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
      fiscalYear: "Jan-Dec",
    },
    donors: donors.map(adaptDonor),
    grants: grants.map(g => ({
      id:        g.id,
      funder:    g.funder,
      program:   g.program || "",
      amount:    g.amount || 0,
      received:  g.received || 0,
      status:    g.status,
      deadline:  g.deadline || "",
      reportDue: g.report_due || null,
      officer:   g.officer || "",
      notes:     g.notes || "",
      history:   Array.isArray(g.history) ? g.history : JSON.parse(g.history || "[]"),
    })),
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
