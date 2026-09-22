#!/usr/bin/env node
// BUILD-95 — THE CHEQUE-READING DRILL. SELF_REFUSING.
//
// The suite proves the arithmetic: two readings that agree settle a line, and
// every other case refuses. What it CANNOT prove is whether the model reads a
// real cheque correctly, because that needs a real key, a real image and real
// money spent — and a mock that answered for it would be the BUILD-57 mistake
// again (three builds proven against a mock that lied in seven ways).
//
// So this is the boundary drill. Point it at real photographs of real cheques
// and read what comes back with your own eyes. It writes NOTHING and needs no
// database: it calls the model directly through the same module the route uses.
//
//   ANTHROPIC_API_KEY=sk-ant-… node scripts/build95-cheque-drill.js cheque1.jpg cheque2.jpg
//
// What to look for, in order of how much it would cost to get wrong:
//   1. An amount it settled that is NOT what the cheque says. This is the only
//      outcome that can reach a gift, and the only one that matters.
//   2. An amount it refused that a person can read easily — annoying, not
//      dangerous, but it is the cost side of the trade.
//   3. A payer name it invented rather than left blank.
const fs = require("fs");
const path = require("path");

if (process.env.NODE_ENV === "production") {
  console.error("This drill does not run in production."); process.exit(1);
}
const files = process.argv.slice(2);
if (!files.length) { console.error("Usage: node scripts/build95-cheque-drill.js <image> [image…]"); process.exit(1); }
if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY is not set — nothing to drill."); process.exit(1); }

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

(async () => {
  const Anthropic = require("@anthropic-ai/sdk");
  const cr = await import("../shared/chequeRead.js");
  const { normalizeMoney } = await import("../shared/importShape.js");
  const client = new Anthropic();
  const money = c => "$" + (c / 100).toFixed(2);
  const TOOL = { name: "record_cheque", description: "Record exactly what is written on this cheque.",
                 strict: true, input_schema: cr.CHEQUE_READ_SCHEMA };

  let settled = 0;
  for (const f of files) {
    const media = MIME[path.extname(f).toLowerCase()];
    if (!media) { console.log(`\n${f}\n  skipped — not an image this drill reads`); continue; }
    const data = fs.readFileSync(f).toString("base64");

    const msg = await client.messages.create({
      model: cr.CHEQUE_READ_MODEL,
      max_tokens: 2048,
      system: cr.CHEQUE_READ_PROMPT,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "record_cheque" },
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: media, data } },
        { type: "text", text: "Transcribe this cheque." },
      ] }],
    });
    const block = (msg.content || []).find(b => b.type === "tool_use");
    const out = block ? block.input : null;
    console.log(`\n${f}`);
    if (!out) { console.log("  the model returned no transcription"); continue; }

    const dm = normalizeMoney(out.amountDigits || "");
    const rec = cr.reconcileAmount(
      dm.value == null ? null : Math.round(dm.value * 100),
      cr.writtenAmountToCents(out.amountWords));

    console.log(`  payer   ${out.payer ?? "(not read)"}`);
    console.log(`  box     ${out.amountDigits ?? "(not read)"}`);
    console.log(`  line    ${out.amountWords ?? "(not read)"}`);
    console.log(`  memo    ${out.memo ?? "(blank)"}`);
    console.log(`  cheque# ${out.chequeNumber ?? "(not read)"}   date ${out.date ?? "(not read)"}`);
    if (out.unreadable?.length) console.log(`  unread  ${out.unreadable.join("; ")}`);
    if (rec.agreed) { settled++; console.log(`  → SETTLED at ${money(rec.cents)} — CHECK THIS AGAINST THE CHEQUE.`); }
    else console.log(`  → not settled: ${cr.unsettledSentence(rec, money)}`);
    console.log(`  usage   in ${msg.usage?.input_tokens} · out ${msg.usage?.output_tokens}`);
  }
  console.log(`\n${settled} of ${files.length} settled. Every settled amount is one you must read back yourself.`);
})().catch(e => { console.error(e); process.exit(1); });
