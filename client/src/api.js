export const API = import.meta.env.VITE_API_URL || "https://nonprofit-erp-production.up.railway.app";

export const getToken = () => localStorage.getItem("npe_token");

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
    throw Object.assign(new Error(err.error || "Request failed"), { status: res.status });
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
  if (!res.ok) throw new Error(`Stream failed: ${res.status}`);
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
export function adaptData({ org, donors, grants, volunteers, tasks, board, financials }) {
  return {
    org: {
      id:         org.id,
      name:       org.name,
      mission:    org.mission || "",
      focus_area: org.focus_area || "",
      annual_budget: org.annual_budget || "",
      founded_year: org.founded_year || "",
      website:    org.website || "",
      programs:   [],
      ein:        org.ein || "",
      fiscalYear: "Jan-Dec",
    },
    donors: donors.map(d => {
      const interactions = (d.interactions || []).map(i => ({
        date: i.date || i.created_at?.split("T")[0],
        type: i.type,
        note: i.note || "",
        metadata: i.metadata || null,
      }));
      const lastTouchpoint = interactions.length > 0
        ? interactions.slice().sort((a, b) => new Date(b.date) - new Date(a.date))[0].date
        : null;
      return {
        id:             d.id,
        name:           d.name,
        email:          d.email || "",
        phone:          d.phone || "",
        total:          d.total_giving || 0,
        lastGift:       d.last_gift_date || new Date().toISOString().split("T")[0],
        lastAmount:     d.last_gift_amount || 0,
        gifts:          d.gift_count || 0,
        status:         d.status,
        stage:          d.stage || "cultivate",
        tags:           Array.isArray(d.tags) ? d.tags : JSON.parse(d.tags || "[]"),
        notes:          d.notes || "",
        lastTouchpoint,
        interactions,
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
      };
    }),
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
