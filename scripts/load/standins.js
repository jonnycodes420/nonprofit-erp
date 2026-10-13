// SCALE-1 · the stand-ins a load run talks to instead of the real providers.
//
//   :6718  Gmail, Google Calendar, Graph, QuickBooks, Xero, Stripe, Givebutter
//          and the other giving sources: each answers "nothing new" in the
//          shape its client expects, after a delay like a real network hop.
//   :6719  the Anthropic Messages API: a short canned answer with real-looking
//          usage figures, so the run can count calls and tokens.
//   :6702  the Resend sink: every send is counted, never delivered.
//
// GET /__counts on any port returns what each stand-in has seen. Loopback only.
const http = require("http");

const LATENCY_MS = Number(process.env.STANDIN_LATENCY_MS || 60);
// SCALE-2: the ports can move, so a second run (the mailbox measure) never
// shares counts with a load run already using the defaults.
const PORTS = { providers: Number(process.env.STANDIN_PROVIDER_PORT || 6718), anthropic: Number(process.env.STANDIN_ANTHROPIC_PORT || 6719),
                mail: Number(process.env.STANDIN_MAIL_PORT || 6702) };
// SCALE-2: a Gmail search longer than this (URL-encoded) is refused with 400,
// the way a real provider refuses a query it will not run. 0 = no limit.
const GMAIL_Q_MAX = Number(process.env.STANDIN_GMAIL_Q_MAX || 0);
const counts = { providers: {}, anthropic: { calls: 0, inputTokens: 0, outputTokens: 0, byKind: {} }, mail: { sends: 0, batch: 0 } };
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const readBody = req => new Promise(res => { let b = ""; req.on("data", c => { b += c; }); req.on("end", () => res(b)); });
const send = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const later = fn => setTimeout(fn, LATENCY_MS);

function providerBody(url) {
  const p = url.split("?")[0];
  if (/\/gmail\/v1\/users\/[^/]+\/profile/.test(p)) return { emailAddress: "load@example.org", historyId: "1000" };
  if (/\/gmail\/v1\/users\/[^/]+\/history/.test(p)) return { history: [], historyId: "1000" };
  if (/\/gmail\/v1\/users\/[^/]+\/messages/.test(p)) return { messages: [], resultSizeEstimate: 0 };
  if (/\/calendar\/v3\//.test(p)) return { items: [], nextSyncToken: "load-sync-token" };
  if (/graph|\/v1\.0\//.test(p)) return { value: [], "@odata.deltaLink": "http://localhost:6718/v1.0/delta?token=x" };
  if (/\/intuit|\/v3\/company/.test(p)) return { QueryResponse: { startPosition: 1, maxResults: 0 }, time: new Date().toISOString() };
  if (/\/xero/.test(p)) return { BankTransactions: [], Contacts: [] };
  if (/\/stripe/.test(p)) return { object: "list", data: [], has_more: false, url: p };
  if (/\/givebutter/.test(p)) return { data: [], links: { next: null }, meta: { current_page: 1, last_page: 1 } };
  if (/\/zeffy|\/square|\/mailchimp|\/constantcontact/.test(p)) return { data: [], items: [], payments: [], cursor: null };
  return {};
}

http.createServer(async (req, res) => {
  const body = await readBody(req);
  if (req.url === "/__counts") return send(res, 200, counts);
  if (req.url === "/__reset") { counts.providers = {}; return send(res, 200, { ok: true }); }
  const key = req.method + " " + req.url.split("?")[0].replace(/\/(load|org_load|realm|acct_load)[\w-]*/g, "/:id").slice(0, 80);
  bump(counts.providers, key);
  void body;
  const qm = GMAIL_Q_MAX && /\/gmail\/v1\/users\/[^/]+\/messages\?/.test(req.url) && req.url.match(/[?&]q=([^&]*)/);
  if (qm && qm[1].length > GMAIL_Q_MAX) return later(() => send(res, 400, { error: { code: 400, message: "Invalid query" } }));
  later(() => send(res, 200, providerBody(req.url)));
}).listen(PORTS.providers, "127.0.0.1");

http.createServer(async (req, res) => {
  const raw = await readBody(req);
  if (req.url === "/__counts") return send(res, 200, counts.anthropic);
  let b = {}; try { b = JSON.parse(raw); } catch {}
  const input = Math.round(raw.length / 4);
  const out = Math.min(Number(b.max_tokens) || 200, 180);
  counts.anthropic.calls++; counts.anthropic.inputTokens += input; counts.anthropic.outputTokens += out;
  bump(counts.anthropic.byKind, String(b.model || "?"));
  // A tool-using caller gets a tool_use block for its first tool, with an
  // empty input; everybody else gets one sentence.
  const tool = Array.isArray(b.tools) && b.tools[0];
  const content = tool
    ? [{ type: "tool_use", id: "toolu_load", name: tool.name, input: {} }]
    : [{ type: "text", text: "A short answer from the load stand-in." }];
  later(() => send(res, 200, { id: "msg_load", type: "message", role: "assistant", model: b.model || "claude-load",
    content, stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null,
    usage: { input_tokens: input, output_tokens: out } }));
}).listen(PORTS.anthropic, "127.0.0.1");

http.createServer(async (req, res) => {
  const raw = await readBody(req);
  if (req.url === "/__counts") return send(res, 200, counts.mail);
  if (/batch/.test(req.url)) {
    let arr = []; try { arr = JSON.parse(raw); } catch {}
    counts.mail.batch++; counts.mail.sends += Array.isArray(arr) ? arr.length : 1;
    return send(res, 200, { data: (Array.isArray(arr) ? arr : [1]).map((_, i) => ({ id: "load_" + i })) });
  }
  counts.mail.sends++;
  send(res, 200, { id: "load_" + counts.mail.sends });
}).listen(PORTS.mail, "127.0.0.1");

console.log(`[standins] providers :${PORTS.providers}, anthropic :${PORTS.anthropic}, mail :${PORTS.mail} (latency ${LATENCY_MS}ms)`);
