// server/mail/confirmScope.js · SENDS-2. ONE CLICK IS ONE PERSON, UNLESS SHE SAW THE LIST.
//
// A staff confirm (sendGate.recordStaffConfirm) is minted by the server inside
// a route, so "a person sent it by hand" only ever meant "an authenticated POST
// arrived". A route that loops over drafts minted one confirm per draft and
// passed the gate as N hand sends (Jarvis, 22 Nov: "Send 33 emails" in one click).
//
// This makes the rule true at run time: within one request, the first confirm
// goes, and a second is refused unless the request is committing a send plan
// the same person was shown (server/mail/sendPlan.js, under()). The CI scan
// (scripts/ci/send-plan-scan.js) catches the same shape in the source before
// it runs. Work outside a request (no scope) mints no staff confirms today; it
// is left to the scan.
const { AsyncLocalStorage } = require("async_hooks");

const scopes = new AsyncLocalStorage();

// Mounted above every router, next to the audit trail.
function middleware() {
  return (req, res, next) => scopes.run({ minted: 0, planId: null }, next);
}

class PlanRequired extends Error {
  constructor() {
    super("send_list_required: a send to more than one person needs the list she was shown (POST /send-plans, then commit it).");
    this.code = "send_list_required";
    this.status = 409;
  }
}

// Called by recordStaffConfirm before it writes. Returns the plan id the
// confirm is minted under (null for a one-person send).
function noteConfirm() {
  const s = scopes.getStore();
  if (!s) return null;
  if (s.minted >= 1 && !s.planId) throw new PlanRequired();
  s.minted++;
  return s.planId;
}

// Runs fn with planId as the list being committed. Only sendPlan.commit calls it.
async function under(planId, fn) {
  const s = scopes.getStore();
  if (!s) return scopes.run({ minted: 0, planId }, fn);
  const was = s.planId;
  s.planId = planId;
  try { return await fn(); } finally { s.planId = was; }
}

module.exports = { middleware, noteConfirm, under, PlanRequired };
