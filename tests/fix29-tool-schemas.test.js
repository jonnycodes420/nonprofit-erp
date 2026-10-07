// tests/fix29-tool-schemas.test.js: FIX-29. EVERY TOOL SCHEMA FITS THE API.
//
//     A strict tool (structured outputs) may hold at most 16 union-typed
//     parameters (a type array such as ["string","null"], or anyOf/oneOf) and
//     at most 24 optional ones. Past either, the API refuses the whole request
//     with a 400, before the model reads a word. Show me's filter_spec was 18
//     the day PARITY-4 wrote it and 36 by WIRE-1; the Agent's find-people and
//     the Ask box's list both failed on it, and a catch hid it.
//
// No server and no database: every tool schema Steward sends is BUILT here,
// with the org's real filter list, and counted the way the API counts.
//   §1 each strict tool is within both limits.
//   §2 a tool over either limit is not strict (the API accepts a non-strict
//      tool of any size: probed 2026-10-06, planTool at 71 unions answered).
//   §3 the inventory is whole: every input_schema in the server's code is in
//      the list below, so a new tool cannot skip the count.
//   §4 the counter itself: filter_spec as PARITY-4 wrote it counts 18.
//
// HOW IT WOULD GO RED: give a SHOW_KEY back its own nullable field in
// specTool, or add a strict tool in a new file without listing it here.
// Proven able to fail: specTool as on main (36 nullable fields) turned §1 red.
const fs = require("fs");
const path = require("path");
const { ok, summary } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const UNION_LIMIT = 16, OPTIONAL_LIMIT = 24;

// The API's count: every parameter, at any depth, whose type is an array or
// that carries anyOf/oneOf; and every property not in its object's required.
function count(schema) {
  let unions = 0, optional = 0;
  const walk = s => {
    if (!s || typeof s !== "object") return;
    if (Array.isArray(s.type) || s.anyOf || s.oneOf) unions++;
    const req = new Set(s.required || []);
    for (const [k, v] of Object.entries(s.properties || {})) { if (!req.has(k)) optional++; walk(v); }
    if (s.items) walk(s.items);
    for (const v of [...(s.anyOf || []), ...(s.oneOf || [])]) walk(v);
  };
  walk(schema);
  return { unions, optional };
}

