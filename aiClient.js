// aiClient.js — FIX-12 Part 3. THE ONE DOOR TO A MODEL.
//
// Every model call in Steward (Anthropic for drafting, reading and summing up;
// OpenAI for voice-memo transcription) goes through this file, and this file
// asks the org's AI switch FIRST, on every call. Before FIX-12 the switch was a
// gate some routes remembered to ask: the score rationale, the board-report
// summary, the voice memo and the column mapper never did, so "off" meant
// "mostly off". Now a route cannot reach a model without passing the gate,
// because the SDK and the transcription URL live nowhere else
// (tests/fix12-ai-switch.test.js fails on a `new Anthropic(` or an OpenAI URL
// anywhere outside this file).
//
// Two conditions, and the reason says WHICH (moved here from server.js, BUILD-96):
//   ai_no_key   — no key for that provider. Steward's state, not the org's.
//   ai_disabled — the org turned AI off in Settings. Its choice, per org.
//
// A refused call throws AiOffError. A route that has a non-AI path catches it
// and takes that path; one that does not lets it reach the error handler,
// which answers 403 with AI_OFF_MESSAGE (code "ai_off") instead of a 500.

const Anthropic = require("@anthropic-ai/sdk");
const { query } = require("./db");

const AI_OFF_MESSAGE = "AI is turned off for your organization";

class AiOffError extends Error {
  constructor(reason) {
    super(reason === "ai_disabled" ? AI_OFF_MESSAGE : "AI isn't available on this server.");
    this.name = "AiOffError";
    this.code = "ai_off";
    this.reason = reason;
  }
}

const KEYS = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

async function aiGate(orgId, provider = "anthropic") {
  if (!process.env[KEYS[provider]]) return { ok: false, reason: "ai_no_key" };
  const [org] = await query("SELECT ai_enabled FROM orgs WHERE id=?", [orgId]);
  if (!org) return { ok: false, reason: "org_not_found" };
  // A column added by a migration that has not run yet reads undefined, and
  // undefined must mean ON — the same direction as the DEFAULT.
  if (org.ai_enabled === false) return { ok: false, reason: "ai_disabled" };
  return { ok: true, reason: null };
}

async function requireAi(orgId, provider) {
  const g = await aiGate(orgId, provider);
  if (!g.ok) throw new AiOffError(g.reason);
}

// An Anthropic client for ONE org. Each messages.create / messages.stream asks
// the gate again, so a client held across a long plan still stops the moment
// the switch goes off. `stream` is async here (the SDK's is sync): await it.
function anthropicFor(orgId) {
  if (!orgId) throw new Error("anthropicFor needs the org it is calling for");
  let real = null;
  const sdk = () => (real = real || new Anthropic());
  return {
    messages: {
      create: async (args, opts) => { await requireAi(orgId); return sdk().messages.create(args, opts); },
      stream: async (args, opts) => { await requireAi(orgId); return sdk().messages.stream(args, opts); },
    },
  };
}

// Voice-memo transcription (OpenAI Whisper). Receives the recording and
// nothing else: no donor name, no org name. OPENAI_BASE_URL exists for tests.
async function transcribeAudio(orgId, { audioBuffer, mimeType, ext }) {
  await requireAi(orgId, "openai");
  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: mimeType || "audio/webm" }), `memo.${ext}`);
  form.append("model", "whisper-1");
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com";
  return fetch(`${base}/v1/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
}

module.exports = { AI_OFF_MESSAGE, AiOffError, aiGate, requireAi, anthropicFor, transcribeAudio };
