// agentCall.js · AGENT-2. THE AGENT DOES THE WORK THROUGH THE SCREENS' OWN ROUTES.
//
// BUILD-97 promised an Agent that does the work; it had seven tools and wrote
// notes. AGENT-2 gives it real actions, and every one of them is the SAME
// route a person's click calls (POST /groups/:id/members, PATCH
// /donors/:id/stage, POST /donors/:id/make-volunteer, ...), called in-process
// with the session of the person who confirmed the plan. So the Agent can do
// exactly what that person could do and nothing more: the route's own checks,
// plan gates and org scoping apply, and the audit middleware records every
// write as it records a click.
//
// THE SIGNED HEADER. Each call carries x-steward-agent: the person, the
// instruction and its words, signed with the server's secret and good for ten
// minutes. middleware/auditTrail.js verifies it and writes the row with the
// Agent as actor ("Agent, approved by Dana") and the instruction as the
// reason. Anybody can send the header; nobody without the secret can make one
// the middleware believes, and a header for another user is ignored.
"use strict";
const crypto = require("crypto");

const SECRET = () => process.env.JWT_SECRET || "nonprofit_erp_secret_dev";
const MAX_AGE_MS = 10 * 60 * 1000;
const b64 = s => Buffer.from(s).toString("base64url");
const mac = body => crypto.createHmac("sha256", SECRET()).update("steward-agent." + body).digest("base64url");

function sign({ userId, instructionId, reason }) {
  const body = b64(JSON.stringify({ u: String(userId || ""), i: String(instructionId || ""),
    r: String(reason || "").slice(0, 240), t: Date.now() }));
  return `${body}.${mac(body)}`;
}
function verify(header, userId) {
  const [body, sig] = String(header || "").split(".");
  if (!body || !sig) return null;
  const want = mac(body);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  let p; try { p = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
  if (!p || Date.now() - Number(p.t) > MAX_AGE_MS) return null;
  if (userId && p.u !== String(userId)) return null;
  return { userId: p.u, instructionId: p.i, reason: p.r };
}

// One call to one of Steward's own routes, as the person, marked as the Agent.
// Returns { status, body }. Never throws for an HTTP refusal: a refusal is the
// step's honest reason.
async function call(ctx, method, path, body) {
  const port = process.env.PORT || 3001;
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: ctx.auth,
      "x-steward-agent": sign({ userId: ctx.userId, instructionId: ctx.instructionId, reason: ctx.instructionText }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let out = null;
  try { out = await r.json(); } catch { out = null; }
  return { status: r.status, body: out };
}

module.exports = { sign, verify, call, MAX_AGE_MS };
