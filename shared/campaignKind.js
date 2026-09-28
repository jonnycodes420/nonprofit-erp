// shared/campaignKind.js — FIX-6 item 5. ONE TABLE, TWO JOBS.
//
// `campaigns` carries both things the word means in this product:
//
//   AN EMAIL CAMPAIGN — subject, body, segment, sent_at, recipient_count,
//   open_count, and a status that runs draft → scheduled → sending → sent.
//
//   A FUNDRAISING GOAL — goal_amount, raised_amount, start_date, end_date,
//   goal_category, parent_goal_id, and a status that runs active → completed.
//
// They share a table because a goal and the appeal that raises it are the same
// thing to a fundraiser. They are NOT the same thing to Communications, and
// listing all of them there is what made the audit's "empty stat columns":
// Harborlight's two rows are the Annual Fund and the gala, neither of which is
// an email, so they showed as "Draft" with nothing in Sent, Open Rate or Date,
// and the pills above them read 0 because no row was ever `sent`.
//
// THE RULE, AND WHY IT IS THIS WAY ROUND. A row is an EMAIL campaign unless it
// is unmistakably only a goal: it carries a goal amount, has never had a
// subject or a body, and has never been sent. Defaulting to "email" is
// deliberate — a brand new draft from the composer has no subject and no body
// yet, and a rule that asked for one would make the campaign you are writing
// disappear from the list you are writing it in.
//
// Pure: no DB, no network, no clock, no JSX.

const blank = v => v === null || v === undefined || String(v).trim() === "";

// The statuses that only an email campaign ever reaches.
export const EMAIL_STATUSES = ["draft", "scheduled", "sending", "sent"];
// The statuses only a fundraising goal ever reaches.
export const GOAL_STATUSES = ["active", "completed", "planned", "archived"];

export function isEmailCampaign(c) {
  if (!c) return false;
  if (c.sent_at || c.scheduled_at) return true;
  if (!blank(c.subject) || !blank(c.body)) return true;
  if (Number(c.recipient_count) > 0 || Number(c.open_count) > 0) return true;
  const status = String(c.status || "").toLowerCase();
  if (["scheduled", "sending", "sent"].includes(status)) return true;
  // Only a goal from here: it has a goal amount, or it sits in a status an
  // email never reaches.
  if (GOAL_STATUSES.includes(status)) return false;
  if (c.goal_amount !== null && c.goal_amount !== undefined && Number(c.goal_amount) > 0) return false;
  return true;
}

export function splitCampaigns(rows) {
  const emails = [], goals = [];
  for (const c of rows || []) (isEmailCampaign(c) ? emails : goals).push(c);
  return { emails, goals };
}

// ── WHAT A NUMBER SAYS WHEN THERE IS NOTHING TO SAY ──────────────────────
// The brief's rule, in one place so the pills and the rows cannot disagree:
// zero is "0" and it MEANS zero; a campaign that has not gone out yet has no
// rate at all, and "0%" would be a claim that nobody opened it.
export function sentWord(campaign) {
  const n = Number((campaign && campaign.recipient_count) || 0);
  if (n > 0) return n.toLocaleString("en-US");
  const status = String((campaign && campaign.status) || "").toLowerCase();
  return ["draft", "scheduled"].includes(status) || !campaign.sent_at ? "Not sent yet" : "0";
}

export function openRateWord(campaign) {
  const sent = Number((campaign && campaign.recipient_count) || 0);
  if (!sent) return "Not sent yet";
  const opened = Number((campaign && campaign.open_count) || 0);
  return Math.round((opened / sent) * 100) + "%";
}

// The three figures over the list, computed from the EMAIL campaigns only.
// `rows` is what each one opens, so a count and the list behind it are one
// computation and cannot drift.
export function campaignStats(rows) {
  const { emails } = splitCampaigns(rows);
  const sent = emails.filter(c => String(c.status || "").toLowerCase() === "sent" || c.sent_at);
  const totalSent = sent.reduce((s, c) => s + (Number(c.recipient_count) || 0), 0);
  const totalOpen = sent.reduce((s, c) => s + (Number(c.open_count) || 0), 0);
  const active = emails.filter(c => ["sending", "scheduled"].includes(String(c.status || "").toLowerCase()));
  return {
    emails,
    totalSent,
    totalSentWord: sent.length ? totalSent.toLocaleString("en-US") : "Not sent yet",
    totalSentRows: sent,
    totalSentSentence: sent.length
      ? `${totalSent.toLocaleString("en-US")} ${totalSent === 1 ? "email" : "emails"} across ${sent.length} sent ${sent.length === 1 ? "campaign" : "campaigns"}.`
      : "No campaign has been sent yet, so nothing has gone out.",
    openRateWord: totalSent ? Math.round((totalOpen / totalSent) * 100) + "%" : "Not sent yet",
    openRateRows: sent,
    openRateSentence: totalSent
      ? `${totalOpen.toLocaleString("en-US")} of ${totalSent.toLocaleString("en-US")} delivered emails were opened. Steward counts opens per campaign and never who opened what.`
      : "There is no open rate until a campaign has gone out.",
    activeCount: active.length,
    activeWord: String(active.length),
    activeRows: active,
    activeSentence: active.length
      ? `${active.length} ${active.length === 1 ? "campaign is" : "campaigns are"} sending or scheduled right now.`
      : "Nothing is sending or scheduled. Zero is the answer, not a missing number.",
  };
}
