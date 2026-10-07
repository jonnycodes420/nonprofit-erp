#!/usr/bin/env node
// HARDEN-1 item 4 · THE COUNTING PROXY for the nightly real-AI run.
//
// The server under test is booted with a DUMMY key and ANTHROPIC_BASE_URL
// pointed here, so this process is the only one that ever holds the real key.
// It forwards each request to api.anthropic.com with the real key swapped in,
// prices the usage it reads back at claude-opus-5 rates ($5 per million input
// tokens, $25 per million output tokens; cache reads and writes are priced as
// input, which over-counts and never under-counts), and REFUSES any call once
// the running spend has reached the cap. A refused call answers 429 with an
// Anthropic-shaped error, so the server takes its normal failure path and the
// run sees it as a failure, never as a quiet pass.
//
// Gzip is turned off on the upstream request: a compressed body is unreadable
// here and its usage would go uncounted (ASK-3's trap).
//
// Env:
//   ANTHROPIC_EVAL_KEY   the real key (required; never printed)
//   PROXY_PORT           default 6524
//   CAP_USD              default 2
//   SPEND_FILE           where the running ledger is written as JSON after each
//                        call (default: none). GET /__spend returns it too.
//   UPSTREAM             default https://api.anthropic.com
//
// scripts/ sits outside tests/fix12-ai-switch.test.js's server scan on purpose:
// this file is test tooling, never loaded by server.js.
"use strict";
const http = require("http");
const https = require("https");
const fs = require("fs");

const KEY = process.env.ANTHROPIC_EVAL_KEY || "";
const PORT = Number(process.env.PROXY_PORT || 6524);
const CAP = Number(process.env.CAP_USD || 2);
const SPEND_FILE = process.env.SPEND_FILE || "";
const UPSTREAM = new URL(process.env.UPSTREAM || "https://api.anthropic.com");
const IN_PER_TOK = 5 / 1e6, OUT_PER_TOK = 25 / 1e6;

if (!KEY) {
  console.error("The proxy needs ANTHROPIC_EVAL_KEY and it is not set, so no model call can be made.");
  process.exit(2);
}

const ledger = { calls: 0, refused: 0, errors: 0, inputTokens: 0, outputTokens: 0, usd: 0, cap: CAP, capReached: false, byStatus: {}, byModel: {} };
const save = () => { if (SPEND_FILE) try { fs.writeFileSync(SPEND_FILE, JSON.stringify(ledger, null, 2)); } catch { /* the ledger in memory still answers /__spend */ } };
save();

// Usage from a JSON body or from a server-sent-events stream.
function usageOf(body, contentType) {
  let inT = 0, outT = 0;
  const add = u => {
    if (!u || typeof u !== "object") return;
    inT += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  };
  if (/event-stream/.test(contentType || "")) {
    for (const line of body.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const ev = JSON.parse(line.slice(5));
        if (ev.type === "message_start") add(ev.message && ev.message.usage);
        if (ev.type === "message_start" && ev.message && ev.message.usage) outT = Math.max(outT, ev.message.usage.output_tokens || 0);
        if (ev.type === "message_delta" && ev.usage) outT = Math.max(outT, ev.usage.output_tokens || 0);
      } catch { /* a partial line is not usage */ }
    }
  } else {
    try { const j = JSON.parse(body); add(j.usage); outT = (j.usage && j.usage.output_tokens) || 0; } catch { /* an error body has no usage */ }
  }
  return { inT, outT };
}

const server = http.createServer((req, res) => {
  if (req.url === "/__spend") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(ledger));
  }
  const chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", () => {
    if (ledger.usd >= CAP) {
      ledger.refused++; ledger.capReached = true; save();
      res.writeHead(429, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: `nightly spend cap of $${CAP} reached; call refused by the counting proxy` } }));
    }
    const headers = { ...req.headers };
    delete headers.host; delete headers["accept-encoding"]; delete headers.authorization; delete headers["content-length"];
    headers["x-api-key"] = KEY;
    headers["accept-encoding"] = "identity";
    const body = Buffer.concat(chunks);
    let model = "unknown";
    try { model = JSON.parse(body.toString("utf8")).model || model; } catch { /* not JSON */ }
    headers["content-length"] = String(body.length);
    const up = https.request({ protocol: UPSTREAM.protocol, hostname: UPSTREAM.hostname, port: UPSTREAM.port || 443,
      path: req.url, method: req.method, headers, timeout: 300000 }, ur => {
      const out = [];
      res.writeHead(ur.statusCode, Object.fromEntries(Object.entries(ur.headers).filter(([k]) => !["content-length", "transfer-encoding", "content-encoding"].includes(k))));
      ur.on("data", c => { out.push(c); res.write(c); });
      ur.on("end", () => {
        res.end();
        const text = Buffer.concat(out).toString("utf8");
        const { inT, outT } = usageOf(text, ur.headers["content-type"]);
        ledger.calls++;
        ledger.byStatus[ur.statusCode] = (ledger.byStatus[ur.statusCode] || 0) + 1;
        if (ur.statusCode >= 400) ledger.errors++;
        const m = ledger.byModel[model] || (ledger.byModel[model] = { calls: 0, errors: 0 });
        m.calls++; if (ur.statusCode >= 400) m.errors++;
        console.log(`[nightly-ai proxy] ${req.method} ${req.url.split("?")[0]} ${model} -> ${ur.statusCode} (in ${inT}, out ${outT})`);
        ledger.inputTokens += inT; ledger.outputTokens += outT;
        ledger.usd = Math.round((ledger.inputTokens * IN_PER_TOK + ledger.outputTokens * OUT_PER_TOK) * 1e6) / 1e6;
        if (ledger.usd >= CAP) ledger.capReached = true;
        save();
      });
    });
    up.on("timeout", () => up.destroy(new Error("upstream timeout")));
    up.on("error", e => {
      ledger.errors++; save();
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "counting proxy could not reach the API: " + e.message } }));
    });
    up.end(body);
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`[nightly-ai proxy] listening on 127.0.0.1:${PORT}, cap $${CAP}`));