(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:1/none";   // groups.js loads db.js; nothing connects
  const GR = require("../groups");
  const AQ = require("../askQuery");
  const imp = f => import(path.join(ROOT, f));
  const [SM, C, N, B, CQ, O, A] = await Promise.all(["shared/showMe.js", "shared/askCatalog.js", "shared/meetingNote.js",
    "shared/briefShape.js", "shared/chequeRead.js", "shared/grantOutline.js", "shared/agentShape.js"].map(imp));

  // Every tool sent to the API, as the route sends it. `strict` is the
  // route's: crm.js and agent.js wrap the bare schemas with strict: true.
  const TOOLS = [
    { name: "filter_spec (Show me, Agent find people)", strict: !!SM.specTool().strict, schema: SM.specTool().input_schema },
    { name: "ask_plan (Ask box)", strict: !!C.planTool({ ruleKeys: GR.RULE_KEYS }).strict, schema: C.planTool({ ruleKeys: GR.RULE_KEYS }).input_schema },
    { name: "query_plan (Ask query layer)", strict: !!AQ.queryTool().strict, schema: AQ.queryTool().input_schema },
    { name: "suggest_chips (meeting note)", strict: !!N.NOTE_CHIP_TOOL.strict, schema: N.NOTE_CHIP_TOOL.input_schema },
    { name: "suggest_conversation_chips", strict: !!N.CONVERSATION_CHIP_TOOL.strict, schema: N.CONVERSATION_CHIP_TOOL.input_schema },
    { name: "brief (donor brief)", strict: true, schema: B.BRIEF_SCHEMA },
    { name: "cheque read", strict: true, schema: CQ.CHEQUE_READ_SCHEMA },
    { name: "outline (grant report)", strict: true, schema: O.OUTLINE_SCHEMA },
    { name: "plan (Agent)", strict: true, schema: A.PLAN_SCHEMA },
    { name: "drafts (Agent, ten at a time)", strict: true, schema: A.DRAFTS_SCHEMA },
  ];

  for (const t of TOOLS) {
    const c = count(t.schema);
    if (t.strict) {
      ok(`§1 ${t.name}: ${c.unions} union params (limit ${UNION_LIMIT})`, c.unions <= UNION_LIMIT, c);
      ok(`§1 ${t.name}: ${c.optional} optional params (limit ${OPTIONAL_LIMIT})`, c.optional <= OPTIONAL_LIMIT, c);
    } else {
      ok(`§2 ${t.name} is not strict, so its ${c.unions} unions and ${c.optional} optional params are allowed`, true);
    }
  }

  // filter_spec keeps every filter Show me had: its field enum IS SHOW_KEYS.
  const f = SM.specTool().input_schema.properties.filters;
  ok("§1 filter_spec still offers every Show me filter", JSON.stringify(f && f.items.properties.field.enum) === JSON.stringify(SM.SHOW_KEYS)
    && SM.SHOW_KEYS.every(k => GR.RULE_KEYS.includes(k)), f && f.items.properties.field.enum);
  // And the model's list reads back to the same rules the old form gave.
  const read = SM.readToolSpec([{ type: "tool_use", name: "filter_spec", input: {
    filters: [{ field: "state", value: "North Carolina" }, { field: "noContactSince", value: "2026-04-06" }], suggestAsk: false, unsupported: "" } }]);
  ok("§1 the list reads back as rules", JSON.stringify(read) === JSON.stringify({ rules: { state: "NC", noContactSince: "2026-04-06" }, unsupported: null, withAsk: false }), read);
  const twice = SM.readToolSpec([{ type: "tool_use", name: "filter_spec", input: {
    filters: [{ field: "state", value: "NC" }, { field: "state", value: "SC" }], suggestAsk: false, unsupported: "" } }]);
  ok("§1 one filter with two values is refused, not the last one kept", !!twice.unsupported, twice);

  // §3 THE INVENTORY IS WHOLE. Each file's input_schema count is what the
  // list above covers; a new one fails here until it is added.
  const EXPECTED = { "askQuery.js": 1, "shared/meetingNote.js": 2, "shared/askCatalog.js": 1, "shared/showMe.js": 1,
    "routes/crm.js": 3, "routes/agent.js": 2, "scripts/build95-cheque-drill.js": 1 };
  const found = {};
  const scan = dir => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!["node_modules", "client", "tests", "dist", "docs", ".git", "audit"].includes(e.name) && !e.name.startsWith(".")) scan(rel); continue; }
      if (!/\.(c|m)?js$/.test(e.name)) continue;
      const n = (fs.readFileSync(path.join(ROOT, rel), "utf8").match(/input_schema\s*:/g) || []).length;
      if (n) found[rel] = n;
    }
  };
  scan("");
  ok("§3 every input_schema in the code is in this suite's list", JSON.stringify(found, Object.keys(found).sort()) === JSON.stringify(EXPECTED, Object.keys(EXPECTED).sort()), found);

  // §4 THE COUNTER COUNTS. filter_spec as PARITY-4 wrote it: 16 filters and
  // two more fields, each ["string","null"], all required.
  const old = { type: "object", properties: {}, required: [] };
  for (let i = 0; i < 18; i++) { old.properties["k" + i] = { type: ["string", "null"] }; old.required.push("k" + i); }
  ok("§4 the PARITY-4 shape counts 18 unions, over the limit", count(old).unions === 18 && count(old).optional === 0, count(old));

  summary();
})().catch(e => { console.error(e); process.exit(1); });
